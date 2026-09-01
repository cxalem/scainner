//! The one set of operations both front doors share.
//!
//! Every `#[tauri::command]` in `lib.rs` and every HTTP handler in
//! `api/mod.rs` is a thin adapter over a function here, so the UI and an
//! agent hitting the local API go through exactly the same code path to the
//! supervisor and the database (decision record: personal-hub
//! `1-Projects/Scainner/agent-api.md`). Nothing in this file knows about
//! Tauri IPC or HTTP — it takes an `AppState` and plain arguments.

use crate::db::{self, Db};
use crate::elm;
use crate::elm::discovery;
use crate::elm::obd::{DtcResult, EcuInfo, SensorReading};
use crate::elm::supervisor::{ConnStatus, Request, Supervisor};
use crate::elm::uds::ClearOutcome;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub struct AppState {
    pub db: Arc<Db>,
    pub supervisor: Mutex<Option<Supervisor>>,
    /// Where the SQLite file lives — reported by `db_path` and in the AI
    /// briefing so an agent can open the raw history if it needs to.
    pub db_path: PathBuf,
}

impl AppState {
    pub fn new(db: Arc<Db>, db_path: PathBuf) -> Self {
        Self {
            db,
            supervisor: Mutex::new(None),
            db_path,
        }
    }
}

// Safety-net ceiling, not the everyday UX timer — normal requests (DTC scan,
// single DID read, PID reads) return in well under a second to a few seconds.
// UDS range scans are the outlier: 256 DIDs at up to 600ms each plus session
// overhead can legitimately take a couple of minutes, so this has to cover
// that comfortably or a slow-but-healthy scan gets mistaken for a hang (see
// uds_scan_range's doc comment for the full story).
const ASK_TIMEOUT: Duration = Duration::from_secs(300);

/// Ceiling for the multi-minute research operations (full discovery, the
/// parked verification plan, correlation captures with repeats): these can
/// legitimately run well past five minutes on a slow ECU.
const LONG_ASK_TIMEOUT: Duration = Duration::from_secs(30 * 60);

/// A poisoned mutex (from a previous panic while holding it) would otherwise
/// make every single command that touches shared state panic forever after —
/// one bad unwrap cascading into a fully dead app. Recover instead: the state
/// underneath is still perfectly usable, only the "was a panic in progress"
/// flag got set.
pub fn lock_or_recover<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
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
pub async fn ask<T: Send + 'static>(
    state: &AppState,
    make: impl FnOnce(mpsc::Sender<Result<T, String>>) -> Request,
) -> Result<T, String> {
    ask_within(state, ASK_TIMEOUT, make).await
}

async fn ask_within<T: Send + 'static>(
    state: &AppState,
    timeout: Duration,
    make: impl FnOnce(mpsc::Sender<Result<T, String>>) -> Request,
) -> Result<T, String> {
    let rx = {
        let guard = lock_or_recover(&state.supervisor);
        let sup = guard.as_ref().ok_or("not connected")?;
        let (tx, rx) = mpsc::channel();
        sup.tx.send(make(tx)).map_err(|_| "supervisor gone")?;
        rx
    };
    tauri::async_runtime::spawn_blocking(move || match rx.recv_timeout(timeout) {
        Ok(r) => r,
        Err(_) => {
            log::warn!("request timed out after {timeout:?} waiting for supervisor reply");
            Err("timed out waiting for dongle".to_string())
        }
    })
    .await
    .map_err(|e| format!("worker join error: {e}"))?
}

/// Write safety rail, enforced at the command boundary: every operation that
/// writes to the car takes `confirmed` and refuses when it is false, so a
/// stray call (a bug, a future automation, an agent) cannot skip the
/// confirmation step. The frontend passes true only from its confirm modal;
/// the HTTP API only from an explicit `{"confirmed": true}` body.
pub fn require_confirmed(confirmed: bool) -> Result<(), String> {
    if confirmed {
        Ok(())
    } else {
        Err("Write not confirmed. This action changes the car, so the app must show the confirmation step first.".into())
    }
}

// ---------- connection lifecycle ----------

