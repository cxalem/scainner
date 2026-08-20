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
}

pub enum Request {
    ScanDtcs(Sender<Result<obd::DtcResult, String>>),
    ClearDtcs(Sender<Result<obd::ObdClearOutcome, String>>),
    ReadEcuInfo(Sender<Result<obd::EcuInfo, String>>),
    Readiness(Sender<Result<HashMap<String, bool>, String>>),
    AllSensors(Sender<Result<Vec<obd::SensorReading>, String>>),
    UdsRead { module: String, did: u16, tx: Sender<Result<Option<uds::UdsHit>, String>> },
    UdsScan { module: String, from: u16, to: u16, tx: Sender<Result<Vec<uds::UdsHit>, String>> },
    UdsClear { module: String, tx: Sender<Result<uds::ClearOutcome, String>> },
    UdsModuleDtcs { module: String, tx: Sender<Result<Vec<String>, String>> },
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
        let session_id = db.start_session(&version);
        // Stamp the VIN so reports group sessions by car.
        if let Ok(vin_payload) = obd::query(&mut drv, "0902", "49 02 01", 15) {
            let vin = parser::decode_vin(&vin_payload);
            if vin.len() == 17 {
                db.set_session_vin(session_id, &vin);
                db.set_car_info("vin", &vin);
            }
        }
        set_status(&app, &status, ConnStatus {
            state: "connected".into(),
            elm_version: Some(version.clone()),
            detail: None,
        });

        let mut consecutive_failures = 0u32;
        let mut tick: u64 = 0;
        let mut alerts_fired: std::collections::HashSet<&'static str> = Default::default();
        let mut low_voltage_streak = 0u32;

        // ---- polling phase ----
        loop {
            // Serve any pending requests first.
            while let Ok(req) = rx.try_recv() {
                match req {
                    Request::Stop => {
                        db.end_session(session_id);
                        set_status(&app, &status, ConnStatus { state: "disconnected".into(), ..Default::default() });
                        return;
                    }
                    req => handle_request(req, &mut drv, &db, &cancel_scan, &app),
                }
            }

            let mut values: HashMap<String, f64> = HashMap::new();
            for pid in parser::PIDS {
                match drv.cmd(pid.pid, Duration::from_secs(3)) {
                    Ok(raw) => {
                        let lines = parser::clean_response(&raw);
                        let payload = parser::payload_bytes(&lines, &format!("41 {}", &pid.pid[2..]));
                        if let Some(v) = (pid.decode)(&payload) {
                            values.insert(pid.key.to_string(), v);
                            db.insert_reading(session_id, pid.key, v);
                        }
                        consecutive_failures = 0;
                    }
                    Err(_) => {
                        consecutive_failures += 1;
                        if consecutive_failures > 8 {
                            // Link is gone — go back to reconnect phase.
                            db.end_session(session_id);
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
                        db.insert_reading(session_id, "voltage", v);
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
                let uds_values = uds::poll_probes(&mut drv, &db, session_id);
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
        .car_info_get("bt_connect_level")
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
                    db.set_car_info("bt_connect_level", &attempt.to_string());
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
        Request::UdsClear { tx, .. } => { let _ = tx.send(Err(err)); }
        Request::UdsModuleDtcs { tx, .. } => { let _ = tx.send(Err(err)); }
        Request::Stop => {}
    }
}

/// Dispatch one request to the right business-logic module. This is the only
/// place that knows both "how to talk to the car" (via `drv`) and "what the
/// UI asked for" (via `Request`) — everything past this point is either
/// `obd::` (standard, any-car) or `uds::` (manufacturer-specific) logic.
fn handle_request(req: Request, drv: &mut ElmDriver, db: &Db, cancel_scan: &AtomicBool, app: &tauri::AppHandle) {
    match req {
        Request::ScanDtcs(tx) => {
            let res = obd::scan_dtcs(drv).map(|r| {
                db.insert_dtc_scan(r.mil_on, &r.stored, &r.pending, &r.permanent, r.voltage, r.freeze.as_ref());
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
                    db.insert_dtc_scan(a.mil_on, &a.stored, &a.pending, &a.permanent, a.voltage, a.freeze.as_ref());
                    let verdict = if a.stored.is_empty() && a.pending.is_empty() { "cleared" } else { "faults_remain" };
                    db.log_write(
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
                    db.log_write("Engine (OBD)", "clear_dtcs", &params, Some(&dtc_json(&before)), None, "error", Some(&error));
                    Err(format!("The clear command failed: {error}"))
                }
                Err(obd::ClearError::VerifyFailed { before, error }) => {
                    db.log_write(
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
                db.set_car_info("vin", &info.vin);
                db.set_car_info("protocol", &info.protocol);
                db.set_car_info("elm_version", &info.elm_version);
                info
            });
            let _ = tx.send(res);
        }
        Request::Readiness(tx) => {
            let _ = tx.send(obd::readiness(drv));
        }
        Request::AllSensors(tx) => {
            let _ = tx.send(obd::read_all_sensors(drv));
        }
        Request::UdsRead { module, did, tx } => {
            let _ = tx.send(uds::read_one(drv, db, &module, did));
        }
        Request::UdsScan { module, from, to, tx } => {
            cancel_scan.store(false, Ordering::Relaxed);
            let result = uds::scan_range(drv, db, &module, from, to, cancel_scan, app);
            let _ = tx.send(result);
        }
        Request::UdsClear { module, tx } => {
            let _ = tx.send(uds::clear_module(drv, db, &module));
        }
        Request::UdsModuleDtcs { module, tx } => {
            let _ = tx.send(uds::module_dtcs(drv, db, &module));
        }
        Request::Stop => {}
    }
}
