//! Connection supervisor: owns the serial driver on a background thread,
//! keeps the link alive (Bluetooth cycle on failure), polls PIDs at ~1 Hz,
//! writes every reading to SQLite, and dispatches one-shot requests (DTC
//! scan, UDS reads, etc.) that arrive over a command channel.
//!
//! This file is deliberately just the connection lifecycle and request
//! dispatch — the actual OBD/UDS business logic lives in `obd.rs` and
//! `uds.rs` respectively. `handle_request` is the seam between them.

use super::driver::{self, ElmDriver};
use super::obd;
use super::parser;
use super::uds;
use crate::db::Db;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;

#[derive(Clone, Serialize, Default)]
pub struct ConnStatus {
    pub state: String, // "disconnected" | "connecting" | "connected"
    pub elm_version: Option<String>,
    pub detail: Option<String>,
    // The CURRENT connection's own resolved identity — never a cache of a
    // previous car (the exact bug caught live 2026-08-21: a failed VIN read
    // on a real Peugeot left the app silently showing the Citroën's
    // identity everywhere). `vin`/`vehicle_id` are None when this
    // connection's vehicle couldn't be identified — the frontend renders an
    // honest unknown-vehicle state then, with a "name this car" action that
    // creates a VIN-less vehicles row (schema v2, db.rs). `vehicle_is_new`
    // is true when THIS connect created the vehicles row — it replaces the
    // frontend's old knownVins-snapshot comparison for triggering the
    // first-connect discovery flow.
    pub vin: Option<String>,
    pub vehicle_id: Option<i64>,
    pub display_name: Option<String>,
    pub vehicle_is_new: bool,
    // A UDS scan (auto-discovery or a manual range scan) is running —
    // standard PID polling is paused for its duration, so live gauges go
    // stale everywhere. Carried on the SAME global conn-status broadcast
    // every tab already listens to, so any view (Live, Lab, Overview) can
    // show an honest "scanning, live data will be back when finished"
    // state instead of a silently frozen/empty one, and the state itself
    // survives switching tabs for free (owner, 2026-08-24).
    pub scanning: bool,
}

/// The live connection's identity context, threaded into every handler that
/// records facts — schema v2's rule: every recorded fact carries
/// `connection_id` and (when identified) `vehicle_id`.
#[derive(Clone, Copy)]
pub struct ConnCtx {
    pub connection_id: i64,
    pub vehicle_id: Option<i64>,
}

pub enum Request {
    ScanDtcs(Sender<Result<obd::DtcResult, String>>),
    ClearDtcs(Sender<Result<obd::ObdClearOutcome, String>>),
    ReadEcuInfo(Sender<Result<obd::EcuInfo, String>>),
    Readiness(Sender<Result<HashMap<String, bool>, String>>),
    AllSensors(Sender<Result<Vec<obd::SensorReading>, String>>),
    UdsRead { module: String, did: u16, tx: Sender<Result<Option<uds::UdsHit>, String>> },
    UdsScan { module: String, from: u16, to: u16, tx: Sender<Result<Vec<uds::UdsHit>, String>> },
    /// One-button auto-discovery: no ranges, no addresses, no user input.
    Discover { full: bool, tx: Sender<Result<uds::DiscoveryReport, String>> },
    UdsClear { module: String, tx: Sender<Result<uds::ClearOutcome, String>> },
    UdsModuleDtcs { module: String, tx: Sender<Result<Vec<String>, String>> },
    /// The "name this car" flow for VIN-less vehicles: creates the vehicles
    /// row, links the live connection, back-stamps everything it already
    /// recorded, and re-emits conn-status with the new identity.
    NameVehicle { name: String, tx: Sender<Result<i64, String>> },
    Stop,
}

pub struct Supervisor {
    pub tx: Sender<Request>,
    pub status: Arc<Mutex<ConnStatus>>,
    /// Flipped by the UI's "Cancel scan" button (or by Disconnect, so it can't
    /// get stuck queued behind a long-running scan). Checked once per DID
    /// inside `uds::scan_range`, so a scan aborts within one DID's timeout.
    pub cancel_scan: Arc<AtomicBool>,
}