/// One connect request = one run of the connect pipeline. A supervisor
/// whose run failed has already stopped its thread and left the stage and
/// reason on its status, so "try again" replaces it with a fresh one
/// instead of silently doing nothing; a run that is still connecting or
/// already connected is left alone.
pub fn connect(state: &AppState, app: tauri::AppHandle) -> Result<(), String> {
    let mut guard = lock_or_recover(&state.supervisor);
    if let Some(supervisor) = guard.as_ref() {
        if lock_or_recover(&supervisor.status).state != "disconnected" {
            return Ok(()); // still running
        }
    }
    *guard = Some(Supervisor::spawn(app, state.db.clone()));
    Ok(())
}

pub fn disconnect(state: &AppState) -> Result<(), String> {
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
pub fn uds_cancel_scan(state: &AppState) {
    log::debug!("scan cancel requested");
    if let Some(sup) = lock_or_recover(&state.supervisor).as_ref() {
        sup.cancel_scan
            .store(true, std::sync::atomic::Ordering::Relaxed);
    }
}

pub fn conn_status(state: &AppState) -> ConnStatus {
    lock_or_recover(&state.supervisor)
        .as_ref()
        .map(|s| lock_or_recover(&s.status).clone())
        .unwrap_or(ConnStatus {
            state: "disconnected".into(),
            ..Default::default()
        })
}

// ---------- standard OBD ----------

pub async fn scan_dtcs(state: &AppState) -> Result<DtcResult, String> {
    ask(state, Request::ScanDtcs).await
}

/// Clears engine DTCs (mode 04), verified: scans before, clears, scans
/// again, and logs the whole thing to `writes_log`. Returns both scans so
/// the caller can show an honest before/after.
pub async fn clear_dtcs(
    state: &AppState,
    confirmed: bool,
) -> Result<elm::obd::ObdClearOutcome, String> {
    require_confirmed(confirmed)?;
    ask(state, Request::ClearDtcs).await
}

pub async fn read_ecu_info(state: &AppState) -> Result<EcuInfo, String> {
    ask(state, Request::ReadEcuInfo).await
}

pub async fn readiness(state: &AppState) -> Result<HashMap<String, bool>, String> {
    ask(state, Request::Readiness).await
}

pub async fn all_sensors(state: &AppState) -> Result<Vec<SensorReading>, String> {
    ask(state, Request::AllSensors).await
}

// ---------- UDS ----------

/// The modules offered for the connected vehicle: what the knowledge map
/// documents for its VIN (`source: "profile"`) plus the user's customs
/// (`source: "custom"`). Without a connected, identified vehicle only the
/// customs are offered — there is no profile to draw on.
pub fn uds_modules(state: &AppState) -> Vec<elm::uds::UdsModule> {
    let vin = conn_status(state).vin;
    let custom = elm::uds::custom_modules(&state.db, vin.as_deref());
    elm::uds::modules_for_vin(vin.as_deref(), &custom)
}

/// Add a custom module (any brand's CAN request/response IDs, hex strings
/// like "7E0"/"7E8") for routes the knowledge map does not document yet.
pub fn add_uds_module(
    state: &AppState,
    key: &str,
    label: &str,
    req: &str,
    resp: &str,
) -> Result<(), String> {
    state
        .db
        .add_uds_module(key, label, &req.to_uppercase(), &resp.to_uppercase())
}

pub fn delete_uds_module(state: &AppState, key: &str) {
    state.db.delete_uds_module(key)
}

pub async fn uds_read(
    state: &AppState,
    module: String,
    did: u16,
) -> Result<Option<elm::uds::UdsHit>, String> {
    ask(state, |tx| Request::UdsRead { module, did, tx }).await
}

pub async fn uds_read_many(
    state: &AppState,
    module: String,
    dids: Vec<u16>,
) -> Result<Vec<elm::uds::UdsHit>, String> {
    ask(state, |tx| Request::UdsReadMany { module, dids, tx }).await
}

pub async fn uds_scan(
    state: &AppState,
    module: String,
    from: u16,
    to: u16,
) -> Result<Vec<elm::uds::UdsHit>, String> {
    ask_within(state, LONG_ASK_TIMEOUT, |tx| Request::UdsScan {
        module,
        from,
        to,
        tx,
    })
    .await
}

/// One-button auto-discovery. No addresses/ranges to fill in — those come
/// from the car's VIN and the shipped knowledge map, never from the user.
/// `full`: false re-probes only what a prior pass on THIS car already
/// found (fast); true forces the complete blind sweep. Cancellable through
/// `uds_cancel_scan`.
pub async fn discover_sensors(
    state: &AppState,
    full: bool,
) -> Result<elm::uds::DiscoveryReport, String> {
    ask_within(state, LONG_ASK_TIMEOUT, |tx| Request::Discover { full, tx }).await
}

/// Reproducible parked-car research pass over the plan generated from the
/// vehicle's profile (`discovery::plan`). Read-only requests on each
/// module's read service; the complete evidence is attached to this vehicle
/// and connection in SQLite.
pub async fn parked_verification(
    state: &AppState,
) -> Result<elm::uds::ParkedVerificationReport, String> {
    ask_within(state, LONG_ASK_TIMEOUT, Request::ParkedVerification).await
}

/// Arguments of one guided-correlation step, shared by both front doors.
#[derive(serde::Deserialize, Clone, Debug)]
pub struct CorrelationCaptureArgs {
    pub req: String,
    pub resp: String,
    pub dids: Vec<u16>,
    pub step: String,
    pub condition: String,
    pub plan_version: String,
    #[serde(default = "default_repeats")]
    pub repeats: u8,
}

fn default_repeats() -> u8 {
    3
}

/// One step of a guided correlation session: the operator holds a physical
/// condition, the app reads the given identifiers `repeats` times. Read-only.
pub async fn correlation_capture(
    state: &AppState,
    args: CorrelationCaptureArgs,
) -> Result<elm::uds::CorrelationCapture, String> {
    ask_within(state, LONG_ASK_TIMEOUT, |tx| Request::CorrelationCapture {
        req: args.req,
        resp: args.resp,
        dids: args.dids,
        step: args.step,
        condition: args.condition,
        plan_version: args.plan_version,
        repeats: args.repeats,
        tx,
    })
    .await
}

/// Clears the fault memory on one module (ABS/engine). Standard, safe
/// diagnostic operation — cannot damage anything, only erases stored codes.
/// Returns a verified before/after so the caller can show what happened.
pub async fn uds_clear(
    state: &AppState,
    module: String,
    confirmed: bool,
) -> Result<ClearOutcome, String> {
    require_confirmed(confirmed)?;
    ask(state, |tx| Request::UdsClear { module, tx }).await
}

/// Reads the fault codes currently stored on one module (UDS 19 02, read-only).
pub async fn uds_module_dtcs(state: &AppState, module: String) -> Result<Vec<String>, String> {
    ask(state, |tx| Request::UdsModuleDtcs { module, tx }).await
}

/// The "name this car" flow for a live, VIN-less connection — routed through
/// the supervisor so the connection loop can adopt the new identity and
/// re-emit conn-status (see Request::NameVehicle).
pub async fn name_current_vehicle(state: &AppState, name: String) -> Result<i64, String> {
    ask(state, |tx| Request::NameVehicle { name, tx }).await
}

// ---------- knowledge (local DB reads, no car needed) ----------

pub fn writes_log(state: &AppState, vehicle_id: Option<i64>, limit: i64) -> Vec<db::WriteLogRow> {
    state.db.writes_log(vehicle_id, limit)
}

pub fn discovered_modules(state: &AppState, vehicle_id: i64) -> Vec<db::DiscoveredModuleRow> {
    state.db.discovered_summary(vehicle_id)
}

pub fn discovered_dids(state: &AppState, module_id: i64) -> Vec<db::DiscoveredDidRow> {
    state.db.discovered_dids(module_id)
}

pub fn fingerprint_experiment(state: &AppState) -> db::FingerprintExperimentReport {
    state.db.fingerprint_experiment()
}

pub fn vehicle_evidence_map(state: &AppState, vehicle_id: i64) -> db::VehicleEvidenceMap {
    state.db.vehicle_evidence_map(vehicle_id)
}

pub fn reading_keys(state: &AppState, vehicle_id: Option<i64>) -> Vec<String> {
    state.db.reading_keys(vehicle_id)
}

pub fn list_vehicles(state: &AppState) -> Vec<db::VehicleListRow> {
    state.db.list_vehicles()
}

pub fn knowledge_candidates(state: &AppState) -> Vec<db::KnowledgeCandidateRow> {
    state.db.knowledge_candidates()
}

pub fn delete_vehicle_private_data(state: &AppState, vehicle_id: i64) -> bool {
    state.db.delete_vehicle_private_data(vehicle_id)
}

pub fn vehicle_report(state: &AppState, vehicle_id: i64) -> db::CarReport {
    state.db.vehicle_report(vehicle_id)
}

pub fn vehicle_info(state: &AppState, vehicle_id: i64) -> Option<db::Vehicle> {
    state.db.vehicle(vehicle_id)
}

pub fn set_vehicle_name(state: &AppState, vehicle_id: i64, name: &str) {
    state.db.set_vehicle_name(vehicle_id, name.trim());
}

pub fn set_fuel_price(state: &AppState, vehicle_id: i64, price: f64) {
    state.db.set_fuel_price(vehicle_id, price);
}

pub fn list_probes(state: &AppState, vehicle_id: Option<i64>) -> Vec<db::UdsProbe> {
    state.db.list_probes(vehicle_id)
}

pub fn add_probe(state: &AppState, probe: &db::UdsProbe, vehicle_id: Option<i64>) -> i64 {
    state.db.add_probe(probe, vehicle_id)
}

pub fn delete_probe(state: &AppState, id: i64) {
    state.db.delete_probe(id)
}

pub fn toggle_probe(state: &AppState, id: i64, enabled: bool) {
    state.db.toggle_probe(id, enabled)
}

pub fn update_probe_decode(state: &AppState, id: i64, probe: &db::UdsProbe) -> bool {
    state.db.update_probe_decode(id, probe)
}

pub fn dtc_history(state: &AppState, vehicle_id: Option<i64>, limit: i64) -> Vec<db::DtcScan> {
    state.db.dtc_history(vehicle_id, limit)
}

pub fn diagnostic_cases(state: &AppState, vehicle_id: Option<i64>) -> Vec<db::DiagnosticCase> {
    state.db.diagnostic_cases(vehicle_id)
}

pub fn create_diagnostic_case(
    state: &AppState,
    vehicle_id: i64,
    complaint: &str,
    odometer_km: Option<i64>,
    assigned_to: Option<&str>,
) -> Result<db::DiagnosticCase, String> {
    state
        .db
        .create_diagnostic_case(vehicle_id, complaint, odometer_km, assigned_to)
        .map_err(|error| error.to_string())
}

pub fn history(
    state: &AppState,
    vehicle_id: Option<i64>,
    key: &str,
    since_hours: f64,
) -> Vec<db::HistoryPoint> {
    state.db.history(vehicle_id, key, since_hours)
}

pub fn export_json(state: &AppState, vehicle_id: Option<i64>, since_hours: f64) -> String {
    state.db.export_json(vehicle_id, since_hours)
}

pub fn db_path(state: &AppState) -> String {
    state.db_path.display().to_string()
}

pub fn sync_batch(state: &AppState, after_reading_id: i64, limit: i64) -> db::SyncBatch {
    state
        .db
        .sync_batch(after_reading_id, limit.clamp(1, 20_000))
}

pub fn app_setting_get(state: &AppState, key: &str) -> Option<String> {
    state.db.setting_get(key)
}

pub fn app_setting_set(state: &AppState, key: &str, value: &str) {
    state.db.setting_set(key, value);
}

// ---------- adapter profile (Phase 5: transport abstraction) ----------

/// Candidate serial ports and paired Bluetooth devices on this machine.
pub fn list_adapters() -> Vec<elm::transport::enumerate::AdapterCandidate> {
    elm::transport::enumerate::candidates()
}

/// The active adapter profile: `adapter.*` settings with the
/// `SCAINNER_OBD_*` environment fallback applied.
pub fn adapter_profile(state: &AppState) -> elm::transport::AdapterProfile {
    elm::transport::AdapterProfile::load(|key| state.db.setting_get(key))
}

/// Persist a profile after validating it. Takes effect at the next
/// (re)connect; the supervisor re-reads the settings on every attempt.
pub fn set_adapter_profile(
    state: &AppState,
    profile: elm::transport::AdapterProfile,
) -> Result<elm::transport::AdapterProfile, String> {
    let profile = profile.normalized();
    profile.validate()?;
    for (key, value) in profile.to_settings() {
        state.db.setting_set(key, &value);
    }
    Ok(profile)
}

pub fn list_verification_runs(
    state: &AppState,
    vehicle_id: Option<i64>,
    plan_version: Option<&str>,
    limit: i64,
) -> Vec<db::VerificationRunRow> {
    state
        .db
        .list_verification_runs(vehicle_id, plan_version, limit)
}

pub fn verification_run(state: &AppState, id: i64) -> Option<(db::VerificationRunRow, String)> {
    state.db.verification_run(id)
}

// ---------- discovery knowledge layer (plan A6) ----------

/// S3 join for one vehicle: families → inherited hypotheses. Local, no car.
pub fn join_vehicle(state: &AppState, vehicle_id: i64) -> Option<discovery::join::JoinSummary> {
    state.db.vehicle(vehicle_id)?;
    Some(discovery::join::join_vehicle(
        &state.db,
        elm::uds_map::map(),
        vehicle_id,
    ))
}

pub fn coverage(state: &AppState, vehicle_id: i64) -> Option<discovery::coverage::CoverageReport> {
    discovery::coverage::coverage(&state.db, elm::uds_map::map(), vehicle_id)
}

/// The parked-verification plan the generator would run for a vehicle, from
/// its profile and the routes it has reached. No car traffic.
pub fn parked_plan(state: &AppState, vehicle_id: i64) -> Option<discovery::plan::ParkedPlan> {
    let vehicle = state.db.vehicle(vehicle_id)?;
    let reached = elm::uds::reached_routes(&state.db, vehicle_id);
    Some(discovery::plan::generate_for_vehicle(
        vehicle.vin.as_deref(),
        vehicle.model.as_deref(),
        &reached,
        elm::uds_map::map(),
    ))
}

pub fn list_hypotheses(state: &AppState, vehicle_id: i64) -> Vec<db::HypothesisRow> {
    state.db.list_hypotheses(vehicle_id)
}

pub fn learning_state(state: &AppState) -> bool {
    state
        .db
        .setting_get(discovery::state::LEARNING_STATE_SETTING)
        .map(|v| v == "on")
        .unwrap_or(false)
}

/// Switch the learning state. Turning it off cascades: every hypothesis
/// polled as `learning` (on any vehicle) goes back to `disabled`, so the
/// supervisor never keeps reading DIDs the flag no longer allows. Returns
/// how many hypotheses were disabled.
pub fn set_learning_state(state: &AppState, on: bool) -> usize {
    state.db.setting_set(
        discovery::state::LEARNING_STATE_SETTING,
        if on { "on" } else { "off" },
    );
    if on {
        0
    } else {
        state.db.disable_learning_hypotheses()
    }
}

/// State transition with the rules enforced; `Err` is the violated rule.
pub fn patch_hypothesis(
    state: &AppState,
    id: i64,
    patch: &db::HypothesisPatch,
) -> Result<Option<db::HypothesisRow>, discovery::state::RuleViolation> {
    let learning_on = learning_state(state);
    state.db.patch_hypothesis(id, patch, learning_on)
}

/// Markdown briefing about the car, ready to paste into any AI chat.
pub fn ai_context(state: &AppState, vehicle_id: Option<i64>, since_hours: f64) -> String {
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
        state.db_path.display()
    ));
    md
}

