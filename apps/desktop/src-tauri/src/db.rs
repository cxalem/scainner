//! SQLite storage. The database IS the product: every reading lands here so
//! any tool (including an AI session running sqlite3) can query the car's
//! full recorded history.
//!
//! Schema v2 (2026-08-21, docs/workflows/data-core/plan.md): a vehicle is a
//! real entity with its own id — VIN is a nullable attribute, not the key
//! (proven necessary by a real ~2000 Peugeot whose ECU never answers Mode
//! 09). Every recorded fact carries `vehicle_id` + `connection_id` FKs; a
//! fact recorded while the vehicle is unidentified carries NULL honestly and
//! can be claimed when the user names the car. Column shapes mirror the
//! target Postgres/Supabase schema (`org_id`/`owner_user_id` reserved,
//! always NULL locally) so multi-tenant doesn't need a second rethink.
//!
//! v1 -> v2 is a CLEAN SLATE, not a migration: the owner's explicit call
//! ("local data is disposable test data") — on first open with the old
//! schema present, the old tables are dropped and v2 is created fresh.

use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::Mutex;

pub struct Db(pub Mutex<Connection>);

const SCHEMA_VERSION: i64 = 13;

/// A workshop repair order / diagnostic investigation. Cases are deliberately
/// separate from connections: one job can span several adapter sessions,
/// scans, technicians, and a before/after verification cycle.
#[derive(Serialize, Clone)]
pub struct DiagnosticCase {
    pub id: i64,
    pub cloud_id: String,
    pub vehicle_id: i64,
    pub reference: String,
    pub status: String,
    pub complaint: String,
    pub odometer_km: Option<i64>,
    pub assigned_to: Option<String>,
    pub opened_at: String,
    pub updated_at: String,
    pub closed_at: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct DtcScan {
    pub id: i64,
    pub ts: String,
    pub mil_on: bool,
    pub stored: Vec<String>,
    pub pending: Vec<String>,
    pub permanent: Vec<String>,
    pub voltage: Option<f64>,
    pub freeze: Option<serde_json::Value>,
}

#[derive(Serialize)]
pub struct DiscoveredModuleRow {
    pub id: i64,
    pub address: String,
    pub name: Option<String>,
    pub discovered_at: String,
    pub last_seen_at: String,
    pub did_count: i64,
    pub labeled_count: i64,
    pub spare_part_number: Option<String>,
    pub hardware_version: Option<String>,
    pub software_version: Option<String>,
    pub system_name: Option<String>,
    pub fingerprint_match_key: Option<String>,
    pub fingerprint_fields_answered: i64,
    pub fingerprint_fields_total: i64,
    /// Identity confidence (`provisional|stable|conflicted`), NULL until
    /// `record_identity` has run for the module.
    pub identity_fit: Option<String>,
    pub identity_reads: i64,
    /// Full route tuple as JSON (protocol, bits, extension, session).
    pub route_json: Option<String>,
    /// Family join result (plan A4): family id and `strong|weak|name_only|none`.
    pub family_id: Option<String>,
    pub family_match: Option<String>,
    /// Route outcome (`reached` once the census writes it; NULL on rows
    /// created before Phase 2, which only ever held reached routes).
    pub route_state: Option<String>,
    /// Supplier code/name from the identity block, when it carried one.
    pub supplier: Option<String>,
}

/// One route outcome of the census (Phase 2): the candidate route and what
/// it did — `reached`, `refused`, `silent`, `transport_failed`.
#[derive(Serialize, Clone, Debug)]
pub struct RouteOutcomeRow {
    pub id: i64,
    pub vehicle_id: i64,
    pub connection_id: Option<i64>,
    pub address: String,
    pub route_state: String,
    pub route_json: Option<String>,
    pub detail: Option<String>,
    pub observed_at: String,
}

/// One tracked hypothesis: a DID on a module of one vehicle with the four
/// state dimensions (plan A3). `decode_json` holds the inherited decode when
/// a family match created the row; `shape_json`/`interpretations_json` are
/// the correlation engine's output once it has run.
#[derive(Serialize, Clone, Debug)]
pub struct HypothesisRow {
    pub id: i64,
    pub vehicle_id: i64,
    pub module_id: i64,
    pub module_address: String,
    pub did: u16,
    pub knowledge_state: String,
    pub vehicle_fit: String,
    pub route_state: Option<String>,
    pub activation: String,
    pub label: Option<String>,
    pub decode_json: Option<String>,
    pub shape_json: Option<String>,
    pub interpretations_json: Option<String>,
    pub confidence: Option<f64>,
    pub discriminating_test: Option<String>,
    pub next_step_id: Option<i64>,
    pub family_id: Option<String>,
    pub sample_count: i64,
    pub created_at: String,
    pub updated_at: String,
    /// What justified the current `knowledge_state`, when a promotion needed
    /// justifying (schema v12). Cleared when the state is retracted.
    pub evidence: Option<HypothesisEvidence>,
}

/// The evidence stored beside a hypothesis: the verification runs whose
/// discriminating result carried it to its knowledge state. Kept as JSON so
/// later evidence kinds (a second vehicle, a pack citation) can join it
/// without another column.
#[derive(Serialize, serde::Deserialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct HypothesisEvidence {
    pub run_ids: Vec<i64>,
}

/// What a join (or any other writer) asks to persist for one hypothesis.
#[derive(Clone, Debug, Default)]
pub struct HypothesisUpsert {
    pub vehicle_id: i64,
    pub module_id: i64,
    pub did: u16,
    pub knowledge_state: String,
    pub label: Option<String>,
    pub decode_json: Option<String>,
    pub discriminating_test: Option<String>,
    pub family_id: Option<String>,
}

/// Fields a state transition may touch. `None` leaves the column alone.
/// `evidence_run_ids` is what the caller offers in support of a
/// knowledge-state promotion; an empty list retracts the stored evidence.
#[derive(Clone, Debug, Default, serde::Deserialize)]
pub struct HypothesisPatch {
    pub knowledge_state: Option<String>,
    pub vehicle_fit: Option<String>,
    pub activation: Option<String>,
    pub label: Option<String>,
    pub evidence_run_ids: Option<Vec<i64>>,
}

/// Raw sample storage is written by the S5 hypothesis poll (a follow-up in
/// the supervisor, outside this track) and read by `discovery::learn`; the
/// tests exercise it, the binary does not yet.
#[allow(dead_code)]
#[derive(Serialize, Clone, Debug)]
pub struct HypothesisSampleRow {
    pub id: i64,
    pub hypothesis_id: i64,
    pub ts_ms: i64,
    pub payload_hex: String,
    pub refs_json: Option<String>,
}

/// Reusable, de-identified knowledge learned from vehicle observations.
/// Deliberately contains no vehicle, connection, VIN, serial, DTC, or raw
/// payload field, so private vehicle deletion cannot remove product knowledge.
#[derive(Serialize, Clone, Debug)]
pub struct KnowledgeCandidateRow {
    pub id: i64,
    pub compatibility_key: String,
    pub scope: String,
    pub family_id: Option<String>,
    pub module_address: String,
    pub supplier: Option<String>,
    pub spare_part_number: Option<String>,
    pub hardware_version: Option<String>,
    pub software_version: Option<String>,
    pub system_name: Option<String>,
    pub route_json: Option<String>,
    pub did: u16,
    pub payload_length: Option<i64>,
    pub knowledge_state: String,
    pub label: Option<String>,
    pub decode_json: Option<String>,
    pub shape_json: Option<String>,
    pub interpretations_json: Option<String>,
    pub confidence: Option<f64>,
    pub discriminating_test: Option<String>,
    pub first_observed_at: String,
    pub last_observed_at: String,
}

/// Samples kept per hypothesis; older ones are dropped on insert.
#[allow(dead_code)]
pub const HYPOTHESIS_SAMPLE_RETENTION: i64 = 5000;

#[derive(Serialize, Clone)]
pub struct VehicleMapIdentity {
    pub spare_part_number: Option<String>,
    pub hardware_version: Option<String>,
    pub software_version: Option<String>,
    pub system_name: Option<String>,
    pub fields_answered: u8,
    pub fields_total: u8,
}

#[derive(Serialize, Clone)]
pub struct VehicleMapDid {
    pub did: u16,
    pub raw_sample: Option<String>,
    pub byte_length: Option<i64>,
    pub label: Option<String>,
    pub confidence: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct VehicleMapModule {
    pub id: i64,
    pub address: String,
    pub display_name: Option<String>,
    pub name_source: Option<String>,
    pub presence: String,
    pub first_seen_at: String,
    pub last_seen_at: String,
    pub identity: VehicleMapIdentity,
    pub dids: Vec<VehicleMapDid>,
    /// Honest placeholder until the unified module-DTC slice persists these.
    pub module_fault_evidence: String,
}

#[derive(Serialize, Clone)]
pub struct VehicleMapStandardFaults {
    pub scanned_at: String,
    pub mil_on: bool,
    pub stored: Vec<String>,
    pub pending: Vec<String>,
    pub permanent: Vec<String>,
}

#[derive(Serialize, Clone)]
pub struct VehicleEvidenceMap {
    pub vehicle_id: i64,
    pub evidence_scope: String,
    pub modules: Vec<VehicleMapModule>,
    pub latest_standard_faults: Option<VehicleMapStandardFaults>,
}

#[derive(Serialize)]
pub struct DiscoveredDidRow {
    pub did: u16,
    pub raw_sample: Option<String>,
    pub byte_length: Option<i64>,
    pub label: Option<String>,
    pub confidence: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct FingerprintObservation {
    /// Cohort-local pseudonym. It is deliberately unrelated to VIN, cloud id,
    /// or the local database id.
    pub vehicle_ref: String,
    pub module_address: String,
    pub spare_part_number: Option<String>,
    pub hardware_version: Option<String>,
    pub software_version: Option<String>,
    pub system_name: Option<String>,
    pub fields_answered: u8,
}

#[derive(Serialize, Clone)]
pub struct FingerprintMatchGroup {
    pub family_key: String,
    pub part_number: String,
    pub vehicle_count: u32,
    pub module_count: u32,
    pub hardware_versions: Vec<String>,
    pub software_versions: Vec<String>,
    pub system_names: Vec<String>,
}

#[derive(Serialize, Clone)]
pub struct FingerprintExperimentReport {
    pub target_vehicles: u32,
    pub vehicles_scanned: u32,
    pub vehicles_with_fingerprints: u32,
    pub modules_observed: u32,
    pub modules_with_fingerprints: u32,
    pub modules_with_part_number: u32,
    pub repeated_family_groups: u32,
    pub vehicles_with_repeated_family: u32,
    pub cohort_target_reached: bool,
    pub match_groups: Vec<FingerprintMatchGroup>,
    pub observations: Vec<FingerprintObservation>,
}

fn normalized_part_number(value: &str) -> Option<String> {
    let normalized: String = value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_uppercase)
        .collect();
    (!matches!(normalized.as_str(), "" | "NA" | "NONE" | "UNKNOWN") && normalized.len() >= 4)
        .then_some(normalized)
}

#[derive(Serialize, serde::Deserialize, Clone)]
pub struct UdsProbe {
    #[serde(default)]
    pub id: i64,
    /// None only for legacy probes saved before per-vehicle scoping
    /// (2026-08-24) — those keep polling on every car, same as always.
    /// Every probe saved from now on (manual or auto-discovered) carries a
    /// real vehicle_id, so a probe found on one car is never attempted on
    /// another (the same cross-car isolation every other table already
    /// has since schema v2).
    #[serde(default)]
    pub vehicle_id: Option<i64>,
    pub module: String,
    pub did: u16,
    pub label: String,
    #[serde(default)]
    pub unit: String,
    #[serde(default)]
    pub offset: usize,
    #[serde(default = "one")]
    pub len: usize,
    #[serde(default = "onef")]
    pub scale: f64,
    #[serde(default)]
    pub bias: f64,
    #[serde(default = "yes")]
    pub enabled: bool,
    /// `manual` probes belong to the user and are never reconciled by
    /// discovery. `discovery` probes may be refreshed or removed when the
    /// shipped knowledge map changes.
    #[serde(default = "manual_origin")]
    pub origin: String,
    /// Set when the probe exists because a hypothesis was activated (schema
    /// v13). One sensor pipeline: the hypothesis is the decision to read
    /// this DID, the probe is how that decision reaches the bus — so a
    /// linked probe is polled whatever its origin says.
    #[serde(default)]
    pub hypothesis_id: Option<i64>,
}

impl UdsProbe {
    /// The `readings.key` this probe's samples are stored under. The poller
    /// (`elm::uds::poll_probes`) derives that key from the label, so anything
    /// mapping a stored key back to its probe has to spell it the same way —
    /// hence one function, used by both sides.
    pub fn reading_key(&self) -> String {
        format!("uds_{}", self.label.to_lowercase().replace(' ', "_"))
    }
}

/// One stored reading key with what the UI needs to name and group it: where
/// it came from (a standard OBD gauge or a UDS probe), which module answers
/// it, and when it was last written. `label`/`unit` are None for standard
/// keys — those are named by the frontend's gauge table.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ReadingKeyRow {
    pub key: String,
    pub label: Option<String>,
    pub unit: Option<String>,
    pub module_key: Option<String>,
    pub module_name: Option<String>,
    /// `standard` | `probe`
    pub source: String,
    pub probe_id: Option<i64>,
    pub last_ts: Option<String>,
}

fn manual_origin() -> String {
    "manual".into()
}
fn one() -> usize {
    1
}
fn onef() -> f64 {
    1.0
}
fn yes() -> bool {
    true
}

/// One row of the write audit trail: everything the app has ever changed on
/// the car, with the state read before and after. See `docs/workflows/
/// write-caps/plan.md` — no write ships without landing here.
#[derive(Serialize, Clone)]
pub struct WriteLogRow {
    pub id: i64,
    pub ts: String,
    pub module: String,
    pub action: String,
    pub params: serde_json::Value,
    pub before: Option<serde_json::Value>,
    pub after: Option<serde_json::Value>,
    /// "cleared" | "faults_remain" | "refused" | "error"
    pub outcome: String,
    pub error: Option<String>,
}

/// The vehicle entity — schema v2's core. `vin` nullable on purpose:
/// pre-Mode-09 ECUs are real; `display_name` is the human identity then.
#[derive(Serialize, Clone)]
pub struct Vehicle {
    pub id: i64,
    pub vin: Option<String>,
    pub display_name: Option<String>,
    pub make: Option<String>,
    pub model: Option<String>,
    pub year: Option<i64>,
    pub trim: Option<String>,
    pub fuel_price: f64,
    pub created_at: String,
    pub first_connected_at: Option<String>,
}

/// One row of the vehicle picker: identity + how many connections recorded.
#[derive(Serialize, Clone)]
pub struct VehicleListRow {
    pub id: i64,
    pub vin: Option<String>,
    pub display_name: Option<String>,
    pub connections: i64,
}

#[derive(Serialize)]
pub struct SessionSummary {
    pub id: i64,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub readings: i64,
    pub max_speed: Option<f64>,
    pub max_coolant: Option<f64>,
    pub min_voltage: Option<f64>,
    pub minutes: f64,
}

#[derive(Serialize)]
pub struct DailyVoltage {
    pub day: String,
    pub min: f64,
    pub avg: f64,
    pub max: f64,
}

#[derive(Serialize)]
pub struct Insights {
    pub window_hours: f64,
    pub engine_hours: f64,
    pub fuel_lph_avg: Option<f64>,
    pub speed_avg: Option<f64>,
    pub l_per_100km: Option<f64>,
    pub fuel_total_l: Option<f64>,
    pub km_total: Option<f64>,
    pub ltft_avg: Option<f64>,
    pub coolant_max: Option<f64>,
    pub coolant_reached_op: bool,
    pub boost_max_kpa: Option<f64>,
    pub baro_kpa: Option<f64>,
    pub voltage_min: Option<f64>,
    pub voltage_avg: Option<f64>,
    pub fuel_price: f64,
    /// Most recent tank-level reading (PID 012F), not a window average — the
    /// tank level is a point-in-time gauge, not a trend. `None` if the ECU
    /// has never reported it (many don't expose this PID over OBD2).
    pub fuel_level_pct: Option<f64>,
}

#[derive(Serialize)]
pub struct CarReport {
    pub vehicle_id: i64,
    pub vin: Option<String>,
    pub display_name: Option<String>,
    pub session_count: i64,
    pub engine_minutes: f64,
    pub total_readings: i64,
    pub first: Option<String>,
    pub last: Option<String>,
    pub scans_total: i64,
    pub scans_clean: i64,
    pub sessions: Vec<SessionSummary>,
    pub stats_7d: Vec<KeyStats>,
    pub stats_all: Vec<KeyStats>,
    pub daily_voltage: Vec<DailyVoltage>,
    pub insights: Insights,
}

#[derive(Serialize)]
pub struct KeyStats {
    pub key: String,
    pub n: i64,
    pub min: f64,
    pub avg: f64,
    pub max: f64,
}

#[derive(Serialize)]
pub struct HistoryPoint {
    pub ts: String,
    pub value: f64,
}

/// Index row of `verification_runs` (agent API): everything but the JSON
/// body, which is fetched per run.
#[derive(Serialize, Clone, Debug)]
pub struct VerificationRunRow {
    pub id: i64,
    pub vehicle_id: i64,
    pub connection_id: i64,
    pub plan_version: String,
    pub created_at: String,
    pub result_bytes: i64,
}

// ---------- cloud sync feed (docs/workflows/data-core/plan.md) ----------
// The frontend sync engine pulls one of these, pushes it to Supabase under
// the signed-in user's JWT, then advances the reading watermark. Only rows
// with a resolved vehicle are included: the cloud's RLS policies reject
// facts whose vehicle is NULL by design ("unassigned facts are invisible"),
// so unidentified connections sync after the user names the car (naming
// back-stamps vehicle_id, and the frontend resets the watermark).

#[derive(Serialize)]
pub struct SyncVehicle {
    pub cloud_id: String,
    pub vin: Option<String>,
    pub display_name: Option<String>,
    pub make: Option<String>,
    pub model: Option<String>,
    pub year: Option<i64>,
    pub trim: Option<String>,
    pub fuel_price: f64,
}

#[derive(Serialize)]
pub struct SyncConnection {
    pub cloud_id: String,
    pub vehicle_cloud_id: String,
    pub device_kind: Option<String>,
    pub elm_version: Option<String>,
    pub protocol: Option<String>,
    pub started_at: String,
    pub ended_at: Option<String>,
}

#[derive(Serialize)]
pub struct SyncCode {
    pub code: String,
    pub status: String,
}

#[derive(Serialize)]
pub struct SyncScanEvent {
    pub cloud_id: String,
    pub connection_cloud_id: Option<String>,
    pub vehicle_cloud_id: String,
    pub ts: String,
    pub mil_on: bool,
    pub voltage: Option<f64>,
    pub freeze_json: Option<String>,
    pub codes: Vec<SyncCode>,
}

