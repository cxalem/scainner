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
    pub state: String,
    pub stage: Option<Stage>,
    pub error: Option<ConnectError>,
    pub elm_version: Option<String>,
    pub detail: Option<String>,
    pub vin: Option<String>,
    pub vehicle_id: Option<i64>,
    pub display_name: Option<String>,
    pub vehicle_is_new: bool,
    pub scanning: bool,
    pub discovery: Option<DiscoveryStatus>,
    pub ride: Option<RideStatus>,
}

#[derive(Clone, Serialize, Debug, PartialEq)]
pub struct RideStatus {
    pub id: i64,
    pub started_at: String,
    pub sample_count: i64,
}

#[derive(Clone, Serialize, Debug, Default, PartialEq)]
pub struct DiscoveryStatus {
    pub state: String,
    pub reason: Option<String>,
    pub stage: Option<String>,
    pub stage_done: Option<u32>,
    pub stage_total: Option<u32>,
    pub started_at: Option<String>,
    pub last_run_at: Option<String>,
    pub knowledge_key: String,
}

#[derive(Clone, Copy)]
pub struct ConnCtx {
    pub connection_id: i64,
    pub vehicle_id: Option<i64>,
}

pub const PROBE_INTERVAL_SETTING: &str = "probe_interval_ticks";
pub const DTC_SCAN_INTERVAL_SETTING: &str = "dtc_scan_interval_ticks";

const PROBE_INTERVAL_DEFAULT: u64 = 120;
const PROBE_INTERVAL_LEARNING_DEFAULT: u64 = 8;
const PROBE_INTERVAL_MIN: u64 = 4;
const PROBE_INTERVAL_MAX: u64 = 2400;

const DTC_SCAN_INTERVAL_DEFAULT: u64 = 1200;
const DTC_SCAN_INTERVAL_MIN: u64 = 240;
const DTC_SCAN_INTERVAL_MAX: u64 = 14400;

pub fn probe_interval_ticks(setting: Option<&str>, learning_on: bool) -> u64 {
    let default = if learning_on {
        PROBE_INTERVAL_LEARNING_DEFAULT
    } else {
        PROBE_INTERVAL_DEFAULT
    };
    setting
        .and_then(|v| v.trim().parse::<u64>().ok())
        .map(|v| v.clamp(PROBE_INTERVAL_MIN, PROBE_INTERVAL_MAX))
        .unwrap_or(default)
}

pub fn dtc_scan_interval_ticks(setting: Option<&str>) -> u64 {
    setting
        .and_then(|v| v.trim().parse::<u64>().ok())
        .map(|v| v.clamp(DTC_SCAN_INTERVAL_MIN, DTC_SCAN_INTERVAL_MAX))
        .unwrap_or(DTC_SCAN_INTERVAL_DEFAULT)
}

struct DtcScanSchedule {
    interval: u64,
    last_scan_tick: Option<u64>,
}

impl DtcScanSchedule {
    fn new(interval: u64) -> Self {
        Self {
            interval,
            last_scan_tick: None,
        }
    }

    fn due(&self, tick: u64) -> bool {
        tick > 0 && tick.saturating_sub(self.last_scan_tick.unwrap_or(0)) >= self.interval
    }

    fn due_at_session_end(&self, tick: u64) -> bool {
        self.last_scan_tick != Some(tick)
    }

    fn record(&mut self, tick: u64) {
        self.last_scan_tick = Some(tick);
    }
}

fn record_dtc_scan(drv: &mut ElmDriver, db: &Db, ctx: ConnCtx) -> Result<obd::DtcResult, String> {
    obd::scan_dtcs(drv).map(|r| {
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
    })
}

fn announce_dtc_scan(app: &tauri::AppHandle, result: &obd::DtcResult) {
    let _ = app.emit("dtc-scan", result);
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
    Discover {
        full: bool,
        tx: Sender<Result<uds::DiscoveryReport, String>>,
    },
    ParkedVerification(Sender<Result<uds::ParkedVerificationReport, String>>),
    RunAutoDiscovery(Sender<Result<discovery::auto::AutoSummary, String>>),
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
    NameVehicle {
        name: String,
        tx: Sender<Result<i64, String>>,
    },
    StartRide(Sender<Result<crate::db::Ride, String>>),
    StopRide {
        id: i64,
        tx: Sender<Result<crate::db::Ride, String>>,
    },
    Stop,
}

