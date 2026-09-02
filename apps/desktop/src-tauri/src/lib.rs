mod api;
mod db;
mod elm;

use api::ops::{self, AppState};
use db::Db;
use elm::obd::{DtcResult, EcuInfo, SensorReading};
use elm::supervisor::ConnStatus;
use elm::uds::ClearOutcome;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::Manager;

type State<'a> = tauri::State<'a, Arc<AppState>>;

#[tauri::command]
fn connect(app: tauri::AppHandle, state: State) -> Result<(), String> {
    ops::connect(&state, app)
}

#[tauri::command]
fn disconnect(state: State) -> Result<(), String> {
    ops::disconnect(&state)
}

#[tauri::command]
fn list_adapters(state: State) -> Vec<elm::transport::enumerate::AdapterCandidate> {
    ops::list_adapters(&state)
}

#[tauri::command]
async fn discover_adapters(
    seconds: Option<u8>,
) -> Result<Vec<elm::transport::bluetooth::NearbyDevice>, String> {
    ops::discover_adapters(
        seconds
            .unwrap_or(elm::transport::bluetooth::DEFAULT_DISCOVER_SECONDS)
            .clamp(
                *elm::transport::bluetooth::DISCOVER_SECONDS.start(),
                *elm::transport::bluetooth::DISCOVER_SECONDS.end(),
            ),
    )
    .await
}

#[tauri::command]
async fn pair_adapter(addr: String, pin: Option<String>) -> Result<(), String> {
    ops::pair_adapter(addr.trim().to_ascii_lowercase(), pin)
        .await
        .map_err(|failure| failure.to_string())
}

#[tauri::command]
fn get_adapter_profile(state: State) -> elm::transport::AdapterProfile {
    ops::adapter_profile(&state)
}

#[tauri::command]
fn set_adapter_profile(
    state: State,
    profile: elm::transport::AdapterProfile,
) -> Result<elm::transport::AdapterProfile, String> {
    ops::set_adapter_profile(&state, profile)
}

#[tauri::command]
fn uds_cancel_scan(state: State) {
    ops::uds_cancel_scan(&state)
}

#[tauri::command]
fn conn_status(state: State) -> ConnStatus {
    ops::conn_status(&state)
}

#[tauri::command]
async fn scan_dtcs(state: State<'_>) -> Result<DtcResult, String> {
    ops::scan_dtcs(&state).await
}

#[tauri::command]
async fn start_ride(state: State<'_>) -> Result<db::Ride, String> {
    ops::start_ride(&state).await
}

#[tauri::command]
async fn stop_ride(state: State<'_>, id: i64) -> Result<db::Ride, String> {
    ops::stop_ride(&state, id).await
}

#[tauri::command]
fn list_rides(state: State, vehicle_id: i64) -> Vec<db::Ride> {
    ops::list_rides(&state, vehicle_id)
}

#[tauri::command]
async fn clear_dtcs(
    state: State<'_>,
    confirmed: bool,
) -> Result<elm::obd::ObdClearOutcome, String> {
    ops::clear_dtcs(&state, confirmed).await
}

#[tauri::command]
fn writes_log(state: State, vehicle_id: Option<i64>, limit: i64) -> Vec<db::WriteLogRow> {
    ops::writes_log(&state, vehicle_id, limit)
}

#[tauri::command]
async fn read_ecu_info(state: State<'_>) -> Result<EcuInfo, String> {
    ops::read_ecu_info(&state).await
}

#[tauri::command]
async fn readiness(state: State<'_>) -> Result<HashMap<String, bool>, String> {
    ops::readiness(&state).await
}

#[tauri::command]
async fn all_sensors(state: State<'_>) -> Result<Vec<SensorReading>, String> {
    ops::all_sensors(&state).await
}

#[tauri::command]
fn uds_modules(state: State) -> Vec<elm::uds::UdsModule> {
    ops::uds_modules(&state)
}

#[tauri::command]
fn add_uds_module(
    state: State,
    key: String,
    label: String,
    req: String,
    resp: String,
) -> Result<(), String> {
    ops::add_uds_module(&state, &key, &label, &req, &resp)
}

#[tauri::command]
fn delete_uds_module(state: State, key: String) {
    ops::delete_uds_module(&state, &key)
}

#[tauri::command]
async fn uds_read(
    state: State<'_>,
    module: String,
    did: u16,
) -> Result<Option<elm::uds::UdsHit>, String> {
    ops::uds_read(&state, module, did).await
}