#[derive(Serialize)]
pub struct SyncWrite {
    pub cloud_id: String,
    pub connection_cloud_id: Option<String>,
    pub vehicle_cloud_id: String,
    pub ts: String,
    pub module: String,
    pub action: String,
    pub params_json: String,
    pub before_json: Option<String>,
    pub after_json: Option<String>,
    pub outcome: String,
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct SyncReading {
    pub local_id: i64,
    pub connection_cloud_id: String,
    pub vehicle_cloud_id: String,
    pub ts: String,
    pub key: String,
    pub value: f64,
}

#[derive(Serialize)]
pub struct SyncProbe {
    pub cloud_id: String,
    pub vehicle_cloud_id: String,
    pub module: String,
    pub did: u16,
    pub label: String,
    pub unit: String,
    pub offset: usize,
    pub len: usize,
    pub scale: f64,
    pub bias: f64,
    pub enabled: bool,
    pub origin: String,
}

#[derive(Serialize)]
pub struct SyncDiscoveredDid {
    pub did: u16,
    pub raw_sample: Option<String>,
    pub byte_length: Option<i64>,
    pub label: Option<String>,
    pub confidence: Option<String>,
    pub first_seen_at: String,
}

#[derive(Serialize)]
pub struct SyncDiscoveredModule {
    pub cloud_id: String,
    pub vehicle_cloud_id: String,
    pub module_address: String,
    pub module_name: Option<String>,
    pub discovered_at: String,
    pub last_seen_at: String,
    pub spare_part_number: Option<String>,
    pub hardware_version: Option<String>,
    pub software_version: Option<String>,
    pub system_name: Option<String>,
    pub fingerprint_match_key: Option<String>,
    pub fingerprint_evidence: Option<serde_json::Value>,
    pub dids: Vec<SyncDiscoveredDid>,
}

#[derive(Serialize)]
pub struct SyncDiagnosticCase {
    pub cloud_id: String,
    pub vehicle_cloud_id: String,
    pub reference: String,
    pub status: String,
    pub complaint: String,
    pub odometer_km: Option<i64>,
    pub assigned_to: Option<String>,
    pub opened_at: String,
    pub updated_at: String,
    pub closed_at: Option<String>,
}

#[derive(Serialize)]
pub struct SyncBatch {
    pub vehicles: Vec<SyncVehicle>,
    pub connections: Vec<SyncConnection>,
    pub scan_events: Vec<SyncScanEvent>,
    pub writes: Vec<SyncWrite>,
    pub readings: Vec<SyncReading>,
    pub probes: Vec<SyncProbe>,
    pub discovered_modules: Vec<SyncDiscoveredModule>,
    pub diagnostic_cases: Vec<SyncDiagnosticCase>,
    /// Highest readings.id included — the next watermark on success.
    pub last_reading_id: i64,
}

impl Db {
    /// Opens (creating if needed) the SQLite database at schema v2.
    ///
    /// Versioning via `PRAGMA user_version`: 0 means either a brand-new
    /// file or the old un-versioned v1 schema — in both cases any v1
    /// tables are dropped (clean-slate policy, see module docs) and v2 is
    /// created fresh. Future schema changes bump SCHEMA_VERSION and add a
    /// stepwise upgrade here (v2 data will NOT be disposable).
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version < 2 {
            // v1 (or partial) — drop everything the old shape ever created.
            // Clean-slate applies to the pre-v2 shape ONLY (the owner's
            // "disposable test data" call was about v1); v2+ data survives
            // every later version bump via additive migrations below.
            conn.execute_batch(
                r#"
                DROP TABLE IF EXISTS readings;
                DROP TABLE IF EXISTS sessions;
                DROP TABLE IF EXISTS dtc_scans;
                DROP TABLE IF EXISTS car_info;
                DROP TABLE IF EXISTS uds_probes;
                DROP TABLE IF EXISTS uds_modules;
                DROP TABLE IF EXISTS writes_log;
                "#,
            )?;
        }
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS vehicles (
                id INTEGER PRIMARY KEY,
                vin TEXT UNIQUE,
                display_name TEXT,
                make TEXT,
                model TEXT,
                year INTEGER,
                trim TEXT,
                fuel_price REAL NOT NULL DEFAULT 1.50,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                first_connected_at TEXT,
                org_id TEXT,           -- reserved: Supabase org uuid, never set locally
                owner_user_id TEXT     -- reserved: Supabase auth.users uuid, never set locally
            );
            CREATE TABLE IF NOT EXISTS connections (
                id INTEGER PRIMARY KEY,
                vehicle_id INTEGER REFERENCES vehicles(id),
                device_kind TEXT,
                elm_version TEXT,
                protocol TEXT,
                started_at TEXT NOT NULL DEFAULT (datetime('now')),
                ended_at TEXT
            );
            CREATE TABLE IF NOT EXISTS readings (
                id INTEGER PRIMARY KEY,
                connection_id INTEGER NOT NULL REFERENCES connections(id),
                vehicle_id INTEGER REFERENCES vehicles(id),
                ts TEXT NOT NULL DEFAULT (datetime('now')),
                key TEXT NOT NULL,
                value REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_readings_vehicle_key_ts ON readings(vehicle_id, key, ts);
            CREATE INDEX IF NOT EXISTS idx_readings_connection ON readings(connection_id);
            CREATE TABLE IF NOT EXISTS dtc_scan_events (
                id INTEGER PRIMARY KEY,
                connection_id INTEGER REFERENCES connections(id),
                vehicle_id INTEGER REFERENCES vehicles(id),
                ts TEXT NOT NULL DEFAULT (datetime('now')),
                mil_on INTEGER NOT NULL,
                voltage REAL,
                freeze_json TEXT
            );
            CREATE TABLE IF NOT EXISTS dtc_codes (
                id INTEGER PRIMARY KEY,
                scan_event_id INTEGER NOT NULL REFERENCES dtc_scan_events(id),
                vehicle_id INTEGER REFERENCES vehicles(id),
                code TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('stored','pending','permanent'))
            );
            CREATE INDEX IF NOT EXISTS idx_dtc_codes_event ON dtc_codes(scan_event_id);
            CREATE TABLE IF NOT EXISTS writes_log (
                id INTEGER PRIMARY KEY,
                connection_id INTEGER REFERENCES connections(id),
                vehicle_id INTEGER REFERENCES vehicles(id),
                ts TEXT NOT NULL DEFAULT (datetime('now')),
                module TEXT NOT NULL,
                action TEXT NOT NULL,
                params_json TEXT NOT NULL DEFAULT '{}',
                before_json TEXT,
                after_json TEXT,
                outcome TEXT NOT NULL,
                error TEXT
            );
            CREATE TABLE IF NOT EXISTS uds_modules (
                id INTEGER PRIMARY KEY,
                key TEXT NOT NULL UNIQUE,
                label TEXT NOT NULL,
                req TEXT NOT NULL,
                resp TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS uds_probes (
                id INTEGER PRIMARY KEY,
                vehicle_id INTEGER REFERENCES vehicles(id),
                module TEXT NOT NULL,
                did INTEGER NOT NULL,
                label TEXT NOT NULL,
                unit TEXT NOT NULL DEFAULT '',
                offset INTEGER NOT NULL DEFAULT 0,
                len INTEGER NOT NULL DEFAULT 1,
                scale REAL NOT NULL DEFAULT 1.0,
                bias REAL NOT NULL DEFAULT 0.0,
                enabled INTEGER NOT NULL DEFAULT 1,
                origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual','discovery')),
                hypothesis_id INTEGER REFERENCES hypotheses(id)
            );
            -- Auto-discovery shape (product-plan.md): no writer yet, the
            -- discovery-engine stream is later — tables exist so the shape
            -- is locked and other streams can build against it.
            CREATE TABLE IF NOT EXISTS discovered_modules (
                id INTEGER PRIMARY KEY,
                vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
                module_address TEXT NOT NULL,
                module_name TEXT,
                discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
                last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
                spare_part_number TEXT,
                hardware_version TEXT,
                software_version TEXT,
                system_name TEXT,
                fingerprint_match_key TEXT,
                fingerprint_evidence_json TEXT
            );
            CREATE TABLE IF NOT EXISTS discovered_dids (
                id INTEGER PRIMARY KEY,
                module_id INTEGER NOT NULL REFERENCES discovered_modules(id),
                did INTEGER NOT NULL,
                raw_sample TEXT,
                byte_length INTEGER,
                label TEXT,
                confidence TEXT CHECK (confidence IN ('confirmed','ai_guess','unlabeled')),
                first_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            -- Parts catalog (owner-requested 2026-08-21): cross-brand part
            -- sharing (Stellantis: one part, fitment rows for both a Peugeot
            -- and a Citroën) is just multiple fitment rows on one part. No
            -- UI yet — shape locked now, first consumer is a later stream.
            CREATE TABLE IF NOT EXISTS parts (
                id INTEGER PRIMARY KEY,
                oem_ref TEXT,
                name TEXT NOT NULL,
                category TEXT,
                notes TEXT
            );
            CREATE TABLE IF NOT EXISTS part_fitments (
                id INTEGER PRIMARY KEY,
                part_id INTEGER NOT NULL REFERENCES parts(id),
                make TEXT NOT NULL,
                model TEXT,
                year_from INTEGER,
                year_to INTEGER,
                engine_code TEXT
            );
            CREATE TABLE IF NOT EXISTS vehicle_parts (
                id INTEGER PRIMARY KEY,
                vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
                part_id INTEGER NOT NULL REFERENCES parts(id),
                installed_at TEXT,
                notes TEXT
            );
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS diagnostic_cases (
                id INTEGER PRIMARY KEY,
                cloud_id TEXT NOT NULL UNIQUE,
                vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
                reference TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','in_progress','waiting','completed','cancelled')),
                complaint TEXT NOT NULL,
                odometer_km INTEGER CHECK (odometer_km IS NULL OR odometer_km >= 0),
                assigned_to TEXT,
                opened_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                closed_at TEXT,
                UNIQUE(vehicle_id, reference)
            );
            CREATE INDEX IF NOT EXISTS idx_diagnostic_cases_status_updated
                ON diagnostic_cases(status, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_diagnostic_cases_vehicle_updated
                ON diagnostic_cases(vehicle_id, updated_at DESC);
            -- Read-only, reproducible in-car research runs. The full result
            -- stays intact as JSON so new decoders can replay old evidence;
            -- vehicle/connection columns prevent cross-car attribution.
            CREATE TABLE IF NOT EXISTS verification_runs (
                id INTEGER PRIMARY KEY,
                vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
                connection_id INTEGER NOT NULL REFERENCES connections(id),
                plan_version TEXT NOT NULL,
                result_json TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_verification_runs_vehicle_created
                ON verification_runs(vehicle_id, created_at DESC);
            "#,
        )?;
        // v3 (cloud sync): client-generated uuids on every syncable row —
        // these become the Postgres primary keys, so pushes are idempotent.
        // ALTER + separate unique index because SQLite can't add a UNIQUE
        // column via ALTER; errors discarded once the column exists.
        let _ = conn.execute("ALTER TABLE vehicles ADD COLUMN cloud_id TEXT", []);
        let _ = conn.execute("ALTER TABLE connections ADD COLUMN cloud_id TEXT", []);
        let _ = conn.execute("ALTER TABLE dtc_scan_events ADD COLUMN cloud_id TEXT", []);
        let _ = conn.execute("ALTER TABLE writes_log ADD COLUMN cloud_id TEXT", []);
        let _ = conn.execute("ALTER TABLE uds_probes ADD COLUMN cloud_id TEXT", []);
        let _ = conn.execute(
            "ALTER TABLE discovered_modules ADD COLUMN cloud_id TEXT",
            [],
        );
        // v7: partial ISO 14229 ECU fingerprints. Each ALTER is idempotent
        // for existing databases; fresh databases already have the columns.
        for column in [
            "spare_part_number TEXT",
            "hardware_version TEXT",
            "software_version TEXT",
            "system_name TEXT",
            "fingerprint_match_key TEXT",
            "fingerprint_evidence_json TEXT",
        ] {
            let _ = conn.execute(
                &format!("ALTER TABLE discovered_modules ADD COLUMN {column}"),
                [],
            );
        }
        // v8: distinguish first discovery from the most recent positive
        // observation used by the evidence-only vehicle map.
        let _ = conn.execute(
            "ALTER TABLE discovered_modules ADD COLUMN last_seen_at TEXT",
            [],
        );
        let _ = conn.execute(
            "UPDATE discovered_modules SET last_seen_at = discovered_at WHERE last_seen_at IS NULL",
            [],
        );
        // v10: Universal Discovery Protocol knowledge layer (plan A3).
        // Identity confidence, the full route tuple and the family join on
        // each module; hypotheses with the four state dimensions; raw
        // samples for the correlation engine. Idempotent like v7.
        for column in [
            "identity_fit TEXT",
            "identity_reads INTEGER NOT NULL DEFAULT 0",
            "identity_hash TEXT",
            "identity_connection_id INTEGER",
            "route_json TEXT",
            "family_id TEXT",
            "family_match TEXT",
            // Phase 2 (multi-brand plan): the route outcome of the module
            // (`reached` for every row the census answered) and the
            // supplier code/name the identity block carried.
            "route_state TEXT",
            "supplier TEXT",
        ] {
            let _ = conn.execute(
                &format!("ALTER TABLE discovered_modules ADD COLUMN {column}"),
                [],
            );
        }
        conn.execute_batch(
            r#"
            -- Phase 2: every census outcome per route, including the ones
            -- that never answered (refused / silent / transport_failed), so
            -- the coverage report accounts for candidates, not only hits.
            CREATE TABLE IF NOT EXISTS route_outcomes (
                id INTEGER PRIMARY KEY,
                vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
                connection_id INTEGER,
                module_address TEXT NOT NULL,
                route_state TEXT NOT NULL,
                route_json TEXT,
                detail TEXT,
                observed_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_route_outcomes_vehicle_address
                ON route_outcomes(vehicle_id, module_address);
            CREATE TABLE IF NOT EXISTS hypotheses (
                id INTEGER PRIMARY KEY,
                vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
                module_id INTEGER NOT NULL REFERENCES discovered_modules(id),
                did INTEGER NOT NULL,
                knowledge_state TEXT NOT NULL,
                vehicle_fit TEXT NOT NULL DEFAULT 'untested',
                route_state TEXT,
                activation TEXT NOT NULL DEFAULT 'disabled',
                label TEXT,
                decode_json TEXT,
                shape_json TEXT,
                interpretations_json TEXT,
                confidence REAL,
                discriminating_test TEXT,
                next_step_id INTEGER,
                family_id TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                cloud_id TEXT
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_hypotheses_vehicle_module_did
                ON hypotheses(vehicle_id, module_id, did);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_hypotheses_cloud ON hypotheses(cloud_id);
            CREATE TABLE IF NOT EXISTS hypothesis_samples (
                id INTEGER PRIMARY KEY,
                hypothesis_id INTEGER NOT NULL REFERENCES hypotheses(id),
                ts_ms INTEGER NOT NULL,
                payload_hex TEXT NOT NULL,
                refs_json TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_hypothesis_samples_hypothesis_ts
                ON hypothesis_samples(hypothesis_id, ts_ms);
            -- v11: reusable knowledge is projected here immediately. This
            -- table intentionally has no FK to private vehicle history.
            CREATE TABLE IF NOT EXISTS knowledge_candidates (
                id INTEGER PRIMARY KEY,
                compatibility_key TEXT NOT NULL,
                scope TEXT NOT NULL CHECK (scope IN ('ecu_family','exact_ecu','observation')),
                family_id TEXT,
                module_address TEXT NOT NULL,
                supplier TEXT,
                spare_part_number TEXT,
                hardware_version TEXT,
                software_version TEXT,
                system_name TEXT,
                route_json TEXT,
                did INTEGER NOT NULL,
                payload_length INTEGER,
                knowledge_state TEXT NOT NULL DEFAULT 'unknown',
                label TEXT,
                decode_json TEXT,
                shape_json TEXT,
                interpretations_json TEXT,
                confidence REAL,
                discriminating_test TEXT,
                first_observed_at TEXT NOT NULL DEFAULT (datetime('now')),
                last_observed_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(compatibility_key, did)
            );
            CREATE INDEX IF NOT EXISTS idx_knowledge_candidates_family_did
                ON knowledge_candidates(family_id, did);
            "#,
        )?;
        // v4: provenance makes discovery-owned probes safely
        // reconcilable. Existing rows are conservatively manual because
        // older schemas cannot prove how they were created.
        let _ = conn.execute(
            "ALTER TABLE uds_probes ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual','discovery'))",
            [],
        );
        conn.execute_batch(
            r#"
            CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_cloud ON vehicles(cloud_id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_connections_cloud ON connections(cloud_id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_events_cloud ON dtc_scan_events(cloud_id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_writes_cloud ON writes_log(cloud_id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_uds_probes_cloud ON uds_probes(cloud_id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_discovered_modules_cloud ON discovered_modules(cloud_id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_discovered_modules_vehicle_address
                ON discovered_modules(vehicle_id, module_address);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_discovered_dids_module_did
                ON discovered_dids(module_id, did);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_dtc_codes_unique_event_status
                ON dtc_codes(scan_event_id, code, status);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_uds_probes_vehicle_module_did_origin
                ON uds_probes(vehicle_id, module, did, origin);
            "#,
        )?;
        // Backfill rows created on v2 before cloud_id existed.
        for table in [
            "vehicles",
            "connections",
            "dtc_scan_events",
            "writes_log",
            "uds_probes",
            "discovered_modules",
        ] {
            let ids: Vec<i64> = {
                let mut stmt =
                    conn.prepare(&format!("SELECT id FROM {table} WHERE cloud_id IS NULL"))?;
                let rows = stmt.query_map([], |r| r.get(0))?;
                rows.filter_map(Result::ok).collect()
            };
            for id in ids {
                conn.execute(
                    &format!("UPDATE {table} SET cloud_id = ?1 WHERE id = ?2"),
                    params![uuid::Uuid::new_v4().to_string(), id],
                )?;
            }
        }
        // v12: the evidence behind a knowledge-state promotion. The
        // verification runs that discriminated the decode are kept on the
        // hypothesis, so the gate in `patch_hypothesis` can be audited
        // afterwards instead of taken on trust. Idempotent like v7/v10.
        let _ = conn.execute("ALTER TABLE hypotheses ADD COLUMN evidence_json TEXT", []);
        // The projected table's pre-v12 default sat outside the protocol
        // vocabulary (`KnowledgeState::parse` does not accept 'observed');
        // `unknown` is the state it always meant.
        let _ = conn.execute(
            "UPDATE knowledge_candidates SET knowledge_state = 'unknown'
             WHERE knowledge_state = 'observed'",
            [],
        );
        // v13: a probe may be owned by a hypothesis. Activating a
        // hypothesis is the user's decision to read that DID, and this
        // column is how that decision reaches the poller instead of dying
        // in a second, never-polled table. NULL on every existing row:
        // probes created before v13 keep their old `origin` semantics.
        let _ = conn.execute(
            "ALTER TABLE uds_probes ADD COLUMN hypothesis_id INTEGER REFERENCES hypotheses(id)",
            [],
        );
        conn.execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION};"))?;
        Ok(Self(Mutex::new(conn)))
    }

    fn new_cloud_id() -> String {
        uuid::Uuid::new_v4().to_string()
    }

    pub fn insert_verification_run(
        &self,
        vehicle_id: i64,
        connection_id: i64,
        plan_version: &str,
        result_json: &str,
    ) -> rusqlite::Result<i64> {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "INSERT INTO verification_runs (vehicle_id, connection_id, plan_version, result_json) VALUES (?1, ?2, ?3, ?4)",
            params![vehicle_id, connection_id, plan_version, result_json],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// Re-store a run's JSON once its row id is known, so an exported report
    /// names the evidence run it came from without consulting the table.
    pub fn update_verification_run_json(&self, id: i64, result_json: &str) -> rusqlite::Result<()> {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "UPDATE verification_runs SET result_json = ?1 WHERE id = ?2",
            params![result_json, id],
        )?;
        Ok(())
    }

    /// Run index for the agent API (`GET /verification/runs`): metadata only,
    /// newest first — the JSON body can be megabytes, so it is fetched per
    /// run through `verification_run`. `vehicle_id`/`plan_version` filter;
    /// `None` means no filter (an agent listing every car's evidence).
    pub fn list_verification_runs(
        &self,
        vehicle_id: Option<i64>,
        plan_version: Option<&str>,
        limit: i64,
    ) -> Vec<VerificationRunRow> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, vehicle_id, connection_id, plan_version, created_at, length(result_json)
                 FROM verification_runs
                 WHERE (?1 IS NULL OR vehicle_id = ?1) AND (?2 IS NULL OR plan_version = ?2)
                 ORDER BY id DESC LIMIT ?3",
            )
            .unwrap();
        stmt.query_map(params![vehicle_id, plan_version, limit.max(1)], |r| {
            Ok(VerificationRunRow {
                id: r.get(0)?,
                vehicle_id: r.get(1)?,
                connection_id: r.get(2)?,
                plan_version: r.get(3)?,
                created_at: r.get(4)?,
                result_bytes: r.get(5)?,
            })
        })
        .unwrap()
        .filter_map(Result::ok)
        .collect()
    }

    /// One run with its complete stored JSON (a `ParkedVerificationReport`
    /// or a `CorrelationCapture`, distinguishable by their fields).
    pub fn verification_run(&self, id: i64) -> Option<(VerificationRunRow, String)> {
        let conn = self.0.lock().unwrap();
        conn.query_row(
            "SELECT id, vehicle_id, connection_id, plan_version, created_at, length(result_json), result_json
             FROM verification_runs WHERE id = ?1",
            params![id],
            |r| {
                Ok((
                    VerificationRunRow {
                        id: r.get(0)?,
                        vehicle_id: r.get(1)?,
                        connection_id: r.get(2)?,
                        plan_version: r.get(3)?,
                        created_at: r.get(4)?,
                        result_bytes: r.get(5)?,
                    },
                    r.get(6)?,
                ))
            },
        )
        .ok()
    }

    // ---------- vehicles ----------

    /// Get-or-create the vehicle for a successfully-read VIN, stamping
    /// `first_connected_at` on creation. Returns (vehicle_id, created).
    pub fn ensure_vehicle(&self, vin: &str) -> (i64, bool) {
        let conn = self.0.lock().unwrap();
        if let Ok(id) = conn.query_row(
            "SELECT id FROM vehicles WHERE vin = ?1",
            params![vin],
            |r| r.get(0),
        ) {
            return (id, false);
        }
        conn.execute(
            "INSERT INTO vehicles (vin, first_connected_at, cloud_id) VALUES (?1, datetime('now'), ?2)",
            params![vin, Self::new_cloud_id()],
        )
        .ok();
        (conn.last_insert_rowid(), true)
    }

    /// A VIN-less vehicle, identified only by the user's chosen name — the
    /// "name this car" path for ECUs that never answer Mode 09.
    pub fn create_vehicle_named(&self, name: &str) -> i64 {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "INSERT INTO vehicles (display_name, first_connected_at, cloud_id) VALUES (?1, datetime('now'), ?2)",
            params![name, Self::new_cloud_id()],
        )
        .ok();
        conn.last_insert_rowid()
    }

    pub fn set_vehicle_name(&self, vehicle_id: i64, name: &str) {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "UPDATE vehicles SET display_name = ?2 WHERE id = ?1",
            params![vehicle_id, name],
        )
        .ok();
    }

    pub fn set_fuel_price(&self, vehicle_id: i64, price: f64) {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "UPDATE vehicles SET fuel_price = ?2 WHERE id = ?1",
            params![vehicle_id, price],
        )
        .ok();
    }

    pub fn vehicle(&self, vehicle_id: i64) -> Option<Vehicle> {
        let conn = self.0.lock().unwrap();
        conn.query_row(
            "SELECT id, vin, display_name, make, model, year, trim, fuel_price, created_at, first_connected_at
             FROM vehicles WHERE id = ?1",
            params![vehicle_id],
            |r| {
                Ok(Vehicle {
                    id: r.get(0)?,
                    vin: r.get(1)?,
                    display_name: r.get(2)?,
                    make: r.get(3)?,
                    model: r.get(4)?,
                    year: r.get(5)?,
                    trim: r.get(6)?,
                    fuel_price: r.get(7)?,
                    created_at: r.get(8)?,
                    first_connected_at: r.get(9)?,
                })
            },
        )
        .ok()
    }

    pub fn list_vehicles(&self) -> Vec<VehicleListRow> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT v.id, v.vin, v.display_name, COUNT(c.id)
                 FROM vehicles v LEFT JOIN connections c ON c.vehicle_id = v.id
                 GROUP BY v.id ORDER BY COUNT(c.id) DESC, v.id",
            )
            .unwrap();
        stmt.query_map([], |r| {
            Ok(VehicleListRow {
                id: r.get(0)?,
                vin: r.get(1)?,
                display_name: r.get(2)?,
                connections: r.get(3)?,
            })
        })
        .unwrap()
        .filter_map(Result::ok)
        .collect()
    }

    /// Permanently remove owner/vehicle history while retaining the separate
    /// de-identified `knowledge_candidates` product knowledge.
    pub fn delete_vehicle_private_data(&self, vehicle_id: i64) -> bool {
        let mut conn = self.0.lock().unwrap();
        let Ok(tx) = conn.transaction() else {
            return false;
        };
        let exists = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM vehicles WHERE id = ?1)",
                params![vehicle_id],
                |row| row.get::<_, bool>(0),
            )
            .unwrap_or(false);
        if !exists {
            return false;
        }
        let statements = [
            "DELETE FROM hypothesis_samples WHERE hypothesis_id IN (SELECT id FROM hypotheses WHERE vehicle_id = ?1)",
            "DELETE FROM hypotheses WHERE vehicle_id = ?1",
            "DELETE FROM discovered_dids WHERE module_id IN (SELECT id FROM discovered_modules WHERE vehicle_id = ?1)",
            "DELETE FROM discovered_modules WHERE vehicle_id = ?1",
            "DELETE FROM route_outcomes WHERE vehicle_id = ?1",
            "DELETE FROM verification_runs WHERE vehicle_id = ?1",
            "DELETE FROM vehicle_parts WHERE vehicle_id = ?1",
            "DELETE FROM diagnostic_cases WHERE vehicle_id = ?1",
            "DELETE FROM dtc_codes WHERE vehicle_id = ?1",
            "DELETE FROM dtc_scan_events WHERE vehicle_id = ?1",
            "DELETE FROM writes_log WHERE vehicle_id = ?1",
            "DELETE FROM uds_probes WHERE vehicle_id = ?1",
            "DELETE FROM readings WHERE vehicle_id = ?1",
            "DELETE FROM connections WHERE vehicle_id = ?1",
            "DELETE FROM vehicles WHERE id = ?1",
        ];
        for sql in statements {
            if tx.execute(sql, params![vehicle_id]).is_err() {
                return false;
            }
        }
        tx.commit().is_ok()
    }

    // ---------- workshop diagnostic cases ----------

    pub fn create_diagnostic_case(
        &self,
        vehicle_id: i64,
        complaint: &str,
        odometer_km: Option<i64>,
        assigned_to: Option<&str>,
    ) -> rusqlite::Result<DiagnosticCase> {
        let complaint = complaint.trim();
        if complaint.is_empty() {
            return Err(rusqlite::Error::InvalidParameterName(
                "complaint must not be empty".into(),
            ));
        }
        if odometer_km.is_some_and(|value| value < 0) {
            return Err(rusqlite::Error::InvalidParameterName(
                "odometer_km must be positive".into(),
            ));
        }

        let conn = self.0.lock().unwrap();
        // Human-readable inside one vehicle; the UUID remains the durable
        // cloud identity. Numbering is allocated transactionally by SQLite.
        let sequence: i64 = conn.query_row(
            "SELECT COUNT(*) + 1 FROM diagnostic_cases WHERE vehicle_id = ?1",
            params![vehicle_id],
            |r| r.get(0),
        )?;
        let reference = format!("JOB-{sequence:04}");
        let cloud_id = Self::new_cloud_id();
        conn.execute(
            "INSERT INTO diagnostic_cases
                (cloud_id, vehicle_id, reference, complaint, odometer_km, assigned_to)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                cloud_id,
                vehicle_id,
                reference,
                complaint,
                odometer_km,
                assigned_to.map(str::trim).filter(|s| !s.is_empty())
            ],
        )?;
        Self::diagnostic_case_from_conn(&conn, conn.last_insert_rowid())
    }