pub struct Supervisor {
    pub tx: Sender<Request>,
    pub status: Arc<Mutex<ConnStatus>>,
    pub cancel_scan: Arc<AtomicBool>,
}

impl Supervisor {
    pub fn spawn(app: tauri::AppHandle, db: Arc<Db>) -> Self {
        let (tx, rx) = mpsc::channel::<Request>();
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

fn set_scanning(app: &tauri::AppHandle, status: &Arc<Mutex<ConnStatus>>, scanning: bool) {
    let snapshot = {
        let mut guard = status.lock().unwrap();
        guard.scanning = scanning;
        guard.clone()
    };
    let _ = app.emit("conn-status", &snapshot);
}

fn set_discovery(app: &tauri::AppHandle, status: &Arc<Mutex<ConnStatus>>, d: DiscoveryStatus) {
    let snapshot = {
        let mut guard = status.lock().unwrap();
        guard.discovery = Some(d);
        guard.clone()
    };
    let _ = app.emit("conn-status", &snapshot);
}

fn notify(app: &tauri::AppHandle, title: &str, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title(title).body(body).show();
}

fn run_loop(
    app: tauri::AppHandle,
    db: Arc<Db>,
    rx: Receiver<Request>,
    status: Arc<Mutex<ConnStatus>>,
    cancel_scan: Arc<AtomicBool>,
) {
    'outer: loop {
        let (mut drv, version) = match connect_once(&app, &db, &status) {
            Some(connected) => connected,
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

        let knowledge_key = discovery::knowledge_key();
        match ctx.vehicle_id.filter(|_| discovery::auto::enabled(&db)) {
            None => set_discovery(
                &app,
                &status,
                DiscoveryStatus {
                    state: "idle".into(),
                    knowledge_key: knowledge_key.clone(),
                    ..Default::default()
                },
            ),
            Some(vehicle_id) => {
                let stored = discovery::knowledge::last_auto_run(&db, vehicle_id);
                match discovery::knowledge::decide(stored.as_ref(), &knowledge_key, false) {
                    discovery::knowledge::RunDecision::Skip { since } => {
                        log::info!("discovery skipped: knowledge unchanged since {since}");
                        set_discovery(
                            &app,
                            &status,
                            DiscoveryStatus {
                                state: "skipped".into(),
                                reason: Some(discovery::knowledge::SKIP_REASON.into()),
                                last_run_at: Some(since),
                                knowledge_key: knowledge_key.clone(),
                                ..Default::default()
                            },
                        );
                    }
                    discovery::knowledge::RunDecision::Run(reason) => {
                        log::info!("discovery running: {}", reason.explain());
                        run_auto_discovery(
                            &mut drv,
                            &db,
                            &app,
                            &status,
                            &cancel_scan,
                            vehicle_id,
                            resolved_vin.as_deref(),
                            connection_id,
                            reason,
                            &knowledge_key,
                        );
                    }
                }
            }
        }

        let mut consecutive_failures = 0u32;
        let mut tick: u64 = 0;
        let mut probe_interval: u64 = 0;
        let mut dtc_schedule = DtcScanSchedule::new(DTC_SCAN_INTERVAL_DEFAULT);
        let mut alerts_fired: std::collections::HashSet<&'static str> = Default::default();
        let mut low_voltage_streak = 0u32;
        let mut ride = db.active_ride();

        macro_rules! service_requests {
            () => {
                while let Ok(req) = rx.try_recv() {
                    match req {
                        Request::Stop => {
                            if dtc_schedule.due_at_session_end(tick) {
                                match record_dtc_scan(&mut drv, &db, ctx) {
                                    Ok(result) => {
                                        log::info!(
                                            "closing fault-code scan: {} stored, {} pending, MIL {}",
                                            result.stored.len(),
                                            result.pending.len(),
                                            if result.mil_on { "on" } else { "off" }
                                        );
                                        announce_dtc_scan(&app, &result);
                                    }
                                    Err(e) => log::warn!("closing fault-code scan failed: {e}"),
                                }
                                dtc_schedule.record(tick);
                            }
                            if let Some(active) = ride.take() {
                                let _ = db.stop_ride(active.id);
                            }
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
                                        vehicle_is_new: true,
                                        ..Default::default()
                                    },
                                );
                                let _ = tx.send(Ok(id));
                            }
                        }
                        Request::ScanDtcs(tx) => {
                            let res = record_dtc_scan(&mut drv, &db, ctx);
                            dtc_schedule.record(tick);
                            if let Ok(result) = &res {
                                announce_dtc_scan(&app, result);
                            }
                            let _ = tx.send(res);
                        }
                        Request::StartRide(tx) => {
                            let result = ctx.vehicle_id.ok_or_else(|| "not connected to an identified vehicle".to_string()).and_then(|vehicle_id| db.start_ride(vehicle_id, ctx.connection_id));
                            if let Ok(started) = &result {
                                ride = Some(started.clone());
                                let snapshot = {
                                    let mut guard = status.lock().unwrap();
                                    guard.ride = Some(RideStatus { id: started.id, started_at: started.started_at.clone(), sample_count: 0 });
                                    guard.clone()
                                };
                                let _ = app.emit("conn-status", &snapshot);
                                probe_interval = PROBE_INTERVAL_LEARNING_DEFAULT;
                            }
                            let _ = tx.send(result);
                        }
                        Request::StopRide { id, tx } => {
                            let result = match ride.as_ref().filter(|active| active.id == id) {
                                None => Err("ride is not active".into()),
                                Some(_) => {
                                    let scan = record_dtc_scan(&mut drv, &db, ctx);
                                    dtc_schedule.record(tick);
                                    if let Ok(value) = &scan { announce_dtc_scan(&app, value); }
                                    scan.and_then(|_| db.stop_ride(id))
                                }
                            };
                            if result.is_ok() {
                                ride = None;
                                let snapshot = {
                                    let mut guard = status.lock().unwrap();
                                    guard.ride = None;
                                    guard.clone()
                                };
                                let _ = app.emit("conn-status", &snapshot);
                                probe_interval = 0;
                            }
                            let _ = tx.send(result);
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
                            if dtc_schedule.due_at_session_end(tick) {
                                match record_dtc_scan(&mut drv, &db, ctx) {
                                    Ok(result) => {
                                        log::info!(
                                            "closing fault-code scan after a dropped link: {} stored, {} pending",
                                            result.stored.len(),
                                            result.pending.len()
                                        );
                                        announce_dtc_scan(&app, &result);
                                    }
                                    Err(e) => log::warn!(
                                        "closing fault-code scan after a dropped link failed: {e}"
                                    ),
                                }
                                dtc_schedule.record(tick);
                            }
                            if let Some(active) = ride.take() {
                                let _ = db.stop_ride(active.id);
                            }
                            db.end_connection(ctx.connection_id);
                            continue 'outer;
                        }
                    }
                }
            }
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
            if tick % 40 == 0 {
                let learning_on = ride.is_some()
                    || db
                        .setting_get(discovery::state::LEARNING_STATE_SETTING)
                        .map(|v| v == "on")
                        .unwrap_or(false);
                let resolved = probe_interval_ticks(
                    db.setting_get(PROBE_INTERVAL_SETTING).as_deref(),
                    learning_on,
                );
                if resolved != probe_interval {
                    log::info!(
                        "probe polling every {resolved} ticks (~{:.1} s), learning state {}",
                        resolved as f64 * 0.25,
                        if learning_on { "on" } else { "off" }
                    );
                    probe_interval = resolved;
                }
                let resolved_scan =
                    dtc_scan_interval_ticks(db.setting_get(DTC_SCAN_INTERVAL_SETTING).as_deref());
                if resolved_scan != dtc_schedule.interval {
                    log::info!(
                        "fault-code scan every {resolved_scan} ticks (~{:.0} s)",
                        resolved_scan as f64 * 0.25
                    );
                    dtc_schedule.interval = resolved_scan;
                }
            }
            if tick > 0 && tick % probe_interval == 0 {
                let uds_values = uds::poll_probes(&mut drv, &db, ctx);
                for (k, v) in uds_values {
                    values.insert(k, v);
                }
            }
            if tick % 20 == 0 {
                if let Some(active) = ride.as_mut() {
                    if let Some(current) = db.ride(active.id) {
                        let count = db.ride_sample_count(active.id);
                        active.sample_count = count;
                        let snapshot = {
                            let mut guard = status.lock().unwrap();
                            guard.ride = Some(RideStatus {
                                id: current.id,
                                started_at: current.started_at,
                                sample_count: count,
                            });
                            guard.clone()
                        };
                        let _ = app.emit("conn-status", &snapshot);
                    }
                }
            }

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

            if dtc_schedule.due(tick) {
                service_requests!();
            }
            // Re-checking after requests lets a just-served manual scan cancel this periodic tick.
            if dtc_schedule.due(tick) {
                match record_dtc_scan(&mut drv, &db, ctx) {
                    Ok(result) => {
                        log::info!(
                            "periodic fault-code scan: {} stored, {} pending, MIL {}",
                            result.stored.len(),
                            result.pending.len(),
                            if result.mil_on { "on" } else { "off" }
                        );
                        announce_dtc_scan(&app, &result);
                    }
                    Err(e) => log::warn!("periodic fault-code scan failed: {e}"),
                }
                dtc_schedule.record(tick);
            }

            if !values.is_empty() {
                let _ = app.emit("live-update", &values);
            }
            tick += 1;
            std::thread::sleep(Duration::from_millis(250));
        }
    }
}

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