impl Supervisor {
    pub fn spawn(app: tauri::AppHandle, db: Arc<Db>) -> Self {
        let (tx, rx) = mpsc::channel::<Request>();
        let status = Arc::new(Mutex::new(ConnStatus {
            state: "disconnected".into(),
            ..Default::default()
        }));
        let cancel_scan = Arc::new(AtomicBool::new(false));
        let status_clone = status.clone();
        let cancel_clone = cancel_scan.clone();
        std::thread::spawn(move || run_loop(app, db, rx, status_clone, cancel_clone));
        Self { tx, status, cancel_scan }
    }
}

fn set_status(app: &tauri::AppHandle, status: &Arc<Mutex<ConnStatus>>, s: ConnStatus) {
    *status.lock().unwrap() = s.clone();
    let _ = app.emit("conn-status", &s);
}

/// Flips just the `scanning` flag on the current status and re-broadcasts
/// it — used around any UDS scan (auto-discovery or the manual range
/// scanner), both of which block standard PID polling for their duration.
/// Every tab already listens to conn-status, so this is how "a scan is
/// running" becomes visible everywhere for free (owner, 2026-08-24).
fn set_scanning(app: &tauri::AppHandle, status: &Arc<Mutex<ConnStatus>>, scanning: bool) {
    let snapshot = {
        let mut guard = status.lock().unwrap();
        guard.scanning = scanning;
        guard.clone()
    };
    let _ = app.emit("conn-status", &snapshot);
}

fn notify(app: &tauri::AppHandle, title: &str, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title(title).body(body).show();
}

