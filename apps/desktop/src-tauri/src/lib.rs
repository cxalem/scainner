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
            log::warn!(
                "recovering from a poisoned mutex (a previous command panicked while holding it)"
            );
            poisoned.into_inner()
        }
    }
}

/// Sends one request to the supervisor and awaits its reply OFF the main
/// thread. This function (and every command built on it) used to be fully
/// synchronous — and Tauri runs sync commands on the MAIN thread, so a
/// dongle round-trip (a DTC scan, a UDS read, anything) blocked the entire
/// IPC layer while it waited: every other command in flight (history
/// refetches, connection status, all of it) queued behind it, which is
/// exactly the app-wide "click something, everything hangs for a beat"
/// jank reported live 2026-08-21. The send itself stays cheap and sync;
/// only the blocking wait moves to a worker via spawn_blocking.
async fn ask<T: Send + 'static>(
    state: &AppState,
    make: impl FnOnce(mpsc::Sender<Result<T, String>>) -> Request,
) -> Result<T, String> {
    let rx = {
        let guard = lock_or_recover(&state.supervisor);
        let sup = guard.as_ref().ok_or("not connected")?;
        let (tx, rx) = mpsc::channel();
        sup.tx.send(make(tx)).map_err(|_| "supervisor gone")?;
        rx
    };
    tauri::async_runtime::spawn_blocking(move || match rx.recv_timeout(ASK_TIMEOUT) {
        Ok(r) => r,
        Err(_) => {
            log::warn!("request timed out after {ASK_TIMEOUT:?} waiting for supervisor reply");
            Err("timed out waiting for dongle".to_string())
        }
    })
    .await
    .map_err(|e| format!("worker join error: {e}"))?
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
        sup.cancel_scan
            .store(true, std::sync::atomic::Ordering::Relaxed);
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
        sup.cancel_scan
            .store(true, std::sync::atomic::Ordering::Relaxed);
    }
}

#[tauri::command]
fn conn_status(state: tauri::State<AppState>) -> ConnStatus {
    lock_or_recover(&state.supervisor)
        .as_ref()
        .map(|s| lock_or_recover(&s.status).clone())
        .unwrap_or(ConnStatus {
            state: "disconnected".into(),
            ..Default::default()
        })
}

