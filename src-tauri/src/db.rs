//! SQLite storage. The database IS the product: every reading lands here so
//! any tool (including an AI session running sqlite3) can query the car's
//! full recorded history.

use rusqlite::{params, Connection};
use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;

pub struct Db(pub Mutex<Connection>);

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

#[derive(Serialize, serde::Deserialize, Clone)]
pub struct UdsProbe {
    #[serde(default)]
    pub id: i64,
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
    pub vin: String,
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

impl Db {
    /// Opens (creating if needed) the SQLite database and brings its schema
    /// up to date.
    ///
    /// Migrations here are deliberately the simplest thing that works for a
    /// single-file personal database: idempotent `CREATE TABLE IF NOT
    /// EXISTS` for new tables, and `ALTER TABLE ... ADD COLUMN` (with the
    /// error discarded via `let _ =`, since "column already exists" is the
    /// expected outcome on every run after the first) for new columns on
    /// existing tables. No migration framework, no down-migrations — there's
    /// one deployment target (the user's own machine) and schema changes are
    /// additive by design (see `readings`/`dtc_scans`/`sessions` below).
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY,
                started_at TEXT NOT NULL,
                ended_at TEXT,
                elm_version TEXT
            );
            CREATE TABLE IF NOT EXISTS readings (
                id INTEGER PRIMARY KEY,
                session_id INTEGER NOT NULL REFERENCES sessions(id),
                ts TEXT NOT NULL,
                key TEXT NOT NULL,
                value REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_readings_key_ts ON readings(key, ts);
            CREATE TABLE IF NOT EXISTS dtc_scans (
                id INTEGER PRIMARY KEY,
                ts TEXT NOT NULL,
                mil_on INTEGER NOT NULL,
                stored_json TEXT NOT NULL,
                pending_json TEXT NOT NULL,
                permanent_json TEXT NOT NULL,
                voltage REAL
            );
            CREATE TABLE IF NOT EXISTS car_info (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            "#,
        )?;
        // Migration: freeze_json on dtc_scans (added wave 2).
        let _ = conn.execute("ALTER TABLE dtc_scans ADD COLUMN freeze_json TEXT", []);
        // Migration (wave 3): sessions carry the VIN so reports group by car.
        let _ = conn.execute("ALTER TABLE sessions ADD COLUMN vin TEXT", []);
        // UDS probes (wave 3): user-defined manufacturer-specific reads that the
        // supervisor polls and records like any other sensor.
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS uds_probes (
                id INTEGER PRIMARY KEY,
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
            "#,
        )?;
        // Write audit trail (write-caps increment 1): every write the app
        // sends to the car inserts a row here, success or failure, with the
        // state read before and after. This is the persisted half of the
        // stream's hard rule (confirmation + logged before/after +
        // documented reversal path).
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS writes_log (
                id INTEGER PRIMARY KEY,
                ts TEXT NOT NULL,
                module TEXT NOT NULL,
                action TEXT NOT NULL,
                params_json TEXT NOT NULL DEFAULT '{}',
                before_json TEXT,
                after_json TEXT,
                outcome TEXT NOT NULL,
                error TEXT
            );
            "#,
        )?;
        // Custom UDS modules (any brand beyond the built-in PSA four): a
        // name plus two CAN IDs, added through the UI. This is what makes
        // the UDS Lab work on non-PSA cars — see elm/uds.rs.
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS uds_modules (
                id INTEGER PRIMARY KEY,
                key TEXT NOT NULL UNIQUE,
                label TEXT NOT NULL,
                req TEXT NOT NULL,
                resp TEXT NOT NULL
            );
            "#,
        )?;
        Ok(Self(Mutex::new(conn)))
    }

    pub fn start_session(&self, elm_version: &str) -> i64 {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "INSERT INTO sessions (started_at, elm_version) VALUES (datetime('now'), ?1)",
            params![elm_version],
        )
        .ok();
        conn.last_insert_rowid()
    }

    pub fn end_session(&self, id: i64) {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "UPDATE sessions SET ended_at = datetime('now') WHERE id = ?1",
            params![id],
        )
        .ok();
    }

    pub fn insert_reading(&self, session_id: i64, key: &str, value: f64) {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "INSERT INTO readings (session_id, ts, key, value) VALUES (?1, datetime('now'), ?2, ?3)",
            params![session_id, key, value],
        )
        .ok();
    }

    pub fn insert_dtc_scan(
        &self,
        mil_on: bool,
        stored: &[String],
        pending: &[String],
        permanent: &[String],
        voltage: Option<f64>,
        freeze: Option<&serde_json::Value>,
    ) -> i64 {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "INSERT INTO dtc_scans (ts, mil_on, stored_json, pending_json, permanent_json, voltage, freeze_json)
             VALUES (datetime('now'), ?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                mil_on,
                serde_json::to_string(stored).unwrap(),
                serde_json::to_string(pending).unwrap(),
                serde_json::to_string(permanent).unwrap(),
                voltage,
                freeze.map(|f| f.to_string())
            ],
        )
        .ok();
        conn.last_insert_rowid()
    }

    /// Append one row to the write audit trail. Called from every write
    /// handler, on success AND on failure — the trail is only trustworthy
    /// if nothing can touch the car without landing here.
    pub fn log_write(
        &self,
        module: &str,
        action: &str,
        params: &serde_json::Value,
        before: Option<&serde_json::Value>,
        after: Option<&serde_json::Value>,
        outcome: &str,
        error: Option<&str>,
    ) -> i64 {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "INSERT INTO writes_log (ts, module, action, params_json, before_json, after_json, outcome, error)
             VALUES (datetime('now'), ?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                module,
                action,
                params.to_string(),
                before.map(|v| v.to_string()),
                after.map(|v| v.to_string()),
                outcome,
                error
            ],
        )
        .ok();
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

    pub fn dtc_history(&self, limit: i64) -> Vec<DtcScan> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, ts, mil_on, stored_json, pending_json, permanent_json, voltage, freeze_json
                 FROM dtc_scans ORDER BY id DESC LIMIT ?1",
            )
            .unwrap();
        stmt.query_map(params![limit], |r| {
            Ok(DtcScan {
                id: r.get(0)?,
                ts: r.get(1)?,
                mil_on: r.get(2)?,
                stored: serde_json::from_str(&r.get::<_, String>(3)?).unwrap_or_default(),
                pending: serde_json::from_str(&r.get::<_, String>(4)?).unwrap_or_default(),
                permanent: serde_json::from_str(&r.get::<_, String>(5)?).unwrap_or_default(),
                voltage: r.get(6)?,
                freeze: r
                    .get::<_, Option<String>>(7)?
                    .and_then(|s| serde_json::from_str(&s).ok()),
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

    pub fn list_probes(&self) -> Vec<UdsProbe> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, module, did, label, unit, offset, len, scale, bias, enabled FROM uds_probes ORDER BY id")
            .unwrap();
        stmt.query_map([], |r| {
            Ok(UdsProbe {
                id: r.get(0)?,
                module: r.get(1)?,
                did: r.get::<_, i64>(2)? as u16,
                label: r.get(3)?,
                unit: r.get(4)?,
                offset: r.get::<_, i64>(5)? as usize,
                len: r.get::<_, i64>(6)? as usize,
                scale: r.get(7)?,
                bias: r.get(8)?,
                enabled: r.get(9)?,
            })
        })
        .unwrap()
        .filter_map(Result::ok)
        .collect()
    }

    pub fn add_probe(&self, p: &UdsProbe) -> i64 {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "INSERT INTO uds_probes (module, did, label, unit, offset, len, scale, bias, enabled)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![p.module, p.did as i64, p.label, p.unit, p.offset as i64, p.len as i64, p.scale, p.bias, p.enabled],
        )
        .ok();
        conn.last_insert_rowid()
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

    pub fn set_session_vin(&self, id: i64, vin: &str) {
        let conn = self.0.lock().unwrap();
        conn.execute("UPDATE sessions SET vin = ?2 WHERE id = ?1", params![id, vin]).ok();
    }

    /// Distinct cars seen (NULL-vin legacy sessions count as the default car).
    pub fn report_cars(&self) -> Vec<(String, i64)> {
        let conn = self.0.lock().unwrap();
        let default_vin: String = conn
            .query_row("SELECT value FROM car_info WHERE key='vin'", [], |r| r.get(0))
            .unwrap_or_else(|_| "unknown".into());
        let mut stmt = conn
            .prepare("SELECT COALESCE(vin, ?1), COUNT(*) FROM sessions GROUP BY COALESCE(vin, ?1) ORDER BY 2 DESC")
            .unwrap();
        stmt.query_map(params![default_vin], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .filter_map(Result::ok)
            .collect()
    }

    pub fn car_report(&self, vin: &str) -> CarReport {
        let conn = self.0.lock().unwrap();
        let mut sessions = Vec::new();
        {
            let mut stmt = conn
                .prepare(
                    "SELECT s.id, s.started_at, s.ended_at,
                        (SELECT COUNT(*) FROM readings r WHERE r.session_id = s.id),
                        (SELECT MAX(value) FROM readings r WHERE r.session_id = s.id AND key='speed'),
                        (SELECT MAX(value) FROM readings r WHERE r.session_id = s.id AND key='coolant'),
                        (SELECT MIN(value) FROM readings r WHERE r.session_id = s.id AND key='voltage'),
                        CAST((julianday(COALESCE(s.ended_at, s.started_at)) - julianday(s.started_at)) * 1440 AS REAL)
                     FROM sessions s WHERE COALESCE(s.vin, ?1) = ?1
                     ORDER BY s.id DESC LIMIT 30",
                )
                .unwrap();
            let rows = stmt
                .query_map(params![vin], |r| {
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
                 FROM sessions WHERE COALESCE(vin, ?1) = ?1",
                params![vin],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap_or((0, 0.0, None, None));
        let total_readings: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM readings r JOIN sessions s ON r.session_id = s.id WHERE COALESCE(s.vin, ?1) = ?1",
                params![vin],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let (scans_total, scans_clean): (i64, i64) = conn
            .query_row(
                "SELECT COUNT(*), SUM(CASE WHEN stored_json='[]' AND pending_json='[]' THEN 1 ELSE 0 END) FROM dtc_scans",
                [],
                |r| Ok((r.get(0)?, r.get::<_, Option<i64>>(1)?.unwrap_or(0))),
            )
            .unwrap_or((0, 0));
        let mut daily_voltage = Vec::new();
        {
            let mut stmt = conn
                .prepare(
                    "SELECT date(r.ts), ROUND(MIN(r.value),2), ROUND(AVG(r.value),2), ROUND(MAX(r.value),2)
                     FROM readings r JOIN sessions s ON r.session_id = s.id
                     WHERE r.key='voltage' AND COALESCE(s.vin, ?1) = ?1
                     GROUP BY date(r.ts) ORDER BY 1 DESC LIMIT 30",
                )
                .unwrap();
            let rows = stmt
                .query_map(params![vin], |r| {
                    Ok(DailyVoltage { day: r.get(0)?, min: r.get(1)?, avg: r.get(2)?, max: r.get(3)? })
                })
                .unwrap();
            daily_voltage.extend(rows.filter_map(Result::ok));
            daily_voltage.reverse();
        }
        let stats = |hours: f64| -> Vec<KeyStats> {
            let mut stmt = conn
                .prepare(
                    "SELECT r.key, COUNT(*), MIN(r.value), AVG(r.value), MAX(r.value)
                     FROM readings r JOIN sessions s ON r.session_id = s.id
                     WHERE COALESCE(s.vin, ?1) = ?1 AND r.ts >= datetime('now', '-' || ?2 || ' hours')
                     GROUP BY r.key ORDER BY r.key",
                )
                .unwrap();
            let rows = stmt
                .query_map(params![vin, hours], |r| {
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
        // Engine hours inside the window ≈ sum of sessions started in it.
        let engine_minutes_window: f64 = conn
            .query_row(
                "SELECT COALESCE(SUM((julianday(COALESCE(ended_at, started_at)) - julianday(started_at)) * 1440), 0)
                 FROM sessions WHERE COALESCE(vin, ?1) = ?1 AND started_at >= datetime('now', '-' || ?2 || ' hours')",
                params![vin, window_hours],
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
        let fuel_price: f64 = conn
            .query_row("SELECT value FROM car_info WHERE key='fuel_price'", [], |r| r.get::<_, String>(0))
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(1.50);
        let coolant = pick(source, "coolant");
        let map_s = pick(source, "map");
        let volt = pick(source, "voltage");
        let fuel_level_pct: Option<f64> = conn
            .query_row(
                "SELECT r.value FROM readings r JOIN sessions s ON r.session_id = s.id
                 WHERE r.key='fuel_level' AND COALESCE(s.vin, ?1) = ?1
                 ORDER BY r.ts DESC LIMIT 1",
                params![vin],
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
            vin: vin.to_string(),
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

    pub fn reading_keys(&self) -> Vec<String> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn.prepare("SELECT DISTINCT key FROM readings ORDER BY key").unwrap();
        stmt.query_map([], |r| r.get(0)).unwrap().filter_map(Result::ok).collect()
    }

    pub fn session_count(&self) -> i64 {
        let conn = self.0.lock().unwrap();
        conn.query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
            .unwrap_or(0)
    }

    pub fn set_car_info(&self, key: &str, value: &str) {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "INSERT INTO car_info (key, value, updated_at) VALUES (?1, ?2, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = datetime('now')",
            params![key, value],
        )
        .ok();
    }

    /// Single-key lookup into the same table `car_info`/`set_car_info` use.
    /// Also doubles as small persistent local-setup state (e.g. the
    /// connection ladder's learned starting point) — not just car facts —
    /// since it's the only generic key/value store in the schema and
    /// there's no value in a second one for a single flag.
    pub fn car_info_get(&self, key: &str) -> Option<String> {
        let conn = self.0.lock().unwrap();
        conn.query_row("SELECT value FROM car_info WHERE key = ?1", params![key], |r| r.get(0))
            .ok()
    }

    pub fn car_info(&self) -> Vec<(String, String)> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT key, value FROM car_info ORDER BY key")
            .unwrap();
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .filter_map(Result::ok)
            .collect()
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
        let readings: Vec<(String, String, f64)> = {
            let conn = self.0.lock().unwrap();
            let mut stmt = conn
                .prepare(
                    "SELECT ts, key, value FROM readings
                     WHERE ts >= datetime('now', '-' || ?1 || ' hours') ORDER BY ts",
                )
                .unwrap();
            stmt.query_map(params![since_hours], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap()
            .filter_map(Result::ok)
            .collect()
        };
        let scans = self.dtc_history(100);
        let info = self.car_info();
        serde_json::json!({
            "car_info": info.into_iter().collect::<std::collections::BTreeMap<_, _>>(),
            "dtc_scans": scans,
            "readings": readings.iter().map(|(ts, k, v)| serde_json::json!({"ts": ts, "key": k, "value": v})).collect::<Vec<_>>(),
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
            db.log_write("engine", &format!("action_{i}"), &serde_json::json!({}), None, None, "cleared", None);
        }
        let rows = db.writes_log(3);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].action, "action_4");
    }
}
