mod db;
mod elm;

use db::Db;
use elm::obd::{DtcResult, EcuInfo, SensorReading};
use elm::supervisor::{ConnStatus, Request, Supervisor};
use elm::uds::ClearOutcome;
use std::collections::HashMap;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use tauri::Manager;

struct AppState {
    db: Arc<Db>,
    supervisor: Mutex<Option<Supervisor>>,
}

// Safety-net ceiling, not the everyday UX timer — normal requests (DTC scan,
// single DID read, PID reads) return in well under a second to a few seconds.
// UDS range scans are the outlier: 256 DIDs at up to 600ms each plus session
// overhead can legitimately take a couple of minutes, so this has to cover
// that comfortably or a slow-but-healthy scan gets mistaken for a hang (see
// uds_scan_range's doc comment for the full story).
const ASK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);

/// A poisoned mutex (from a previous panic while holding it) would otherwise
/// make every single command that touches shared state panic forever after —
/// one bad unwrap cascading into a fully dead app. Recover instead: the state
/// underneath is still perfectly usable, only the "was a panic in progress"
/// flag got set.
fn lock_or_recover<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    match m.lock() {
        Ok(g) => g,
        Err(poisoned) => {
            log::warn!("recovering from a poisoned mutex (a previous command panicked while holding it)");
            poisoned.into_inner()
        }
    }
}

fn ask<T: Send + 'static>(
    state: &AppState,
    make: impl FnOnce(mpsc::Sender<Result<T, String>>) -> Request,
) -> Result<T, String> {
    let guard = lock_or_recover(&state.supervisor);
    let sup = guard.as_ref().ok_or("not connected")?;
    let (tx, rx) = mpsc::channel();
    sup.tx.send(make(tx)).map_err(|_| "supervisor gone")?;
    drop(guard);
    match rx.recv_timeout(ASK_TIMEOUT) {
        Ok(r) => r,
        Err(_) => {
            log::warn!("request timed out after {ASK_TIMEOUT:?} waiting for supervisor reply");
            Err("timed out waiting for dongle".to_string())
        }
    }
}

#[tauri::command]
fn connect(app: tauri::AppHandle, state: tauri::State<AppState>) -> Result<(), String> {
    let mut guard = lock_or_recover(&state.supervisor);
    if guard.is_some() {
        return Ok(()); // already running
    }
    *guard = Some(Supervisor::spawn(app, state.db.clone()));
    Ok(())
}

#[tauri::command]
fn disconnect(state: tauri::State<AppState>) -> Result<(), String> {
    let mut guard = lock_or_recover(&state.supervisor);
    if let Some(sup) = guard.take() {
        // Wake up an in-progress UDS scan first so Stop doesn't sit queued
        // behind it for however long the scan has left to run.
        sup.cancel_scan.store(true, std::sync::atomic::Ordering::Relaxed);
        let _ = sup.tx.send(Request::Stop);
    }
    Ok(())
}

/// Aborts an in-progress UDS range scan. Takes effect within one DID's
/// timeout (≤600ms), not instantly — the scan loop only checks between DIDs.
#[tauri::command]
fn uds_cancel_scan(state: tauri::State<AppState>) {
    log::debug!("scan cancel requested from UI");
    if let Some(sup) = lock_or_recover(&state.supervisor).as_ref() {
        sup.cancel_scan.store(true, std::sync::atomic::Ordering::Relaxed);
    }
}

#[tauri::command]
fn conn_status(state: tauri::State<AppState>) -> ConnStatus {
    lock_or_recover(&state.supervisor)
        .as_ref()
        .map(|s| lock_or_recover(&s.status).clone())
        .unwrap_or(ConnStatus {
            state: "disconnected".into(),
            elm_version: None,
            detail: None,
            vin: None,
        })
}

#[tauri::command]
fn scan_dtcs(state: tauri::State<AppState>) -> Result<DtcResult, String> {
    ask(&state, Request::ScanDtcs)
}

/// Write safety rail, enforced at the command boundary: every command that
/// writes to the car takes `confirmed` and refuses when it is false, so a
/// stray call (a bug, a future automation) cannot skip the confirmation
/// modal the UI shows. The frontend passes true only from that modal's
/// confirm button.
fn require_confirmed(confirmed: bool) -> Result<(), String> {
    if confirmed {
        Ok(())
    } else {
        Err("Write not confirmed. This action changes the car, so the app must show the confirmation step first.".into())
    }
}