fn current_vin(db: &Db, ctx: ConnCtx) -> Option<String> {
    ctx.vehicle_id
        .and_then(|id| db.vehicle(id))
        .and_then(|v| v.vin)
}

#[allow(clippy::too_many_arguments)]
fn run_auto_discovery(
    drv: &mut ElmDriver,
    db: &Db,
    app: &tauri::AppHandle,
    status: &Arc<Mutex<ConnStatus>>,
    cancel_scan: &AtomicBool,
    vehicle_id: i64,
    vin: Option<&str>,
    connection_id: i64,
    reason: discovery::knowledge::RunReason,
    knowledge_key: &str,
) -> discovery::auto::AutoSummary {
    discovery::auto::notify_unknown_brand(vin, |notice| {
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
    set_scanning(app, status, true);
    let started_at = discovery::knowledge::now(db);
    let running = DiscoveryStatus {
        state: "running".into(),
        reason: Some(reason.as_str().into()),
        started_at: Some(started_at.clone()),
        knowledge_key: knowledge_key.to_string(),
        ..Default::default()
    };
    set_discovery(app, status, running.clone());

    let stage_of = |phase: &str| match phase {
        "auto-census" => "census",
        "auto-identity" => "identity",
        "auto-join" => "join",
        _ => "coverage",
    };
    let stage = std::cell::RefCell::new(String::new());
    let progress = |phase: &str, current: u32, total: u32, detail: &str| {
        let _ = app.emit(
            "discovery-progress",
            serde_json::json!({
                "phase": phase, "current": current, "total": total,
                "detail": detail, "modulesFound": 0, "didsFound": 0,
            }),
        );
        let next = stage_of(phase);
        if *stage.borrow() != next {
            *stage.borrow_mut() = next.to_string();
            set_discovery(
                app,
                status,
                DiscoveryStatus {
                    stage: Some(next.to_string()),
                    stage_done: Some(current),
                    stage_total: Some(total),
                    ..running.clone()
                },
            );
        }
    };
    let summary = discovery::auto::run(
        drv,
        db,
        vehicle_id,
        vin,
        connection_id,
        cancel_scan,
        &discovery::auto::AutoConfig::default(),
        &progress,
    );
    set_scanning(app, status, false);
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
        let _ = db.insert_verification_run(vehicle_id, connection_id, "auto-s1-s3", &json);
    }
    let last_run_at = if discovery::knowledge::completed(&summary) {
        Some(discovery::knowledge::record_auto_run(db, vehicle_id, knowledge_key).at)
    } else {
        log::info!(
            "discovery not recorded as done: {}",
            summary.stopped.as_deref().unwrap_or("cancelled")
        );
        discovery::knowledge::last_auto_run(db, vehicle_id).map(|r| r.at)
    };
    set_discovery(
        app,
        status,
        DiscoveryStatus {
            state: "done".into(),
            stage: None,
            stage_done: None,
            stage_total: None,
            last_run_at,
            ..running
        },
    );
    summary
}

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
            let _ = tx.send(Err("fault-code scans are run by the connection loop".into()));
        }
        Request::ClearDtcs(tx) => {
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
                db.set_connection_protocol(ctx.connection_id, &info.protocol);
                info
            });
            let _ = tx.send(res);
        }
        Request::Readiness(tx) => {
            let _ = tx.send(obd::readiness(drv));
        }
        Request::AllSensors(tx) => {
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
        Request::RunAutoDiscovery(tx) => match ctx.vehicle_id {
            None => {
                let _ = tx.send(Err(
                    "this connection has no identified vehicle, so findings would have nowhere to live".into(),
                ));
            }
            Some(vehicle_id) => {
                let vin = status.lock().unwrap().vin.clone();
                let summary = run_auto_discovery(
                    drv,
                    db,
                    app,
                    status,
                    cancel_scan,
                    vehicle_id,
                    vin.as_deref(),
                    ctx.connection_id,
                    discovery::knowledge::RunReason::Requested,
                    &discovery::knowledge_key(),
                );
                let _ = tx.send(Ok(summary));
            }
        },
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
        Request::NameVehicle { tx, .. } => {
            let _ = tx.send(Err("naming is handled by the connection loop".into()));
        }
        Request::StartRide(tx) => {
            let _ = tx.send(Err("ride request reached the wrong handler".into()));
        }
        Request::StopRide { tx, .. } => {
            let _ = tx.send(Err("ride request reached the wrong handler".into()));
        }
        Request::Stop => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::elm::discovery::state::LEARNING_STATE_SETTING;
    use std::path::Path;

    fn test_db() -> Db {
        Db::open(Path::new(":memory:")).expect("in-memory db")
    }

    #[test]
    fn the_status_carries_the_discovery_block_on_the_wire() {
        let status = ConnStatus {
            state: "connected".into(),
            discovery: Some(DiscoveryStatus {
                state: "running".into(),
                reason: Some(discovery::knowledge::RunReason::NeverRun.as_str().into()),
                stage: Some("census".into()),
                stage_done: Some(3),
                stage_total: Some(12),
                started_at: Some("2026-09-01 10:00:00".into()),
                last_run_at: None,
                knowledge_key: discovery::knowledge_key(),
            }),
            ..Default::default()
        };
        let json = serde_json::to_value(&status).unwrap();
        assert_eq!(json["discovery"]["state"], "running");
        assert_eq!(json["discovery"]["reason"], "never_run");
        assert_eq!(json["discovery"]["stage"], "census");
        assert_eq!(json["discovery"]["stage_total"], 12);
        assert_eq!(
            json["discovery"]["knowledge_key"],
            discovery::knowledge_key()
        );
        let empty = serde_json::to_value(ConnStatus {
            state: "disconnected".into(),
            ..Default::default()
        })
        .unwrap();
        assert!(empty["discovery"].is_null());
    }

    #[test]
    fn a_learning_state_speeds_probe_sampling_up_and_off_again() {
        assert_eq!(probe_interval_ticks(None, false), 120);
        assert_eq!(probe_interval_ticks(None, true), 8);
    }

    #[test]
    fn an_explicit_probe_interval_wins_in_either_state() {
        assert_eq!(probe_interval_ticks(Some("60"), false), 60);
        assert_eq!(probe_interval_ticks(Some("60"), true), 60);
        assert_eq!(probe_interval_ticks(Some(" 60 "), true), 60);
        assert_eq!(probe_interval_ticks(Some("1"), false), 4);
        assert_eq!(probe_interval_ticks(Some("99999"), false), 2400);
        assert_eq!(probe_interval_ticks(Some("fast"), true), 8);
    }

    #[test]
    fn the_fault_code_scan_interval_defaults_to_five_minutes_and_clamps() {
        assert_eq!(dtc_scan_interval_ticks(None), 1200);
        assert_eq!(dtc_scan_interval_ticks(Some("600")), 600);
        assert_eq!(dtc_scan_interval_ticks(Some("10")), 240);
        assert_eq!(dtc_scan_interval_ticks(Some("999999")), 14400);
    }

    #[test]
    fn the_settings_row_reaches_the_resolver_from_the_database() {
        let db = test_db();
        assert_eq!(
            probe_interval_ticks(db.setting_get(PROBE_INTERVAL_SETTING).as_deref(), false),
            120
        );
        db.setting_set(LEARNING_STATE_SETTING, "on");
        let learning_on = db
            .setting_get(LEARNING_STATE_SETTING)
            .map(|v| v == "on")
            .unwrap_or(false);
        assert!(learning_on);
        assert_eq!(
            probe_interval_ticks(
                db.setting_get(PROBE_INTERVAL_SETTING).as_deref(),
                learning_on
            ),
            8
        );
        db.setting_set(PROBE_INTERVAL_SETTING, "40");
        assert_eq!(
            probe_interval_ticks(
                db.setting_get(PROBE_INTERVAL_SETTING).as_deref(),
                learning_on
            ),
            40
        );
    }

    #[test]
    fn no_fault_code_scan_runs_inside_the_first_interval() {
        let schedule = DtcScanSchedule::new(1200);
        for tick in [0u64, 1, 120, 1199] {
            assert!(!schedule.due(tick), "a scan fired at tick {tick}");
        }
        assert!(schedule.due(1200));
    }

    #[test]
    fn the_poller_scans_once_per_interval() {
        let mut schedule = DtcScanSchedule::new(1200);
        assert!(schedule.due(1200));
        schedule.record(1200);
        assert!(!schedule.due(1201));
        assert!(!schedule.due(2399));
        assert!(schedule.due(2400));
    }

    #[test]
    fn a_manual_scan_resets_the_pollers_own_clock() {
        let mut schedule = DtcScanSchedule::new(1200);
        schedule.record(1000);
        assert!(!schedule.due(1200));
        assert!(schedule.due(2200));
    }

    #[test]
    fn a_session_that_ends_gets_one_closing_scan_and_never_two() {
        let mut schedule = DtcScanSchedule::new(1200);
        assert!(schedule.due_at_session_end(300));
        schedule.record(300);
        assert!(!schedule.due_at_session_end(300));
        assert!(schedule.due_at_session_end(301));
    }

    #[test]
    fn a_recorded_scan_lands_in_history_the_way_a_manual_one_does() {
        let raw = r#"{
            "schema_version": 1,
            "name": "standard-dtc-scan",
            "contains_vehicle_identifiers": false,
            "steps": [
                {"command": "0101", "response": "41 01 00 00 00 00\r>"},
                {"command": "03", "response": "43 00\r>"},
                {"command": "07", "response": "47 00\r>"},
                {"command": "0A", "response": "4A 00\r>"},
                {"command": "ATRV", "response": "12.4V\r>"}
            ]
        }"#;
        let mut drv = ElmDriver::from_replay_json(raw).expect("fixture");
        let db = test_db();
        let connection_id = db.start_connection("ELM327 v1.5", "test");
        let ctx = ConnCtx {
            connection_id,
            vehicle_id: None,
        };

        let result = record_dtc_scan(&mut drv, &db, ctx).expect("the scan completes");
        drv.assert_replay_complete();

        assert!(!result.mil_on);
        assert!(result.stored.is_empty());
        let history = db.dtc_history(None, 10);
        assert_eq!(history.len(), 1, "the scan was recorded, not just returned");
        assert_eq!(history[0].voltage, Some(12.4));
    }
}
