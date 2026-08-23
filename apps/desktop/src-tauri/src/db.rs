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
use std::path::Path;
use std::sync::Mutex;

pub struct Db(pub Mutex<Connection>);

const SCHEMA_VERSION: i64 = 3;

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
    pub did_count: i64,
    pub labeled_count: i64,
}

#[derive(Serialize)]
pub struct DiscoveredDidRow {
    pub did: u16,
    pub raw_sample: Option<String>,
    pub byte_length: Option<i64>,
    pub label: Option<String>,
    pub confidence: Option<String>,
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
}
fn one() -> usize { 1 }
fn onef() -> f64 { 1.0 }
fn yes() -> bool { true }

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
pub struct SyncBatch {
    pub vehicles: Vec<SyncVehicle>,
    pub connections: Vec<SyncConnection>,
    pub scan_events: Vec<SyncScanEvent>,
    pub writes: Vec<SyncWrite>,
    pub readings: Vec<SyncReading>,
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
                enabled INTEGER NOT NULL DEFAULT 1
            );
            -- Auto-discovery shape (product-plan.md): no writer yet, the
            -- discovery-engine stream is later — tables exist so the shape
            -- is locked and other streams can build against it.
            CREATE TABLE IF NOT EXISTS discovered_modules (
                id INTEGER PRIMARY KEY,
                vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
                module_address TEXT NOT NULL,
                module_name TEXT,
                discovered_at TEXT NOT NULL DEFAULT (datetime('now'))
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
        conn.execute_batch(
            r#"
            CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_cloud ON vehicles(cloud_id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_connections_cloud ON connections(cloud_id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_events_cloud ON dtc_scan_events(cloud_id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_writes_cloud ON writes_log(cloud_id);
            "#,
        )?;
        // Backfill rows created on v2 before cloud_id existed.
        for table in ["vehicles", "connections", "dtc_scan_events", "writes_log"] {
            let ids: Vec<i64> = {
                let mut stmt = conn.prepare(&format!("SELECT id FROM {table} WHERE cloud_id IS NULL"))?;
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

    // ---------- vehicles ----------

    /// Get-or-create the vehicle for a successfully-read VIN, stamping
    /// `first_connected_at` on creation. Returns (vehicle_id, created).
    pub fn ensure_vehicle(&self, vin: &str) -> (i64, bool) {
        let conn = self.0.lock().unwrap();
        if let Ok(id) = conn.query_row("SELECT id FROM vehicles WHERE vin = ?1", params![vin], |r| r.get(0)) {
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
        conn.execute("UPDATE vehicles SET display_name = ?2 WHERE id = ?1", params![vehicle_id, name]).ok();
    }

    pub fn set_fuel_price(&self, vehicle_id: i64, price: f64) {
        let conn = self.0.lock().unwrap();
        conn.execute("UPDATE vehicles SET fuel_price = ?2 WHERE id = ?1", params![vehicle_id, price]).ok();
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
            Ok(VehicleListRow { id: r.get(0)?, vin: r.get(1)?, display_name: r.get(2)?, connections: r.get(3)? })
        })
        .unwrap()
        .filter_map(Result::ok)
        .collect()
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
        conn.execute("UPDATE connections SET ended_at = datetime('now') WHERE id = ?1", params![id]).ok();
    }

    pub fn set_connection_protocol(&self, id: i64, protocol: &str) {
        let conn = self.0.lock().unwrap();
        conn.execute("UPDATE connections SET protocol = ?2 WHERE id = ?1", params![id, protocol]).ok();
    }

    /// Link a connection to its vehicle, back-stamping everything the
    /// connection already recorded while unidentified — this is what makes
    /// the "name this car" flow claim the live data recorded before naming.
    pub fn link_connection_vehicle(&self, connection_id: i64, vehicle_id: i64) {
        let conn = self.0.lock().unwrap();
        conn.execute("UPDATE connections SET vehicle_id = ?2 WHERE id = ?1", params![connection_id, vehicle_id]).ok();
        conn.execute("UPDATE readings SET vehicle_id = ?2 WHERE connection_id = ?1", params![connection_id, vehicle_id]).ok();
        conn.execute("UPDATE dtc_scan_events SET vehicle_id = ?2 WHERE connection_id = ?1", params![connection_id, vehicle_id]).ok();
        conn.execute(
            "UPDATE dtc_codes SET vehicle_id = ?2
             WHERE scan_event_id IN (SELECT id FROM dtc_scan_events WHERE connection_id = ?1)",
            params![connection_id, vehicle_id],
        )
        .ok();
        conn.execute("UPDATE writes_log SET vehicle_id = ?2 WHERE connection_id = ?1", params![connection_id, vehicle_id]).ok();
    }

    // ---------- recorded facts ----------

    pub fn insert_reading(&self, connection_id: i64, vehicle_id: Option<i64>, key: &str, value: f64) {
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

    pub fn writes_log(&self, limit: i64) -> Vec<WriteLogRow> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, ts, module, action, params_json, before_json, after_json, outcome, error
                 FROM writes_log ORDER BY id DESC LIMIT ?1",
            )
            .unwrap();
        stmt.query_map(params![limit], |r| {
            Ok(WriteLogRow {
                id: r.get(0)?,
                ts: r.get(1)?,
                module: r.get(2)?,
                action: r.get(3)?,
                params: serde_json::from_str(&r.get::<_, String>(4)?).unwrap_or(serde_json::json!({})),
                before: r.get::<_, Option<String>>(5)?.and_then(|s| serde_json::from_str(&s).ok()),
                after: r.get::<_, Option<String>>(6)?.and_then(|s| serde_json::from_str(&s).ok()),
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

    /// Every scan regardless of vehicle — export/AI-briefing use only.
    pub fn dtc_history_all(&self, limit: i64) -> Vec<DtcScan> {
        self.dtc_history_where(String::new(), limit)
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
                freeze: r.get::<_, Option<String>>(4)?.and_then(|s| serde_json::from_str(&s).ok()),
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
    pub fn key_stats(&self, since_hours: f64) -> Vec<KeyStats> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT key, COUNT(*), MIN(value), AVG(value), MAX(value) FROM readings
                 WHERE ts >= datetime('now', '-' || ?1 || ' hours') GROUP BY key ORDER BY key",
            )
            .unwrap();
        stmt.query_map(params![since_hours], |r| {
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

    pub fn upsert_discovered_module(&self, vehicle_id: i64, address: &str, name: Option<&str>) -> i64 {
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
                // Only ever overwrite a stored name with a real one.
                if name.is_some() {
                    let _ = conn.execute("UPDATE discovered_modules SET module_name = ?1 WHERE id = ?2", params![name, id]);
                }
                id
            }
            None => {
                conn.execute(
                    "INSERT INTO discovered_modules (vehicle_id, module_address, module_name) VALUES (?1, ?2, ?3)",
                    params![vehicle_id, address, name],
                )
                .ok();
                conn.last_insert_rowid()
            }
        }
    }

    pub fn upsert_discovered_did(&self, module_id: i64, did: u16, raw_sample: &str, byte_length: i64, label: Option<&str>) {
        let conn = self.0.lock().unwrap();
        // A label from the knowledge map counts as confirmed; an unlabeled
        // hit stays honestly "unlabeled" until something identifies it.
        let confidence = if label.is_some() { "confirmed" } else { "unlabeled" };
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
                     label = COALESCE(?3, label),
                     confidence = CASE WHEN ?3 IS NOT NULL THEN 'confirmed' ELSE confidence END
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
                        COUNT(d.id), SUM(CASE WHEN d.label IS NOT NULL THEN 1 ELSE 0 END)
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
                did_count: r.get(4)?,
                labeled_count: r.get::<_, Option<i64>>(5)?.unwrap_or(0),
            })
        })
        .unwrap()
        .filter_map(Result::ok)
        .collect()
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
        stmt.query_map(params![vehicle_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as u16)))
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
                "SELECT id, vehicle_id, module, did, label, unit, offset, len, scale, bias, enabled
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
            })
        })
        .unwrap()
        .filter_map(Result::ok)
        .collect()
    }

    pub fn add_probe(&self, p: &UdsProbe, vehicle_id: Option<i64>) -> i64 {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "INSERT INTO uds_probes (vehicle_id, module, did, label, unit, offset, len, scale, bias, enabled)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![vehicle_id, p.module, p.did as i64, p.label, p.unit, p.offset as i64, p.len as i64, p.scale, p.bias, p.enabled],
        )
        .ok();
        conn.last_insert_rowid()
    }

    /// Auto-discovery's promotion path: a DID the knowledge map has a full
    /// decode formula for becomes a real, continuously-polled probe with
    /// no manual "save as probe" step. Upserts on (vehicle_id, module,
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
        let existing: Option<i64> = conn
            .query_row(
                "SELECT id FROM uds_probes WHERE vehicle_id = ?1 AND module = ?2 AND did = ?3",
                params![vehicle_id, module, did as i64],
                |r| r.get(0),
            )
            .ok();
        match existing {
            Some(id) => {
                let _ = conn.execute(
                    "UPDATE uds_probes SET label = ?1, unit = ?2, offset = ?3, len = ?4, scale = ?5, bias = ?6 WHERE id = ?7",
                    params![label, unit, offset as i64, len as i64, scale, bias, id],
                );
                false
            }
            None => {
                let _ = conn.execute(
                    "INSERT INTO uds_probes (vehicle_id, module, did, label, unit, offset, len, scale, bias, enabled)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1)",
                    params![vehicle_id, module, did as i64, label, unit, offset as i64, len as i64, scale, bias],
                );
                true
            }
        }
    }

    pub fn delete_probe(&self, id: i64) {
        let conn = self.0.lock().unwrap();
        conn.execute("DELETE FROM uds_probes WHERE id = ?1", params![id]).ok();
    }

    pub fn toggle_probe(&self, id: i64, enabled: bool) {
        let conn = self.0.lock().unwrap();
        conn.execute("UPDATE uds_probes SET enabled = ?2 WHERE id = ?1", params![id, enabled]).ok();
    }

    /// Custom UDS modules (non-PSA brands, or extra PSA modules the built-in
    /// four don't cover). Returned as generic (key, label, req, resp) tuples
    /// so this module stays free of a dependency on `elm::uds`.
    pub fn list_uds_modules(&self) -> Vec<(String, String, String, String)> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn.prepare("SELECT key, label, req, resp FROM uds_modules ORDER BY id").unwrap();
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .unwrap()
            .filter_map(Result::ok)
            .collect()
    }

    /// Returns Err if the key collides with a built-in or an existing custom
    /// module (UNIQUE constraint) — surfaced to the UI as a friendly message.
    pub fn add_uds_module(&self, key: &str, label: &str, req: &str, resp: &str) -> Result<(), String> {
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
        conn.execute("DELETE FROM uds_modules WHERE key = ?1", params![key]).ok();
    }

    // ---------- app settings (app-level, not car-level) ----------

    pub fn setting_get(&self, key: &str) -> Option<String> {
        let conn = self.0.lock().unwrap();
        conn.query_row("SELECT value FROM app_settings WHERE key = ?1", params![key], |r| r.get(0))
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
                    Ok(DailyVoltage { day: r.get(0)?, min: r.get(1)?, avg: r.get(2)?, max: r.get(3)? })
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
                    Ok(KeyStats { key: r.get(0)?, n: r.get(1)?, min: r.get(2)?, avg: r.get(3)?, max: r.get(4)? })
                })
                .unwrap();
            rows.filter_map(Result::ok).collect()
        };
        let stats_7d = stats(24.0 * 7.0);
        let stats_all = stats(24.0 * 3650.0);

        // ---- Plain-language insights (last 7 days; falls back to all-time) ----
        let window_hours = 24.0 * 7.0;
        let pick = |set: &Vec<KeyStats>, key: &str| -> Option<(f64, f64, f64, i64)> {
            set.iter().find(|s| s.key == key).map(|s| (s.min, s.avg, s.max, s.n))
        };
        let source = if stats_7d.is_empty() { &stats_all } else { &stats_7d };
        // Engine hours inside the window ≈ sum of connections started in it.
        let engine_minutes_window: f64 = conn
            .query_row(
                "SELECT COALESCE(SUM((julianday(COALESCE(ended_at, started_at)) - julianday(started_at)) * 1440), 0)
                 FROM connections WHERE vehicle_id = ?1 AND started_at >= datetime('now', '-' || ?2 || ' hours')",
                params![vehicle_id, window_hours],
                |r| r.get(0),
            )
            .unwrap_or(0.0);
        let engine_hours = if stats_7d.is_empty() { engine_minutes / 60.0 } else { engine_minutes_window / 60.0 };
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
            window_hours: if stats_7d.is_empty() { 24.0 * 3650.0 } else { window_hours },
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
                        .query_map(params![event_id], |r| Ok(SyncCode { code: r.get(0)?, status: r.get(1)? }))
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
        SyncBatch { vehicles, connections, scan_events, writes, readings, last_reading_id }
    }

    // ---------- misc ----------

    pub fn reading_keys(&self) -> Vec<String> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn.prepare("SELECT DISTINCT key FROM readings ORDER BY key").unwrap();
        stmt.query_map([], |r| r.get(0)).unwrap().filter_map(Result::ok).collect()
    }

    pub fn connection_count(&self) -> i64 {
        let conn = self.0.lock().unwrap();
        conn.query_row("SELECT COUNT(*) FROM connections", [], |r| r.get(0))
            .unwrap_or(0)
    }

    pub fn history(&self, key: &str, since_hours: f64) -> Vec<HistoryPoint> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT ts, value FROM readings
                 WHERE key = ?1 AND ts >= datetime('now', '-' || ?2 || ' hours')
                 ORDER BY ts",
            )
            .unwrap();
        stmt.query_map(params![key, since_hours], |r| {
            Ok(HistoryPoint { ts: r.get(0)?, value: r.get(1)? })
        })
        .unwrap()
        .filter_map(Result::ok)
        .collect()
    }

    /// Everything in a date range as one JSON blob — the export button.
    pub fn export_json(&self, since_hours: f64) -> String {
        let readings: Vec<(String, String, f64, Option<i64>)> = {
            let conn = self.0.lock().unwrap();
            let mut stmt = conn
                .prepare(
                    "SELECT ts, key, value, vehicle_id FROM readings
                     WHERE ts >= datetime('now', '-' || ?1 || ' hours') ORDER BY ts",
                )
                .unwrap();
            stmt.query_map(params![since_hours], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })
            .unwrap()
            .filter_map(Result::ok)
            .collect()
        };
        let scans = self.dtc_history_all(100);
        let vehicles = self.list_vehicles();
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
        let rows = db.writes_log(10);
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
        let rows = db.writes_log(10);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].outcome, "error");
        assert_eq!(rows[0].error.as_deref(), Some("link dropped mid-clear"));
        assert_eq!(rows[0].after, None);
    }

    #[test]
    fn writes_log_newest_first_and_limited() {
        let db = test_db();
        for i in 0..5 {
            db.log_write(None, None, "engine", &format!("action_{i}"), &serde_json::json!({}), None, None, "cleared", None);
        }
        let rows = db.writes_log(3);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].action, "action_4");
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
        };
        db.add_probe(&probe, Some(citroen));
        let citroen_probes = db.list_probes(Some(citroen));
        let peugeot_probes = db.list_probes(Some(peugeot));
        assert_eq!(citroen_probes.len(), 1);
        assert!(peugeot_probes.is_empty(), "a Citroën-scoped probe leaked onto the Peugeot");
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
        let first = db.upsert_probe_from_discovery(citroen, "engine", 0xD422, "Battery voltage", "V", 0, 2, 0.01, 0.0);
        let second = db.upsert_probe_from_discovery(citroen, "engine", 0xD422, "Battery voltage (refined)", "V", 0, 2, 0.02, 0.0);
        assert!(first, "first pass should insert");
        assert!(!second, "second pass should update, not insert");
        let probes = db.list_probes(Some(citroen));
        assert_eq!(probes.len(), 1);
        assert_eq!(probes[0].label, "Battery voltage (refined)");
        assert_eq!(probes[0].scale, 0.02);
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
        db.insert_dtc_scan(Some(c_unknown), None, true, &["P0204".into()], &[], &[], Some(13.5), None);
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
        db.insert_dtc_scan(Some(c), Some(v), true, &["P0420".into()], &[], &[], Some(13.0), None);
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
        db.insert_dtc_scan(Some(c), Some(v), true, &["P0420".into()], &[], &[], Some(13.1), None);
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
}
