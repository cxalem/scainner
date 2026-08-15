//! Connection supervisor: owns the serial driver on a background thread,
//! keeps the link alive (Bluetooth cycle on failure), polls PIDs at ~1 Hz,
//! writes every reading to SQLite, and serves one-shot requests (DTC scan,
//! readiness, VIN) over a command channel.

use super::driver::{self, ElmDriver};
use super::parser;
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

#[derive(Serialize, Clone)]
pub struct DtcResult {
    pub mil_on: bool,
    pub dtc_count: u8,
    pub stored: Vec<String>,
    pub pending: Vec<String>,
    pub permanent: Vec<String>,
    pub voltage: Option<f64>,
    pub freeze: Option<serde_json::Value>,
}

#[derive(Serialize, Clone)]
pub struct EcuInfo {
    pub vin: String,
    pub protocol: String,
    pub elm_version: String,
}

#[derive(Serialize, Clone)]
pub struct SensorReading {
    pub pid: String,
    pub key: String,
    pub label: String,
    pub unit: String,
    pub value: f64,
}

pub enum Request {
    ScanDtcs(Sender<Result<DtcResult, String>>),
    ClearDtcs(Sender<Result<(), String>>),
    ReadEcuInfo(Sender<Result<EcuInfo, String>>),
    Readiness(Sender<Result<HashMap<String, bool>, String>>),
    AllSensors(Sender<Result<Vec<SensorReading>, String>>),
    UdsRead { module: String, did: u16, tx: Sender<Result<Option<super::uds::UdsHit>, String>> },
    UdsScan { module: String, from: u16, to: u16, tx: Sender<Result<Vec<super::uds::UdsHit>, String>> },
    UdsClear { module: String, tx: Sender<Result<ClearOutcome, String>> },
    UdsModuleDtcs { module: String, tx: Sender<Result<Vec<String>, String>> },
    Stop,
}

/// Everything the UI needs to explain a module-clear honestly: what was
/// there before, whether the module accepted the clear, and what's left.
#[derive(Serialize, Clone)]
pub struct ClearOutcome {
    pub before: Vec<String>,
    pub accepted: bool,
    pub after: Vec<String>,
}