/// The main loop: alternates between a (re)connect phase and a polling phase.
/// Any link failure during polling (8 consecutive command failures) drops
/// back to reconnect rather than giving up — this is what makes the app
/// self-heal through the dongle's "sulk mode" without user intervention.
fn run_loop(
    app: tauri::AppHandle,
    db: Arc<Db>,
    rx: Receiver<Request>,
    status: Arc<Mutex<ConnStatus>>,
    cancel_scan: Arc<AtomicBool>,
) {
    'outer: loop {
        // ---- (re)connect phase ----
        set_status(&app, &status, ConnStatus { state: "connecting".into(), ..Default::default() });
        let mut drv = match connect_with_retries(&db) {
            Ok(d) => d,
            Err(e) => {
                set_status(&app, &status, ConnStatus {
                    state: "disconnected".into(),
                    detail: Some(e),
                    ..Default::default()
                });
                // Wait a bit, but stay responsive to Stop.
                match rx.recv_timeout(Duration::from_secs(10)) {
                    Ok(Request::Stop) => return,
                    Ok(req) => { answer_disconnected(req); }
                    Err(_) => {}
                }
                continue;
            }
        };
        let version = match drv.init() {
            Ok(v) => v,
            Err(e) => {
                set_status(&app, &status, ConnStatus {
                    state: "disconnected".into(),
                    detail: Some(e.to_string()),
                    ..Default::default()
                });
                continue;
            }
        };
        // Wake the ECU / detect protocol.
        let _ = drv.cmd("0100", Duration::from_secs(20));
        let connection_id = db.start_connection(&version, "vgate_icar_pro");
        // Resolve this connection's vehicle. The VIN read decides whether
        // the app recognizes what's connected at all — retried up to 3
        // times (the first query right after the 0100 wake-up is the one
        // most likely to land before the bus settles), logged loudly on
        // failure. A car whose ECU never answers Mode 09 (real case: a
        // ~2000 Peugeot, 2026-08-21) stays unidentified: the connection
        // records with NULL vehicle_id until the user names the car
        // (Request::NameVehicle below) — never silently attributed to a
        // previously-connected vehicle.
        let mut resolved_vin: Option<String> = None;
        for attempt in 1..=3 {
            match obd::query(&mut drv, "0902", "49 02 01", 15) {
                Ok(vin_payload) => {
                    let vin = parser::decode_vin(&vin_payload);
                    if vin.len() == 17 {
                        resolved_vin = Some(vin);
                        break;
                    }
                    log::warn!(
                        "VIN read attempt {attempt}/3: got {} bytes, decoded to {:?} (want 17 chars)",
                        vin_payload.len(),
                        vin
                    );
                }
                Err(e) => log::warn!("VIN read attempt {attempt}/3 failed: {e}"),
            }
            if attempt < 3 {
                std::thread::sleep(Duration::from_millis(300));
            }
        }
        let (vehicle_id, display_name, vehicle_is_new) = match &resolved_vin {
            Some(vin) => {
                let (id, created) = db.ensure_vehicle(vin);
                db.link_connection_vehicle(connection_id, id);
                let name = db.vehicle(id).and_then(|v| v.display_name);
                (Some(id), name, created)
            }
            None => {
                log::warn!(
                    "VIN read failed after 3 attempts — this connection records as an unidentified vehicle until the user names it"
                );
                (None, None, false)
            }
        };
        let mut ctx = ConnCtx { connection_id, vehicle_id };
        set_status(&app, &status, ConnStatus {
            state: "connected".into(),
            elm_version: Some(version.clone()),
            detail: None,
            vin: resolved_vin.clone(),
            vehicle_id,
            display_name,
            vehicle_is_new,
            scanning: false,
        });

        // Adaptive polling: ask the ECU once which mode-01 PIDs it supports
        // and poll only those. The old Peugeot answers 5 of the poll set's
        // 12 — before this, the other 7 burned a NO DATA timeout on EVERY
        // sweep (multi-second sweeps, sluggish live data, requests queuing
        // behind dead reads). Empty result = bitmap read failed = poll
        // everything, the pre-existing behavior.
        let supported_pids = obd::supported_pids(&mut drv);
        if supported_pids.is_empty() {
            log::warn!("supported-PID bitmap unavailable — polling the full set");
        } else {
            let polled: Vec<&str> = parser::PIDS
                .iter()
                .filter(|p| {
                    u8::from_str_radix(&p.pid[2..], 16)
                        .map(|n| supported_pids.contains(&n))
                        .unwrap_or(true)
                })
                .map(|p| p.key)
                .collect();
            log::info!("ECU supports {} PIDs; polling: {}", supported_pids.len(), polled.join(", "));
        }

        let mut consecutive_failures = 0u32;
        let mut tick: u64 = 0;
        let mut alerts_fired: std::collections::HashSet<&'static str> = Default::default();
        let mut low_voltage_streak = 0u32;

        // ---- polling phase ----
        // Drains every queued one-shot request. A macro (not a fn/closure)
        // because Stop must `return` from run_loop itself, and NameVehicle
        // mutates the loop's own ctx and re-emits conn-status. Invoked both
        // at the top of each tick AND between individual PID reads below —
        // requests used to wait for a whole 12-PID sweep (seconds on a slow
        // bus) before even starting, the second half of the "click scan,
        // nothing happens for a beat" jank reported live 2026-08-21 (the
        // first half was sync Tauri commands blocking the main thread, see
        // lib.rs's ask()). Now a request waits at most one PID read.
        macro_rules! service_requests {
            () => {
                while let Ok(req) = rx.try_recv() {
                    match req {
                        Request::Stop => {
                            db.end_connection(ctx.connection_id);
                            set_status(&app, &status, ConnStatus { state: "disconnected".into(), ..Default::default() });
                            return;
                        }
                        Request::NameVehicle { name, tx } => {
                            let trimmed = name.trim();
                            if trimmed.is_empty() {
                                let _ = tx.send(Err("name is empty".into()));
                            } else if ctx.vehicle_id.is_some() {
                                let _ = tx.send(Err("this connection already has an identified vehicle".into()));
                            } else {
                                let id = db.create_vehicle_named(trimmed);
                                db.link_connection_vehicle(ctx.connection_id, id);
                                ctx.vehicle_id = Some(id);
                                set_status(&app, &status, ConnStatus {
                                    state: "connected".into(),
                                    elm_version: Some(version.clone()),
                                    detail: None,
                                    vin: None,
                                    vehicle_id: Some(id),
                                    display_name: Some(trimmed.to_string()),
                                    // Naming IS this vehicle's first appearance.
                                    vehicle_is_new: true,
                                    scanning: false,
                                });
                                let _ = tx.send(Ok(id));
                            }
                        }
                        req => handle_request(req, &mut drv, &db, &cancel_scan, &app, ctx, &status),
                    }
                }
            };
        }

        loop {
            service_requests!();

            let mut values: HashMap<String, f64> = HashMap::new();
            for pid in parser::PIDS {
                if !supported_pids.is_empty() {
                    let n = u8::from_str_radix(&pid.pid[2..], 16).unwrap_or(0);
                    if !supported_pids.contains(&n) {
                        continue;
                    }
                }
                service_requests!();
                match drv.cmd(pid.pid, Duration::from_secs(3)) {
                    Ok(raw) => {
                        let lines = parser::clean_response(&raw);
                        let payload = parser::payload_bytes(&lines, &format!("41 {}", &pid.pid[2..]));
                        if let Some(v) = (pid.decode)(&payload) {
                            values.insert(pid.key.to_string(), v);
                            db.insert_reading(ctx.connection_id, ctx.vehicle_id, pid.key, v);
                        }
                        consecutive_failures = 0;
                    }
                    Err(_) => {
                        consecutive_failures += 1;
                        if consecutive_failures > 8 {
                            // Link is gone — go back to reconnect phase.
                            db.end_connection(ctx.connection_id);
                            continue 'outer;
                        }
                    }
                }
            }
            // Voltage every ~15 ticks.
            if tick % 15 == 0 {
                if let Ok(raw) = drv.cmd("ATRV", Duration::from_secs(3)) {
                    if let Some(v) = parser::clean_response(&raw)
                        .first()
                        .and_then(|l| parser::decode_voltage(l))
                    {
                        values.insert("voltage".into(), v);
                        db.insert_reading(ctx.connection_id, ctx.vehicle_id, "voltage", v);
                    }
                }
            }

            // ---- Alerts (once per session each) ----
            if let Some(&t) = values.get("coolant") {
                if t > 105.0 && alerts_fired.insert("coolant") {
                    notify(&app, "Coolant overheating", &format!("{t:.0}°C — stop when safe and check"));
                }
            }
            if let Some(&v) = values.get("voltage") {
                let running = values.get("rpm").map(|&r| r > 400.0).unwrap_or(false);
                if running && v < 11.8 {
                    low_voltage_streak += 1;
                    // Voltage samples come every ~20-30s; two in a row = sustained.
                    if low_voltage_streak >= 2 && alerts_fired.insert("voltage") {
                        notify(&app, "Battery voltage low while running", &format!("{v:.1} V — charging system may have a problem"));
                    }
                } else {
                    low_voltage_streak = 0;
                }
            }
            // User-defined UDS probes every ~120 ticks (~30-60 s).
            if tick > 0 && tick % 120 == 0 {
                let uds_values = uds::poll_probes(&mut drv, &db, ctx);
                for (k, v) in uds_values {
                    values.insert(k, v);
                }
            }

            // MIL watch every ~240 ticks (~1-2 min): does the check-engine light come on?
            if tick > 0 && tick % 240 == 0 {
                if let Ok(raw) = drv.cmd("0101", Duration::from_secs(5)) {
                    let lines = parser::clean_response(&raw);
                    let payload = parser::payload_bytes(&lines, "41 01");
                    if let Some(m) = parser::decode_mil(&payload) {
                        if m.mil_on && alerts_fired.insert("mil") {
                            notify(&app, "Check-engine light is on", &format!("{} code(s) stored — run a scan in Scainner", m.dtc_count));
                        }
                    }
                }
            }

            if !values.is_empty() {
                let _ = app.emit("live-update", &values);
            }
            tick += 1;
            std::thread::sleep(Duration::from_millis(250));
        }
    }
}