    pub fn diagnostic_cases(&self, vehicle_id: Option<i64>) -> Vec<DiagnosticCase> {
        let conn = self.0.lock().unwrap();
        let sql = if vehicle_id.is_some() {
            "SELECT id, cloud_id, vehicle_id, reference, status, complaint, odometer_km,
                    assigned_to, opened_at, updated_at, closed_at
             FROM diagnostic_cases WHERE vehicle_id = ?1 ORDER BY updated_at DESC, id DESC"
        } else {
            "SELECT id, cloud_id, vehicle_id, reference, status, complaint, odometer_km,
                    assigned_to, opened_at, updated_at, closed_at
             FROM diagnostic_cases ORDER BY updated_at DESC, id DESC"
        };
        let mut stmt = conn.prepare(sql).unwrap();
        let map = |r: &rusqlite::Row<'_>| {
            Ok(DiagnosticCase {
                id: r.get(0)?,
                cloud_id: r.get(1)?,
                vehicle_id: r.get(2)?,
                reference: r.get(3)?,
                status: r.get(4)?,
                complaint: r.get(5)?,
                odometer_km: r.get(6)?,
                assigned_to: r.get(7)?,
                opened_at: r.get(8)?,
                updated_at: r.get(9)?,
                closed_at: r.get(10)?,
            })
        };
        if let Some(id) = vehicle_id {
            stmt.query_map(params![id], map)
                .unwrap()
                .filter_map(Result::ok)
                .collect()
        } else {
            stmt.query_map([], map)
                .unwrap()
                .filter_map(Result::ok)
                .collect()
        }
    }

    fn diagnostic_case_from_conn(conn: &Connection, id: i64) -> rusqlite::Result<DiagnosticCase> {
        conn.query_row(
            "SELECT id, cloud_id, vehicle_id, reference, status, complaint, odometer_km,
                    assigned_to, opened_at, updated_at, closed_at
             FROM diagnostic_cases WHERE id = ?1",
            params![id],
            |r| {
                Ok(DiagnosticCase {
                    id: r.get(0)?,
                    cloud_id: r.get(1)?,
                    vehicle_id: r.get(2)?,
                    reference: r.get(3)?,
                    status: r.get(4)?,
                    complaint: r.get(5)?,
                    odometer_km: r.get(6)?,
                    assigned_to: r.get(7)?,
                    opened_at: r.get(8)?,
                    updated_at: r.get(9)?,
                    closed_at: r.get(10)?,
                })
            },
        )
    }

    // ---------- connections ----------