/// Clears engine DTCs (mode 04), verified: scans before, clears, scans
/// again, and logs the whole thing to `writes_log`. Returns both scans so
/// the UI can show an honest before/after.
#[tauri::command]
fn clear_dtcs(state: tauri::State<AppState>, confirmed: bool) -> Result<elm::obd::ObdClearOutcome, String> {
    require_confirmed(confirmed)?;
    ask(&state, Request::ClearDtcs)
}

/// The write audit trail, newest first: everything the app has changed on
/// the car, with before/after state and outcome.
#[tauri::command]
fn writes_log(state: tauri::State<AppState>, limit: i64) -> Vec<db::WriteLogRow> {
    state.db.writes_log(limit)
}

#[tauri::command]
fn read_ecu_info(state: tauri::State<AppState>) -> Result<EcuInfo, String> {
    ask(&state, Request::ReadEcuInfo)
}

#[tauri::command]
fn readiness(state: tauri::State<AppState>) -> Result<HashMap<String, bool>, String> {
    ask(&state, Request::Readiness)
}

#[tauri::command]
fn all_sensors(state: tauri::State<AppState>) -> Result<Vec<SensorReading>, String> {
    ask(&state, Request::AllSensors)
}

#[tauri::command]
fn uds_modules(state: tauri::State<AppState>) -> Vec<elm::uds::UdsModule> {
    let mut mods = elm::uds::builtin_modules();
    mods.extend(state.db.list_uds_modules().into_iter().map(|(key, label, req, resp)| {
        elm::uds::UdsModule { key, label, req, resp, builtin: false }
    }));
    mods
}

/// Add a custom module (any brand's CAN request/response IDs, hex strings
/// like "7E0"/"7E8") so the UDS Lab works beyond the built-in PSA four.
#[tauri::command]
fn add_uds_module(state: tauri::State<AppState>, key: String, label: String, req: String, resp: String) -> Result<(), String> {
    state.db.add_uds_module(&key, &label, &req.to_uppercase(), &resp.to_uppercase())
}

#[tauri::command]
fn delete_uds_module(state: tauri::State<AppState>, key: String) {
    state.db.delete_uds_module(&key)
}

#[tauri::command]
fn uds_read(state: tauri::State<AppState>, module: String, did: u16) -> Result<Option<elm::uds::UdsHit>, String> {
    ask(&state, |tx| Request::UdsRead { module, did, tx })
}

#[tauri::command]
fn uds_scan(state: tauri::State<AppState>, module: String, from: u16, to: u16) -> Result<Vec<elm::uds::UdsHit>, String> {
    ask(&state, |tx| Request::UdsScan { module, from, to, tx })
}

/// Clears the fault memory on one module (ABS/engine). Standard, safe
/// diagnostic operation — cannot damage anything, only erases stored codes.
/// Returns a verified before/after so the UI can show what actually happened.
#[tauri::command]
fn uds_clear(state: tauri::State<AppState>, module: String, confirmed: bool) -> Result<ClearOutcome, String> {
    require_confirmed(confirmed)?;
    ask(&state, |tx| Request::UdsClear { module, tx })
}

/// Reads the fault codes currently stored on one module (UDS 19 02, read-only).
#[tauri::command]
fn uds_module_dtcs(state: tauri::State<AppState>, module: String) -> Result<Vec<String>, String> {
    ask(&state, |tx| Request::UdsModuleDtcs { module, tx })
}

#[tauri::command]
fn reading_keys(state: tauri::State<AppState>) -> Vec<String> {
    state.db.reading_keys()
}

#[tauri::command]
fn report_cars(state: tauri::State<AppState>) -> Vec<(String, i64)> {
    state.db.report_cars()
}

#[tauri::command]
fn car_report(state: tauri::State<AppState>, vin: String) -> db::CarReport {
    state.db.car_report(&vin)
}

#[tauri::command]
fn set_fuel_price(state: tauri::State<AppState>, price: f64) {
    state.db.set_car_info("fuel_price", &format!("{price}"));
}

#[tauri::command]
fn list_probes(state: tauri::State<AppState>) -> Vec<db::UdsProbe> {
    state.db.list_probes()
}

#[tauri::command]
fn add_probe(state: tauri::State<AppState>, probe: db::UdsProbe) -> i64 {
    state.db.add_probe(&probe)
}

#[tauri::command]
fn delete_probe(state: tauri::State<AppState>, id: i64) {
    state.db.delete_probe(id)
}