#[tauri::command]
async fn uds_scan(
    state: State<'_>,
    module: String,
    from: u16,
    to: u16,
) -> Result<Vec<elm::uds::UdsHit>, String> {
    ops::uds_scan(&state, module, from, to).await
}

#[tauri::command]
async fn discover_sensors(
    state: State<'_>,
    full: bool,
) -> Result<elm::uds::DiscoveryReport, String> {
    ops::discover_sensors(&state, full).await
}

#[tauri::command]
async fn run_discovery(
    state: State<'_>,
    vehicle_id: i64,
) -> Result<ops::DiscoveryRunOutcome, String> {
    ops::run_discovery(&state, vehicle_id).await
}

#[tauri::command]
async fn parked_verification(
    state: State<'_>,
) -> Result<elm::uds::ParkedVerificationReport, String> {
    ops::parked_verification(&state).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn correlation_capture(
    state: State<'_>,
    req: String,
    resp: String,
    dids: Vec<u16>,
    step: String,
    condition: String,
    plan_version: String,
    repeats: u8,
) -> Result<elm::uds::CorrelationCapture, String> {
    ops::correlation_capture(
        &state,
        ops::CorrelationCaptureArgs {
            req,
            resp,
            dids,
            step,
            condition,
            plan_version,
            repeats,
        },
    )
    .await
}

#[tauri::command]
async fn uds_read_many(
    state: State<'_>,
    module: String,
    dids: Vec<u16>,
) -> Result<Vec<elm::uds::UdsHit>, String> {
    ops::uds_read_many(&state, module, dids).await
}

#[tauri::command]
fn parked_plan(state: State, vehicle_id: i64) -> Option<elm::discovery::plan::ParkedPlan> {
    ops::parked_plan(&state, vehicle_id)
}

#[tauri::command]
fn guided_steps(state: State, vehicle_id: i64) -> Option<ops::GuidedSteps> {
    ops::guided_steps(&state, vehicle_id)
}

#[tauri::command]
fn discovered_modules(state: State, vehicle_id: i64) -> Vec<db::DiscoveredModuleRow> {
    ops::discovered_modules(&state, vehicle_id)
}

#[tauri::command]
fn discovered_dids(state: State, module_id: i64) -> Vec<db::DiscoveredDidRow> {
    ops::discovered_dids(&state, module_id)
}

#[tauri::command]
fn fingerprint_experiment(state: State) -> db::FingerprintExperimentReport {
    ops::fingerprint_experiment(&state)
}

#[tauri::command]
fn vehicle_evidence_map(state: State, vehicle_id: i64) -> db::VehicleEvidenceMap {
    ops::vehicle_evidence_map(&state, vehicle_id)
}

#[tauri::command]
async fn uds_clear(
    state: State<'_>,
    module: String,
    confirmed: bool,
) -> Result<ClearOutcome, String> {
    ops::uds_clear(&state, module, confirmed).await
}

#[tauri::command]
async fn uds_module_dtcs(state: State<'_>, module: String) -> Result<Vec<String>, String> {
    ops::uds_module_dtcs(&state, module).await
}

#[tauri::command]
fn reading_keys(state: State, vehicle_id: Option<i64>) -> Vec<String> {
    ops::reading_keys(&state, vehicle_id)
}

#[tauri::command]
fn reading_key_details(state: State, vehicle_id: Option<i64>) -> Vec<db::ReadingKeyRow> {
    ops::reading_key_details(&state, vehicle_id)
}

#[tauri::command]
fn list_vehicles(state: State) -> Vec<db::VehicleListRow> {
    ops::list_vehicles(&state)
}

#[tauri::command]
fn vehicle_report(state: State, vehicle_id: i64) -> db::CarReport {
    ops::vehicle_report(&state, vehicle_id)
}

#[tauri::command]
fn vehicle_info(state: State, vehicle_id: i64) -> Option<db::Vehicle> {
    ops::vehicle_info(&state, vehicle_id)
}

#[tauri::command]
fn set_vehicle_name(state: State, vehicle_id: i64, name: String) {
    ops::set_vehicle_name(&state, vehicle_id, &name);
}

#[tauri::command]
async fn name_current_vehicle(state: State<'_>, name: String) -> Result<i64, String> {
    ops::name_current_vehicle(&state, name).await
}

#[tauri::command]
fn set_fuel_price(state: State, vehicle_id: i64, price: f64) {
    ops::set_fuel_price(&state, vehicle_id, price);
}

#[tauri::command]
fn list_probes(state: State, vehicle_id: Option<i64>) -> Vec<db::UdsProbe> {
    ops::list_probes(&state, vehicle_id)
}

#[tauri::command]
fn add_probe(state: State, probe: db::UdsProbe, vehicle_id: Option<i64>) -> Result<i64, String> {
    ops::add_probe(&state, &probe, vehicle_id)
}

#[tauri::command]
fn delete_probe(state: State, id: i64) {
    ops::delete_probe(&state, id)
}

#[tauri::command]
fn toggle_probe(state: State, id: i64, enabled: bool) {
    ops::toggle_probe(&state, id, enabled)
}

#[tauri::command]
fn dtc_history(state: State, vehicle_id: Option<i64>, limit: i64) -> Vec<db::DtcScan> {
    ops::dtc_history(&state, vehicle_id, limit)
}

#[tauri::command]
fn diagnostic_cases(state: State, vehicle_id: Option<i64>) -> Vec<db::DiagnosticCase> {
    ops::diagnostic_cases(&state, vehicle_id)
}

#[tauri::command]
fn create_diagnostic_case(
    state: State,
    vehicle_id: i64,
    complaint: String,
    odometer_km: Option<i64>,
    assigned_to: Option<String>,
) -> Result<db::DiagnosticCase, String> {
    ops::create_diagnostic_case(
        &state,
        vehicle_id,
        &complaint,
        odometer_km,
        assigned_to.as_deref(),
    )
}

#[tauri::command]
fn history(
    state: State,
    vehicle_id: Option<i64>,
    key: String,
    since_hours: f64,
) -> Vec<db::HistoryPoint> {
    ops::history(&state, vehicle_id, &key, since_hours)
}

#[tauri::command]
fn export_json(state: State, vehicle_id: Option<i64>, since_hours: f64) -> String {
    ops::export_json(&state, vehicle_id, since_hours)
}

#[tauri::command]
fn db_path(state: State) -> String {
    ops::db_path(&state)
}

#[tauri::command]
fn sync_batch(state: State, after_reading_id: i64, limit: i64) -> db::SyncBatch {
    ops::sync_batch(&state, after_reading_id, limit)
}

#[tauri::command]
fn app_setting_get(state: State, key: String) -> Option<String> {
    ops::app_setting_get(&state, &key)
}

#[tauri::command]
fn app_setting_set(state: State, key: String, value: String) {
    ops::app_setting_set(&state, &key, &value);
}

#[tauri::command]
fn ai_context(state: State, vehicle_id: Option<i64>, since_hours: f64) -> String {
    ops::ai_context(&state, vehicle_id, since_hours)
}

fn data_db_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    let dir = app.path().app_data_dir().expect("no app data dir");
    std::fs::create_dir_all(&dir).ok();
    dir.join("scainner.sqlite3")
}

