//! Connection supervisor: owns the serial driver on a background thread,
//! polls PIDs at ~1 Hz, writes every reading to SQLite, and dispatches
//! one-shot requests (DTC scan, UDS reads, etc.) that arrive over a command
//! channel.
//!
//! Getting the link up is `connect.rs`'s job: one deterministic pipeline
//! run per connect request, no ladder and no automatic re-attempt. This
//! file is deliberately just the connection lifecycle and request dispatch
//! — the actual OBD/UDS business logic lives in `obd.rs` and `uds.rs`
//! respectively. `handle_request` is the seam between them.

use super::connect::{self, ConnectError, Stage};
use super::discovery;
use super::driver::ElmDriver;
use super::obd;
use super::parser;
use super::transport::{self, AdapterKind, AdapterProfile};
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
    /// Which pipeline stage is running right now — set while `state` is
    /// `connecting` so the UI names the step instead of showing an
    /// anonymous spinner.
    pub stage: Option<Stage>,
    /// Why the last attempt stopped, and where. Set with `disconnected`
    /// after a failed attempt, and cleared by the next one.
    pub error: Option<ConnectError>,
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
    UdsRead {
        module: String,
        did: u16,
        tx: Sender<Result<Option<uds::UdsHit>, String>>,
    },
    UdsReadMany {
        module: String,
        dids: Vec<u16>,
        tx: Sender<Result<Vec<uds::UdsHit>, String>>,
    },
    UdsScan {
        module: String,
        from: u16,
        to: u16,
        tx: Sender<Result<Vec<uds::UdsHit>, String>>,
    },
    /// One-button auto-discovery: no ranges, no addresses, no user input.
    Discover {
        full: bool,
        tx: Sender<Result<uds::DiscoveryReport, String>>,
    },
    ParkedVerification(Sender<Result<uds::ParkedVerificationReport, String>>),
    /// One guided-correlation capture (read-only, default session), saved as
    /// a verification run carrying the operator's condition label.
    CorrelationCapture {
        req: String,
        resp: String,
        dids: Vec<u16>,
        step: String,
        condition: String,
        plan_version: String,
        repeats: u8,
        tx: Sender<Result<uds::CorrelationCapture, String>>,
    },
    UdsClear {
        module: String,
        tx: Sender<Result<uds::ClearOutcome, String>>,
    },
    UdsModuleDtcs {
        module: String,
        tx: Sender<Result<Vec<String>, String>>,
    },
    /// The "name this car" flow for VIN-less vehicles: creates the vehicles
    /// row, links the live connection, back-stamps everything it already
    /// recorded, and re-emits conn-status with the new identity.
    NameVehicle {
        name: String,
        tx: Sender<Result<i64, String>>,
    },
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
        // Born connecting: a supervisor only exists because someone asked
        // for a connection, and `ops::connect` reads this state to tell a
        // run in progress from one that has already stopped.
        let status = Arc::new(Mutex::new(ConnStatus {
            state: "connecting".into(),
            ..Default::default()
        }));
        let cancel_scan = Arc::new(AtomicBool::new(false));
        let status_clone = status.clone();
        let cancel_clone = cancel_scan.clone();
        std::thread::spawn(move || run_loop(app, db, rx, status_clone, cancel_clone));
        Self {
            tx,
            status,
            cancel_scan,
        }
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