#[tauri::command]
async fn scan_dtcs(state: tauri::State<'_, AppState>) -> Result<DtcResult, String> {
    ask(&state, Request::ScanDtcs).await
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
async fn clear_dtcs(
    state: tauri::State<'_, AppState>,
    confirmed: bool,
) -> Result<elm::obd::ObdClearOutcome, String> {
    require_confirmed(confirmed)?;
    ask(&state, Request::ClearDtcs).await
}

/// The write audit trail, newest first: everything the app has changed on
/// the car, with before/after state and outcome.
#[tauri::command]
fn writes_log(
    state: tauri::State<AppState>,
    vehicle_id: Option<i64>,
    limit: i64,
) -> Vec<db::WriteLogRow> {
    state.db.writes_log(vehicle_id, limit)
}

#[tauri::command]
async fn read_ecu_info(state: tauri::State<'_, AppState>) -> Result<EcuInfo, String> {
    ask(&state, Request::ReadEcuInfo).await
}

#[tauri::command]
async fn readiness(state: tauri::State<'_, AppState>) -> Result<HashMap<String, bool>, String> {
    ask(&state, Request::Readiness).await
}

#[tauri::command]
async fn all_sensors(state: tauri::State<'_, AppState>) -> Result<Vec<SensorReading>, String> {
    ask(&state, Request::AllSensors).await
}

#[tauri::command]
fn uds_modules(state: tauri::State<AppState>) -> Vec<elm::uds::UdsModule> {
    let mut mods = elm::uds::builtin_modules();
    mods.extend(
        state
            .db
            .list_uds_modules()
            .into_iter()
            .map(|(key, label, req, resp)| elm::uds::UdsModule {
                key,
                label,
                req,
                resp,
                builtin: false,
            }),
    );
    mods
}

/// Add a custom module (any brand's CAN request/response IDs, hex strings
/// like "7E0"/"7E8") so the UDS Lab works beyond the built-in PSA four.
#[tauri::command]
fn add_uds_module(
    state: tauri::State<AppState>,
    key: String,
    label: String,
    req: String,
    resp: String,
) -> Result<(), String> {
    state
        .db
        .add_uds_module(&key, &label, &req.to_uppercase(), &resp.to_uppercase())
}

#[tauri::command]
fn delete_uds_module(state: tauri::State<AppState>, key: String) {
    state.db.delete_uds_module(&key)
}

#[tauri::command]
async fn uds_read(
    state: tauri::State<'_, AppState>,
    module: String,
    did: u16,
) -> Result<Option<elm::uds::UdsHit>, String> {
    ask(&state, |tx| Request::UdsRead { module, did, tx }).await
}

#[tauri::command]
async fn uds_scan(
    state: tauri::State<'_, AppState>,
    module: String,
    from: u16,
    to: u16,
) -> Result<Vec<elm::uds::UdsHit>, String> {
    ask(&state, |tx| Request::UdsScan {
        module,
        from,
        to,
        tx,
    })
    .await
}

/// One-button auto-discovery. No addresses/ranges to fill in — those come
/// from the car's VIN and the shipped knowledge map, never from the user.
/// `full`: false (the normal button) re-probes only what a prior pass on
/// THIS car already found, which is fast — "a re-scan shouldn't take that
/// long" (owner, 2026-08-24); true forces the complete blind sweep (a
/// brand new car, or checking for newly-covered sensors after a map
/// update). Cancellable through the existing uds_cancel_scan command.
#[tauri::command]
async fn discover_sensors(
    state: tauri::State<'_, AppState>,
    full: bool,
) -> Result<elm::uds::DiscoveryReport, String> {
    ask(&state, |tx| Request::Discover { full, tx }).await
}

/// What previous discovery passes found for a vehicle: one row per module
/// with its DID counts. Local DB read, no car needed.
#[tauri::command]
fn discovered_modules(
    state: tauri::State<AppState>,
    vehicle_id: i64,
) -> Vec<db::DiscoveredModuleRow> {
    state.db.discovered_summary(vehicle_id)
}

#[tauri::command]
fn discovered_dids(state: tauri::State<AppState>, module_id: i64) -> Vec<db::DiscoveredDidRow> {
    state.db.discovered_dids(module_id)
}

/// Local, VIN-free cohort measurement for the 30–50 vehicle fingerprint
/// experiment. No adapter connection is required and no vehicle traffic is
/// generated.
#[tauri::command]
fn fingerprint_experiment(state: tauri::State<AppState>) -> db::FingerprintExperimentReport {
    state.db.fingerprint_experiment()
}

/// Persisted, evidence-only topology for one vehicle. This local read does
/// not contact the adapter or infer module classifications.
#[tauri::command]
fn vehicle_evidence_map(state: tauri::State<AppState>, vehicle_id: i64) -> db::VehicleEvidenceMap {
    state.db.vehicle_evidence_map(vehicle_id)
}

/// Clears the fault memory on one module (ABS/engine). Standard, safe
/// diagnostic operation — cannot damage anything, only erases stored codes.
/// Returns a verified before/after so the UI can show what actually happened.
#[tauri::command]
async fn uds_clear(
    state: tauri::State<'_, AppState>,
    module: String,
    confirmed: bool,
) -> Result<ClearOutcome, String> {
    require_confirmed(confirmed)?;
    ask(&state, |tx| Request::UdsClear { module, tx }).await
}

/// Reads the fault codes currently stored on one module (UDS 19 02, read-only).
#[tauri::command]
async fn uds_module_dtcs(
    state: tauri::State<'_, AppState>,
    module: String,
) -> Result<Vec<String>, String> {
    ask(&state, |tx| Request::UdsModuleDtcs { module, tx }).await
}

#[tauri::command]
fn reading_keys(state: tauri::State<AppState>, vehicle_id: Option<i64>) -> Vec<String> {
    state.db.reading_keys(vehicle_id)
}

#[tauri::command]
fn list_vehicles(state: tauri::State<AppState>) -> Vec<db::VehicleListRow> {
    state.db.list_vehicles()
}

#[tauri::command]
fn vehicle_report(state: tauri::State<AppState>, vehicle_id: i64) -> db::CarReport {
    state.db.vehicle_report(vehicle_id)
}

#[tauri::command]
fn vehicle_info(state: tauri::State<AppState>, vehicle_id: i64) -> Option<db::Vehicle> {
    state.db.vehicle(vehicle_id)
}

#[tauri::command]
fn set_vehicle_name(state: tauri::State<AppState>, vehicle_id: i64, name: String) {
    state.db.set_vehicle_name(vehicle_id, name.trim());
}

/// The "name this car" flow for a live, VIN-less connection — routed through
/// the supervisor so the connection loop can adopt the new identity and
/// re-emit conn-status (see Request::NameVehicle).
#[tauri::command]
async fn name_current_vehicle(
    state: tauri::State<'_, AppState>,
    name: String,
) -> Result<i64, String> {
    ask(&state, |tx| Request::NameVehicle { name, tx }).await
}

#[tauri::command]
fn set_fuel_price(state: tauri::State<AppState>, vehicle_id: i64, price: f64) {
    state.db.set_fuel_price(vehicle_id, price);
}

/// Probes for one car — the vehicle's own plus any legacy (pre-scoping)
/// global ones. `None` when no vehicle is identified.
#[tauri::command]
fn list_probes(state: tauri::State<AppState>, vehicle_id: Option<i64>) -> Vec<db::UdsProbe> {
    state.db.list_probes(vehicle_id)
}

#[tauri::command]
fn add_probe(state: tauri::State<AppState>, probe: db::UdsProbe, vehicle_id: Option<i64>) -> i64 {
    state.db.add_probe(&probe, vehicle_id)
}

#[tauri::command]
fn delete_probe(state: tauri::State<AppState>, id: i64) {
    state.db.delete_probe(id)
}

#[tauri::command]
fn toggle_probe(state: tauri::State<AppState>, id: i64, enabled: bool) {
    state.db.toggle_probe(id, enabled)
}

/// Scan history for one vehicle; `None` means "the current unidentified
/// connection's scans" (vehicle_id IS NULL rows), never "everything."
#[tauri::command]
fn dtc_history(
    state: tauri::State<AppState>,
    vehicle_id: Option<i64>,
    limit: i64,
) -> Vec<db::DtcScan> {
    state.db.dtc_history(vehicle_id, limit)
}

#[tauri::command]
fn diagnostic_cases(
    state: tauri::State<AppState>,
    vehicle_id: Option<i64>,
) -> Vec<db::DiagnosticCase> {
    state.db.diagnostic_cases(vehicle_id)
}

#[tauri::command]
fn create_diagnostic_case(
    state: tauri::State<AppState>,
    vehicle_id: i64,
    complaint: String,
    odometer_km: Option<i64>,
    assigned_to: Option<String>,
) -> Result<db::DiagnosticCase, String> {
    state
        .db
        .create_diagnostic_case(vehicle_id, &complaint, odometer_km, assigned_to.as_deref())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn history(
    state: tauri::State<AppState>,
    vehicle_id: Option<i64>,
    key: String,
    since_hours: f64,
) -> Vec<db::HistoryPoint> {
    state.db.history(vehicle_id, &key, since_hours)
}

#[tauri::command]
fn export_json(state: tauri::State<AppState>, vehicle_id: Option<i64>, since_hours: f64) -> String {
    state.db.export_json(vehicle_id, since_hours)
}

#[tauri::command]
fn db_path(app: tauri::AppHandle) -> String {
    data_db_path(&app).display().to_string()
}

/// One batch of unsynced (or idempotently re-syncable) rows for the cloud
/// sync engine (src/lib/sync.ts) — see db::SyncBatch's doc comment.
#[tauri::command]
fn sync_batch(state: tauri::State<AppState>, after_reading_id: i64, limit: i64) -> db::SyncBatch {
    state
        .db
        .sync_batch(after_reading_id, limit.clamp(1, 20_000))
}

/// App-level settings kv (sync watermark etc.) — deliberately generic, the
/// same table the connection ladder's learned level already uses.
#[tauri::command]
fn app_setting_get(state: tauri::State<AppState>, key: String) -> Option<String> {
    state.db.setting_get(&key)
}

#[tauri::command]
fn app_setting_set(state: tauri::State<AppState>, key: String, value: String) {
    state.db.setting_set(&key, &value);
}

/// Markdown briefing about the car, ready to paste into any AI chat.
#[tauri::command]
fn ai_context(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    vehicle_id: Option<i64>,
    since_hours: f64,
) -> String {
    let vehicles: Vec<_> = vehicle_id
        .and_then(|id| state.db.vehicle(id))
        .map(|v| db::VehicleListRow {
            id: v.id,
            vin: v.vin,
            display_name: v.display_name,
            connections: state.db.connection_count(Some(v.id)),
        })
        .into_iter()
        .collect();
    let scans = state.db.dtc_history(vehicle_id, 5);
    let stats = state.db.key_stats(vehicle_id, since_hours);
    let sessions = state.db.connection_count(vehicle_id);
    let days = since_hours / 24.0;

    let mut md = String::from("# Car diagnostic briefing (Scainner export)\n\n## Vehicles\n\n");
    // Deliberately no hardcoded car description here — Scainner works on any
    // car (see README "Bring your own car"), so the briefing only claims what
    // was actually read from (or the user named for) each connected vehicle.
    if vehicles.is_empty() {
        md.push_str("(No vehicle recorded yet — connect to a car first.)\n");
    }
    for v in &vehicles {
        let identity = match (&v.display_name, &v.vin) {
            (Some(name), Some(vin)) => format!("{name} (VIN {vin})"),
            (Some(name), None) => {
                format!("{name} (no VIN — ECU predates Mode 09 or never answered)")
            }
            (None, Some(vin)) => format!("VIN {vin}"),
            (None, None) => "unnamed vehicle".to_string(),
        };
        md.push_str(&format!(
            "- #{}: {} — {} connection(s)\n",
            v.id, identity, v.connections
        ));
    }
    md.push_str(&format!("- Recorded connections total: {sessions}\n\n"));

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

    md.push_str(&format!(
        "\n## Sensor stats, last {days:.1} days (min / avg / max)\n\n"
    ));
    for st in &stats {
        md.push_str(&format!(
            "- {}: {:.1} / {:.1} / {:.1} ({} samples)\n",
            st.key, st.min, st.avg, st.max, st.n
        ));
    }
    md.push_str(&format!(
        "\nRaw SQLite (full history): `{}` — tables: vehicles, connections, readings(ts,key,value,vehicle_id), dtc_scan_events, dtc_codes.\n",
        data_db_path(&app).display()
    ));
    md
}

fn data_db_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    let dir = app.path().app_data_dir().expect("no app data dir");
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
            diagnostic_cases,
            create_diagnostic_case,
            history,
            export_json,
            db_path,
            sync_batch,
            app_setting_get,
            app_setting_set,
            ai_context,
            all_sensors,
            uds_modules,
            add_uds_module,
            delete_uds_module,
            uds_read,
            uds_scan,
            uds_cancel_scan,
            discover_sensors,
            discovered_modules,
            discovered_dids,
            fingerprint_experiment,
            vehicle_evidence_map,
            uds_clear,
            uds_module_dtcs,
            writes_log,
            list_probes,
            reading_keys,
            list_vehicles,
            vehicle_report,
            vehicle_info,
            set_vehicle_name,
            name_current_vehicle,
            set_fuel_price,
            add_probe,
            delete_probe,
            toggle_probe
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