struct Tee(std::fs::File);

impl std::io::Write for Tee {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let _ = self.0.write_all(buf);
        std::io::stderr().write(buf)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        let _ = self.0.flush();
        std::io::stderr().flush()
    }
}

fn log_file() -> Option<std::fs::File> {
    #[cfg(target_os = "macos")]
    {
        let dir = std::path::PathBuf::from(std::env::var_os("HOME")?)
            .join("Library/Logs/com.cxalem.scainner");
        std::fs::create_dir_all(&dir).ok()?;
        let path = dir.join("desktop.log");
        if std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0) > 2 * 1024 * 1024 {
            std::fs::rename(&path, dir.join("desktop.log.1")).ok();
        }
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .ok()
    }
    #[cfg(not(target_os = "macos"))]
    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut logger =
        env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"));
    if let Some(file) = log_file() {
        logger.target(env_logger::Target::Pipe(Box::new(Tee(file))));
    }
    logger.init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let path = data_db_path(app.handle());
            let db = Arc::new(Db::open(&path).expect("failed to open sqlite db"));
            let state = Arc::new(AppState::new(db, path));
            app.manage(state.clone());
            api::start(app.handle().clone(), state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            connect,
            disconnect,
            list_adapters,
            discover_adapters,
            pair_adapter,
            get_adapter_profile,
            set_adapter_profile,
            conn_status,
            scan_dtcs,
            start_ride,
            stop_ride,
            list_rides,
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
            run_discovery,
            parked_verification,
            correlation_capture,
            uds_read_many,
            parked_plan,
            guided_steps,
            discovered_modules,
            discovered_dids,
            fingerprint_experiment,
            vehicle_evidence_map,
            uds_clear,
            uds_module_dtcs,
            writes_log,
            list_probes,
            reading_keys,
            reading_key_details,
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