#[tauri::command]
fn toggle_probe(state: tauri::State<AppState>, id: i64, enabled: bool) {
    state.db.toggle_probe(id, enabled)
}

#[tauri::command]
fn dtc_history(state: tauri::State<AppState>, limit: i64) -> Vec<db::DtcScan> {
    state.db.dtc_history(limit)
}

#[tauri::command]
fn car_info(state: tauri::State<AppState>) -> Vec<(String, String)> {
    state.db.car_info()
}

#[tauri::command]
fn history(state: tauri::State<AppState>, key: String, since_hours: f64) -> Vec<db::HistoryPoint> {
    state.db.history(&key, since_hours)
}

#[tauri::command]
fn export_json(state: tauri::State<AppState>, since_hours: f64) -> String {
    state.db.export_json(since_hours)
}

#[tauri::command]
fn db_path(app: tauri::AppHandle) -> String {
    data_db_path(&app).display().to_string()
}

/// Markdown briefing about the car, ready to paste into any AI chat.
#[tauri::command]
fn ai_context(app: tauri::AppHandle, state: tauri::State<AppState>, since_hours: f64) -> String {
    let info = state.db.car_info();
    let scans = state.db.dtc_history(5);
    let stats = state.db.key_stats(since_hours);
    let sessions = state.db.session_count();
    let days = since_hours / 24.0;

    let mut md = String::from("# Car diagnostic briefing (Scainner export)\n\n## Vehicle\n\n");
    // Deliberately no hardcoded car description here — Scainner works on any
    // car (see README "Bring your own car"), so the briefing only claims what
    // was actually read from the connected ECU.
    if info.is_empty() {
        md.push_str("(ECU not read yet — connect and use \"Read from ECU\" in the Vehicle tab.)\n");
    }
    for (k, v) in &info {
        md.push_str(&format!("- {k}: `{v}`\n"));
    }
    md.push_str(&format!("- Recorded sessions total: {sessions}\n\n"));

    md.push_str("## Latest DTC scans (newest first)\n\n");
    if scans.is_empty() {
        md.push_str("No scans recorded.\n");
    }
    for s in &scans {
        let n = s.stored.len() + s.pending.len() + s.permanent.len();
        md.push_str(&format!(
            "- {} UTC — MIL {} — stored {:?}, pending {:?}, permanent {:?}{}{}\n",
            s.ts,
            if s.mil_on { "ON" } else { "off" },
            s.stored,
            s.pending,
            s.permanent,
            s.voltage.map(|v| format!(", {v:.1} V")).unwrap_or_default(),
            if n == 0 { " — clean" } else { "" },
        ));
        if let Some(f) = &s.freeze {
            md.push_str(&format!("  - freeze frame: {f}\n"));
        }
    }

    md.push_str(&format!("\n## Sensor stats, last {days:.1} days (min / avg / max)\n\n"));
    for st in &stats {
        md.push_str(&format!(
            "- {}: {:.1} / {:.1} / {:.1} ({} samples)\n",
            st.key, st.min, st.avg, st.max, st.n
        ));
    }
    md.push_str(&format!(
        "\nRaw SQLite (full history): `{}` — tables: sessions, readings(ts,key,value), dtc_scans, car_info.\n",
        data_db_path(&app).display()
    ));
    md
}

fn data_db_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .expect("no app data dir");
    std::fs::create_dir_all(&dir).ok();
    dir.join("scainner.sqlite3")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Quiet by default — set RUST_LOG=debug (or =trace for per-DID scan
    // detail) to see the connection/scan internals. `Info` is the default
    // level so warnings and above always surface.
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let path = data_db_path(app.handle());
            let db = Arc::new(Db::open(&path).expect("failed to open sqlite db"));
            app.manage(AppState {
                db,
                supervisor: Mutex::new(None),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            connect,
            disconnect,
            conn_status,
            scan_dtcs,
            clear_dtcs,
            read_ecu_info,
            readiness,
            dtc_history,
            car_info,
            history,
            export_json,
            db_path,
            ai_context,
            all_sensors,
            uds_modules,
            add_uds_module,
            delete_uds_module,
            uds_read,
            uds_scan,
            uds_cancel_scan,
            uds_clear,
            uds_module_dtcs,
            writes_log,
            list_probes,
            reading_keys,
            report_cars,
            car_report,
            set_fuel_price,
            add_probe,
            delete_probe,
            toggle_probe
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