pub struct Supervisor {
    pub tx: Sender<Request>,
    pub status: Arc<Mutex<ConnStatus>>,
    /// Flipped by the UI's "Cancel scan" button (or by Disconnect, so it can't
    /// get stuck queued behind a long-running scan). Checked once per DID
    /// inside uds_scan_range, so a scan aborts within one DID's timeout.
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
        let mut drv = match connect_with_retries() {
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
        if let Ok(vin_payload) = query(&mut drv, "0902", "49 02 01", 15) {
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
                    notify(&app, "🔥 Coolant overheating", &format!("{t:.0} °C — stop when safe and check"));
                }
            }
            if let Some(&v) = values.get("voltage") {
                let running = values.get("rpm").map(|&r| r > 400.0).unwrap_or(false);
                if running && v < 11.8 {
                    low_voltage_streak += 1;
                    // Voltage samples come every ~20-30s; two in a row = sustained.
                    if low_voltage_streak >= 2 && alerts_fired.insert("voltage") {
                        notify(&app, "🔋 Battery voltage low while running", &format!("{v:.1} V — charging system may have a problem"));
                    }
                } else {
                    low_voltage_streak = 0;
                }
            }
            // User-defined UDS probes every ~120 ticks (~30-60 s).
            if tick > 0 && tick % 120 == 0 {
                let uds_values = poll_uds_probes(&mut drv, &db, session_id);
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
                            notify(&app, "⚠️ Check-engine light is ON", &format!("{} code(s) stored — run a scan in Scainner", m.dtc_count));
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

fn notify(app: &tauri::AppHandle, title: &str, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title(title).body(body).show();
}

fn connect_with_retries() -> Result<ElmDriver, String> {
    // Escalation ladder, cheapest first:
    //   attempt 0 — FAST PATH: if the port node already exists, just open it and
    //     probe. A healthy link reconnects in ~2-3s instead of the ~10s a full
    //     BT cycle costs. (The stale-port trap is real — the node can exist with
    //     a dead RFCOMM link behind it — but the probe catches that, and we only
    //     pay the escalation cost when it actually happens.)
    //   attempt 1 — plain BT disconnect/connect cycle.
    //   attempt 2 — full PIN re-pair (the dongle's sulk-state cure).
    let port = driver::port();
    let bt_addr = driver::bt_addr();
    let pin = std::env::var("SCAINNER_OBD_PIN").unwrap_or_else(|_| "1234".to_string());
    for attempt in 0..3 {
        if attempt == 0 {
            if std::path::Path::new(&port).exists() {
                eprintln!("[scainner] attempt {attempt}: fast path — port exists, probing directly");
            } else {
                eprintln!("[scainner] attempt {attempt}: no port node, bluetooth cycle...");
                driver::bluetooth_cycle(&bt_addr)?;
            }
        } else if attempt == 1 {
            eprintln!("[scainner] attempt {attempt}: bluetooth cycle...");
            driver::bluetooth_cycle(&bt_addr)?;
        } else {
            eprintln!("[scainner] attempt {attempt}: full PIN re-pair...");
            driver::bluetooth_repair(&bt_addr, &pin)?;
        }
        // Let the RFCOMM channel settle before opening — opening too early
        // wedges it. Only needed after a cycle/repair; the fast path opens an
        // already-settled link.
        if attempt > 0 {
            std::thread::sleep(Duration::from_secs(2));
        }
        eprintln!("[scainner] attempt {attempt}: opening {port}");
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
                    eprintln!("[scainner] attempt {attempt} probe {probe_try}: ATZ -> {probe:?}");
                    if matches!(&probe, Ok(r) if r.contains("ELM")) {
                        alive = true;
                        break;
                    }
                    std::thread::sleep(Duration::from_secs(1));
                }
                if alive {
                    return Ok(d);
                }
                if attempt == 2 {
                    return Err("port opens but ELM stays silent after 3 BT cycles".into());
                }
            }
            Err(e) => {
                eprintln!("[scainner] attempt {attempt}: open failed -> {e}");
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

fn handle_request(req: Request, drv: &mut ElmDriver, db: &Db, cancel_scan: &AtomicBool, app: &tauri::AppHandle) {
    match req {
        Request::ScanDtcs(tx) => {
            let res = scan_dtcs(drv).map(|r| {
                db.insert_dtc_scan(
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
            let res = drv
                .cmd("04", Duration::from_secs(10))
                .map(|_| ())
                .map_err(|e| e.to_string());
            let _ = tx.send(res);
        }
        Request::ReadEcuInfo(tx) => {
            let res = read_ecu_info(drv).map(|info| {
                db.set_car_info("vin", &info.vin);
                db.set_car_info("protocol", &info.protocol);
                db.set_car_info("elm_version", &info.elm_version);
                info
            });
            let _ = tx.send(res);
        }
        Request::Readiness(tx) => {
            let _ = tx.send(readiness(drv));
        }
        Request::AllSensors(tx) => {
            let _ = tx.send(read_all_sensors(drv));
        }
        Request::UdsRead { module, did, tx } => {
            let _ = tx.send(uds_read_one(drv, db, &module, did));
        }
        Request::UdsScan { module, from, to, tx } => {
            eprintln!("[scainner][uds-scan] dequeued UdsScan request: {module} {from:04X}-{to:04X}");
            cancel_scan.store(false, Ordering::Relaxed);
            let result = uds_scan_range(drv, db, &module, from, to, cancel_scan, app);
            eprintln!("[scainner][uds-scan] sending result back to frontend: {}", match &result {
                Ok(hits) => format!("Ok({} hits)", hits.len()),
                Err(e) => format!("Err({e})"),
            });
            let send_ok = tx.send(result).is_ok();
            eprintln!("[scainner][uds-scan] send to frontend channel: {}", if send_ok { "delivered" } else { "FAILED — receiver already dropped (frontend gave up)" });
        }
        Request::UdsClear { module, tx } => {
            let _ = tx.send(uds_clear_module(drv, db, &module));
        }
        Request::UdsModuleDtcs { module, tx } => {
            let _ = tx.send(uds_module_dtcs(drv, db, &module));
        }
        Request::Stop => {}
    }
}

/// Custom modules from the DB, converted to `uds::UdsModule` — kept as a
/// tiny adapter here so `db.rs` doesn't need to know about `elm::uds` types.
fn custom_modules(db: &Db) -> Vec<uds::UdsModule> {
    db.list_uds_modules()
        .into_iter()
        .map(|(key, label, req, resp)| uds::UdsModule { key, label, req, resp, builtin: false })
        .collect()
}

/// Read → clear → read again, so the UI can show a verified before/after
/// instead of a blind "done".
fn uds_clear_module(drv: &mut ElmDriver, db: &Db, module: &str) -> Result<ClearOutcome, String> {
    let custom = custom_modules(db);
    let m = uds::resolve(module, &custom).ok_or("unknown module")?;
    uds::setup(drv, &m).map_err(|e| e.to_string())?;
    let before = uds::read_dtcs(drv).unwrap_or_default();
    let accepted = match uds::clear_dtcs(drv) {
        Ok(ok) => ok,
        Err(e) => {
            uds::teardown(drv);
            return Err(e.to_string());
        }
    };
    let after = uds::read_dtcs(drv).unwrap_or_default();
    uds::teardown(drv);
    Ok(ClearOutcome { before, accepted, after })
}

fn uds_module_dtcs(drv: &mut ElmDriver, db: &Db, module: &str) -> Result<Vec<String>, String> {
    let custom = custom_modules(db);
    let m = uds::resolve(module, &custom).ok_or("unknown module")?;
    uds::setup(drv, &m).map_err(|e| e.to_string())?;
    let res = uds::read_dtcs(drv).map_err(|e| e.to_string());
    uds::teardown(drv);
    res
}

use super::uds;

fn uds_read_one(drv: &mut ElmDriver, db: &Db, module: &str, did: u16) -> Result<Option<uds::UdsHit>, String> {
    let custom = custom_modules(db);
    let m = uds::resolve(module, &custom).ok_or("unknown module")?;
    uds::setup(drv, &m).map_err(|e| e.to_string())?;
    let res = uds::read_did(drv, did).map_err(|e| e.to_string());
    uds::teardown(drv);
    res.map(|opt| opt.map(|d| uds::to_hit(did, &d)))
}

/// Scan a DID range on one module. Capped at 256 DIDs per call to bound wall-
/// clock time to well under the ask() timeout (see lib.rs); the UI chunks
/// bigger ranges into repeated calls, updating its results after each one.
///
/// Bug fixed 2026-08-14: this used to cap at 512 DIDs with a 1500ms per-DID
/// timeout (worst case ~13 min for one call) against a hardcoded 60s ask()
/// timeout — a scan running long enough would blow past that ceiling, the
/// frontend would show a "timed out" error while this function kept running
/// to completion (or the ELM's response landed after the caller had already
/// dropped the reply channel), and the WHOLE supervisor thread — including
/// live gauge polling and Disconnect — was unresponsive for the entire scan,
/// which reads as "the app crashed". Fixed by: a much shorter per-DID
/// timeout for scans, a smaller chunk cap, a matching longer ask() ceiling
/// (a safety net now, not the everyday UX timer), and real cancellation via
/// `cancel_scan` so a stuck scan releases within one DID's timeout instead of
/// running to completion regardless.
fn uds_scan_range(
    drv: &mut ElmDriver,
    db: &Db,
    module: &str,
    from: u16,
    to: u16,
    cancel_scan: &AtomicBool,
    app: &tauri::AppHandle,
) -> Result<Vec<uds::UdsHit>, String> {
    eprintln!("[scainner][uds-scan] request: module={module} from={from:04X} to={to:04X}");
    let custom = custom_modules(db);
    let m = match uds::resolve(module, &custom) {
        Some(m) => m,
        None => {
            eprintln!("[scainner][uds-scan] ERROR: unknown module {module:?}");
            return Err("unknown module".into());
        }
    };
    let to = to.min(from.saturating_add(255));
    eprintln!("[scainner][uds-scan] clamped range: {from:04X}-{to:04X} ({} DIDs), calling uds::setup", to - from + 1);
    if let Err(e) = uds::setup(drv, &m) {
        eprintln!("[scainner][uds-scan] ERROR: setup failed: {e}");
        return Err(e.to_string());
    }
    eprintln!("[scainner][uds-scan] setup ok, starting DID loop");
    let total = (to - from + 1) as u32;
    let mut hits = Vec::new();
    let mut errors = 0u32;
    for (i, did) in (from..=to).enumerate() {
        if i % 8 == 0 {
            eprintln!("[scainner][uds-scan] progress: at DID {did:04X} ({i}/{total}), {} hits, {errors} errors so far", hits.len());
            let _ = app.emit("uds-scan-progress", serde_json::json!({
                "current": i as u32,
                "total": total,
                "did": format!("{did:04X}"),
                "hits": hits.len(),
            }));
        }
        if cancel_scan.swap(false, Ordering::Relaxed) {
            eprintln!("[scainner][uds-scan] CANCELLED at DID {did:04X}, {} hits kept", hits.len());
            uds::teardown(drv);
            return Err(format!("cancelled at DID {did:04X}; {} hits kept", hits.len()));
        }
        if i % 40 == 39 {
            uds::tester_present(drv);
        }
        match uds::read_did_timeout(drv, did, Duration::from_millis(600)) {
            Ok(Some(d)) => hits.push(uds::to_hit(did, &d)),
            Ok(None) => {}
            Err(ref e) => {
                eprintln!("[scainner][uds-scan] read error at DID {did:04X}: {e}");
                errors += 1;
                if errors > 10 {
                    eprintln!("[scainner][uds-scan] ABORTING: too many errors ({errors}) at DID {did:04X}");
                    uds::teardown(drv);
                    return Err(format!("link degraded mid-scan at DID {did:04X}; {} hits so far kept", hits.len()));
                }
            }
        }
    }
    eprintln!("[scainner][uds-scan] completed: {} hits, {errors} errors, calling teardown", hits.len());
    uds::teardown(drv);
    eprintln!("[scainner][uds-scan] teardown done, returning {} hits", hits.len());
    Ok(hits)
}

/// Poll all enabled user-defined UDS probes once; record + return values.
fn poll_uds_probes(drv: &mut ElmDriver, db: &Db, session_id: i64) -> HashMap<String, f64> {
    let mut out = HashMap::new();
    let probes: Vec<_> = db.list_probes().into_iter().filter(|p| p.enabled).collect();
    if probes.is_empty() {
        return out;
    }
    let mut by_module: HashMap<String, Vec<&crate::db::UdsProbe>> = HashMap::new();
    for p in &probes {
        by_module.entry(p.module.clone()).or_default().push(p);
    }
    let custom = custom_modules(db);
    for (mkey, group) in by_module {
        let Some(m) = uds::resolve(&mkey, &custom) else { continue };
        if uds::setup(drv, &m).is_err() {
            continue;
        }
        for p in group {
            if let Ok(Some(data)) = uds::read_did(drv, p.did) {
                if let Some(v) = uds::extract(&data, p.offset, p.len, p.scale, p.bias) {
                    let key = format!("uds_{}", p.label.to_lowercase().replace(' ', "_"));
                    db.insert_reading(session_id, &key, v);
                    out.insert(key, v);
                }
            }
        }
    }
    uds::teardown(drv);
    out
}

/// Discover which PIDs the ECU supports (0100/0120/0140/0160 bitmaps), then
/// read every one we know how to decode. One-shot, ~10-20 s.
fn read_all_sensors(drv: &mut ElmDriver) -> Result<Vec<SensorReading>, String> {
    let mut supported: Vec<u8> = Vec::new();
    for base in [0x00u8, 0x20, 0x40, 0x60] {
        let cmd = format!("01{base:02X}");
        let prefix = format!("41 {base:02X}");
        match query(drv, &cmd, &prefix, 8) {
            Ok(p) if !p.is_empty() => {
                let pids = parser::decode_supported_bitmap(base, &p);
                let has_next = pids.contains(&(base + 0x20));
                supported.extend(pids);
                if !has_next {
                    break;
                }
            }
            _ => break,
        }
    }
    if supported.is_empty() {
        return Err("ECU did not report supported PIDs".into());
    }
    let mut out = Vec::new();
    for def in parser::FULL_PIDS {
        let pid_num = u8::from_str_radix(&def.pid[2..], 16).unwrap_or(0);
        if !supported.contains(&pid_num) {
            continue;
        }
        if let Ok(p) = query(drv, def.pid, &format!("41 {}", &def.pid[2..]), 5) {
            if let Some(v) = (def.decode)(&p) {
                out.push(SensorReading {
                    pid: def.pid.into(),
                    key: def.key.into(),
                    label: def.label.into(),
                    unit: def.unit.into(),
                    value: v,
                });
            }
        }
    }
    Ok(out)
}

fn query(drv: &mut ElmDriver, cmd: &str, prefix: &str, timeout_s: u64) -> Result<Vec<u8>, String> {
    let raw = drv.cmd(cmd, Duration::from_secs(timeout_s)).map_err(|e| e.to_string())?;
    let lines = parser::clean_response(&raw);
    Ok(parser::payload_bytes(&lines, prefix))
}

fn scan_dtcs(drv: &mut ElmDriver) -> Result<DtcResult, String> {
    let mil_payload = query(drv, "0101", "41 01", 10)?;
    let mil = parser::decode_mil(&mil_payload).ok_or("bad 0101 response")?;
    let stored = parser::decode_dtcs(&query(drv, "03", "43", 15)?);
    let pending = parser::decode_dtcs(&query(drv, "07", "47", 15)?);
    let permanent = query(drv, "0A", "4A", 15)
        .map(|p| parser::decode_dtcs(&p))
        .unwrap_or_default(); // NO DATA is fine
    let voltage = drv
        .cmd("ATRV", Duration::from_secs(3))
        .ok()
        .and_then(|r| parser::clean_response(&r).first().and_then(|l| parser::decode_voltage(l)));
    // Freeze frame: only meaningful when something is actually stored.
    let freeze = if stored.is_empty() { None } else { read_freeze_frame(drv) };
    Ok(DtcResult {
        mil_on: mil.mil_on,
        dtc_count: mil.dtc_count,
        stored,
        pending,
        permanent,
        voltage,
        freeze,
    })
}

/// Mode 02 (freeze frame 0): the ECU's sensor snapshot from the moment the
/// fault was stored. Mirrors the live PID set plus PID 02 (the triggering DTC).
fn read_freeze_frame(drv: &mut ElmDriver) -> Option<serde_json::Value> {
    let mut out = serde_json::Map::new();
    // Which DTC caused this freeze frame (PID 02).
    if let Ok(p) = query(drv, "020200", "42 02", 8) {
        // payload: frame no. then 2 DTC bytes
        let dtc_bytes: Vec<u8> = p.into_iter().skip(1).take(2).collect();
        let codes = parser::decode_dtcs(&[&[1u8][..], &dtc_bytes[..]].concat());
        if let Some(c) = codes.first() {
            out.insert("trigger_dtc".into(), serde_json::json!(c));
        }
    }
    for pid in parser::PIDS {
        let cmd = format!("02{}00", &pid.pid[2..]);
        if let Ok(p) = query(drv, &cmd, &format!("42 {}", &pid.pid[2..]), 8) {
            // First payload byte is the frame number; PID data follows.
            let data: Vec<u8> = p.into_iter().skip(1).collect();
            if let Some(v) = (pid.decode)(&data) {
                out.insert(pid.key.into(), serde_json::json!(v));
            }
        }
    }
    if out.is_empty() { None } else { Some(serde_json::Value::Object(out)) }
}

fn read_ecu_info(drv: &mut ElmDriver) -> Result<EcuInfo, String> {
    let vin_payload = query(drv, "0902", "49 02 01", 15)?;
    let vin = parser::decode_vin(&vin_payload);
    let protocol_raw = drv.cmd("ATDPN", Duration::from_secs(3)).map_err(|e| e.to_string())?;
    let pn = parser::clean_response(&protocol_raw).first().cloned().unwrap_or_default();
    let protocol = match pn.trim_start_matches('A') {
        "6" => "ISO 15765-4 CAN 11-bit 500k".to_string(),
        "7" => "ISO 15765-4 CAN 29-bit 500k".to_string(),
        other => format!("protocol {other}"),
    };
    Ok(EcuInfo { vin, protocol, elm_version: "ELM327".into() })
}

/// Mode 0101 bytes C/D: which noncontinuous monitors are supported and complete.
fn readiness(drv: &mut ElmDriver) -> Result<HashMap<String, bool>, String> {
    let p = query(drv, "0101", "41 01", 10)?;
    if p.len() < 4 {
        return Err("short 0101 response".into());
    }
    let (b, c, d) = (p[1], p[2], p[3]);
    let mut out = HashMap::new();
    // Continuous monitors (byte B low bits): supported / complete
    let cont = [("misfire", 0), ("fuel_system", 1), ("components", 2)];
    for (name, bit) in cont {
        if b & (1 << bit) != 0 {
            out.insert(name.to_string(), b & (1 << (bit + 4)) == 0);
        }
    }
    // Spark-ignition noncontinuous monitors (bytes C=supported, D=incomplete)
    let noncont = [
        ("catalyst", 0),
        ("heated_catalyst", 1),
        ("evap", 2),
        ("secondary_air", 3),
        ("o2_sensor", 5),
        ("o2_heater", 6),
        ("egr_vvt", 7),
    ];
    for (name, bit) in noncont {
        if c & (1 << bit) != 0 {
            out.insert(name.to_string(), d & (1 << bit) == 0);
        }
    }
    Ok(out)
}