/// Escalation ladder, cheapest first:
///   attempt 0 — FAST PATH: if the port node already exists, just open it and
///     probe. A healthy link reconnects in ~2-3s instead of the ~10s a full
///     BT cycle costs. (The stale-port trap is real — the node can exist with
///     a dead RFCOMM link behind it — but the probe catches that, and we only
///     pay the escalation cost when it actually happens.)
///   attempt 1 — plain BT disconnect/connect cycle.
///   attempt 2 — full PIN re-pair (the dongle's sulk-state cure).
///
/// This is a general-purpose ladder because dongles vary: most reconnect
/// fine at attempt 0 or 1, and always jumping straight to a full unpair/
/// re-pair would be needlessly disruptive for them (heavier on the OS
/// Bluetooth stack, and it uses `SCAINNER_OBD_PIN`, which may not even be
/// the right PIN for someone else's hardware).
///
/// But *this specific dongle* (see driver.rs's "sulk mode") empirically
/// needs the full repair essentially every time — so starting from scratch
/// at attempt 0 on every single connection just burns ~10-15s on steps that
/// are known not to work before reaching the one that does. Rather than
/// hardcode that assumption (which would be wrong for better-behaved
/// hardware), we learn it: the level that last succeeded is persisted
/// (`car_info` key `bt_connect_level`) and the ladder starts there next
/// time. A dongle that only ever needs attempt 0 stays fast forever; one
/// that needs attempt 2 skips straight to it after the first connection.
fn connect_with_retries(db: &Db) -> Result<ElmDriver, String> {
    let port = driver::port();
    let bt_addr = driver::bt_addr();
    let pin = std::env::var("SCAINNER_OBD_PIN").unwrap_or_else(|_| "1234".to_string());
    let start = db
        .setting_get("bt_connect_level")
        .and_then(|v| v.parse::<u8>().ok())
        .filter(|&level| level <= 2)
        .unwrap_or(0);
    if start > 0 {
        log::debug!("connect: skipping to attempt {start} (learned from last successful connect)");
    }
    for attempt in start..3 {
        if attempt == 0 {
            if std::path::Path::new(&port).exists() {
                log::debug!("connect attempt 0: fast path — port exists, probing directly");
            } else {
                log::debug!("connect attempt 0: no port node, bluetooth cycle...");
                driver::bluetooth_cycle(&bt_addr)?;
            }
        } else if attempt == 1 {
            log::debug!("connect attempt 1: bluetooth cycle...");
            driver::bluetooth_cycle(&bt_addr)?;
        } else {
            log::debug!("connect attempt 2: full PIN re-pair...");
            driver::bluetooth_repair(&bt_addr, &pin)?;
        }
        // Let the RFCOMM channel settle before opening — opening too early
        // wedges it. Only needed after a cycle/repair; the fast path opens an
        // already-settled link.
        if attempt > 0 {
            std::thread::sleep(Duration::from_secs(2));
        }
        log::debug!("connect attempt {attempt}: opening {port}");
        match ElmDriver::open(&port) {
            Ok(mut d) => {
                // Liveness probe: ATZ on the open port. Fast path gets one
                // short try (a healthy link answers in <1s; a dead one should
                // fail fast so escalation starts sooner); post-cycle attempts
                // get two patient tries since fresh links often eat the first
                // write.
                let (tries, per_try) = if attempt == 0 { (1, Duration::from_secs(3)) } else { (2, Duration::from_secs(5)) };
                let mut alive = false;
                for probe_try in 0..tries {
                    let probe = d.cmd("ATZ", per_try);
                    log::trace!("connect attempt {attempt} probe {probe_try}: ATZ -> {probe:?}");
                    if matches!(&probe, Ok(r) if r.contains("ELM")) {
                        alive = true;
                        break;
                    }
                    std::thread::sleep(Duration::from_secs(1));
                }
                if alive {
                    db.setting_set("bt_connect_level", &attempt.to_string());
                    return Ok(d);
                }
                if attempt == 2 {
                    return Err("port opens but ELM stays silent after 3 BT cycles".into());
                }
            }
            Err(e) => {
                log::debug!("connect attempt {attempt}: open failed -> {e}");
                if attempt == 2 {
                    return Err(e.to_string());
                }
                std::thread::sleep(Duration::from_secs(1));
            }
        }
    }
    unreachable!()
}