// ---------- guided correlation steps (multi-brand plan P4.2) ----------

#[cfg(test)]
mod guided_tests {
    use super::expected_signature;

    #[test]
    fn signatures_follow_the_wording() {
        assert_eq!(
            expected_signature("pump the pedal; expect a fall to ~20 hPa"),
            "monotonic_decrease"
        );
        assert_eq!(
            expected_signature("value drops while braking"),
            "monotonic_decrease"
        );
        assert_eq!(
            expected_signature("expect the pressure to decrease"),
            "monotonic_decrease"
        );
        assert_eq!(
            expected_signature("expect a rise with pedal travel"),
            "monotonic_increase"
        );
        assert_eq!(
            expected_signature("temperature should increase after start"),
            "monotonic_increase"
        );
        assert_eq!(
            expected_signature("same slope with an offset"),
            "monotonic_increase"
        );
        assert_eq!(
            expected_signature("sign follows direction"),
            "sign_positive"
        );
        assert_eq!(
            expected_signature("press and release three times"),
            "changed"
        );
    }
}

/// One node of the guided-step state tree (universal discovery protocol §9).
/// Generated from the vehicle's open hypotheses, never written by hand: the
/// app renders it, an API client or an agent walks it the same way.
#[derive(serde::Serialize, Clone, Debug)]
pub struct GuidedStepNode {
    pub id: String,
    /// `baseline` or `input`.
    pub kind: &'static str,
    /// `REQ/RESP` of the module the capture reads.
    pub module: Option<String>,
    pub hypotheses: Vec<String>,
    pub precondition: serde_json::Map<String, serde_json::Value>,
    pub instruction: String,
    pub condition_label: String,
    pub capture: GuidedCapture,
    pub success: GuidedSuccess,
    /// Vehicle facts the step needs; the app asks the operator when a fact
    /// is not known.
    pub applicable_if: serde_json::Map<String, serde_json::Value>,
    pub optional: bool,
    /// Question the operator must answer before the step is offered, when a
    /// fact it depends on is not in the database.
    pub operator_confirmation: Option<String>,
    pub safety: &'static str,
    pub estimated_seconds: u32,
    pub on_success: Option<String>,
    pub on_failure: Option<String>,
}

