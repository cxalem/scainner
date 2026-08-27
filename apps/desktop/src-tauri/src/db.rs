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

const SCHEMA_VERSION: i64 = 9;

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
}

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
                origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual','discovery'))
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
             fingerprint_evidence_json = ?5
             WHERE id = ?6",
            params![
                fingerprint.spare_part_number,
                fingerprint.hardware_version,
                fingerprint.software_version,
                fingerprint.system_name,
                evidence,
                module_id,
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
                        CASE WHEN m.system_name IS NOT NULL THEN 1 ELSE 0 END
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
            })
        })
        .unwrap()
        .filter_map(Result::ok)
        .collect()
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
                "SELECT id, vehicle_id, module, did, label, unit, offset, len, scale, bias, enabled, origin
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
            })
        })
        .unwrap()
        .filter_map(Result::ok)
        .collect()
    }

    pub fn add_probe(&self, p: &UdsProbe, vehicle_id: Option<i64>) -> i64 {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "INSERT INTO uds_probes (vehicle_id, module, did, label, unit, offset, len, scale, bias, enabled, origin, cloud_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'manual', ?11)",
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
}