/// The main loop: one connect pipeline run, then the polling phase.
///
/// A link that drops during polling (8 consecutive command failures) gets
/// exactly one more pipeline run, so a session survives a dongle that
/// blinks; a run that fails ends the thread with the stage and reason on
/// the status. There is no automatic re-attempt and no backoff loop — the
/// user presses connect again if they want another go, and `ops::connect`
/// starts a fresh supervisor for it.
fn run_loop(
    app: tauri::AppHandle,
    db: Arc<Db>,
    rx: Receiver<Request>,
    status: Arc<Mutex<ConnStatus>>,
    cancel_scan: Arc<AtomicBool>,
) {
    'outer: loop {
        // ---- connect phase: one pipeline run ----
        let (mut drv, version) = match connect_once(&app, &db, &status) {
            Some(connected) => connected,
            // The status already carries the stage and the reason. Ending
            // the thread here is what makes the next connect request a
            // genuinely fresh single attempt.
            None => return,
        };
        let link = drv.describe();
        log::info!(
            "connected over {} {} (banner {:?}, device_kind {})",
            link.kind,
            link.target,
            link.banner,
            drv.device_kind()
        );
        let connection_id = db.start_connection(&version, &drv.device_kind());
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
        let mut ctx = ConnCtx {
            connection_id,
            vehicle_id,
        };
        set_status(
            &app,
            &status,
            ConnStatus {
                state: "connected".into(),
                elm_version: Some(version.clone()),
                vin: resolved_vin.clone(),
                vehicle_id,
                display_name,
                vehicle_is_new,
                ..Default::default()
            },
        );

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
            log::info!(
                "ECU supports {} PIDs; polling: {}",
                supported_pids.len(),
                polled.join(", ")
            );
        }

        // Automatic discovery on connect (protocol S1–S3; multi-brand plan
        // P2.7): census → identity (twice) → join → coverage, read-only in
        // the default session, within the protocol's budgets. Switched off
        // with `app_settings.auto_discovery = off`; an unidentified car has
        // nowhere to file findings, so it is skipped too.
        if let Some(vehicle_id) = ctx.vehicle_id {
            if discovery::auto::enabled(&db) {
                discovery::auto::notify_unknown_brand(resolved_vin.as_deref(), |notice| {
                    log::info!(
                        "discovery profile callback: reason={}, wmi={:?}; policy={}, scan_allowed={}",
                        notice.reason,
                        notice.wmi,
                        notice.fallback_policy,
                        notice.discovery_continues
                    );
                    let _ = app.emit(
                        "unknown-brand",
                        serde_json::json!({
                            "vehicleId": vehicle_id,
                            "classification": notice.classification,
                            "reason": notice.reason,
                            "wmi": notice.wmi,
                            "brandId": notice.brand_id,
                            "fallbackPolicy": notice.fallback_policy,
                            "discoveryContinues": notice.discovery_continues,
                        }),
                    );
                });
                cancel_scan.store(false, Ordering::Relaxed);
                set_scanning(&app, &status, true);
                let progress = |phase: &str, current: u32, total: u32, detail: &str| {
                    let _ = app.emit(
                        "discovery-progress",
                        serde_json::json!({
                            "phase": phase, "current": current, "total": total,
                            "detail": detail, "modulesFound": 0, "didsFound": 0,
                        }),
                    );
                };
                let summary = discovery::auto::run(
                    &mut drv,
                    &db,
                    vehicle_id,
                    resolved_vin.as_deref(),
                    connection_id,
                    &cancel_scan,
                    &discovery::auto::AutoConfig::default(),
                    &progress,
                );
                set_scanning(&app, &status, false);
                log::info!(
                    "automatic discovery: {} candidates, {} reached, {} refused, {} silent; {} fingerprinted; coverage {}; {} ms{}",
                    summary.census.candidates,
                    summary.census.reached,
                    summary.census.refused,
                    summary.census.silent,
                    summary.identity.fingerprinted,
                    summary.coverage_status.as_deref().unwrap_or("none"),
                    summary.elapsed_ms,
                    summary.stopped.as_deref().map(|s| format!(" ({s})")).unwrap_or_default()
                );
                if let Ok(json) = serde_json::to_string(&summary) {
                    let _ =
                        db.insert_verification_run(vehicle_id, connection_id, "auto-s1-s3", &json);
                }
            }
        }

        let mut consecutive_failures = 0u32;
        let mut tick: u64 = 0;
        let mut probe_interval: u64 = 120;
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
                            set_status(
                                &app,
                                &status,
                                ConnStatus {
                                    state: "disconnected".into(),
                                    ..Default::default()
                                },
                            );
                            return;
                        }
                        Request::NameVehicle { name, tx } => {
                            let trimmed = name.trim();
                            if trimmed.is_empty() {
                                let _ = tx.send(Err("name is empty".into()));
                            } else if ctx.vehicle_id.is_some() {
                                let _ = tx.send(Err(
                                    "this connection already has an identified vehicle".into(),
                                ));
                            } else {
                                let id = db.create_vehicle_named(trimmed);
                                db.link_connection_vehicle(ctx.connection_id, id);
                                ctx.vehicle_id = Some(id);
                                set_status(
                                    &app,
                                    &status,
                                    ConnStatus {
                                        state: "connected".into(),
                                        elm_version: Some(version.clone()),
                                        vehicle_id: Some(id),
                                        display_name: Some(trimmed.to_string()),
                                        // Naming IS this vehicle's first appearance.
                                        vehicle_is_new: true,
                                        ..Default::default()
                                    },
                                );
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
                        let payload =
                            parser::payload_bytes(&lines, &format!("41 {}", &pid.pid[2..]));
                        if let Some(v) = (pid.decode)(&payload) {
                            values.insert(pid.key.to_string(), v);
                            db.insert_reading(ctx.connection_id, ctx.vehicle_id, pid.key, v);
                        }
                        consecutive_failures = 0;
                    }
                    Err(error) => {
                        consecutive_failures += 1;
                        log::warn!(
                            "live PID {} failed ({}/9 before reconnect): {}",
                            pid.pid,
                            consecutive_failures,
                            error
                        );
                        if consecutive_failures > 8 {
                            // The link is gone mid-session: one more
                            // pipeline run, and if that fails the thread
                            // ends with the stage and reason on the status.
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
                    notify(
                        &app,
                        "Coolant overheating",
                        &format!("{t:.0}°C — stop when safe and check"),
                    );
                }
            }
            if let Some(&v) = values.get("voltage") {
                let running = values.get("rpm").map(|&r| r > 400.0).unwrap_or(false);
                if running && v < 11.8 {
                    low_voltage_streak += 1;
                    // Voltage samples come every ~20-30s; two in a row = sustained.
                    if low_voltage_streak >= 2 && alerts_fired.insert("voltage") {
                        notify(
                            &app,
                            "Battery voltage low while running",
                            &format!("{v:.1} V — charging system may have a problem"),
                        );
                    }
                } else {
                    low_voltage_streak = 0;
                }
            }
            // User-defined UDS probes every `probe_interval_ticks` ticks
            // (default 120 ≈ 30–60 s). An agent running a physical test can
            // lower it through the API settings route (minimum 4 ≈ 1 s);
            // the value is re-read every 40 ticks so a change applies without
            // reconnecting.
            if tick % 40 == 0 {
                probe_interval = db
                    .setting_get("probe_interval_ticks")
                    .and_then(|v| v.trim().parse::<u64>().ok())
                    .map(|v| v.clamp(4, 2400))
                    .unwrap_or(120);
            }
            if tick > 0 && tick % probe_interval == 0 {
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
                            notify(
                                &app,
                                "Check-engine light is on",
                                &format!("{} code(s) stored — run a scan in Scainner", m.dtc_count),
                            );
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

/// The profile this connect should use. A fresh install with a single
/// dongle and nothing configured still connects: the one port that looks
/// like an adapter is used.
fn resolve_profile(db: &Db) -> Result<AdapterProfile, ConnectError> {
    let mut profile = AdapterProfile::load(|key| db.setting_get(key));
    if profile.kind == AdapterKind::ElmSerial && profile.path.is_none() {
        match transport::enumerate::guess_serial_path() {
            Some(path) => {
                log::info!(
                    "connect: no adapter.path configured, using the only OBD-looking port {path}"
                );
                profile.path = Some(path);
            }
            None => {
                return Err(ConnectError::new(
                    Stage::Link,
                    "no adapter configured: pick one under Settings → Adapter (PUT /adapter), or set SCAINNER_OBD_PORT",
                ))
            }
        }
    }
    Ok(profile)
}

/// One pipeline run, with its stages broadcast on the connection status.
/// `None` means it failed and the status already carries the stage and the
/// reason; nothing here re-attempts anything.
fn connect_once(
    app: &tauri::AppHandle,
    db: &Db,
    status: &Arc<Mutex<ConnStatus>>,
) -> Option<(ElmDriver, String)> {
    let emit = |stage: Stage| {
        set_status(
            app,
            status,
            ConnStatus {
                state: "connecting".into(),
                stage: Some(stage),
                ..Default::default()
            },
        );
    };
    let bluetooth = transport::bluetooth::platform();
    let outcome = resolve_profile(db)
        .and_then(|profile| connect::connect(&profile, bluetooth.as_ref(), &emit));
    match outcome {
        Ok(driver) => {
            // `init` stored exactly this as the adapter's identification.
            let version = driver
                .describe()
                .banner
                .unwrap_or_else(|| "ELM327-compatible (no banner)".to_string());
            Some((driver, version))
        }
        Err(error) => {
            log::warn!("connect failed at {}: {}", error.stage, error.reason);
            set_status(
                app,
                status,
                ConnStatus {
                    state: "disconnected".into(),
                    detail: Some(error.to_string()),
                    error: Some(error),
                    ..Default::default()
                },
            );
            None
        }
    }
}

/// The VIN of the connection's vehicle, which selects the profile every
/// UDS operation resolves modules, routes and read services from.
fn current_vin(db: &Db, ctx: ConnCtx) -> Option<String> {
    ctx.vehicle_id
        .and_then(|id| db.vehicle(id))
        .and_then(|v| v.vin)
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
                    let verdict = if a.stored.is_empty() && a.pending.is_empty() {
                        "cleared"
                    } else {
                        "faults_remain"
                    };
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
                Err(obd::ClearError::BeforeScanFailed(e)) => Err(format!(
                    "Could not read the current codes before clearing, so nothing was cleared: {e}"
                )),
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
                        Some(&format!(
                            "clear sent, but the verification scan failed: {error}"
                        )),
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
            let vin = current_vin(db, ctx);
            let _ = tx.send(uds::read_one(drv, db, vin.as_deref(), &module, did));
        }
        Request::UdsReadMany { module, dids, tx } => {
            let vin = current_vin(db, ctx);
            let _ = tx.send(uds::read_many(drv, db, vin.as_deref(), &module, &dids));
        }
        Request::UdsScan {
            module,
            from,
            to,
            tx,
        } => {
            cancel_scan.store(false, Ordering::Relaxed);
            set_scanning(app, status, true);
            let vin = current_vin(db, ctx);
            let result =
                uds::scan_range(drv, db, vin.as_deref(), &module, from, to, cancel_scan, app);
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
                None => {
                    Err("name this vehicle first so its findings have somewhere to live".into())
                }
            };
            let _ = tx.send(result);
        }
        Request::ParkedVerification(tx) => {
            let result = match ctx.vehicle_id {
                None => Err(
                    "name this vehicle first so the evidence cannot be filed against the wrong car"
                        .into(),
                ),
                Some(vehicle_id) => {
                    let vehicle = db.vehicle(vehicle_id);
                    let vin = vehicle.as_ref().and_then(|value| value.vin.as_deref());
                    let model = vehicle.as_ref().and_then(|value| value.model.as_deref());
                    let reached = uds::reached_routes(db, vehicle_id);
                    set_scanning(app, status, true);
                    let mut report = uds::parked_verification(drv, vin, model, &reached);
                    set_scanning(app, status, false);
                    match serde_json::to_string(&report)
                        .map_err(|error| error.to_string())
                        .and_then(|json| {
                            db.insert_verification_run(
                                vehicle_id,
                                ctx.connection_id,
                                &report.plan_version,
                                &json,
                            )
                            .map_err(|error| error.to_string())
                        }) {
                        Ok(run_id) => {
                            report.run_id = Some(run_id);
                            if let Ok(json) = serde_json::to_string(&report) {
                                let _ = db.update_verification_run_json(run_id, &json);
                            }
                            // Promote what the car itself answered into the
                            // module records: a reachable route bumps
                            // last_seen_at, a decoded identity block fills
                            // the fingerprint columns (and counts as one
                            // identity read on this connection), and sweep
                            // hits become unlabeled discovered DIDs. Silent
                            // routes write nothing.
                            for target in &report.targets {
                                let reached = target.observations.iter().any(|item| {
                                    matches!(
                                        item.outcome.status,
                                        super::outcome::DiagnosticStatus::Answered
                                            | super::outcome::DiagnosticStatus::Refused
                                    )
                                });
                                if !reached {
                                    continue;
                                }
                                let Some((req, resp)) = target.route.split_once('→') else {
                                    continue;
                                };
                                let resp = resp.split(" + ").next().unwrap_or(resp).trim();
                                let address = format!("{}/{}", req.trim(), resp);
                                // A sweep shares its route with an identity
                                // target; its label describes the search, not
                                // the module, so it must not rename the row.
                                let label =
                                    target.summary.is_none().then_some(target.label.as_str());
                                let module_id =
                                    db.upsert_discovered_module(vehicle_id, &address, label);
                                db.set_module_route_state(module_id, "reached");
                                if let Some(fingerprint) = uds::target_fingerprint(vin, target) {
                                    db.update_ecu_fingerprint(module_id, &fingerprint);
                                    discovery::identity::record_identity(
                                        db,
                                        module_id,
                                        &fingerprint,
                                        ctx.connection_id,
                                    );
                                }
                                if target.summary.is_some() {
                                    for hit in target.observations.iter().filter(|item| {
                                        item.outcome.status
                                            == super::outcome::DiagnosticStatus::Answered
                                    }) {
                                        if let (Ok(did), Some(hex)) = (
                                            u16::from_str_radix(&hit.did, 16),
                                            hit.payload_hex.as_deref(),
                                        ) {
                                            let length = hex.split_whitespace().count() as i64;
                                            db.upsert_discovered_did(
                                                module_id, did, hex, length, None,
                                            );
                                        }
                                    }
                                }
                            }
                            Ok(report)
                        }
                        Err(error) => Err(format!(
                            "verification completed but its evidence could not be saved: {error}"
                        )),
                    }
                }
            };
            let _ = tx.send(result);
        }
        Request::CorrelationCapture {
            req,
            resp,
            dids,
            step,
            condition,
            plan_version,
            repeats,
            tx,
        } => {
            let result = match ctx.vehicle_id {
                None => Err(
                    "name this vehicle first so the capture cannot be filed against the wrong car"
                        .into(),
                ),
                Some(vehicle_id) => {
                    let vin = db.vehicle(vehicle_id).and_then(|v| v.vin);
                    set_scanning(app, status, true);
                    let readings =
                        uds::correlation_capture(drv, vin.as_deref(), &req, &resp, &dids, repeats);
                    set_scanning(app, status, false);
                    readings.and_then(|readings| {
                        let mut capture = uds::CorrelationCapture {
                            run_id: None,
                            plan_version,
                            route: format!("{req}→{resp}"),
                            step,
                            condition,
                            repeats: repeats.clamp(1, 10),
                            safety: "parked or operator-controlled, read-only requests on the module's read service, default diagnostic session".into(),
                            readings,
                        };
                        let json = serde_json::to_string(&capture).map_err(|e| e.to_string())?;
                        let run_id = db
                            .insert_verification_run(
                                vehicle_id,
                                ctx.connection_id,
                                &capture.plan_version,
                                &json,
                            )
                            .map_err(|e| format!("capture completed but could not be saved: {e}"))?;
                        capture.run_id = Some(run_id);
                        if let Ok(json) = serde_json::to_string(&capture) {
                            let _ = db.update_verification_run_json(run_id, &json);
                        }
                        Ok(capture)
                    })
                }
            };
            let _ = tx.send(result);
        }
        Request::UdsClear { module, tx } => {
            let vin = current_vin(db, ctx);
            let _ = tx.send(uds::clear_module(drv, db, vin.as_deref(), &module, ctx));
        }
        Request::UdsModuleDtcs { module, tx } => {
            let vin = current_vin(db, ctx);
            let _ = tx.send(uds::module_dtcs(drv, db, vin.as_deref(), &module));
        }
        // Handled inline in the polling loop (needs the loop's own ctx and
        // status); reaching here would be a dispatch bug, answer honestly.
        Request::NameVehicle { tx, .. } => {
            let _ = tx.send(Err("naming is handled by the connection loop".into()));
        }
        Request::Stop => {}
    }
}