#[derive(serde::Serialize, Clone, Debug, Default)]
pub struct GuidedCapture {
    pub dids: Vec<String>,
    pub reference_dids: HashMap<String, Vec<String>>,
    pub repeats: u8,
    pub hold_seconds: u32,
}

#[derive(serde::Serialize, Clone, Debug, Default)]
pub struct GuidedSuccess {
    pub expected: HashMap<String, String>,
    pub returns_after: bool,
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct GuidedSteps {
    pub vehicle_id: i64,
    /// `{brand}-{platform|unknown}-corr-v{plan_revision}`.
    pub plan_version: String,
    pub repeats: u8,
    pub facts: serde_json::Map<String, serde_json::Value>,
    pub steps: Vec<GuidedStepNode>,
}

const GUIDED_SAFETY: &str = "read-only; you control the car; stop if anything feels wrong";
const GUIDED_REPEATS: u8 = 3;

/// `{brand}-{platform|unknown}-corr-v{n}`: the parked plan's version with
/// the correlation marker, so both kinds of run share one revision.
pub fn correlation_plan_version(vin: Option<&str>) -> String {
    let parked = discovery::plan::plan_version(vin);
    match parked.rsplit_once("-v") {
        Some((head, rev)) => format!("{head}-corr-v{rev}"),
        None => format!("{parked}-corr"),
    }
}

/// What a discriminating test asks of the operator, read from its wording.
/// Keyword classes, not brands: the same words describe the same physical
/// action on every car.
struct TestShape {
    moves_car: bool,
    needs_gear_selector: bool,
    needs_clutch: bool,
    engine: Option<&'static str>,
}

fn shape_of(test: &str) -> TestShape {
    let t = test.to_ascii_lowercase();
    let moves_car = t.starts_with("drive") || t.contains("roll") || t.contains("drive:");
    let needs_gear_selector = t.contains("reverse")
        || t.contains("select r")
        || t.contains("gear")
        || t.contains("neutral");
    let needs_clutch = t.contains("clutch");
    let engine = if t.contains("engine off") {
        Some("off")
    } else if t.contains("engine running") {
        Some("running")
    } else {
        None
    };
    TestShape {
        moves_car,
        needs_gear_selector,
        needs_clutch,
        engine,
    }
}

/// Stable, label-safe condition name from the test text.
fn condition_slug(test: &str) -> String {
    let mut out = String::new();
    let mut last_sep = true;
    for c in test.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            last_sep = false;
        } else if !last_sep {
            out.push('_');
            last_sep = true;
        }
        if out.len() >= 40 {
            break;
        }
    }
    out.trim_end_matches('_').to_string()
}