    pub fn start_connection(&self, elm_version: &str, device_kind: &str) -> i64 {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "INSERT INTO connections (elm_version, device_kind, cloud_id) VALUES (?1, ?2, ?3)",
            params![elm_version, device_kind, Self::new_cloud_id()],
        )
        .ok();
        conn.last_insert_rowid()
    }

    pub fn end_connection(&self, id: i64) {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "UPDATE connections SET ended_at = datetime('now') WHERE id = ?1",
            params![id],
        )
        .ok();
    }

    pub fn set_connection_protocol(&self, id: i64, protocol: &str) {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "UPDATE connections SET protocol = ?2 WHERE id = ?1",
            params![id, protocol],
        )
        .ok();
    }

    /// Link a connection to its vehicle, back-stamping everything the
    /// connection already recorded while unidentified — this is what makes
    /// the "name this car" flow claim the live data recorded before naming.
    pub fn link_connection_vehicle(&self, connection_id: i64, vehicle_id: i64) {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "UPDATE connections SET vehicle_id = ?2 WHERE id = ?1",
            params![connection_id, vehicle_id],
        )
        .ok();
        conn.execute(
            "UPDATE readings SET vehicle_id = ?2 WHERE connection_id = ?1",
            params![connection_id, vehicle_id],
        )
        .ok();
        conn.execute(
            "UPDATE dtc_scan_events SET vehicle_id = ?2 WHERE connection_id = ?1",
            params![connection_id, vehicle_id],
        )
        .ok();
        conn.execute(
            "UPDATE dtc_codes SET vehicle_id = ?2
             WHERE scan_event_id IN (SELECT id FROM dtc_scan_events WHERE connection_id = ?1)",
            params![connection_id, vehicle_id],
        )
        .ok();
        conn.execute(
            "UPDATE writes_log SET vehicle_id = ?2 WHERE connection_id = ?1",
            params![connection_id, vehicle_id],
        )
        .ok();
    }

    // ---------- recorded facts ----------

    pub fn insert_reading(
        &self,
        connection_id: i64,
        vehicle_id: Option<i64>,
        key: &str,
        value: f64,
    ) {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "INSERT INTO readings (connection_id, vehicle_id, key, value) VALUES (?1, ?2, ?3, ?4)",
            params![connection_id, vehicle_id, key, value],
        )
        .ok();
    }

    pub fn insert_dtc_scan(
        &self,
        connection_id: Option<i64>,
        vehicle_id: Option<i64>,
        mil_on: bool,
        stored: &[String],
        pending: &[String],
        permanent: &[String],
        voltage: Option<f64>,
        freeze: Option<&serde_json::Value>,
    ) -> i64 {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "INSERT INTO dtc_scan_events (connection_id, vehicle_id, mil_on, voltage, freeze_json, cloud_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![connection_id, vehicle_id, mil_on, voltage, freeze.map(|f| f.to_string()), Self::new_cloud_id()],
        )
        .ok();
        let event_id = conn.last_insert_rowid();
        let insert = |codes: &[String], status: &str| {
            for code in codes {
                conn.execute(
                    "INSERT INTO dtc_codes (scan_event_id, vehicle_id, code, status) VALUES (?1, ?2, ?3, ?4)",
                    params![event_id, vehicle_id, code, status],
                )
                .ok();
            }
        };
        insert(stored, "stored");
        insert(pending, "pending");
        insert(permanent, "permanent");
        event_id
    }

    /// Append one row to the write audit trail. Called from every write
    /// handler, on success AND on failure — the trail is only trustworthy
    /// if nothing can touch the car without landing here.
    #[allow(clippy::too_many_arguments)]
    pub fn log_write(
        &self,
        connection_id: Option<i64>,
        vehicle_id: Option<i64>,
        module: &str,
        action: &str,
        params: &serde_json::Value,
        before: Option<&serde_json::Value>,
        after: Option<&serde_json::Value>,
        outcome: &str,
        error: Option<&str>,
    ) -> i64 {
        let conn = self.0.lock().unwrap();
        let res = conn.execute(
            "INSERT INTO writes_log (connection_id, vehicle_id, module, action, params_json, before_json, after_json, outcome, error, cloud_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                connection_id,
                vehicle_id,
                module,
                action,
                params.to_string(),
                before.map(|v| v.to_string()),
                after.map(|v| v.to_string()),
                outcome,
                error,
                Self::new_cloud_id()
            ],
        );
        if let Err(e) = &res {
            // A write reached the car but its audit row could not be stored.
            // The `.ok()` style the other inserts use would hide that, and
            // for THIS table a silent gap defeats its whole purpose, so at
            // minimum it must be loud in the logs. (Review fix, write-caps.)
            log::error!("writes_log insert failed, the audit trail is missing a row ({module}/{action}/{outcome}): {e}");
            return -1;
        }
        conn.last_insert_rowid()
    }

    /// Write audit trail for exactly one vehicle. `None` means only writes
    /// made while the connection was still unidentified, never all cars.
    pub fn writes_log(&self, vehicle_id: Option<i64>, limit: i64) -> Vec<WriteLogRow> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, ts, module, action, params_json, before_json, after_json, outcome, error
                 FROM writes_log WHERE vehicle_id IS ?1 ORDER BY id DESC LIMIT ?2",
            )
            .unwrap();
        stmt.query_map(params![vehicle_id, limit], |r| {
            Ok(WriteLogRow {
                id: r.get(0)?,
                ts: r.get(1)?,
                module: r.get(2)?,
                action: r.get(3)?,
                params: serde_json::from_str(&r.get::<_, String>(4)?)
                    .unwrap_or(serde_json::json!({})),
                before: r
                    .get::<_, Option<String>>(5)?
                    .and_then(|s| serde_json::from_str(&s).ok()),
                after: r
                    .get::<_, Option<String>>(6)?
                    .and_then(|s| serde_json::from_str(&s).ok()),
                outcome: r.get(7)?,
                error: r.get(8)?,
            })
        })
        .unwrap()
        .filter_map(Result::ok)
        .collect()
    }

    /// Scan history for one vehicle — or, with `None`, the scans of
    /// still-unidentified connections (vehicle_id IS NULL): "what this
    /// unnamed car scanned," never "everything in the database."
    pub fn dtc_history(&self, vehicle_id: Option<i64>, limit: i64) -> Vec<DtcScan> {
        self.dtc_history_where(
            match vehicle_id {
                Some(id) => format!("WHERE e.vehicle_id = {id}"),
                None => "WHERE e.vehicle_id IS NULL".to_string(),
            },
            limit,
        )
    }

    fn dtc_history_where(&self, where_clause: String, limit: i64) -> Vec<DtcScan> {
        let conn = self.0.lock().unwrap();
        let sql = format!(
            "SELECT e.id, e.ts, e.mil_on, e.voltage, e.freeze_json,
                    (SELECT json_group_array(code) FROM dtc_codes c WHERE c.scan_event_id = e.id AND c.status='stored'),
                    (SELECT json_group_array(code) FROM dtc_codes c WHERE c.scan_event_id = e.id AND c.status='pending'),
                    (SELECT json_group_array(code) FROM dtc_codes c WHERE c.scan_event_id = e.id AND c.status='permanent')
             FROM dtc_scan_events e {where_clause} ORDER BY e.id DESC LIMIT ?1"
        );
        let mut stmt = conn.prepare(&sql).unwrap();
        stmt.query_map(params![limit], |r| {
            Ok(DtcScan {
                id: r.get(0)?,
                ts: r.get(1)?,
                mil_on: r.get(2)?,
                voltage: r.get(3)?,
                freeze: r
                    .get::<_, Option<String>>(4)?
                    .and_then(|s| serde_json::from_str(&s).ok()),
                stored: serde_json::from_str(&r.get::<_, String>(5)?).unwrap_or_default(),
                pending: serde_json::from_str(&r.get::<_, String>(6)?).unwrap_or_default(),
                permanent: serde_json::from_str(&r.get::<_, String>(7)?).unwrap_or_default(),
            })
        })
        .unwrap()
        .filter_map(Result::ok)
        .collect()
    }

    /// Per-key min/avg/max over the last N hours — feeds the AI briefing.
    pub fn key_stats(&self, vehicle_id: Option<i64>, since_hours: f64) -> Vec<KeyStats> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT key, COUNT(*), MIN(value), AVG(value), MAX(value) FROM readings
                 WHERE vehicle_id IS ?1 AND ts >= datetime('now', '-' || ?2 || ' hours') GROUP BY key ORDER BY key",
            )
            .unwrap();
        stmt.query_map(params![vehicle_id, since_hours], |r| {
            Ok(KeyStats {
                key: r.get(0)?,
                n: r.get(1)?,
                min: r.get(2)?,
                avg: r.get(3)?,
                max: r.get(4)?,
            })
        })
        .unwrap()
        .filter_map(Result::ok)
        .collect()
    }

    // ---------- auto-discovery findings ----------
    // Upserts, not inserts: rediscovering the same car refreshes what it
    // finds rather than piling up duplicates — a pass is idempotent.

    pub fn upsert_discovered_module(
        &self,
        vehicle_id: i64,
        address: &str,
        name: Option<&str>,
    ) -> i64 {
        let conn = self.0.lock().unwrap();
        let existing: Option<i64> = conn
            .query_row(
                "SELECT id FROM discovered_modules WHERE vehicle_id = ?1 AND module_address = ?2",
                params![vehicle_id, address],
                |r| r.get(0),
            )
            .ok();
        match existing {
            Some(id) => {
                // Only overwrite a stored name with a real one, but always
                // record that this module positively answered again.
                let _ = conn.execute(
                    "UPDATE discovered_modules SET
                     module_name = COALESCE(?1, module_name),
                     last_seen_at = datetime('now') WHERE id = ?2",
                    params![name, id],
                );
                id
            }
            None => {
                conn.execute(
                    "INSERT INTO discovered_modules (vehicle_id, module_address, module_name, cloud_id) VALUES (?1, ?2, ?3, ?4)",
                    params![vehicle_id, address, name, Self::new_cloud_id()],
                )
                .ok();
                conn.last_insert_rowid()
            }
        }
    }

    pub fn update_ecu_fingerprint(
        &self,
        module_id: i64,
        fingerprint: &crate::elm::uds::EcuFingerprint,
    ) {
        let evidence = serde_json::to_string(&fingerprint.evidence).ok();
        let conn = self.0.lock().unwrap();
        let _ = conn.execute(
            "UPDATE discovered_modules SET
             spare_part_number = COALESCE(?1, spare_part_number),
             hardware_version = COALESCE(?2, hardware_version),
             software_version = COALESCE(?3, software_version),
             system_name = COALESCE(?4, system_name),
             fingerprint_evidence_json = ?5,
             supplier = COALESCE(?7, supplier)
             WHERE id = ?6",
            params![
                fingerprint.spare_part_number,
                fingerprint.hardware_version,
                fingerprint.software_version,
                fingerprint.system_name,
                evidence,
                module_id,
                fingerprint.supplier,
            ],
        );
        // Rebuild from every proven field retained on the module, not only
        // from this pass. An intermittent refusal must not make a stable ECU
        // family appear to become a different, less-complete family.
        let _ = conn.execute(
            "UPDATE discovered_modules SET fingerprint_match_key = NULLIF(
               RTRIM(
                 CASE WHEN spare_part_number IS NOT NULL THEN 'part=' || spare_part_number || '|' ELSE '' END ||
                 CASE WHEN hardware_version IS NOT NULL THEN 'hw=' || hardware_version || '|' ELSE '' END ||
                 CASE WHEN software_version IS NOT NULL THEN 'sw=' || software_version || '|' ELSE '' END ||
                 CASE WHEN system_name IS NOT NULL THEN 'sys=' || system_name || '|' ELSE '' END,
                 '|'
               ), '')
             WHERE id = ?1",
            params![module_id],
        );
        drop(conn);
        self.sync_module_knowledge(module_id);
    }

    pub fn upsert_discovered_did(
        &self,
        module_id: i64,
        did: u16,
        raw_sample: &str,
        byte_length: i64,
        label: Option<&str>,
    ) {
        let conn = self.0.lock().unwrap();
        // A label from the knowledge map counts as confirmed; an unlabeled
        // hit stays honestly "unlabeled" until something identifies it.
        let confidence = if label.is_some() {
            "confirmed"
        } else {
            "unlabeled"
        };
        let existing: Option<i64> = conn
            .query_row(
                "SELECT id FROM discovered_dids WHERE module_id = ?1 AND did = ?2",
                params![module_id, did as i64],
                |r| r.get(0),
            )
            .ok();
        match existing {
            Some(id) => {
                let _ = conn.execute(
                    "UPDATE discovered_dids SET raw_sample = ?1, byte_length = ?2,
                     label = ?3,
                     confidence = CASE WHEN ?3 IS NOT NULL THEN 'confirmed' ELSE 'unlabeled' END
                     WHERE id = ?4",
                    params![raw_sample, byte_length, label, id],
                );
            }
            None => {
                let _ = conn.execute(
                    "INSERT INTO discovered_dids (module_id, did, raw_sample, byte_length, label, confidence)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![module_id, did as i64, raw_sample, byte_length, label, confidence],
                );
            }
        }
        drop(conn);
        self.sync_knowledge_candidate(module_id, did);
    }

    /// Project a vehicle-scoped observation into reusable product knowledge.
    /// Raw payloads and all owner identifiers stop at this boundary.
    fn sync_knowledge_candidate(&self, module_id: i64, did: u16) {
        let conn = self.0.lock().unwrap();
        let source = conn.query_row(
            "SELECT m.module_address, m.family_id, m.supplier,
                    m.spare_part_number, m.hardware_version, m.software_version,
                    m.system_name, m.route_json, d.byte_length,
                    COALESCE(h.knowledge_state, 'unknown'),
                    COALESCE(h.label, d.label), h.decode_json, h.shape_json,
                    h.interpretations_json, h.confidence, h.discriminating_test,
                    m.fingerprint_match_key, COALESCE(m.cloud_id, 'legacy-' || m.id)
             FROM discovered_modules m
             JOIN discovered_dids d ON d.module_id = m.id AND d.did = ?2
             LEFT JOIN hypotheses h ON h.module_id = m.id AND h.did = ?2
             WHERE m.id = ?1",
            params![module_id, did as i64],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, Option<String>>(5)?,
                    r.get::<_, Option<String>>(6)?,
                    r.get::<_, Option<String>>(7)?,
                    r.get::<_, Option<i64>>(8)?,
                    r.get::<_, String>(9)?,
                    r.get::<_, Option<String>>(10)?,
                    r.get::<_, Option<String>>(11)?,
                    r.get::<_, Option<String>>(12)?,
                    r.get::<_, Option<String>>(13)?,
                    r.get::<_, Option<f64>>(14)?,
                    r.get::<_, Option<String>>(15)?,
                    r.get::<_, Option<String>>(16)?,
                    r.get::<_, String>(17)?,
                ))
            },
        );
        let Ok((
            address,
            family,
            supplier,
            part,
            hardware,
            software,
            system,
            route,
            length,
            state,
            label,
            decode,
            shape,
            interpretations,
            confidence,
            test,
            fingerprint,
            observation_id,
        )) = source
        else {
            return;
        };
        let (scope, compatibility_key) = if let Some(family) = family.as_deref() {
            ("ecu_family", format!("family:{family}"))
        } else if let Some(fingerprint) = fingerprint.as_deref() {
            ("exact_ecu", format!("ecu:{fingerprint}"))
        } else {
            ("observation", format!("observation:{observation_id}"))
        };
        // Identity can arrive after the first responsive DID. Replace the
        // earlier weak scope; do not leave duplicate observation/exact candidates.
        if scope != "observation" {
            let _ = conn.execute(
                "DELETE FROM knowledge_candidates WHERE compatibility_key = ?1 AND did = ?2",
                params![format!("observation:{observation_id}"), did as i64],
            );
        }
        if scope == "ecu_family" {
            if let Some(fingerprint) = fingerprint.as_deref() {
                let _ = conn.execute(
                    "DELETE FROM knowledge_candidates WHERE compatibility_key = ?1 AND did = ?2",
                    params![format!("ecu:{fingerprint}"), did as i64],
                );
            }
        }
        let _ = conn.execute(
            "INSERT INTO knowledge_candidates
               (compatibility_key, scope, family_id, module_address, supplier,
                spare_part_number, hardware_version, software_version, system_name,
                route_json, did, payload_length, knowledge_state, label, decode_json,
                shape_json, interpretations_json, confidence, discriminating_test)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                     ?14, ?15, ?16, ?17, ?18, ?19)
             ON CONFLICT(compatibility_key, did) DO UPDATE SET
               payload_length = COALESCE(excluded.payload_length, payload_length),
               knowledge_state = CASE
                 WHEN knowledge_candidates.knowledge_state IN
                      ('locally_confirmed','community_verified','oem_confirmed')
                 THEN knowledge_candidates.knowledge_state
                 ELSE excluded.knowledge_state END,
               label = COALESCE(excluded.label, label),
               decode_json = COALESCE(excluded.decode_json, decode_json),
               shape_json = COALESCE(excluded.shape_json, shape_json),
               interpretations_json = COALESCE(excluded.interpretations_json, interpretations_json),
               confidence = COALESCE(excluded.confidence, confidence),
               discriminating_test = COALESCE(excluded.discriminating_test, discriminating_test),
               last_observed_at = datetime('now')",
            params![
                compatibility_key,
                scope,
                family,
                address,
                supplier,
                part,
                hardware,
                software,
                system,
                route,
                did as i64,
                length,
                state,
                label,
                decode,
                shape,
                interpretations,
                confidence,
                test
            ],
        );
    }

    fn sync_module_knowledge(&self, module_id: i64) {
        let dids = {
            let conn = self.0.lock().unwrap();
            let mut stmt = match conn
                .prepare("SELECT did FROM discovered_dids WHERE module_id = ?1 ORDER BY did")
            {
                Ok(stmt) => stmt,
                Err(_) => return,
            };
            let found = match stmt.query_map(params![module_id], |r| r.get::<_, i64>(0)) {
                Ok(rows) => rows.filter_map(Result::ok).collect::<Vec<_>>(),
                Err(_) => return,
            };
            found
        };
        for did in dids {
            self.sync_knowledge_candidate(module_id, did as u16);
        }
    }

    pub fn knowledge_candidates(&self) -> Vec<KnowledgeCandidateRow> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, compatibility_key, scope, family_id, module_address,
                        supplier, spare_part_number, hardware_version, software_version,
                        system_name, route_json, did, payload_length, knowledge_state,
                        label, decode_json, shape_json, interpretations_json, confidence,
                        discriminating_test, first_observed_at, last_observed_at
                 FROM knowledge_candidates ORDER BY compatibility_key, did",
            )
            .unwrap();
        stmt.query_map([], |r| {
            Ok(KnowledgeCandidateRow {
                id: r.get(0)?,
                compatibility_key: r.get(1)?,
                scope: r.get(2)?,
                family_id: r.get(3)?,
                module_address: r.get(4)?,
                supplier: r.get(5)?,
                spare_part_number: r.get(6)?,
                hardware_version: r.get(7)?,
                software_version: r.get(8)?,
                system_name: r.get(9)?,
                route_json: r.get(10)?,
                did: r.get::<_, i64>(11)? as u16,
                payload_length: r.get(12)?,
                knowledge_state: r.get(13)?,
                label: r.get(14)?,
                decode_json: r.get(15)?,
                shape_json: r.get(16)?,
                interpretations_json: r.get(17)?,
                confidence: r.get(18)?,
                discriminating_test: r.get(19)?,
                first_observed_at: r.get(20)?,
                last_observed_at: r.get(21)?,
            })
        })
        .unwrap()
        .filter_map(Result::ok)
        .collect()
    }

    pub fn discovered_summary(&self, vehicle_id: i64) -> Vec<DiscoveredModuleRow> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT m.id, m.module_address, m.module_name, m.discovered_at,
                        COALESCE(m.last_seen_at, m.discovered_at),
                        COUNT(d.id), SUM(CASE WHEN d.label IS NOT NULL THEN 1 ELSE 0 END),
                        m.spare_part_number, m.hardware_version, m.software_version,
                        m.system_name, m.fingerprint_match_key,
                        CASE WHEN m.spare_part_number IS NOT NULL THEN 1 ELSE 0 END +
                        CASE WHEN m.hardware_version IS NOT NULL THEN 1 ELSE 0 END +
                        CASE WHEN m.software_version IS NOT NULL THEN 1 ELSE 0 END +
                        CASE WHEN m.system_name IS NOT NULL THEN 1 ELSE 0 END,
                        m.identity_fit, m.identity_reads, m.route_json, m.family_id, m.family_match,
                        m.route_state, m.supplier
                 FROM discovered_modules m
                 LEFT JOIN discovered_dids d ON d.module_id = m.id
                 WHERE m.vehicle_id = ?1
                 GROUP BY m.id ORDER BY m.module_address",
            )
            .unwrap();
        stmt.query_map(params![vehicle_id], |r| {
            Ok(DiscoveredModuleRow {
                id: r.get(0)?,
                address: r.get(1)?,
                name: r.get(2)?,
                discovered_at: r.get(3)?,
                last_seen_at: r.get(4)?,
                did_count: r.get(5)?,
                labeled_count: r.get::<_, Option<i64>>(6)?.unwrap_or(0),
                spare_part_number: r.get(7)?,
                hardware_version: r.get(8)?,
                software_version: r.get(9)?,
                system_name: r.get(10)?,
                fingerprint_match_key: r.get(11)?,
                fingerprint_fields_answered: r.get(12)?,
                fingerprint_fields_total: 4,
                identity_fit: r.get(13)?,
                identity_reads: r.get::<_, Option<i64>>(14)?.unwrap_or(0),
                route_json: r.get(15)?,
                family_id: r.get(16)?,
                family_match: r.get(17)?,
                route_state: r.get(18)?,
                supplier: r.get(19)?,
            })
        })
        .unwrap()
        .filter_map(Result::ok)
        .collect()
    }

    /// Store the route outcome of a discovered (answering) module.
    pub fn set_module_route_state(&self, module_id: i64, route_state: &str) -> bool {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "UPDATE discovered_modules SET route_state = ?1 WHERE id = ?2",
            params![route_state, module_id],
        )
        .map(|n| n > 0)
        .unwrap_or(false)
    }

    /// Record the census outcome of one candidate route (upsert on
    /// vehicle + address). `reached` routes also live in
    /// `discovered_modules`; refused/silent ones only here.
    pub fn record_route_outcome(
        &self,
        vehicle_id: i64,
        connection_id: Option<i64>,
        address: &str,
        route_state: &str,
        route_json: Option<&str>,
        detail: Option<&str>,
    ) {
        let conn = self.0.lock().unwrap();
        let _ = conn.execute(
            "INSERT INTO route_outcomes (vehicle_id, connection_id, module_address, route_state, route_json, detail)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(vehicle_id, module_address) DO UPDATE SET
               connection_id = excluded.connection_id,
               route_state = excluded.route_state,
               route_json = COALESCE(excluded.route_json, route_outcomes.route_json),
               detail = excluded.detail,
               observed_at = datetime('now')",
            params![vehicle_id, connection_id, address, route_state, route_json, detail],
        );
    }

    /// Every recorded route outcome of a vehicle, by address.
    pub fn route_outcomes(&self, vehicle_id: i64) -> Vec<RouteOutcomeRow> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, vehicle_id, connection_id, module_address, route_state, route_json, detail, observed_at
                 FROM route_outcomes WHERE vehicle_id = ?1 ORDER BY module_address",
            )
            .unwrap();
        stmt.query_map(params![vehicle_id], |r| {
            Ok(RouteOutcomeRow {
                id: r.get(0)?,
                vehicle_id: r.get(1)?,
                connection_id: r.get(2)?,
                address: r.get(3)?,
                route_state: r.get(4)?,
                route_json: r.get(5)?,
                detail: r.get(6)?,
                observed_at: r.get(7)?,
            })
        })
        .unwrap()
        .filter_map(Result::ok)
        .collect()
    }

    // ---------- discovery knowledge layer (plan A3) ----------

    /// Called by `discovery::identity::record_identity` (wired into the
    /// supervisor as a follow-up, see plan A7).
    #[allow(dead_code)]
    /// Identity confidence write-back (protocol S2 "repeat once for
    /// byte-identity"). `identity_hash` is a digest of the fingerprint match
    /// key (never the serial or VIN). Returns the new fit and read count, or
    /// None when the module does not exist.
    pub fn record_identity(
        &self,
        module_id: i64,
        identity_hash: &str,
        connection_id: i64,
    ) -> Option<(crate::elm::discovery::state::IdentityFit, i64)> {
        use crate::elm::discovery::state::{next_identity_fit, IdentityFit};
        let conn = self.0.lock().unwrap();
        let (fit, reads, previous_hash, previous_conn): (
            Option<String>,
            i64,
            Option<String>,
            Option<i64>,
        ) = conn
            .query_row(
                "SELECT identity_fit, COALESCE(identity_reads, 0), identity_hash,
                        identity_connection_id
                 FROM discovered_modules WHERE id = ?1",
                params![module_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .ok()?;
        let current = fit.as_deref().and_then(IdentityFit::parse);
        // A row hashed before the connection column existed counts as seen
        // on an unknown (-1) connection: the next real read can make it stable.
        let previous = previous_hash
            .as_deref()
            .map(|h| (h, previous_conn.unwrap_or(-1)));
        let (next, reads) =
            next_identity_fit(current, reads, previous, identity_hash, connection_id);
        conn.execute(
            "UPDATE discovered_modules SET identity_fit = ?1, identity_reads = ?2,
             identity_hash = CASE WHEN ?1 = 'conflicted' THEN identity_hash ELSE ?3 END,
             identity_connection_id = CASE WHEN ?1 = 'conflicted' THEN identity_connection_id ELSE ?4 END
             WHERE id = ?5",
            params![next.as_str(), reads, identity_hash, connection_id, module_id],
        )
        .ok()?;
        Some((next, reads))
    }

    /// `PUT /learning-state {"on": false}` cascade: every hypothesis that was
    /// polled as `learning`, on every vehicle, goes back to `disabled` in
    /// one statement. Returns how many rows changed.
    pub fn disable_learning_hypotheses(&self) -> usize {
        let conn = self.0.lock().unwrap();
        // The probes a learning hypothesis owns go off with it, or the
        // supervisor would keep reading DIDs the flag no longer allows
        // through the other half of the pipeline.
        let _ = conn.execute(
            "UPDATE uds_probes SET enabled = 0 WHERE hypothesis_id IN
               (SELECT id FROM hypotheses WHERE activation = 'learning')",
            [],
        );
        conn.execute(
            "UPDATE hypotheses SET activation = 'disabled', updated_at = datetime('now')
             WHERE activation = 'learning'",
            [],
        )
        .unwrap_or(0)
    }

    /// Store the S3 join result on the module (idempotent).
    pub fn set_module_family(
        &self,
        module_id: i64,
        family_id: Option<&str>,
        family_match: &str,
    ) -> bool {
        let conn = self.0.lock().unwrap();
        let updated = conn
            .execute(
                "UPDATE discovered_modules SET family_id = ?1, family_match = ?2 WHERE id = ?3",
                params![family_id, family_match, module_id],
            )
            .map(|n| n > 0)
            .unwrap_or(false);
        drop(conn);
        if updated {
            self.sync_module_knowledge(module_id);
        }
        updated
    }

    /// Store the full route tuple (protocol §9) on the module. Written by the
    /// census stage once it persists route tuples (follow-up outside this
    /// track); read back through `discovered_summary`.
    #[allow(dead_code)]
    pub fn set_module_route(&self, module_id: i64, route_json: &str) -> bool {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "UPDATE discovered_modules SET route_json = ?1 WHERE id = ?2",
            params![route_json, module_id],
        )
        .map(|n| n > 0)
        .unwrap_or(false)
    }

    /// Insert or refresh one hypothesis, unique on (vehicle, module, DID).
    /// Re-running a join updates the knowledge it carries but never touches
    /// what this vehicle established (`vehicle_fit`, `activation`, engine
    /// output) and never downgrades a confirmed knowledge state. Returns
    /// (id, created).
    pub fn upsert_hypothesis(&self, h: &HypothesisUpsert) -> (i64, bool) {
        let conn = self.0.lock().unwrap();
        let existing: Option<i64> = conn
            .query_row(
                "SELECT id FROM hypotheses WHERE vehicle_id = ?1 AND module_id = ?2 AND did = ?3",
                params![h.vehicle_id, h.module_id, h.did as i64],
                |r| r.get(0),
            )
            .ok();
        let result = match existing {
            Some(id) => {
                let _ = conn.execute(
                    "UPDATE hypotheses SET
                       knowledge_state = CASE
                         WHEN knowledge_state IN ('locally_confirmed','community_verified','oem_confirmed')
                         THEN knowledge_state ELSE ?1 END,
                       label = CASE WHEN label IS NULL THEN ?2 ELSE label END,
                       decode_json = COALESCE(?3, decode_json),
                       discriminating_test = COALESCE(?4, discriminating_test),
                       family_id = COALESCE(?5, family_id),
                       updated_at = datetime('now')
                     WHERE id = ?6",
                    params![
                        h.knowledge_state,
                        h.label,
                        h.decode_json,
                        h.discriminating_test,
                        h.family_id,
                        id
                    ],
                );
                (id, false)
            }
            None => {
                let _ = conn.execute(
                    "INSERT INTO hypotheses (vehicle_id, module_id, did, knowledge_state,
                       vehicle_fit, activation, label, decode_json, discriminating_test,
                       family_id, cloud_id)
                     VALUES (?1, ?2, ?3, ?4, 'untested', 'disabled', ?5, ?6, ?7, ?8, ?9)",
                    params![
                        h.vehicle_id,
                        h.module_id,
                        h.did as i64,
                        h.knowledge_state,
                        h.label,
                        h.decode_json,
                        h.discriminating_test,
                        h.family_id,
                        Self::new_cloud_id()
                    ],
                );
                (conn.last_insert_rowid(), true)
            }
        };
        drop(conn);
        self.sync_knowledge_candidate(h.module_id, h.did);
        result
    }

    const HYPOTHESIS_SELECT: &str =
        "SELECT h.id, h.vehicle_id, h.module_id, m.module_address, h.did, h.knowledge_state,
                h.vehicle_fit, h.route_state, h.activation, h.label, h.decode_json,
                h.shape_json, h.interpretations_json, h.confidence, h.discriminating_test,
                h.next_step_id, h.family_id,
                (SELECT COUNT(*) FROM hypothesis_samples s WHERE s.hypothesis_id = h.id),
                h.created_at, h.updated_at, h.evidence_json
         FROM hypotheses h JOIN discovered_modules m ON m.id = h.module_id";

    fn hypothesis_from_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<HypothesisRow> {
        Ok(HypothesisRow {
            id: r.get(0)?,
            vehicle_id: r.get(1)?,
            module_id: r.get(2)?,
            module_address: r.get(3)?,
            did: r.get::<_, i64>(4)? as u16,
            knowledge_state: r.get(5)?,
            vehicle_fit: r.get(6)?,
            route_state: r.get(7)?,
            activation: r.get(8)?,
            label: r.get(9)?,
            decode_json: r.get(10)?,
            shape_json: r.get(11)?,
            interpretations_json: r.get(12)?,
            confidence: r.get(13)?,
            discriminating_test: r.get(14)?,
            next_step_id: r.get(15)?,
            family_id: r.get(16)?,
            sample_count: r.get(17)?,
            created_at: r.get(18)?,
            updated_at: r.get(19)?,
            evidence: r
                .get::<_, Option<String>>(20)?
                .and_then(|json| serde_json::from_str(&json).ok()),
        })
    }

    pub fn list_hypotheses(&self, vehicle_id: i64) -> Vec<HypothesisRow> {
        let conn = self.0.lock().unwrap();
        let sql = format!(
            "{} WHERE h.vehicle_id = ?1 ORDER BY m.module_address, h.did",
            Self::HYPOTHESIS_SELECT
        );
        let mut stmt = conn.prepare(&sql).unwrap();
        stmt.query_map(params![vehicle_id], Self::hypothesis_from_row)
            .unwrap()
            .filter_map(Result::ok)
            .collect()
    }

    pub fn hypothesis(&self, id: i64) -> Option<HypothesisRow> {
        let conn = self.0.lock().unwrap();
        let sql = format!("{} WHERE h.id = ?1", Self::HYPOTHESIS_SELECT);
        conn.query_row(&sql, params![id], Self::hypothesis_from_row)
            .ok()
    }

    /// Apply a state transition with the rules from `discovery::state`
    /// enforced against the row's resulting state. `learning_on` is the
    /// `app_settings.learning_state` flag. Err carries the violated rule.
    ///
    /// A knowledge-state promotion is gated on evidence: the runs named in
    /// `patch.evidence_run_ids` must be this vehicle's own, and the rules in
    /// `check_knowledge` decide whether they carry the claim. The runs that
    /// justified the state are stored, and a retraction drops them.
    pub fn patch_hypothesis(
        &self,
        id: i64,
        patch: &HypothesisPatch,
        learning_on: bool,
    ) -> Result<Option<HypothesisRow>, crate::elm::discovery::state::RuleViolation> {
        use crate::elm::discovery::state::{
            check_activation, check_knowledge, Activation, KnowledgeEvidence, KnowledgeState,
            RuleViolation, VehicleFit,
        };
        let Some(current) = self.hypothesis(id) else {
            return Ok(None);
        };
        let invalid = |field: &'static str, value: &str| RuleViolation {
            rule: "unknown_state_value",
            reason: format!("{field} does not accept {value:?}"),
        };
        let knowledge = match &patch.knowledge_state {
            Some(v) => KnowledgeState::parse(v).ok_or_else(|| invalid("knowledge_state", v))?,
            None => {
                KnowledgeState::parse(&current.knowledge_state).unwrap_or(KnowledgeState::Unknown)
            }
        };
        let fit = match &patch.vehicle_fit {
            Some(v) => VehicleFit::parse(v).ok_or_else(|| invalid("vehicle_fit", v))?,
            None => VehicleFit::parse(&current.vehicle_fit).unwrap_or(VehicleFit::Untested),
        };
        let activation = match &patch.activation {
            Some(v) => Activation::parse(v).ok_or_else(|| invalid("activation", v))?,
            None => Activation::parse(&current.activation).unwrap_or(Activation::Disabled),
        };
        let was =
            KnowledgeState::parse(&current.knowledge_state).unwrap_or(KnowledgeState::Unknown);
        let offered = patch.evidence_run_ids.clone().unwrap_or_default();
        // Evidence has to be this car's own: a run recorded against another
        // vehicle proves nothing about this decode.
        {
            let conn = self.0.lock().unwrap();
            for run in &offered {
                let mine: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM verification_runs WHERE id = ?1 AND vehicle_id = ?2",
                        params![run, current.vehicle_id],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                if mine == 0 {
                    return Err(RuleViolation {
                        rule: "evidence_run_not_found",
                        reason: format!(
                            "verification run #{run} is not recorded for vehicle #{}",
                            current.vehicle_id
                        ),
                    });
                }
            }
        }
        check_knowledge(
            was,
            knowledge,
            &KnowledgeEvidence {
                run_ids: offered.clone(),
                vehicle_fit: fit,
            },
        )?;
        check_activation(activation, fit, learning_on)?;
        // Offered runs replace what was stored; an empty list and any move
        // off `locally_confirmed` retract it.
        let evidence_json = match &patch.evidence_run_ids {
            Some(ids) if !ids.is_empty() => serde_json::to_string(&HypothesisEvidence {
                run_ids: ids.clone(),
            })
            .ok(),
            Some(_) => None,
            None if knowledge != was && knowledge != KnowledgeState::LocallyConfirmed => None,
            None => current
                .evidence
                .as_ref()
                .and_then(|e| serde_json::to_string(e).ok()),
        };
        let conn = self.0.lock().unwrap();
        let _ = conn.execute(
            "UPDATE hypotheses SET knowledge_state = ?1, vehicle_fit = ?2, activation = ?3,
             label = COALESCE(?4, label), evidence_json = ?5, updated_at = datetime('now')
             WHERE id = ?6",
            params![
                knowledge.as_str(),
                fit.as_str(),
                activation.as_str(),
                patch.label,
                evidence_json,
                id
            ],
        );
        drop(conn);
        let row = self.hypothesis(id);
        if let Some(row) = &row {
            self.sync_knowledge_candidate(row.module_id, row.did);
        }
        Ok(row)
    }

    /// Writer: the S5 hypothesis poll (supervisor follow-up).
    #[allow(dead_code)]
    /// Store one raw sample and enforce the retention rule (keep the newest
    /// `HYPOTHESIS_SAMPLE_RETENTION` per hypothesis).
    pub fn insert_hypothesis_sample(
        &self,
        hypothesis_id: i64,
        ts_ms: i64,
        payload_hex: &str,
        refs_json: Option<&str>,
    ) -> i64 {
        self.insert_hypothesis_sample_keeping(
            hypothesis_id,
            ts_ms,
            payload_hex,
            refs_json,
            HYPOTHESIS_SAMPLE_RETENTION,
        )
    }

    /// Same as `insert_hypothesis_sample` with an explicit retention count.
    #[allow(dead_code)]
    pub fn insert_hypothesis_sample_keeping(
        &self,
        hypothesis_id: i64,
        ts_ms: i64,
        payload_hex: &str,
        refs_json: Option<&str>,
        keep: i64,
    ) -> i64 {
        let conn = self.0.lock().unwrap();
        let _ = conn.execute(
            "INSERT INTO hypothesis_samples (hypothesis_id, ts_ms, payload_hex, refs_json)
             VALUES (?1, ?2, ?3, ?4)",
            params![hypothesis_id, ts_ms, payload_hex, refs_json],
        );
        let id = conn.last_insert_rowid();
        // Retention by insertion order: everything older than the N-th
        // newest row goes. One indexed lookup, not a full re-sort per insert.
        let _ = conn.execute(
            "DELETE FROM hypothesis_samples WHERE hypothesis_id = ?1 AND id <= COALESCE(
               (SELECT id FROM hypothesis_samples WHERE hypothesis_id = ?1
                ORDER BY id DESC LIMIT 1 OFFSET ?2), 0)",
            params![hypothesis_id, keep],
        );
        id
    }

    /// Reader: `discovery::learn` over stored samples (follow-up).
    #[allow(dead_code)]
    pub fn hypothesis_samples(&self, hypothesis_id: i64, limit: i64) -> Vec<HypothesisSampleRow> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, hypothesis_id, ts_ms, payload_hex, refs_json FROM hypothesis_samples
                 WHERE hypothesis_id = ?1 ORDER BY ts_ms DESC, id DESC LIMIT ?2",
            )
            .unwrap();
        stmt.query_map(params![hypothesis_id, limit], |r| {
            Ok(HypothesisSampleRow {
                id: r.get(0)?,
                hypothesis_id: r.get(1)?,
                ts_ms: r.get(2)?,
                payload_hex: r.get(3)?,
                refs_json: r.get(4)?,
            })
        })
        .unwrap()
        .filter_map(Result::ok)
        .collect()
    }

    /// Distinct reading keys and total count for a vehicle — the cheap
    /// "standard" line of the coverage report.
    pub fn standard_coverage(&self, vehicle_id: i64) -> (i64, i64) {
        let conn = self.0.lock().unwrap();
        conn.query_row(
            "SELECT COUNT(DISTINCT key), COUNT(*) FROM readings WHERE vehicle_id = ?1",
            params![vehicle_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap_or((0, 0))
    }

    pub fn vehicle_evidence_map(&self, vehicle_id: i64) -> VehicleEvidenceMap {
        struct MapRow {
            id: i64,
            address: String,
            stored_name: Option<String>,
            first_seen: String,
            last_seen: String,
            part: Option<String>,
            hardware: Option<String>,
            software: Option<String>,
            system: Option<String>,
        }
        let conn = self.0.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, module_address, module_name, discovered_at,
                        COALESCE(last_seen_at, discovered_at), spare_part_number,
                        hardware_version, software_version, system_name
                 FROM discovered_modules WHERE vehicle_id = ?1
                 ORDER BY module_address",
            )
            .unwrap();
        let rows: Vec<MapRow> = stmt
            .query_map(params![vehicle_id], |row| {
                Ok(MapRow {
                    id: row.get(0)?,
                    address: row.get(1)?,
                    stored_name: row.get(2)?,
                    first_seen: row.get(3)?,
                    last_seen: row.get(4)?,
                    part: row.get(5)?,
                    hardware: row.get(6)?,
                    software: row.get(7)?,
                    system: row.get(8)?,
                })
            })
            .unwrap()
            .filter_map(Result::ok)
            .collect();
        let modules = rows
            .into_iter()
            .map(|row| {
                let (display_name, name_source) = if row.system.is_some() {
                    (row.system.clone(), Some("ecu_reported".to_string()))
                } else if row.stored_name.is_some() && row.stored_name == row.part {
                    (row.stored_name, Some("ecu_reported_identity".to_string()))
                } else if row.stored_name.is_some() {
                    (row.stored_name, Some("documented_profile".to_string()))
                } else {
                    (None, None)
                };
                let mut did_stmt = conn
                    .prepare(
                        "SELECT did, raw_sample, byte_length, label, confidence
                             FROM discovered_dids WHERE module_id = ?1 ORDER BY did",
                    )
                    .unwrap();
                let dids = did_stmt
                    .query_map(params![row.id], |row| {
                        Ok(VehicleMapDid {
                            did: row.get::<_, i64>(0)? as u16,
                            raw_sample: row.get(1)?,
                            byte_length: row.get(2)?,
                            label: row.get(3)?,
                            confidence: row.get(4)?,
                        })
                    })
                    .unwrap()
                    .filter_map(Result::ok)
                    .collect();
                let fields_answered = [
                    row.part.as_ref(),
                    row.hardware.as_ref(),
                    row.software.as_ref(),
                    row.system.as_ref(),
                ]
                .iter()
                .filter(|value| value.is_some())
                .count() as u8;
                VehicleMapModule {
                    id: row.id,
                    address: row.address,
                    display_name,
                    name_source,
                    presence: "previously_reached".into(),
                    first_seen_at: row.first_seen,
                    last_seen_at: row.last_seen,
                    identity: VehicleMapIdentity {
                        spare_part_number: row.part,
                        hardware_version: row.hardware,
                        software_version: row.software,
                        system_name: row.system,
                        fields_answered,
                        fields_total: 4,
                    },
                    dids,
                    module_fault_evidence: "not_scanned".into(),
                }
            })
            .collect();
        let latest_standard_faults = conn
            .query_row(
                "SELECT ts, mil_on,
                        (SELECT json_group_array(code) FROM dtc_codes c WHERE c.scan_event_id = e.id AND c.status='stored'),
                        (SELECT json_group_array(code) FROM dtc_codes c WHERE c.scan_event_id = e.id AND c.status='pending'),
                        (SELECT json_group_array(code) FROM dtc_codes c WHERE c.scan_event_id = e.id AND c.status='permanent')
                 FROM dtc_scan_events e WHERE vehicle_id = ?1 ORDER BY id DESC LIMIT 1",
                params![vehicle_id],
                |row| {
                    Ok(VehicleMapStandardFaults {
                        scanned_at: row.get(0)?,
                        mil_on: row.get(1)?,
                        stored: serde_json::from_str(&row.get::<_, String>(2)?)
                            .unwrap_or_default(),
                        pending: serde_json::from_str(&row.get::<_, String>(3)?)
                            .unwrap_or_default(),
                        permanent: serde_json::from_str(&row.get::<_, String>(4)?)
                            .unwrap_or_default(),
                    })
                },
            )
            .ok();

        VehicleEvidenceMap {
            vehicle_id,
            evidence_scope: "persisted_observations".into(),
            modules,
            latest_standard_faults,
        }
    }

    /// VIN-free field-trial dataset and conservative reuse measurement. A
    /// repeated family requires the same normalized F187 part number on at
    /// least two different vehicles; weaker overlaps are retained in the
    /// observations but never promoted to a match.
    pub fn fingerprint_experiment(&self) -> FingerprintExperimentReport {
        #[derive(Clone)]
        struct Row {
            vehicle_id: i64,
            address: String,
            part: Option<String>,
            hardware: Option<String>,
            software: Option<String>,
            system: Option<String>,
        }

        let conn = self.0.lock().unwrap();
        let vehicles_scanned = conn
            .query_row(
                "SELECT COUNT(DISTINCT vehicle_id) FROM discovered_modules",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0) as u32;
        let modules_observed = conn
            .query_row("SELECT COUNT(*) FROM discovered_modules", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap_or(0) as u32;
        let mut stmt = conn
            .prepare(
                "SELECT vehicle_id, module_address, spare_part_number,
                        hardware_version, software_version, system_name
                 FROM discovered_modules
                 WHERE spare_part_number IS NOT NULL OR hardware_version IS NOT NULL
                    OR software_version IS NOT NULL OR system_name IS NOT NULL
                 ORDER BY vehicle_id, module_address",
            )
            .unwrap();
        let rows: Vec<Row> = stmt
            .query_map([], |row| {
                Ok(Row {
                    vehicle_id: row.get(0)?,
                    address: row.get(1)?,
                    part: row.get(2)?,
                    hardware: row.get(3)?,
                    software: row.get(4)?,
                    system: row.get(5)?,
                })
            })
            .unwrap()
            .filter_map(Result::ok)
            .collect();

        let vehicle_ids: BTreeSet<i64> = rows.iter().map(|row| row.vehicle_id).collect();
        let vehicle_refs: BTreeMap<i64, String> = vehicle_ids
            .iter()
            .enumerate()
            .map(|(index, id)| (*id, format!("vehicle_{:03}", index + 1)))
            .collect();
        let observations: Vec<FingerprintObservation> = rows
            .iter()
            .map(|row| FingerprintObservation {
                vehicle_ref: vehicle_refs[&row.vehicle_id].clone(),
                module_address: row.address.clone(),
                spare_part_number: row.part.clone(),
                hardware_version: row.hardware.clone(),
                software_version: row.software.clone(),
                system_name: row.system.clone(),
                fields_answered: [
                    row.part.as_ref(),
                    row.hardware.as_ref(),
                    row.software.as_ref(),
                    row.system.as_ref(),
                ]
                .iter()
                .filter(|value| value.is_some())
                .count() as u8,
            })
            .collect();

        let mut families: BTreeMap<String, Vec<&Row>> = BTreeMap::new();
        for row in &rows {
            if let Some(key) = row.part.as_deref().and_then(normalized_part_number) {
                families.entry(key).or_default().push(row);
            }
        }
        let modules_with_part_number = families.values().map(Vec::len).sum::<usize>() as u32;
        let mut repeated_vehicles = BTreeSet::new();
        let mut match_groups = Vec::new();
        for (family_key, members) in families {
            let vehicle_ids: BTreeSet<i64> =
                members.iter().map(|member| member.vehicle_id).collect();
            if vehicle_ids.len() < 2 {
                continue;
            }
            repeated_vehicles.extend(vehicle_ids.iter().copied());
            let values = |select: fn(&Row) -> Option<&String>| {
                members
                    .iter()
                    .filter_map(|member| select(member).cloned())
                    .collect::<BTreeSet<_>>()
                    .into_iter()
                    .collect()
            };
            match_groups.push(FingerprintMatchGroup {
                family_key,
                part_number: members[0].part.clone().unwrap_or_default(),
                vehicle_count: vehicle_ids.len() as u32,
                module_count: members.len() as u32,
                hardware_versions: values(|row| row.hardware.as_ref()),
                software_versions: values(|row| row.software.as_ref()),
                system_names: values(|row| row.system.as_ref()),
            });
        }

        FingerprintExperimentReport {
            target_vehicles: 30,
            vehicles_scanned,
            vehicles_with_fingerprints: vehicle_ids.len() as u32,
            modules_observed,
            modules_with_fingerprints: rows.len() as u32,
            modules_with_part_number,
            repeated_family_groups: match_groups.len() as u32,
            vehicles_with_repeated_family: repeated_vehicles.len() as u32,
            cohort_target_reached: vehicle_ids.len() >= 30,
            match_groups,
            observations,
        }
    }

    /// Every (module address, did) pair already found on this vehicle —
    /// the fast re-scan path's input: re-probe exactly these instead of
    /// blindly sweeping the whole bus/band range again. Owner call
    /// 2026-08-24: "if we already have data from a car, a re-scan
    /// shouldn't take that long."
    pub fn discovered_addresses_and_dids(&self, vehicle_id: i64) -> Vec<(String, u16)> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT m.module_address, d.did FROM discovered_dids d
                 JOIN discovered_modules m ON m.id = d.module_id
                 WHERE m.vehicle_id = ?1 ORDER BY m.module_address, d.did",
            )
            .unwrap();
        stmt.query_map(params![vehicle_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as u16))
        })
        .unwrap()
        .filter_map(Result::ok)
        .collect()
    }

    pub fn discovered_dids(&self, module_id: i64) -> Vec<DiscoveredDidRow> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT did, raw_sample, byte_length, label, confidence FROM discovered_dids WHERE module_id = ?1 ORDER BY did")
            .unwrap();
        stmt.query_map(params![module_id], |r| {
            Ok(DiscoveredDidRow {
                did: r.get::<_, i64>(0)? as u16,
                raw_sample: r.get(1)?,
                byte_length: r.get(2)?,
                label: r.get(3)?,
                confidence: r.get(4)?,
            })
        })
        .unwrap()
        .filter_map(Result::ok)
        .collect()
    }

    // ---------- uds probes / modules ----------

    /// Probes for one car: this vehicle's own probes plus any legacy
    /// (pre-scoping) global ones. `None` scope (no identified vehicle
    /// connected) returns only the legacy global probes — never another
    /// car's, the same isolation rule as readings/scans/everything else.
    pub fn list_probes(&self, vehicle_id: Option<i64>) -> Vec<UdsProbe> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, vehicle_id, module, did, label, unit, offset, len, scale, bias, enabled,
                        origin, hypothesis_id
                 FROM uds_probes WHERE vehicle_id IS ?1 OR vehicle_id IS NULL ORDER BY id",
            )
            .unwrap();
        stmt.query_map(params![vehicle_id], |r| {
            Ok(UdsProbe {
                id: r.get(0)?,
                vehicle_id: r.get(1)?,
                module: r.get(2)?,
                did: r.get::<_, i64>(3)? as u16,
                label: r.get(4)?,
                unit: r.get(5)?,
                offset: r.get::<_, i64>(6)? as usize,
                len: r.get::<_, i64>(7)? as usize,
                scale: r.get(8)?,
                bias: r.get(9)?,
                enabled: r.get(10)?,
                origin: r.get(11)?,
                hypothesis_id: r.get(12)?,
            })
        })
        .unwrap()
        .filter_map(Result::ok)
        .collect()
    }

    pub fn add_probe(&self, p: &UdsProbe, vehicle_id: Option<i64>) -> i64 {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "INSERT INTO uds_probes (vehicle_id, module, did, label, unit, offset, len, scale, bias, enabled, origin, hypothesis_id, cloud_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'manual', NULL, ?11)",
            params![vehicle_id, p.module, p.did as i64, p.label, p.unit, p.offset as i64, p.len as i64, p.scale, p.bias, p.enabled, Self::new_cloud_id()],
        )
        .ok();
        conn.last_insert_rowid()
    }

    /// Auto-discovery's promotion path: a DID the knowledge map has a full
    /// decode formula for becomes a stored decode definition with no
    /// manual "save as probe" step. Upserts on (vehicle_id, module,
    /// did) so re-running discovery refreshes the formula rather than
    /// piling up duplicates.
    pub fn upsert_probe_from_discovery(
        &self,
        vehicle_id: i64,
        module: &str,
        did: u16,
        label: &str,
        unit: &str,
        offset: usize,
        len: usize,
        scale: f64,
        bias: f64,
    ) -> bool {
        let conn = self.0.lock().unwrap();
        let existing: Option<(i64, String)> = conn
            .query_row(
                "SELECT id, origin FROM uds_probes WHERE vehicle_id = ?1 AND module = ?2 AND did = ?3 ORDER BY origin = 'manual' DESC LIMIT 1",
                params![vehicle_id, module, did as i64],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok();
        match existing {
            // A manual definition is user-owned. It wins over discovery
            // and is never silently rewritten.
            Some((_id, origin)) if origin == "manual" => false,
            Some((id, _)) => {
                let _ = conn.execute(
                    "UPDATE uds_probes SET label = ?1, unit = ?2, offset = ?3, len = ?4, scale = ?5, bias = ?6 WHERE id = ?7",
                    params![label, unit, offset as i64, len as i64, scale, bias, id],
                );
                false
            }
            None => {
                let _ = conn.execute(
                    "INSERT INTO uds_probes (vehicle_id, module, did, label, unit, offset, len, scale, bias, enabled, origin, cloud_id)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, 'discovery', ?10)",
                    params![vehicle_id, module, did as i64, label, unit, offset as i64, len as i64, scale, bias, Self::new_cloud_id()],
                );
                true
            }
        }
    }

    pub fn delete_probe(&self, id: i64) {
        let conn = self.0.lock().unwrap();
        conn.execute("DELETE FROM uds_probes WHERE id = ?1", params![id])
            .ok();
    }

    /// Removes one probe only when discovery owns it. Used when the
    /// knowledge map retracts or moves a formula; manual rows are immune.
    pub fn delete_discovery_probe(&self, id: i64) -> bool {
        self.0
            .lock()
            .unwrap()
            .execute(
                "DELETE FROM uds_probes WHERE id = ?1 AND origin = 'discovery'",
                params![id],
            )
            .map(|n| n > 0)
            .unwrap_or(false)
    }

    /// Edit a probe's decode formula in place (agent API `PATCH /probes/:id`).
    /// Identity (id, vehicle, origin) never changes; only how the answer is
    /// read. Returns false when no such probe exists.
    pub fn update_probe_decode(&self, id: i64, p: &UdsProbe) -> bool {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "UPDATE uds_probes SET module = ?2, did = ?3, label = ?4, unit = ?5, offset = ?6,
                 len = ?7, scale = ?8, bias = ?9, enabled = ?10 WHERE id = ?1",
            params![
                id,
                p.module,
                p.did as i64,
                p.label,
                p.unit,
                p.offset as i64,
                p.len as i64,
                p.scale,
                p.bias,
                p.enabled
            ],
        )
        .map(|n| n > 0)
        .unwrap_or(false)
    }

    pub fn toggle_probe(&self, id: i64, enabled: bool) {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "UPDATE uds_probes SET enabled = ?2 WHERE id = ?1",
            params![id, enabled],
        )
        .ok();
    }

    /// A hypothesis that has just been activated owns a probe: the row that
    /// makes the poller actually read that DID. An existing row for the same
    /// (vehicle, module, DID) is adopted whatever its origin — that is the
    /// whole point, a user who already saved this DID by hand must not end
    /// up with a duplicate. Otherwise a new `discovery`-origin row is
    /// created from the hypothesis's decode. Returns the probe's id.
    pub fn link_hypothesis_probe(&self, hypothesis_id: i64, vehicle_id: i64, p: &UdsProbe) -> i64 {
        let conn = self.0.lock().unwrap();
        // A manual row wins the adoption when both exist: it is the one the
        // user can see and edit in the probe list.
        let existing: Option<i64> = conn
            .query_row(
                "SELECT id FROM uds_probes WHERE vehicle_id = ?1 AND module = ?2 AND did = ?3
                 ORDER BY origin = 'manual' DESC, id LIMIT 1",
                params![vehicle_id, p.module, p.did as i64],
                |r| r.get(0),
            )
            .ok();
        match existing {
            Some(id) => {
                // Adoption never rewrites a formula the user may have tuned;
                // it only records the ownership and switches the row on.
                let _ = conn.execute(
                    "UPDATE uds_probes SET hypothesis_id = ?2, enabled = 1 WHERE id = ?1",
                    params![id, hypothesis_id],
                );
                id
            }
            None => {
                let _ = conn.execute(
                    "INSERT INTO uds_probes (vehicle_id, module, did, label, unit, offset, len, scale, bias, enabled, origin, hypothesis_id, cloud_id)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, 'discovery', ?10, ?11)",
                    params![
                        vehicle_id,
                        p.module,
                        p.did as i64,
                        p.label,
                        p.unit,
                        p.offset as i64,
                        p.len as i64,
                        p.scale,
                        p.bias,
                        hypothesis_id,
                        Self::new_cloud_id()
                    ],
                );
                conn.last_insert_rowid()
            }
        }
    }

    /// Switch off every probe a hypothesis owns. The row is kept (with its
    /// link) so re-enabling the hypothesis reuses it instead of piling up a
    /// second definition of the same DID.
    pub fn disable_hypothesis_probes(&self, hypothesis_id: i64) -> usize {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "UPDATE uds_probes SET enabled = 0 WHERE hypothesis_id = ?1",
            params![hypothesis_id],
        )
        .unwrap_or(0)
    }

    /// Custom UDS modules (non-PSA brands, or extra PSA modules the built-in
    /// four don't cover). Returned as generic (key, label, req, resp) tuples
    /// so this module stays free of a dependency on `elm::uds`.
    pub fn list_uds_modules(&self) -> Vec<(String, String, String, String)> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT key, label, req, resp FROM uds_modules ORDER BY id")
            .unwrap();
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .unwrap()
            .filter_map(Result::ok)
            .collect()
    }

    /// Returns Err if the key collides with a built-in or an existing custom
    /// module (UNIQUE constraint) — surfaced to the UI as a friendly message.
    pub fn add_uds_module(
        &self,
        key: &str,
        label: &str,
        req: &str,
        resp: &str,
    ) -> Result<(), String> {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "INSERT INTO uds_modules (key, label, req, resp) VALUES (?1, ?2, ?3, ?4)",
            params![key, label, req, resp],
        )
        .map(|_| ())
        .map_err(|e| format!("could not add module (duplicate key?): {e}"))
    }

    pub fn delete_uds_module(&self, key: &str) {
        let conn = self.0.lock().unwrap();
        conn.execute("DELETE FROM uds_modules WHERE key = ?1", params![key])
            .ok();
    }

    // ---------- app settings (app-level, not car-level) ----------

    pub fn setting_get(&self, key: &str) -> Option<String> {
        let conn = self.0.lock().unwrap();
        conn.query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            params![key],
            |r| r.get(0),
        )
        .ok()
    }

    pub fn setting_set(&self, key: &str, value: &str) {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = datetime('now')",
            params![key, value],
        )
        .ok();
    }

    // ---------- per-vehicle report ----------

    pub fn vehicle_report(&self, vehicle_id: i64) -> CarReport {
        let conn = self.0.lock().unwrap();
        let (vin, display_name, fuel_price): (Option<String>, Option<String>, f64) = conn
            .query_row(
                "SELECT vin, display_name, fuel_price FROM vehicles WHERE id = ?1",
                params![vehicle_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap_or((None, None, 1.50));
        let mut sessions = Vec::new();
        {
            let mut stmt = conn
                .prepare(
                    "SELECT c.id, c.started_at, c.ended_at,
                        (SELECT COUNT(*) FROM readings r WHERE r.connection_id = c.id),
                        (SELECT MAX(value) FROM readings r WHERE r.connection_id = c.id AND key='speed'),
                        (SELECT MAX(value) FROM readings r WHERE r.connection_id = c.id AND key='coolant'),
                        (SELECT MIN(value) FROM readings r WHERE r.connection_id = c.id AND key='voltage'),
                        CAST((julianday(COALESCE(c.ended_at, c.started_at)) - julianday(c.started_at)) * 1440 AS REAL)
                     FROM connections c WHERE c.vehicle_id = ?1
                     ORDER BY c.id DESC LIMIT 30",
                )
                .unwrap();
            let rows = stmt
                .query_map(params![vehicle_id], |r| {
                    Ok(SessionSummary {
                        id: r.get(0)?,
                        started_at: r.get(1)?,
                        ended_at: r.get(2)?,
                        readings: r.get(3)?,
                        max_speed: r.get(4)?,
                        max_coolant: r.get(5)?,
                        min_voltage: r.get(6)?,
                        minutes: r.get(7)?,
                    })
                })
                .unwrap();
            sessions.extend(rows.filter_map(Result::ok));
        }
        let (session_count, engine_minutes, first, last): (i64, f64, Option<String>, Option<String>) = conn
            .query_row(
                "SELECT COUNT(*),
                    COALESCE(SUM((julianday(COALESCE(ended_at, started_at)) - julianday(started_at)) * 1440), 0),
                    MIN(started_at), MAX(started_at)
                 FROM connections WHERE vehicle_id = ?1",
                params![vehicle_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap_or((0, 0.0, None, None));
        let total_readings: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM readings WHERE vehicle_id = ?1",
                params![vehicle_id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        // Per-vehicle at last — dtc_scan_events carries vehicle_id now (the
        // old dtc_scans table had no link at all and this pair was global).
        let (scans_total, scans_clean): (i64, i64) = conn
            .query_row(
                "SELECT COUNT(*),
                        SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM dtc_codes c WHERE c.scan_event_id = e.id AND c.status IN ('stored','pending'))
                            THEN 1 ELSE 0 END)
                 FROM dtc_scan_events e WHERE e.vehicle_id = ?1",
                params![vehicle_id],
                |r| Ok((r.get(0)?, r.get::<_, Option<i64>>(1)?.unwrap_or(0))),
            )
            .unwrap_or((0, 0));
        let mut daily_voltage = Vec::new();
        {
            let mut stmt = conn
                .prepare(
                    "SELECT date(ts), ROUND(MIN(value),2), ROUND(AVG(value),2), ROUND(MAX(value),2)
                     FROM readings WHERE key='voltage' AND vehicle_id = ?1
                     GROUP BY date(ts) ORDER BY 1 DESC LIMIT 30",
                )
                .unwrap();
            let rows = stmt
                .query_map(params![vehicle_id], |r| {
                    Ok(DailyVoltage {
                        day: r.get(0)?,
                        min: r.get(1)?,
                        avg: r.get(2)?,
                        max: r.get(3)?,
                    })
                })
                .unwrap();
            daily_voltage.extend(rows.filter_map(Result::ok));
            daily_voltage.reverse();
        }
        let stats = |hours: f64| -> Vec<KeyStats> {
            let mut stmt = conn
                .prepare(
                    "SELECT key, COUNT(*), MIN(value), AVG(value), MAX(value)
                     FROM readings
                     WHERE vehicle_id = ?1 AND ts >= datetime('now', '-' || ?2 || ' hours')
                     GROUP BY key ORDER BY key",
                )
                .unwrap();
            let rows = stmt
                .query_map(params![vehicle_id, hours], |r| {
                    Ok(KeyStats {
                        key: r.get(0)?,
                        n: r.get(1)?,
                        min: r.get(2)?,
                        avg: r.get(3)?,
                        max: r.get(4)?,
                    })
                })
                .unwrap();
            rows.filter_map(Result::ok).collect()
        };
        let stats_7d = stats(24.0 * 7.0);
        let stats_all = stats(24.0 * 3650.0);

        // ---- Plain-language insights (last 7 days; falls back to all-time) ----
        let window_hours = 24.0 * 7.0;
        let pick = |set: &Vec<KeyStats>, key: &str| -> Option<(f64, f64, f64, i64)> {
            set.iter()
                .find(|s| s.key == key)
                .map(|s| (s.min, s.avg, s.max, s.n))
        };
        let source = if stats_7d.is_empty() {
            &stats_all
        } else {
            &stats_7d
        };
        // Engine hours inside the window ≈ sum of connections started in it.
        let engine_minutes_window: f64 = conn
            .query_row(
                "SELECT COALESCE(SUM((julianday(COALESCE(ended_at, started_at)) - julianday(started_at)) * 1440), 0)
                 FROM connections WHERE vehicle_id = ?1 AND started_at >= datetime('now', '-' || ?2 || ' hours')",
                params![vehicle_id, window_hours],
                |r| r.get(0),
            )
            .unwrap_or(0.0);
        let engine_hours = if stats_7d.is_empty() {
            engine_minutes / 60.0
        } else {
            engine_minutes_window / 60.0
        };
        let fuel = pick(source, "fuel_rate");
        let speed = pick(source, "speed");
        let fuel_lph_avg = fuel.map(|f| f.1);
        let speed_avg = speed.map(|s| s.1);
        let l_per_100km = match (fuel_lph_avg, speed_avg) {
            (Some(f), Some(s)) if s > 1.0 => Some(f / s * 100.0),
            _ => None,
        };
        let fuel_total_l = fuel_lph_avg.map(|f| f * engine_hours);
        let km_total = speed_avg.map(|s| s * engine_hours);
        let coolant = pick(source, "coolant");
        let map_s = pick(source, "map");
        let volt = pick(source, "voltage");
        let fuel_level_pct: Option<f64> = conn
            .query_row(
                "SELECT value FROM readings
                 WHERE key='fuel_level' AND vehicle_id = ?1
                 ORDER BY ts DESC LIMIT 1",
                params![vehicle_id],
                |r| r.get(0),
            )
            .ok();
        let insights = Insights {
            window_hours: if stats_7d.is_empty() {
                24.0 * 3650.0
            } else {
                window_hours
            },
            engine_hours,
            fuel_lph_avg,
            speed_avg,
            l_per_100km,
            fuel_total_l,
            km_total,
            ltft_avg: pick(source, "ltft").map(|s| s.1),
            coolant_max: coolant.map(|s| s.2),
            coolant_reached_op: coolant.map(|s| s.2 >= 80.0).unwrap_or(false),
            boost_max_kpa: map_s.map(|s| s.2),
            baro_kpa: Some(92.0),
            voltage_min: volt.map(|s| s.0),
            voltage_avg: volt.map(|s| s.1),
            fuel_price,
            fuel_level_pct,
        };

        CarReport {
            vehicle_id,
            vin,
            display_name,
            session_count,
            engine_minutes,
            total_readings,
            first,
            last,
            scans_total,
            scans_clean,
            sessions,
            stats_7d,
            stats_all,
            daily_voltage,
            insights,
        }
    }

    // ---------- cloud sync feed ----------

    pub fn sync_batch(&self, after_reading_id: i64, limit: i64) -> SyncBatch {
        let conn = self.0.lock().unwrap();
        let vehicles = {
            let mut stmt = conn
                .prepare("SELECT cloud_id, vin, display_name, make, model, year, trim, fuel_price FROM vehicles WHERE cloud_id IS NOT NULL")
                .unwrap();
            let rows = stmt.query_map([], |r| {
                Ok(SyncVehicle {
                    cloud_id: r.get(0)?,
                    vin: r.get(1)?,
                    display_name: r.get(2)?,
                    make: r.get(3)?,
                    model: r.get(4)?,
                    year: r.get(5)?,
                    trim: r.get(6)?,
                    fuel_price: r.get(7)?,
                })
            });
            rows.unwrap().filter_map(Result::ok).collect()
        };
        let connections = {
            let mut stmt = conn
                .prepare(
                    "SELECT c.cloud_id, v.cloud_id, c.device_kind, c.elm_version, c.protocol, c.started_at, c.ended_at
                     FROM connections c JOIN vehicles v ON v.id = c.vehicle_id
                     WHERE c.cloud_id IS NOT NULL AND v.cloud_id IS NOT NULL",
                )
                .unwrap();
            let rows = stmt.query_map([], |r| {
                Ok(SyncConnection {
                    cloud_id: r.get(0)?,
                    vehicle_cloud_id: r.get(1)?,
                    device_kind: r.get(2)?,
                    elm_version: r.get(3)?,
                    protocol: r.get(4)?,
                    started_at: r.get(5)?,
                    ended_at: r.get(6)?,
                })
            });
            rows.unwrap().filter_map(Result::ok).collect()
        };
        let diagnostic_cases = {
            let mut stmt = conn
                .prepare(
                    "SELECT d.cloud_id, v.cloud_id, d.reference, d.status, d.complaint,
                            d.odometer_km, d.assigned_to, d.opened_at, d.updated_at, d.closed_at
                     FROM diagnostic_cases d JOIN vehicles v ON v.id = d.vehicle_id
                     WHERE v.cloud_id IS NOT NULL",
                )
                .unwrap();
            let rows = stmt.query_map([], |r| {
                Ok(SyncDiagnosticCase {
                    cloud_id: r.get(0)?,
                    vehicle_cloud_id: r.get(1)?,
                    reference: r.get(2)?,
                    status: r.get(3)?,
                    complaint: r.get(4)?,
                    odometer_km: r.get(5)?,
                    assigned_to: r.get(6)?,
                    opened_at: r.get(7)?,
                    updated_at: r.get(8)?,
                    closed_at: r.get(9)?,
                })
            });
            rows.unwrap().filter_map(Result::ok).collect()
        };
        let mut scan_events: Vec<SyncScanEvent> = {
            let mut stmt = conn
                .prepare(
                    "SELECT e.id, e.cloud_id, c.cloud_id, v.cloud_id, e.ts, e.mil_on, e.voltage, e.freeze_json
                     FROM dtc_scan_events e
                     JOIN vehicles v ON v.id = e.vehicle_id
                     LEFT JOIN connections c ON c.id = e.connection_id
                     WHERE e.cloud_id IS NOT NULL AND v.cloud_id IS NOT NULL",
                )
                .unwrap();
            let rows = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    SyncScanEvent {
                        cloud_id: r.get(1)?,
                        connection_cloud_id: r.get(2)?,
                        vehicle_cloud_id: r.get(3)?,
                        ts: r.get(4)?,
                        mil_on: r.get(5)?,
                        voltage: r.get(6)?,
                        freeze_json: r.get(7)?,
                        codes: Vec::new(),
                    },
                ))
            });
            let pairs: Vec<(i64, SyncScanEvent)> = rows.unwrap().filter_map(Result::ok).collect();
            pairs
                .into_iter()
                .map(|(event_id, mut ev)| {
                    let mut stmt = conn
                        .prepare("SELECT code, status FROM dtc_codes WHERE scan_event_id = ?1")
                        .unwrap();
                    let codes = stmt
                        .query_map(params![event_id], |r| {
                            Ok(SyncCode {
                                code: r.get(0)?,
                                status: r.get(1)?,
                            })
                        })
                        .unwrap()
                        .filter_map(Result::ok)
                        .collect();
                    ev.codes = codes;
                    ev
                })
                .collect()
        };
        scan_events.sort_by(|a, b| a.ts.cmp(&b.ts));
        let writes = {
            let mut stmt = conn
                .prepare(
                    "SELECT w.cloud_id, c.cloud_id, v.cloud_id, w.ts, w.module, w.action, w.params_json, w.before_json, w.after_json, w.outcome, w.error
                     FROM writes_log w
                     JOIN vehicles v ON v.id = w.vehicle_id
                     LEFT JOIN connections c ON c.id = w.connection_id
                     WHERE w.cloud_id IS NOT NULL AND v.cloud_id IS NOT NULL",
                )
                .unwrap();
            let rows = stmt.query_map([], |r| {
                Ok(SyncWrite {
                    cloud_id: r.get(0)?,
                    connection_cloud_id: r.get(1)?,
                    vehicle_cloud_id: r.get(2)?,
                    ts: r.get(3)?,
                    module: r.get(4)?,
                    action: r.get(5)?,
                    params_json: r.get(6)?,
                    before_json: r.get(7)?,
                    after_json: r.get(8)?,
                    outcome: r.get(9)?,
                    error: r.get(10)?,
                })
            });
            rows.unwrap().filter_map(Result::ok).collect()
        };
        let mut last_reading_id = after_reading_id;
        let readings = {
            let mut stmt = conn
                .prepare(
                    "SELECT r.id, c.cloud_id, v.cloud_id, r.ts, r.key, r.value
                     FROM readings r
                     JOIN connections c ON c.id = r.connection_id
                     JOIN vehicles v ON v.id = r.vehicle_id
                     WHERE r.id > ?1 AND c.cloud_id IS NOT NULL AND v.cloud_id IS NOT NULL
                     ORDER BY r.id LIMIT ?2",
                )
                .unwrap();
            let rows = stmt.query_map(params![after_reading_id, limit], |r| {
                Ok(SyncReading {
                    local_id: r.get(0)?,
                    connection_cloud_id: r.get(1)?,
                    vehicle_cloud_id: r.get(2)?,
                    ts: r.get(3)?,
                    key: r.get(4)?,
                    value: r.get(5)?,
                })
            });
            let list: Vec<SyncReading> = rows.unwrap().filter_map(Result::ok).collect();
            if let Some(max) = list.iter().map(|r| r.local_id).max() {
                last_reading_id = max;
            }
            list
        };
        let probes = {
            let mut stmt = conn
                .prepare(
                    "SELECT p.cloud_id, v.cloud_id, p.module, p.did, p.label, p.unit, p.offset, p.len, p.scale, p.bias, p.enabled, p.origin
                     FROM uds_probes p JOIN vehicles v ON v.id = p.vehicle_id
                     WHERE p.cloud_id IS NOT NULL AND v.cloud_id IS NOT NULL",
                )
                .unwrap();
            stmt.query_map([], |r| {
                Ok(SyncProbe {
                    cloud_id: r.get(0)?,
                    vehicle_cloud_id: r.get(1)?,
                    module: r.get(2)?,
                    did: r.get::<_, i64>(3)? as u16,
                    label: r.get(4)?,
                    unit: r.get(5)?,
                    offset: r.get::<_, i64>(6)? as usize,
                    len: r.get::<_, i64>(7)? as usize,
                    scale: r.get(8)?,
                    bias: r.get(9)?,
                    enabled: r.get(10)?,
                    origin: r.get(11)?,
                })
            })
            .unwrap()
            .filter_map(Result::ok)
            .collect()
        };
        let discovered_modules = {
            let mut stmt = conn
                .prepare(
                    "SELECT m.id, m.cloud_id, v.cloud_id, m.module_address, m.module_name, m.discovered_at,
                            COALESCE(m.last_seen_at, m.discovered_at),
                            m.spare_part_number, m.hardware_version, m.software_version,
                            m.system_name, m.fingerprint_match_key, m.fingerprint_evidence_json
                     FROM discovered_modules m JOIN vehicles v ON v.id = m.vehicle_id
                     WHERE m.cloud_id IS NOT NULL AND v.cloud_id IS NOT NULL",
                )
                .unwrap();
            let rows: Vec<(i64, SyncDiscoveredModule)> = stmt
                .query_map([], |r| {
                    Ok((
                        r.get(0)?,
                        SyncDiscoveredModule {
                            cloud_id: r.get(1)?,
                            vehicle_cloud_id: r.get(2)?,
                            module_address: r.get(3)?,
                            module_name: r.get(4)?,
                            discovered_at: r.get(5)?,
                            last_seen_at: r.get(6)?,
                            spare_part_number: r.get(7)?,
                            hardware_version: r.get(8)?,
                            software_version: r.get(9)?,
                            system_name: r.get(10)?,
                            fingerprint_match_key: r.get(11)?,
                            fingerprint_evidence: r
                                .get::<_, Option<String>>(12)?
                                .and_then(|json| serde_json::from_str(&json).ok()),
                            dids: Vec::new(),
                        },
                    ))
                })
                .unwrap()
                .filter_map(Result::ok)
                .collect();
            rows.into_iter()
                .map(|(module_id, mut module)| {
                    let mut did_stmt = conn
                        .prepare(
                            "SELECT did, raw_sample, byte_length, label, confidence, first_seen_at
                     FROM discovered_dids WHERE module_id = ?1 ORDER BY did",
                        )
                        .unwrap();
                    module.dids = did_stmt
                        .query_map(params![module_id], |r| {
                            Ok(SyncDiscoveredDid {
                                did: r.get::<_, i64>(0)? as u16,
                                raw_sample: r.get(1)?,
                                byte_length: r.get(2)?,
                                label: r.get(3)?,
                                confidence: r.get(4)?,
                                first_seen_at: r.get(5)?,
                            })
                        })
                        .unwrap()
                        .filter_map(Result::ok)
                        .collect();
                    module
                })
                .collect()
        };
        SyncBatch {
            vehicles,
            connections,
            scan_events,
            writes,
            readings,
            probes,
            discovered_modules,
            diagnostic_cases,
            last_reading_id,
        }
    }

    // ---------- misc ----------

    pub fn reading_keys(&self, vehicle_id: Option<i64>) -> Vec<String> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT DISTINCT key FROM readings WHERE vehicle_id IS ?1 ORDER BY key")
            .unwrap();
        stmt.query_map(params![vehicle_id], |r| r.get(0))
            .unwrap()
            .filter_map(Result::ok)
            .collect()
    }

    /// The same keys, each with the probe and module behind it and the newest
    /// timestamp it carries. Two cheap queries: the keys plus their MAX(ts)
    /// (served by idx_readings_vehicle_key_ts) and the discovered module
    /// names. The probe join happens in memory because a probe's reading key
    /// is derived from its label (`UdsProbe::reading_key`), which SQL would
    /// have to spell a second time.
    pub fn reading_key_details(&self, vehicle_id: Option<i64>) -> Vec<ReadingKeyRow> {
        // list_probes takes the same (non-reentrant) lock — call it first.
        let probes = self.list_probes(vehicle_id);
        let conn = self.0.lock().unwrap();
        let mut module_names: BTreeMap<String, String> = BTreeMap::new();
        {
            let mut stmt = conn
                .prepare(
                    "SELECT module_address, module_name FROM discovered_modules
                     WHERE vehicle_id IS ?1 AND module_name IS NOT NULL",
                )
                .unwrap();
            let rows = stmt
                .query_map(params![vehicle_id], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                })
                .unwrap()
                .filter_map(Result::ok);
            for (address, name) in rows {
                module_names.insert(address.to_lowercase().replace('/', "_"), name);
            }
        }
        let mut stmt = conn
            .prepare(
                "SELECT key, MAX(ts) FROM readings WHERE vehicle_id IS ?1
                 GROUP BY key ORDER BY key",
            )
            .unwrap();
        stmt.query_map(params![vehicle_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
        })
        .unwrap()
        .filter_map(Result::ok)
        .map(|(key, last_ts)| match probes.iter().find(|p| p.reading_key() == key) {
            Some(p) => ReadingKeyRow {
                key,
                label: Some(p.label.clone()),
                unit: (!p.unit.is_empty()).then(|| p.unit.clone()),
                module_key: Some(p.module.clone()),
                module_name: module_names.get(&p.module).cloned(),
                source: "probe".into(),
                probe_id: Some(p.id),
                last_ts,
            },
            None => ReadingKeyRow {
                key,
                label: None,
                unit: None,
                module_key: None,
                module_name: Some("Standard".into()),
                source: "standard".into(),
                probe_id: None,
                last_ts,
            },
        })
        .collect()
    }

    pub fn connection_count(&self, vehicle_id: Option<i64>) -> i64 {
        let conn = self.0.lock().unwrap();
        conn.query_row(
            "SELECT COUNT(*) FROM connections WHERE vehicle_id IS ?1",
            params![vehicle_id],
            |r| r.get(0),
        )
        .unwrap_or(0)
    }

    pub fn history(
        &self,
        vehicle_id: Option<i64>,
        key: &str,
        since_hours: f64,
    ) -> Vec<HistoryPoint> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT ts, value FROM readings
                 WHERE vehicle_id IS ?1 AND key = ?2 AND ts >= datetime('now', '-' || ?3 || ' hours')
                 ORDER BY ts",
            )
            .unwrap();
        stmt.query_map(params![vehicle_id, key, since_hours], |r| {
            Ok(HistoryPoint {
                ts: r.get(0)?,
                value: r.get(1)?,
            })
        })
        .unwrap()
        .filter_map(Result::ok)
        .collect()
    }

    /// Everything in a date range as one JSON blob — the export button.
    pub fn export_json(&self, vehicle_id: Option<i64>, since_hours: f64) -> String {
        let readings: Vec<(String, String, f64, Option<i64>)> = {
            let conn = self.0.lock().unwrap();
            let mut stmt = conn
                .prepare(
                    "SELECT ts, key, value, vehicle_id FROM readings
                     WHERE vehicle_id IS ?1 AND ts >= datetime('now', '-' || ?2 || ' hours') ORDER BY ts",
                )
                .unwrap();
            stmt.query_map(params![vehicle_id, since_hours], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })
            .unwrap()
            .filter_map(Result::ok)
            .collect()
        };
        let scans = self.dtc_history(vehicle_id, 100);
        let vehicles: Vec<_> = vehicle_id
            .and_then(|id| self.vehicle(id))
            .into_iter()
            .collect();
        serde_json::json!({
            "vehicles": vehicles,
            "dtc_scans": scans,
            "readings": readings.iter().map(|(ts, k, v, vid)| serde_json::json!({"ts": ts, "key": k, "value": v, "vehicle_id": vid})).collect::<Vec<_>>(),
        })
        .to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db() -> Db {
        // ":memory:" is SQLite's in-memory database name; Db::open passes it
        // through to Connection::open unchanged.
        Db::open(Path::new(":memory:")).expect("in-memory db")
    }

    #[test]
    fn verification_evidence_is_scoped_to_vehicle_and_connection() {
        let db = test_db();
        let (vehicle_id, _) = db.ensure_vehicle("VF7TEST0000000001");
        let connection_id = db.start_connection("ELM327", "test");
        db.link_connection_vehicle(connection_id, vehicle_id);
        let id = db
            .insert_verification_run(
                vehicle_id,
                connection_id,
                "citroen-c41-v1",
                r#"{"targets":[]}"#,
            )
            .unwrap();
        let stored: (i64, i64, String, String) = db
            .0
            .lock()
            .unwrap()
            .query_row(
                "SELECT vehicle_id, connection_id, plan_version, result_json FROM verification_runs WHERE id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(stored.0, vehicle_id);
        assert_eq!(stored.1, connection_id);
        assert_eq!(stored.2, "citroen-c41-v1");
        assert_eq!(stored.3, r#"{"targets":[]}"#);
    }

    #[test]
    fn writes_log_round_trip() {
        let db = test_db();
        let id = db.log_write(
            None,
            None,
            "engine",
            "clear_faults",
            &serde_json::json!({"group": "FFFFFF"}),
            Some(&serde_json::json!(["P0420", "P0301"])),
            Some(&serde_json::json!([])),
            "cleared",
            None,
        );
        assert!(id > 0);
        let rows = db.writes_log(None, 10);
        assert_eq!(rows.len(), 1);
        let row = &rows[0];
        assert_eq!(row.module, "engine");
        assert_eq!(row.action, "clear_faults");
        assert_eq!(row.outcome, "cleared");
        assert_eq!(row.before, Some(serde_json::json!(["P0420", "P0301"])));
        assert_eq!(row.after, Some(serde_json::json!([])));
        assert_eq!(row.error, None);
    }

    #[test]
    fn writes_log_records_failures_too() {
        let db = test_db();
        db.log_write(
            None,
            None,
            "abs",
            "clear_faults",
            &serde_json::json!({}),
            Some(&serde_json::json!(["C1560"])),
            None,
            "error",
            Some("link dropped mid-clear"),
        );
        let rows = db.writes_log(None, 10);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].outcome, "error");
        assert_eq!(rows[0].error.as_deref(), Some("link dropped mid-clear"));
        assert_eq!(rows[0].after, None);
    }

    #[test]
    fn writes_log_newest_first_and_limited() {
        let db = test_db();
        for i in 0..5 {
            db.log_write(
                None,
                None,
                "engine",
                &format!("action_{i}"),
                &serde_json::json!({}),
                None,
                None,
                "cleared",
                None,
            );
        }
        let rows = db.writes_log(None, 3);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].action, "action_4");
    }

    #[test]
    fn writes_log_never_leaks_between_vehicles() {
        let db = test_db();
        let (citroen, _) = db.ensure_vehicle("VR7BAHNSANE014974");
        let (peugeot, _) = db.ensure_vehicle("VF3EXAMPLE0000001");
        db.log_write(
            None,
            Some(citroen),
            "engine",
            "citroen_write",
            &serde_json::json!({}),
            None,
            None,
            "cleared",
            None,
        );
        db.log_write(
            None,
            Some(peugeot),
            "engine",
            "peugeot_write",
            &serde_json::json!({}),
            None,
            None,
            "cleared",
            None,
        );

        let citroen_rows = db.writes_log(Some(citroen), 10);
        assert_eq!(citroen_rows.len(), 1);
        assert_eq!(citroen_rows[0].action, "citroen_write");
        let peugeot_rows = db.writes_log(Some(peugeot), 10);
        assert_eq!(peugeot_rows.len(), 1);
        assert_eq!(peugeot_rows[0].action, "peugeot_write");
    }

    #[test]
    fn history_and_sensor_keys_never_leak_between_vehicles() {
        let db = test_db();
        let (citroen, _) = db.ensure_vehicle("VR7BAHNSANE014974");
        let (peugeot, _) = db.ensure_vehicle("VF3EXAMPLE0000001");
        let c1 = db.start_connection("ELM327", "test");
        db.link_connection_vehicle(c1, citroen);
        db.insert_reading(c1, Some(citroen), "rpm", 800.0);
        let c2 = db.start_connection("ELM327", "test");
        db.link_connection_vehicle(c2, peugeot);
        db.insert_reading(c2, Some(peugeot), "coolant", 90.0);

        assert_eq!(db.reading_keys(Some(citroen)), vec!["rpm"]);
        assert_eq!(db.reading_keys(Some(peugeot)), vec!["coolant"]);
        assert_eq!(db.history(Some(citroen), "rpm", 24.0).len(), 1);
        assert!(db.history(Some(citroen), "coolant", 24.0).is_empty());
    }

    #[test]
    fn reading_key_details_names_probe_keys_and_leaves_standard_ones_bare() {
        let db = test_db();
        let (vehicle, _) = db.ensure_vehicle("VR7EXAMPLE0000001");
        let conn_id = db.start_connection("ELM327", "test");
        db.link_connection_vehicle(conn_id, vehicle);
        db.upsert_discovered_module(vehicle, "6A8/688", Some("Engine ECU"));
        let probe = UdsProbe {
            id: 0,
            vehicle_id: Some(vehicle),
            module: "6a8_688".into(),
            did: 0xD422,
            label: "Steering angle".into(),
            unit: "°".into(),
            offset: 0,
            len: 2,
            scale: 0.1,
            bias: 0.0,
            enabled: true,
            origin: "manual".into(),
            hypothesis_id: None,
        };
        let probe_id = db.add_probe(&probe, Some(vehicle));
        db.insert_reading(conn_id, Some(vehicle), "voltage", 12.6);
        db.insert_reading(conn_id, Some(vehicle), &probe.reading_key(), -3.5);

        let rows = db.reading_key_details(Some(vehicle));
        assert_eq!(
            rows.iter().map(|r| r.key.as_str()).collect::<Vec<_>>(),
            vec!["uds_steering_angle", "voltage"]
        );

        let steering = &rows[0];
        assert_eq!(steering.source, "probe");
        assert_eq!(steering.label.as_deref(), Some("Steering angle"));
        assert_eq!(steering.unit.as_deref(), Some("°"));
        assert_eq!(steering.module_key.as_deref(), Some("6a8_688"));
        assert_eq!(steering.module_name.as_deref(), Some("Engine ECU"));
        assert_eq!(steering.probe_id, Some(probe_id));
        assert!(steering.last_ts.is_some());

        let voltage = &rows[1];
        assert_eq!(voltage.source, "standard");
        assert_eq!(voltage.label, None);
        assert_eq!(voltage.module_key, None);
        assert_eq!(voltage.module_name.as_deref(), Some("Standard"));
        assert_eq!(voltage.probe_id, None);
        assert!(voltage.last_ts.is_some());

        // Another car's keys never appear here, same rule as reading_keys.
        let (other, _) = db.ensure_vehicle("VF3XXXXXXXXXXXXXX");
        assert!(db.reading_key_details(Some(other)).is_empty());
    }

    #[test]
    fn ensure_vehicle_is_get_or_create() {
        let db = test_db();
        let (id1, created1) = db.ensure_vehicle("VR7EXAMPLE0000001");
        let (id2, created2) = db.ensure_vehicle("VR7EXAMPLE0000001");
        assert!(created1);
        assert!(!created2);
        assert_eq!(id1, id2);
        let (id3, created3) = db.ensure_vehicle("VF3XXXXXXXXXXXXXX");
        assert!(created3);
        assert_ne!(id1, id3);
    }

    #[test]
    fn readings_are_scoped_per_vehicle() {
        let db = test_db();
        let (citroen, _) = db.ensure_vehicle("VR7EXAMPLE0000001");
        let (peugeot, _) = db.ensure_vehicle("VF3XXXXXXXXXXXXXX");
        let c1 = db.start_connection("ELM327 v2.3", "vgate_icar_pro");
        db.link_connection_vehicle(c1, citroen);
        let c2 = db.start_connection("ELM327 v2.3", "vgate_icar_pro");
        db.link_connection_vehicle(c2, peugeot);
        db.insert_reading(c1, Some(citroen), "fuel_level", 80.0);
        db.insert_reading(c2, Some(peugeot), "fuel_level", 49.8);
        // The exact live bug from 2026-08-21: the Peugeot's fuel level must
        // NEVER show up in the Citroën's report, and vice versa.
        let citroen_report = db.vehicle_report(citroen);
        let peugeot_report = db.vehicle_report(peugeot);
        assert_eq!(citroen_report.insights.fuel_level_pct, Some(80.0));
        assert_eq!(peugeot_report.insights.fuel_level_pct, Some(49.8));
        assert_eq!(citroen_report.total_readings, 1);
        assert_eq!(peugeot_report.total_readings, 1);
    }

    #[test]
    fn a_pre_v13_database_opens_with_no_hypothesis_link_on_existing_probes() {
        // The v13 column is additive: a database written before the probe /
        // hypothesis link existed must open untouched, with every stored
        // probe still polling on exactly the rule it was saved under.
        let path = std::env::temp_dir().join(format!(
            "scainner-v11-migration-{}.sqlite3",
            uuid::Uuid::new_v4()
        ));
        {
            let conn = Connection::open(&path).expect("v11 fixture");
            conn.execute_batch(
                r#"
                CREATE TABLE uds_probes (
                    id INTEGER PRIMARY KEY,
                    vehicle_id INTEGER,
                    module TEXT NOT NULL,
                    did INTEGER NOT NULL,
                    label TEXT NOT NULL,
                    unit TEXT NOT NULL DEFAULT '',
                    offset INTEGER NOT NULL DEFAULT 0,
                    len INTEGER NOT NULL DEFAULT 1,
                    scale REAL NOT NULL DEFAULT 1.0,
                    bias REAL NOT NULL DEFAULT 0.0,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    origin TEXT NOT NULL DEFAULT 'manual',
                    cloud_id TEXT
                );
                INSERT INTO uds_probes (module, did, label, unit, len, scale, cloud_id)
                    VALUES ('engine', 54306, 'Battery voltage', 'V', 2, 0.01, 'existing-cloud-id');
                PRAGMA user_version = 11;
                "#,
            )
            .expect("v11 fixture schema");
        }

        let db = Db::open(&path).expect("a v11 database must open, not be refused");
        let version: i64 =
            db.0.lock()
                .unwrap()
                .query_row("PRAGMA user_version", [], |r| r.get(0))
                .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
        let probes = db.list_probes(None);
        assert_eq!(probes.len(), 1, "the existing probe survived the migration");
        assert_eq!(probes[0].label, "Battery voltage");
        assert_eq!(probes[0].origin, "manual");
        assert_eq!(
            probes[0].hypothesis_id, None,
            "nothing owns a probe that predates the link"
        );
        drop(db);
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
        }
    }

    #[test]
    fn probes_are_scoped_per_vehicle() {
        // A probe found on one car (e.g. auto-discovery on a Kona) must
        // never be attempted on another (e.g. a Peugeot) — the same cross-
        // car isolation every other table already has since schema v2.
        let db = test_db();
        let (citroen, _) = db.ensure_vehicle("VR7EXAMPLE0000001");
        let (peugeot, _) = db.ensure_vehicle("VF3XXXXXXXXXXXXXX");
        let probe = UdsProbe {
            id: 0,
            vehicle_id: None,
            module: "engine".into(),
            did: 0xD422,
            label: "Battery voltage".into(),
            unit: "V".into(),
            offset: 0,
            len: 2,
            scale: 0.01,
            bias: 0.0,
            enabled: true,
            origin: "manual".into(),
            hypothesis_id: None,
        };
        db.add_probe(&probe, Some(citroen));
        let citroen_probes = db.list_probes(Some(citroen));
        let peugeot_probes = db.list_probes(Some(peugeot));
        assert_eq!(citroen_probes.len(), 1);
        assert!(
            peugeot_probes.is_empty(),
            "a Citroën-scoped probe leaked onto the Peugeot"
        );
    }

    #[test]
    fn legacy_global_probes_still_poll_on_every_car() {
        // Probes saved before per-vehicle scoping existed have vehicle_id
        // NULL — they must keep working everywhere, not silently vanish.
        let db = test_db();
        let (citroen, _) = db.ensure_vehicle("VR7EXAMPLE0000001");
        let (peugeot, _) = db.ensure_vehicle("VF3XXXXXXXXXXXXXX");
        let probe = UdsProbe {
            id: 0,
            vehicle_id: None,
            module: "engine".into(),
            did: 0xD422,
            label: "Battery voltage".into(),
            unit: "V".into(),
            offset: 0,
            len: 2,
            scale: 0.01,
            bias: 0.0,
            enabled: true,
            origin: "manual".into(),
            hypothesis_id: None,
        };
        db.add_probe(&probe, None); // legacy path: no vehicle scope
        assert_eq!(db.list_probes(Some(citroen)).len(), 1);
        assert_eq!(db.list_probes(Some(peugeot)).len(), 1);
        assert_eq!(db.list_probes(None).len(), 1);
    }

    #[test]
    fn discovery_promotion_upserts_instead_of_duplicating() {
        // Re-running discovery on the same car must refresh the probe's
        // formula, not pile up a second row for the same DID.
        let db = test_db();
        let (citroen, _) = db.ensure_vehicle("VR7EXAMPLE0000001");
        let first = db.upsert_probe_from_discovery(
            citroen,
            "engine",
            0xD422,
            "Battery voltage",
            "V",
            0,
            2,
            0.01,
            0.0,
        );
        let second = db.upsert_probe_from_discovery(
            citroen,
            "engine",
            0xD422,
            "Battery voltage (refined)",
            "V",
            0,
            2,
            0.02,
            0.0,
        );
        assert!(first, "first pass should insert");
        assert!(!second, "second pass should update, not insert");
        let probes = db.list_probes(Some(citroen));
        assert_eq!(probes.len(), 1);
        assert_eq!(probes[0].label, "Battery voltage (refined)");
        assert_eq!(probes[0].scale, 0.02);
        assert_eq!(probes[0].origin, "discovery");
    }

    #[test]
    fn partial_ecu_fingerprint_updates_the_existing_module() {
        let db = test_db();
        let (vehicle, _) = db.ensure_vehicle("VR7EXAMPLE0000001");
        let module = db.upsert_discovered_module(vehicle, "6A8/688", Some("Engine ECU"));
        let fingerprint = crate::elm::uds::EcuFingerprint {
            request_address: "6A8".into(),
            response_address: "688".into(),
            spare_part_number: Some("981234".into()),
            hardware_version: None,
            software_version: Some("SW12".into()),
            system_name: None,
            supplier: None,
            match_key: Some("part=981234|sw=SW12".into()),
            fields_answered: 2,
            fields_total: 4,
            evidence: Vec::new(),
        };

        db.update_ecu_fingerprint(module, &fingerprint);
        db.update_ecu_fingerprint(
            module,
            &crate::elm::uds::EcuFingerprint {
                request_address: "6A8".into(),
                response_address: "688".into(),
                spare_part_number: None,
                hardware_version: None,
                software_version: None,
                system_name: None,
                supplier: None,
                match_key: None,
                fields_answered: 0,
                fields_total: 4,
                evidence: Vec::new(),
            },
        );

        let modules = db.discovered_summary(vehicle);
        assert_eq!(modules.len(), 1);
        assert_eq!(modules[0].spare_part_number.as_deref(), Some("981234"));
        assert_eq!(modules[0].fingerprint_fields_answered, 2);
        assert_eq!(
            modules[0].fingerprint_match_key.as_deref(),
            Some("part=981234|sw=SW12")
        );
    }

    #[test]
    fn fingerprint_experiment_matches_part_numbers_across_vehicles_without_vins() {
        let db = test_db();
        for (vin, address, part) in [
            ("VR7EXAMPLE0000001", "6A8/688", "98 12-34"),
            ("VF3EXAMPLE0000002", "7E0/7E8", "981234"),
            ("TMAEXAMPLE0000003", "7E1/7E9", "OTHER-99"),
        ] {
            let (vehicle, _) = db.ensure_vehicle(vin);
            let module = db.upsert_discovered_module(vehicle, address, None);
            db.update_ecu_fingerprint(
                module,
                &crate::elm::uds::EcuFingerprint {
                    request_address: address.split('/').next().unwrap().into(),
                    response_address: address.split('/').nth(1).unwrap().into(),
                    spare_part_number: Some(part.into()),
                    hardware_version: None,
                    software_version: None,
                    system_name: None,
                    supplier: None,
                    match_key: Some(format!("part={part}")),
                    fields_answered: 1,
                    fields_total: 4,
                    evidence: Vec::new(),
                },
            );
        }

        let report = db.fingerprint_experiment();
        assert_eq!(report.vehicles_scanned, 3);
        assert_eq!(report.vehicles_with_fingerprints, 3);
        assert_eq!(report.repeated_family_groups, 1);
        assert_eq!(report.vehicles_with_repeated_family, 2);
        assert_eq!(report.match_groups[0].family_key, "981234");
        let export = serde_json::to_string(&report).unwrap();
        assert!(!export.contains("VR7EXAMPLE"));
        assert!(export.contains("vehicle_001"));
    }

    #[test]
    fn vehicle_map_separates_observed_modules_from_unscanned_module_faults() {
        let db = test_db();
        let (vehicle, _) = db.ensure_vehicle("VR7EXAMPLE0000001");
        let module = db.upsert_discovered_module(vehicle, "6A8/688", Some("Engine ECU"));
        db.0.lock()
            .unwrap()
            .execute(
                "UPDATE discovered_modules SET discovered_at = '2020-01-01 00:00:00',
                 last_seen_at = '2020-01-01 00:00:00' WHERE id = ?1",
                params![module],
            )
            .unwrap();
        assert_eq!(
            db.upsert_discovered_module(vehicle, "6A8/688", None),
            module
        );
        db.upsert_discovered_did(module, 0x1234, "0102", 2, None);
        db.insert_dtc_scan(
            None,
            Some(vehicle),
            true,
            &["P0301".into()],
            &[],
            &[],
            Some(12.4),
            None,
        );

        let map = db.vehicle_evidence_map(vehicle);
        assert_eq!(map.evidence_scope, "persisted_observations");
        assert_eq!(map.modules.len(), 1);
        assert_eq!(map.modules[0].presence, "previously_reached");
        assert_eq!(map.modules[0].first_seen_at, "2020-01-01 00:00:00");
        assert_ne!(map.modules[0].last_seen_at, map.modules[0].first_seen_at);
        assert_eq!(map.modules[0].module_fault_evidence, "not_scanned");
        assert_eq!(map.modules[0].dids[0].did, 0x1234);
        assert_eq!(map.latest_standard_faults.unwrap().stored, vec!["P0301"]);
    }

    #[test]
    fn discovery_never_rewrites_or_deletes_a_manual_probe() {
        let db = test_db();
        let (citroen, _) = db.ensure_vehicle("VR7EXAMPLE0000001");
        let manual = UdsProbe {
            id: 0,
            vehicle_id: Some(citroen),
            module: "engine".into(),
            did: 0xD422,
            label: "My voltage formula".into(),
            unit: "V".into(),
            offset: 0,
            len: 2,
            scale: 0.02,
            bias: 0.0,
            enabled: true,
            origin: "manual".into(),
            hypothesis_id: None,
        };
        let id = db.add_probe(&manual, Some(citroen));

        assert!(!db.upsert_probe_from_discovery(
            citroen,
            "engine",
            0xD422,
            "Mapped voltage",
            "V",
            0,
            2,
            0.01,
            0.0
        ));
        assert!(!db.delete_discovery_probe(id));
        let probes = db.list_probes(Some(citroen));
        assert_eq!(probes.len(), 1);
        assert_eq!(probes[0].label, "My voltage formula");
        assert_eq!(probes[0].origin, "manual");
    }

    #[test]
    fn stale_discovery_probe_can_be_removed_by_provenance() {
        let db = test_db();
        let (citroen, _) = db.ensure_vehicle("VR7EXAMPLE0000001");
        assert!(db.upsert_probe_from_discovery(
            citroen,
            "engine",
            0xD422,
            "Battery voltage",
            "V",
            0,
            2,
            0.01,
            0.0
        ));
        let auto = db.list_probes(Some(citroen)).pop().unwrap();
        assert_eq!(auto.origin, "discovery");
        assert!(db.delete_discovery_probe(auto.id));
        assert!(db.list_probes(Some(citroen)).is_empty());
    }

    #[test]
    fn rediscovery_clears_a_label_the_current_map_no_longer_supports() {
        let db = test_db();
        let (citroen, _) = db.ensure_vehicle("VR7EXAMPLE0000001");
        let module = db.upsert_discovered_module(citroen, "6A8/688", Some("Engine ECU"));
        db.upsert_discovered_did(module, 0xD410, "20", 1, Some("Incorrect battery SOC"));
        db.upsert_discovered_did(module, 0xD410, "21", 1, None);

        let dids = db.discovered_dids(module);
        assert_eq!(dids.len(), 1);
        assert_eq!(dids[0].raw_sample.as_deref(), Some("21"));
        assert_eq!(dids[0].label, None);
        assert_eq!(dids[0].confidence.as_deref(), Some("unlabeled"));
    }

    #[test]
    fn unidentified_connection_stays_unattributed_until_named() {
        let db = test_db();
        let (citroen, _) = db.ensure_vehicle("VR7EXAMPLE0000001");
        let c_known = db.start_connection("ELM327 v2.3", "vgate_icar_pro");
        db.link_connection_vehicle(c_known, citroen);
        db.insert_reading(c_known, Some(citroen), "rpm", 800.0);
        // A VIN-less car connects: readings recorded with NULL vehicle_id.
        let c_unknown = db.start_connection("ELM327 v2.3", "vgate_icar_pro");
        db.insert_reading(c_unknown, None, "rpm", 900.0);
        db.insert_dtc_scan(
            Some(c_unknown),
            None,
            true,
            &["P0204".into()],
            &[],
            &[],
            Some(13.5),
            None,
        );
        // Nothing leaks into the Citroën.
        let report = db.vehicle_report(citroen);
        assert_eq!(report.total_readings, 1);
        assert_eq!(report.scans_total, 0);
        // Unidentified scan history is its own bucket, not the Citroën's.
        assert_eq!(db.dtc_history(Some(citroen), 10).len(), 0);
        assert_eq!(db.dtc_history(None, 10).len(), 1);
        // The user names the car -> everything already recorded is claimed.
        let peugeot = db.create_vehicle_named("Peugeot viejo");
        db.link_connection_vehicle(c_unknown, peugeot);
        let named_report = db.vehicle_report(peugeot);
        assert_eq!(named_report.total_readings, 1);
        assert_eq!(named_report.scans_total, 1);
        assert_eq!(named_report.display_name.as_deref(), Some("Peugeot viejo"));
        assert_eq!(db.dtc_history(Some(peugeot), 10).len(), 1);
        assert_eq!(db.dtc_history(None, 10).len(), 0);
    }

    #[test]
    fn scans_clean_counts_per_vehicle() {
        let db = test_db();
        let (v, _) = db.ensure_vehicle("VR7EXAMPLE0000001");
        let c = db.start_connection("ELM327 v2.3", "vgate_icar_pro");
        db.link_connection_vehicle(c, v);
        db.insert_dtc_scan(Some(c), Some(v), false, &[], &[], &[], Some(13.1), None);
        db.insert_dtc_scan(
            Some(c),
            Some(v),
            true,
            &["P0420".into()],
            &[],
            &[],
            Some(13.0),
            None,
        );
        let report = db.vehicle_report(v);
        assert_eq!(report.scans_total, 2);
        assert_eq!(report.scans_clean, 1);
        // Round-trips through the per-code table back into arrays.
        let history = db.dtc_history(Some(v), 10);
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].stored, vec!["P0420".to_string()]);
        assert!(history[1].stored.is_empty());
    }

    #[test]
    fn sync_batch_only_ships_identified_rows_and_advances_watermark() {
        let db = test_db();
        let (v, _) = db.ensure_vehicle("VR7EXAMPLE0000001");
        let c = db.start_connection("ELM327 v2.3", "vgate_icar_pro");
        db.link_connection_vehicle(c, v);
        db.insert_reading(c, Some(v), "rpm", 800.0);
        db.insert_reading(c, Some(v), "rpm", 810.0);
        db.insert_dtc_scan(
            Some(c),
            Some(v),
            true,
            &["P0420".into()],
            &[],
            &[],
            Some(13.1),
            None,
        );
        let module_id = db.upsert_discovered_module(v, "6A8/688", Some("Engine ECU"));
        db.upsert_discovered_did(module_id, 0xD422, "05 78", 2, Some("Battery voltage"));
        db.upsert_probe_from_discovery(
            v,
            "engine",
            0xD422,
            "Battery voltage",
            "V",
            0,
            2,
            0.01,
            0.0,
        );
        db.create_diagnostic_case(v, "MIL illuminated", Some(128_400), Some("Alex"))
            .unwrap();
        // An unidentified connection: its rows must NOT ship (the cloud's
        // RLS rejects NULL-vehicle facts by design).
        let c2 = db.start_connection("ELM327 v2.3", "vgate_icar_pro");
        db.insert_reading(c2, None, "rpm", 900.0);
        let batch = db.sync_batch(0, 100);
        assert_eq!(batch.vehicles.len(), 1);
        assert_eq!(batch.connections.len(), 1);
        assert_eq!(batch.readings.len(), 2);
        assert_eq!(batch.scan_events.len(), 1);
        assert_eq!(batch.scan_events[0].codes.len(), 1);
        assert_eq!(batch.probes.len(), 1);
        assert_eq!(batch.discovered_modules.len(), 1);
        assert_eq!(batch.discovered_modules[0].dids.len(), 1);
        assert_eq!(batch.diagnostic_cases.len(), 1);
        assert_eq!(batch.diagnostic_cases[0].reference, "JOB-0001");
        assert_eq!(
            batch.diagnostic_cases[0].vehicle_cloud_id,
            batch.vehicles[0].cloud_id
        );
        assert!(batch.last_reading_id >= 2);
        // Idempotent watermark: nothing new past the watermark.
        let empty = db.sync_batch(batch.last_reading_id, 100);
        assert!(empty.readings.is_empty());
        assert_eq!(empty.last_reading_id, batch.last_reading_id);
        // Every shipped row carries a cloud id.
        assert!(!batch.vehicles[0].cloud_id.is_empty());
        assert!(!batch.connections[0].cloud_id.is_empty());
        assert!(!batch.scan_events[0].cloud_id.is_empty());
    }

    #[test]
    fn fuel_price_is_per_vehicle() {
        let db = test_db();
        let (a, _) = db.ensure_vehicle("VR7EXAMPLE0000001");
        let (b, _) = db.ensure_vehicle("VF3XXXXXXXXXXXXXX");
        db.set_fuel_price(a, 1.62);
        assert_eq!(db.vehicle_report(a).insights.fuel_price, 1.62);
        assert_eq!(db.vehicle_report(b).insights.fuel_price, 1.50); // default untouched
    }

    #[test]
    fn diagnostic_cases_are_vehicle_scoped_and_numbered() {
        let db = test_db();
        let (citroen, _) = db.ensure_vehicle("VR7EXAMPLE0000001");
        let (peugeot, _) = db.ensure_vehicle("VF3XXXXXXXXXXXXXX");

        let first = db
            .create_diagnostic_case(
                citroen,
                "Engine warning under load",
                Some(128_400),
                Some("Alex"),
            )
            .unwrap();
        let second = db
            .create_diagnostic_case(citroen, "Intermittent no-start", None, None)
            .unwrap();
        db.create_diagnostic_case(peugeot, "ABS warning", Some(201_000), None)
            .unwrap();

        assert_eq!(first.reference, "JOB-0001");
        assert_eq!(second.reference, "JOB-0002");
        assert_eq!(first.status, "open");
        assert_eq!(first.assigned_to.as_deref(), Some("Alex"));
        assert_eq!(db.diagnostic_cases(Some(citroen)).len(), 2);
        assert_eq!(db.diagnostic_cases(Some(peugeot)).len(), 1);
        assert_eq!(db.diagnostic_cases(None).len(), 3);
    }

    #[test]
    fn diagnostic_case_requires_a_real_complaint() {
        let db = test_db();
        let (vehicle, _) = db.ensure_vehicle("VR7EXAMPLE0000001");
        assert!(db
            .create_diagnostic_case(vehicle, "   ", None, None)
            .is_err());
        assert!(db
            .create_diagnostic_case(vehicle, "Noise", Some(-1), None)
            .is_err());
        assert!(db.diagnostic_cases(Some(vehicle)).is_empty());
    }

    #[test]
    fn hypotheses_are_unique_per_vehicle_module_did_and_samples_are_retained_newest_first() {
        let db = test_db();
        let (vehicle, _) = db.ensure_vehicle("VR7EXAMPLE0000001");
        let module = db.upsert_discovered_module(vehicle, "6AD/68D", None);
        let upsert = HypothesisUpsert {
            vehicle_id: vehicle,
            module_id: module,
            did: 0xD400,
            knowledge_state: "unknown".into(),
            ..Default::default()
        };
        let (id, created) = db.upsert_hypothesis(&upsert);
        assert!(created);
        let (again, created) = db.upsert_hypothesis(&HypothesisUpsert {
            label: Some("Wheel speed rear-left".into()),
            ..upsert.clone()
        });
        assert_eq!((again, created), (id, false));
        assert_eq!(db.list_hypotheses(vehicle).len(), 1);
        assert_eq!(
            db.hypothesis(id).unwrap().label.as_deref(),
            Some("Wheel speed rear-left")
        );

        // The production constant is 5000; the rule is exercised with a
        // small window so the suite stays fast.
        assert_eq!(HYPOTHESIS_SAMPLE_RETENTION, 5000);
        let keep = 50;
        for ts in 0..(keep + 7) {
            db.insert_hypothesis_sample_keeping(id, ts, "00 00", None, keep);
        }
        let samples = db.hypothesis_samples(id, 10);
        assert_eq!(samples[0].ts_ms, keep + 6);
        assert_eq!(db.hypothesis(id).unwrap().sample_count, keep);
        assert!(db
            .hypothesis_samples(id, 10_000)
            .iter()
            .all(|s| s.ts_ms >= 7));
    }

    #[test]
    fn patching_a_hypothesis_enforces_the_activation_rules_and_rejects_bad_values() {
        let db = test_db();
        let (vehicle, _) = db.ensure_vehicle("VR7EXAMPLE0000001");
        let module = db.upsert_discovered_module(vehicle, "6AD/68D", None);
        let (id, _) = db.upsert_hypothesis(&HypothesisUpsert {
            vehicle_id: vehicle,
            module_id: module,
            did: 0xD400,
            knowledge_state: "unknown".into(),
            ..Default::default()
        });
        let enable = HypothesisPatch {
            activation: Some("enabled".into()),
            ..Default::default()
        };
        let err = db.patch_hypothesis(id, &enable, false).unwrap_err();
        assert_eq!(err.rule, "enabled_requires_matched");
        let learn = HypothesisPatch {
            activation: Some("learning".into()),
            ..Default::default()
        };
        assert_eq!(
            db.patch_hypothesis(id, &learn, false).unwrap_err().rule,
            "learning_requires_learning_state"
        );
        assert_eq!(
            db.patch_hypothesis(id, &learn, true)
                .unwrap()
                .unwrap()
                .activation,
            "learning"
        );
        let bad = HypothesisPatch {
            vehicle_fit: Some("maybe".into()),
            ..Default::default()
        };
        assert_eq!(
            db.patch_hypothesis(id, &bad, true).unwrap_err().rule,
            "unknown_state_value"
        );
        // Confirming the decode needs the run that discriminated it.
        let connection = db.start_connection("ELM327", "test");
        db.link_connection_vehicle(connection, vehicle);
        let run = db
            .insert_verification_run(vehicle, connection, "corr-v1", "{}")
            .unwrap();
        let confirm = HypothesisPatch {
            vehicle_fit: Some("matched".into()),
            activation: Some("enabled".into()),
            knowledge_state: Some("locally_confirmed".into()),
            label: Some("Wheel speed RL".into()),
            evidence_run_ids: Some(vec![run]),
        };
        let row = db.patch_hypothesis(id, &confirm, false).unwrap().unwrap();
        assert_eq!(
            (
                row.vehicle_fit.as_str(),
                row.activation.as_str(),
                row.knowledge_state.as_str()
            ),
            ("matched", "enabled", "locally_confirmed")
        );
        assert!(db.patch_hypothesis(999, &confirm, false).unwrap().is_none());
    }

    /// The knowledge dimension is gated the way activation is: a promotion
    /// to a confirmed state has to name the evidence, and the evidence has
    /// to belong to this car.
    #[test]
    fn promoting_knowledge_requires_this_vehicles_discriminating_runs() {
        let db = test_db();
        let (vehicle, _) = db.ensure_vehicle("VR7EXAMPLE0000002");
        let connection = db.start_connection("ELM327", "test");
        db.link_connection_vehicle(connection, vehicle);
        let module = db.upsert_discovered_module(vehicle, "6AD/68D", None);
        let (id, _) = db.upsert_hypothesis(&HypothesisUpsert {
            vehicle_id: vehicle,
            module_id: module,
            did: 0xD400,
            knowledge_state: "inherited".into(),
            ..Default::default()
        });
        // Another car's evidence, recorded before this one's.
        let (other_vehicle, _) = db.ensure_vehicle("VR7EXAMPLE0000003");
        let other_connection = db.start_connection("ELM327", "test");
        db.link_connection_vehicle(other_connection, other_vehicle);
        let other_run = db
            .insert_verification_run(other_vehicle, other_connection, "corr-v1", "{}")
            .unwrap();
        let run = db
            .insert_verification_run(vehicle, connection, "corr-v1", "{}")
            .unwrap();

        // Matched, but nothing to point at.
        let bare = HypothesisPatch {
            knowledge_state: Some("locally_confirmed".into()),
            vehicle_fit: Some("matched".into()),
            ..Default::default()
        };
        assert_eq!(
            db.patch_hypothesis(id, &bare, false).unwrap_err().rule,
            "locally_confirmed_requires_evidence"
        );
        // A run, but this car never matched the decode.
        let unmatched = HypothesisPatch {
            knowledge_state: Some("locally_confirmed".into()),
            evidence_run_ids: Some(vec![run]),
            ..Default::default()
        };
        assert_eq!(
            db.patch_hypothesis(id, &unmatched, false).unwrap_err().rule,
            "locally_confirmed_requires_evidence"
        );
        // Someone else's run proves nothing here.
        let borrowed = HypothesisPatch {
            evidence_run_ids: Some(vec![other_run]),
            ..bare.clone()
        };
        assert_eq!(
            db.patch_hypothesis(id, &borrowed, false).unwrap_err().rule,
            "evidence_run_not_found"
        );
        // Fleet knowledge never starts on one car.
        for fleet in ["community_verified", "oem_confirmed"] {
            let patch = HypothesisPatch {
                knowledge_state: Some(fleet.into()),
                evidence_run_ids: Some(vec![run]),
                ..bare.clone()
            };
            assert_eq!(
                db.patch_hypothesis(id, &patch, false).unwrap_err().rule,
                "fleet_state_not_settable_locally"
            );
        }
        // Nothing was written while the rules refused.
        assert_eq!(db.hypothesis(id).unwrap().knowledge_state, "inherited");
        assert!(db.hypothesis(id).unwrap().evidence.is_none());

        let confirmed = HypothesisPatch {
            evidence_run_ids: Some(vec![run]),
            ..bare.clone()
        };
        let row = db.patch_hypothesis(id, &confirmed, false).unwrap().unwrap();
        assert_eq!(row.knowledge_state, "locally_confirmed");
        assert_eq!(row.evidence.unwrap().run_ids, vec![run]);
        // An unrelated patch leaves the evidence where it is.
        let relabel = HypothesisPatch {
            label: Some("Wheel speed RL".into()),
            ..Default::default()
        };
        let row = db.patch_hypothesis(id, &relabel, false).unwrap().unwrap();
        assert_eq!(row.evidence.unwrap().run_ids, vec![run]);
    }

    #[test]
    fn retracting_a_confirmation_drops_the_evidence_behind_it() {
        let db = test_db();
        let (vehicle, _) = db.ensure_vehicle("VR7EXAMPLE0000004");
        let connection = db.start_connection("ELM327", "test");
        db.link_connection_vehicle(connection, vehicle);
        let module = db.upsert_discovered_module(vehicle, "6AD/68D", None);
        let (id, _) = db.upsert_hypothesis(&HypothesisUpsert {
            vehicle_id: vehicle,
            module_id: module,
            did: 0xD400,
            knowledge_state: "unknown".into(),
            ..Default::default()
        });
        let run = db
            .insert_verification_run(vehicle, connection, "corr-v1", "{}")
            .unwrap();
        let row = db
            .patch_hypothesis(
                id,
                &HypothesisPatch {
                    knowledge_state: Some("locally_confirmed".into()),
                    vehicle_fit: Some("matched".into()),
                    evidence_run_ids: Some(vec![run]),
                    ..Default::default()
                },
                false,
            )
            .unwrap()
            .unwrap();
        assert_eq!(row.evidence.unwrap().run_ids, vec![run]);

        // A human demotion is allowed and takes the evidence with it.
        let row = db
            .patch_hypothesis(
                id,
                &HypothesisPatch {
                    knowledge_state: Some("research_candidate".into()),
                    ..Default::default()
                },
                false,
            )
            .unwrap()
            .unwrap();
        assert_eq!(row.knowledge_state, "research_candidate");
        assert!(row.evidence.is_none());
        let stored: Option<String> =
            db.0.lock()
                .unwrap()
                .query_row(
                    "SELECT evidence_json FROM hypotheses WHERE id = ?1",
                    params![id],
                    |r| r.get(0),
                )
                .unwrap();
        assert!(stored.is_none());
    }

    /// A database written before v12 opens with the evidence column and with
    /// the projected state moved into the protocol's vocabulary.
    #[test]
    fn a_pre_v12_database_gains_evidence_and_the_protocol_vocabulary() {
        let path =
            std::env::temp_dir().join(format!("scainner-v11-{}.sqlite3", uuid::Uuid::new_v4()));
        {
            let db = Db::open(&path).expect("fresh db");
            let conn = db.0.lock().unwrap();
            // Wind the file back to the v11 shape.
            conn.execute_batch(
                "ALTER TABLE hypotheses DROP COLUMN evidence_json;
                 INSERT INTO knowledge_candidates
                     (compatibility_key, scope, module_address, did, knowledge_state)
                 VALUES ('family:example', 'ecu_family', '6AD/68D', 54272, 'observed');
                 PRAGMA user_version = 11;",
            )
            .unwrap();
        }
        let db = Db::open(&path).expect("reopened db");
        let conn = db.0.lock().unwrap();
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
        let state: String = conn
            .query_row(
                "SELECT knowledge_state FROM knowledge_candidates WHERE compatibility_key = 'family:example'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(state, "unknown");
        assert!(crate::elm::discovery::state::KnowledgeState::parse(&state).is_some());
        let has_evidence_column: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('hypotheses') WHERE name = 'evidence_json'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(has_evidence_column, 1);
        drop(conn);
        drop(db);
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
        }
    }

    #[test]
    fn reusable_knowledge_is_immediate_deidentified_and_survives_vehicle_deletion() {
        let db = test_db();
        let (vehicle, _) = db.ensure_vehicle("VR7PRIVATE00000001");
        let connection = db.start_connection("1.0", "vlink");
        db.set_connection_protocol(connection, "CAN");
        db.link_connection_vehicle(connection, vehicle);
        db.insert_reading(connection, Some(vehicle), "speed", 42.0);
        db.insert_dtc_scan(
            Some(connection),
            Some(vehicle),
            false,
            &["P1234".into()],
            &[],
            &[],
            None,
            None,
        );
        let module = db.upsert_discovered_module(vehicle, "6AD/68D", Some("ABS"));
        {
            let conn = db.0.lock().unwrap();
            conn.execute(
                "UPDATE discovered_modules SET family_id = 'cont_esp_mk100_psa',
                 supplier = 'Continental', spare_part_number = '9846124980',
                 hardware_version = '9820609380', software_version = '9695041580'
                 WHERE id = ?1",
                params![module],
            )
            .unwrap();
        }
        db.upsert_discovered_did(module, 0xD400, "0F A0", 2, None);
        let (hypothesis, _) = db.upsert_hypothesis(&HypothesisUpsert {
            vehicle_id: vehicle,
            module_id: module,
            did: 0xD400,
            knowledge_state: "unknown".into(),
            label: Some("Wheel speed".into()),
            decode_json: Some(r#"{"scale":0.01,"unit":"km/h"}"#.into()),
            family_id: Some("cont_esp_mk100_psa".into()),
            ..Default::default()
        });
        let run = db
            .insert_verification_run(vehicle, connection, "corr-v1", "{}")
            .unwrap();
        db.patch_hypothesis(
            hypothesis,
            &HypothesisPatch {
                knowledge_state: Some("locally_confirmed".into()),
                vehicle_fit: Some("matched".into()),
                activation: Some("enabled".into()),
                label: None,
                evidence_run_ids: Some(vec![run]),
            },
            false,
        )
        .unwrap();

        let learned = db.knowledge_candidates();
        assert_eq!(learned.len(), 1);
        assert_eq!(learned[0].scope, "ecu_family");
        assert_eq!(learned[0].knowledge_state, "locally_confirmed");
        assert_eq!(learned[0].label.as_deref(), Some("Wheel speed"));

        // A later unvalidated observation from another compatible car
        // deduplicates into the family row and cannot downgrade confirmation.
        let (second_vehicle, _) = db.ensure_vehicle("VR7SECOND00000001");
        let second_module = db.upsert_discovered_module(second_vehicle, "6AD/68D", Some("ABS"));
        db.set_module_family(second_module, Some("cont_esp_mk100_psa"), "strong");
        db.upsert_discovered_did(second_module, 0xD400, "00 00", 2, None);
        db.upsert_hypothesis(&HypothesisUpsert {
            vehicle_id: second_vehicle,
            module_id: second_module,
            did: 0xD400,
            knowledge_state: "unknown".into(),
            family_id: Some("cont_esp_mk100_psa".into()),
            ..Default::default()
        });
        assert_eq!(db.knowledge_candidates().len(), 1);
        assert_eq!(
            db.knowledge_candidates()[0].knowledge_state,
            "locally_confirmed"
        );

        // Enforce the privacy boundary structurally, not only by convention.
        let private_columns = {
            let conn = db.0.lock().unwrap();
            let mut stmt = conn
                .prepare("PRAGMA table_info(knowledge_candidates)")
                .unwrap();
            stmt.query_map([], |r| r.get::<_, String>(1))
                .unwrap()
                .filter_map(Result::ok)
                .collect::<Vec<_>>()
        };
        for forbidden in [
            "vehicle_id",
            "connection_id",
            "vin",
            "serial",
            "dtc",
            "raw_sample",
            "payload_hex",
        ] {
            assert!(!private_columns.iter().any(|column| column == forbidden));
        }

        assert!(db.delete_vehicle_private_data(vehicle));
        assert!(db.vehicle(vehicle).is_none());
        assert!(db.list_hypotheses(vehicle).is_empty());
        assert!(db.dtc_history(Some(vehicle), 10).is_empty());
        assert_eq!(db.knowledge_candidates().len(), 1);
        assert_eq!(
            db.knowledge_candidates()[0].family_id.as_deref(),
            Some("cont_esp_mk100_psa")
        );
    }
}