fn answer_disconnected(req: Request) {
    let err = "not connected".to_string();
    match req {
        Request::ScanDtcs(tx) => { let _ = tx.send(Err(err)); }
        Request::ClearDtcs(tx) => { let _ = tx.send(Err(err)); }
        Request::ReadEcuInfo(tx) => { let _ = tx.send(Err(err)); }
        Request::Readiness(tx) => { let _ = tx.send(Err(err)); }
        Request::AllSensors(tx) => { let _ = tx.send(Err(err)); }
        Request::UdsRead { tx, .. } => { let _ = tx.send(Err(err)); }
        Request::UdsScan { tx, .. } => { let _ = tx.send(Err(err)); }
        Request::Discover { tx, .. } => { let _ = tx.send(Err(err)); }
        Request::UdsClear { tx, .. } => { let _ = tx.send(Err(err)); }
        Request::UdsModuleDtcs { tx, .. } => { let _ = tx.send(Err(err)); }
        Request::NameVehicle { tx, .. } => { let _ = tx.send(Err(err)); }
        Request::Stop => {}
    }
}

/// Dispatch one request to the right business-logic module. This is the only
/// place that knows both "how to talk to the car" (via `drv`) and "what the
/// UI asked for" (via `Request`) — everything past this point is either
/// `obd::` (standard, any-car) or `uds::` (manufacturer-specific) logic.
fn handle_request(
    req: Request,
    drv: &mut ElmDriver,
    db: &Db,
    cancel_scan: &AtomicBool,
    app: &tauri::AppHandle,
    ctx: ConnCtx,
    status: &Arc<Mutex<ConnStatus>>,
) {
    match req {
        Request::ScanDtcs(tx) => {
            let res = obd::scan_dtcs(drv).map(|r| {
                db.insert_dtc_scan(
                    Some(ctx.connection_id),
                    ctx.vehicle_id,
                    r.mil_on,
                    &r.stored,
                    &r.pending,
                    &r.permanent,
                    r.voltage,
                    r.freeze.as_ref(),
                );
                r
            });
            let _ = tx.send(res);
        }
        Request::ClearDtcs(tx) => {
            // Write safety rail: read before, clear, read after, and ALWAYS
            // log the attempt to writes_log once the clear command has been
            // sent (a failed before-scan aborts without writing, so it is
            // not logged as a write — nothing touched the car).
            let dtc_json = |r: &obd::DtcResult| {
                serde_json::json!({
                    "mil_on": r.mil_on,
                    "stored": r.stored,
                    "pending": r.pending,
                    "permanent": r.permanent,
                })
            };
            let params = serde_json::json!({ "mode": "04" });
            let res = match obd::clear_and_verify(drv) {
                Ok(outcome) => {
                    // The post-clear scan lands in history like any other
                    // scan, same as the UI's old clear-then-rescan flow did.
                    let a = &outcome.after;
                    db.insert_dtc_scan(
                        Some(ctx.connection_id),
                        ctx.vehicle_id,
                        a.mil_on,
                        &a.stored,
                        &a.pending,
                        &a.permanent,
                        a.voltage,
                        a.freeze.as_ref(),
                    );
                    let verdict = if a.stored.is_empty() && a.pending.is_empty() { "cleared" } else { "faults_remain" };
                    db.log_write(
                        Some(ctx.connection_id),
                        ctx.vehicle_id,
                        "Engine (OBD)",
                        "clear_dtcs",
                        &params,
                        Some(&dtc_json(&outcome.before)),
                        Some(&dtc_json(a)),
                        verdict,
                        None,
                    );
                    Ok(outcome)
                }
                Err(obd::ClearError::BeforeScanFailed(e)) => {
                    Err(format!("Could not read the current codes before clearing, so nothing was cleared: {e}"))
                }
                Err(obd::ClearError::ClearFailed { before, error }) => {
                    db.log_write(
                        Some(ctx.connection_id),
                        ctx.vehicle_id,
                        "Engine (OBD)",
                        "clear_dtcs",
                        &params,
                        Some(&dtc_json(&before)),
                        None,
                        "error",
                        Some(&error),
                    );
                    Err(format!("The clear command failed: {error}"))
                }
                Err(obd::ClearError::VerifyFailed { before, error }) => {
                    db.log_write(
                        Some(ctx.connection_id),
                        ctx.vehicle_id,
                        "Engine (OBD)",
                        "clear_dtcs",
                        &params,
                        Some(&dtc_json(&before)),
                        None,
                        "error",
                        Some(&format!("clear sent, but the verification scan failed: {error}")),
                    );
                    Err(format!("The clear was sent, but the verification scan failed: {error}. Run a new scan to see the current state."))
                }
            };
            let _ = tx.send(res);
        }
        Request::ReadEcuInfo(tx) => {
            let res = obd::read_ecu_info(drv).map(|info| {
                // protocol/elm_version are real values read straight from
                // the adapter — they belong to THIS connection now (schema
                // v2), not to a global cache. The VIN in this response is
                // display-only: the connect handshake already resolved the
                // vehicle identity (or honestly didn't), and a manual
                // "Read from ECU" click must not re-litigate it.
                db.set_connection_protocol(ctx.connection_id, &info.protocol);
                info
            });
            let _ = tx.send(res);
        }
        Request::Readiness(tx) => {
            let _ = tx.send(obd::readiness(drv));
        }
        Request::AllSensors(tx) => {
            // Persist the sweep, not just display it: the full-catalog
            // sweep is exactly the "which sensors does THIS car actually
            // answer" map, and before this it evaporated with the UI. As
            // plain readings rows it lands per-vehicle, feeds the reports,
            // and rides the cloud sync like everything else. The map
            // itself is then just DISTINCT keys for the vehicle joined
            // against parser.rs's static FULL_PIDS catalog.
            let res = obd::read_all_sensors(drv).map(|list| {
                for s in &list {
                    db.insert_reading(ctx.connection_id, ctx.vehicle_id, &s.key, s.value);
                }
                list
            });
            let _ = tx.send(res);
        }
        Request::UdsRead { module, did, tx } => {
            let _ = tx.send(uds::read_one(drv, db, &module, did));
        }
        Request::UdsScan { module, from, to, tx } => {
            cancel_scan.store(false, Ordering::Relaxed);
            set_scanning(app, status, true);
            let result = uds::scan_range(drv, db, &module, from, to, cancel_scan, app);
            set_scanning(app, status, false);
            let _ = tx.send(result);
        }
        Request::Discover { full, tx } => {
            cancel_scan.store(false, Ordering::Relaxed);
            // Findings are per-vehicle, so an unidentified car must name
            // itself first — otherwise a discovery pass would have nowhere
            // honest to file what it finds.
            let result = match ctx.vehicle_id {
                Some(vehicle_id) => {
                    let vin = db.vehicle(vehicle_id).and_then(|v| v.vin);
                    set_scanning(app, status, true);
                    let r = uds::discover(drv, db, vehicle_id, vin, cancel_scan, app, full);
                    set_scanning(app, status, false);
                    r
                }
                None => Err("name this vehicle first so its findings have somewhere to live".into()),
            };
            let _ = tx.send(result);
        }
        Request::UdsClear { module, tx } => {
            let _ = tx.send(uds::clear_module(drv, db, &module, ctx));
        }
        Request::UdsModuleDtcs { module, tx } => {
            let _ = tx.send(uds::module_dtcs(drv, db, &module));
        }
        // Handled inline in the polling loop (needs the loop's own ctx and
        // status); reaching here would be a dispatch bug, answer honestly.
        Request::NameVehicle { tx, .. } => {
            let _ = tx.send(Err("naming is handled by the connection loop".into()));
        }
        Request::Stop => {}
    }
}