/// Per-hypothesis success signature read from the test wording (protocol
/// section 9: `changed`, `monotonic_increase`, `monotonic_decrease`,
/// `sign_positive`). Words that describe a fall map to a decrease, words
/// that describe a rise to an increase; anything else is `changed`.
pub fn expected_signature(test: &str) -> &'static str {
    let t = test.to_ascii_lowercase();
    let decreases = ["fall", "drop", "decrease", "lower", "down to"];
    let increases = ["rise", "increase", "climb", "monotonic", "slope", "grow"];
    if t.contains("sign") {
        "sign_positive"
    } else if decreases.iter().any(|w| t.contains(w)) {
        "monotonic_decrease"
    } else if increases.iter().any(|w| t.contains(w)) {
        "monotonic_increase"
    } else {
        "changed"
    }
}

fn baseline_node(id: &str, module: Option<&str>, dids: Vec<String>) -> GuidedStepNode {
    let mut precondition = serde_json::Map::new();
    precondition.insert("parked".into(), true.into());
    precondition.insert("parking_brake".into(), true.into());
    precondition.insert("hands_off".into(), true.into());
    GuidedStepNode {
        id: id.into(),
        kind: "baseline",
        module: module.map(str::to_string),
        hypotheses: Vec::new(),
        precondition,
        instruction: "Hands off everything: no pedals, wheel centred, no gear engaged, parking brake on. Then capture.".into(),
        condition_label: "baseline".into(),
        capture: GuidedCapture {
            dids,
            reference_dids: HashMap::new(),
            repeats: GUIDED_REPEATS,
            hold_seconds: 0,
        },
        success: GuidedSuccess {
            expected: HashMap::new(),
            returns_after: false,
        },
        applicable_if: serde_json::Map::new(),
        optional: false,
        operator_confirmation: None,
        safety: GUIDED_SAFETY,
        estimated_seconds: 20,
        on_success: None,
        on_failure: None,
    }
}

/// The guided-step tree for one vehicle: open hypotheses that carry a
/// discriminating test, grouped by module and test, each input bracketed
/// by a baseline (A→B→A). Steps that move the car are optional with an
/// explicit precondition; steps that need a gear selector or a clutch carry
/// `applicable_if` plus an operator confirmation while the gearbox is not a
/// known fact. `None` when the vehicle does not exist.
pub fn guided_steps(state: &AppState, vehicle_id: i64) -> Option<GuidedSteps> {
    let vehicle = state.db.vehicle(vehicle_id)?;
    let vin = vehicle.vin.as_deref();
    let rows = state.db.list_hypotheses(vehicle_id);
    let open: Vec<&db::HypothesisRow> =
        rows.iter().filter(|h| h.vehicle_fit != "matched").collect();
    let did_hex = |d: u16| format!("{d:04X}");

    // Facts the database and the pack can vouch for. The gearbox is not
    // recorded anywhere yet, so it is `unknown` and the steps say so.
    let mut facts = serde_json::Map::new();
    facts.insert("vin_known".into(), vin.is_some().into());
    facts.insert(
        "brand".into(),
        elm::uds_map::brand_for_vin(vin)
            .map(|b| b.id.clone())
            .into(),
    );
    facts.insert(
        "platform".into(),
        elm::uds_map::platform_for_vin(vin).map(|p| p.key).into(),
    );
    facts.insert("gearbox".into(), "unknown".into());
    let gearbox_known = false;

    // Group (module, test) in first-seen order.
    let mut groups: Vec<(String, String, Vec<&db::HypothesisRow>)> = Vec::new();
    for h in &open {
        let Some(test) = h.discriminating_test.as_deref() else {
            continue;
        };
        let address = h.module_address.to_uppercase();
        match groups
            .iter_mut()
            .find(|(a, t, _)| *a == address && t == test)
        {
            Some((_, _, list)) => list.push(h),
            None => groups.push((address, test.to_string(), vec![h])),
        }
    }
    // Stationary tests first, then those that move the car: information
    // per minute, and the optional nodes last.
    groups.sort_by_key(|(_, test, _)| shape_of(test).moves_car);

    let mut inputs: Vec<GuidedStepNode> = Vec::new();
    for (address, test, members) in &groups {
        let shape = shape_of(test);
        let hypotheses: Vec<String> = members.iter().map(|h| did_hex(h.did)).collect();
        // Every open hypothesis on the module without a test of its own
        // rides along: any input may be the one that moves it.
        let mut dids = hypotheses.clone();
        for h in &open {
            if h.module_address.eq_ignore_ascii_case(address)
                && h.discriminating_test.is_none()
                && !dids.contains(&did_hex(h.did))
            {
                dids.push(did_hex(h.did));
            }
        }
        // A DID of another module named in the test is a reference read.
        let mut reference_dids: HashMap<String, Vec<String>> = HashMap::new();
        for h in &rows {
            if h.module_address.eq_ignore_ascii_case(address) {
                continue;
            }
            let hex = did_hex(h.did);
            if test.to_uppercase().contains(&hex) {
                reference_dids
                    .entry(h.module_address.to_uppercase())
                    .or_default()
                    .push(hex);
            }
        }
        let mut precondition = serde_json::Map::new();
        precondition.insert("parked".into(), (!shape.moves_car).into());
        precondition.insert("parking_brake".into(), (!shape.moves_car).into());
        if let Some(engine) = shape.engine {
            precondition.insert("engine".into(), engine.into());
        }
        if shape.moves_car {
            precondition.insert("space_clear".into(), true.into());
            precondition.insert("driver_seated".into(), true.into());
        }
        let mut applicable_if = serde_json::Map::new();
        let mut operator_confirmation = None;
        if shape.needs_clutch {
            applicable_if.insert("gearbox".into(), "manual".into());
            if !gearbox_known {
                operator_confirmation = Some("Does this car have a clutch pedal?".to_string());
            }
        } else if shape.needs_gear_selector {
            applicable_if.insert("gearbox".into(), "any".into());
            if !gearbox_known {
                operator_confirmation = Some(
                    "Can you select the gear the step asks for and keep the car stationary?"
                        .to_string(),
                );
            }
        }
        let signature = expected_signature(test);
        let expected = hypotheses
            .iter()
            .map(|d| (d.clone(), signature.to_string()))
            .collect();
        let slug = condition_slug(test);
        let index = inputs.len() + 1;
        inputs.push(GuidedStepNode {
            id: format!("input_{index}"),
            kind: "input",
            module: Some(address.clone()),
            hypotheses,
            precondition,
            instruction: test.clone(),
            condition_label: slug,
            capture: GuidedCapture {
                dids,
                reference_dids,
                repeats: GUIDED_REPEATS,
                hold_seconds: if shape.moves_car { 0 } else { 8 },
            },
            success: GuidedSuccess {
                expected,
                returns_after: !shape.moves_car,
            },
            applicable_if,
            optional: shape.moves_car,
            operator_confirmation,
            safety: GUIDED_SAFETY,
            estimated_seconds: if shape.moves_car { 60 } else { 25 },
            on_success: None,
            on_failure: None,
        });
    }

    // One independent experiment per input: `baseline_before_<i>`,
    // `input_<i>`, `baseline_after_<i>`, all three on the input's module and
    // DID set. Edges run within the triplet; triplets chain in order, so a
    // diff always compares an input with its own baselines and never with a
    // capture taken on another module or minutes earlier.
    let mut steps: Vec<GuidedStepNode> = Vec::new();
    let count = inputs.len();
    for (i, mut node) in inputs.into_iter().enumerate() {
        let n = i + 1;
        let before_id = format!("baseline_before_{n}");
        let after_id = format!("baseline_after_{n}");
        let next_triplet = (n < count).then(|| format!("baseline_before_{}", n + 1));
        let mut before = baseline_node(
            &before_id,
            node.module.as_deref(),
            node.capture.dids.clone(),
        );
        before.on_success = Some(node.id.clone());
        before.on_failure = Some(node.id.clone());
        node.on_success = Some(after_id.clone());
        node.on_failure = Some(after_id.clone());
        let mut after = baseline_node(&after_id, node.module.as_deref(), node.capture.dids.clone());
        after.on_success = next_triplet.clone();
        after.on_failure = next_triplet;
        steps.push(before);
        steps.push(node);
        steps.push(after);
    }

    Some(GuidedSteps {
        vehicle_id,
        plan_version: correlation_plan_version(vin),
        repeats: GUIDED_REPEATS,
        facts,
        steps,
    })
}
