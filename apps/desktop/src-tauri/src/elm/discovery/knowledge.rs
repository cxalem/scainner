//! The knowledge version key, and the run-once gate built on it.
//!
//! The automatic run on connect (S1–S3, `auto.rs`) reads the car with the
//! maps the app ships: the trusted `uds-map.json`, the overlay packs
//! (`packs.rs`), the research packs (`research.rs`) that prioritize where
//! to look, and the plan revision that decides what a plan asks for.
//! Running it a second time against the SAME maps on the SAME car finds
//! the same things — it is minutes of bus traffic and blocked live data
//! for nothing (owner, 2026-09-01).
//!
//! So the run is gated on a *knowledge key*: a stable string composed from
//! exactly those inputs. Each vehicle stores the key its last completed
//! run finished with; the next connect runs only when the key moved (the
//! app shipped new maps) or the user asked for another scan. A run that
//! stops on budget records nothing, so its leftovers resume next connect —
//! the protocol's carry-over intent, unchanged.

use super::auto::AutoSummary;
use super::{pack_ext, packs, research};
use crate::db::Db;
use crate::elm::uds_map;

/// Prefix of the key's own format. Bumped only when the *composition*
/// below changes shape, so an old stored key never compares equal to a new
/// one computed from the same maps.
const KEY_FORMAT: &str = "k1";

/// `app_settings` key holding the knowledge key the last completed
/// automatic run finished with, per vehicle. A settings row rather than a
/// `vehicles` column: no migration, and the value is app-level knowledge
/// state, not a fact about the car.
pub const AUTO_DONE_PREFIX: &str = "auto_discovery_done:";

pub fn done_setting_key(vehicle_id: i64) -> String {
    format!("{AUTO_DONE_PREFIX}{vehicle_id}")
}

/// The key for the maps this build ships. Everything the automatic run
/// depends on, and nothing else: change any of them and the key changes.
pub fn knowledge_key() -> String {
    let research: Vec<(&str, u32)> = research::packs()
        .iter()
        .map(|p| (p.pack_id.as_str(), p.version))
        .collect();
    let overlays: Vec<(&str, u32)> = packs::overlays()
        .iter()
        .map(|p| (p.id.as_str(), p.version))
        .collect();
    compose_key(
        uds_map::map().version,
        pack_ext::map_generated(),
        &research,
        &overlays,
        pack_ext::plan_revision(),
    )
}

/// Readable rather than hashed: this string is logged on every connect and
/// shown in `GET /status`, and "which maps ran on this car" has to be
/// answerable without the binary that produced it. Lists are sorted so the
/// key does not depend on file order in an index.
fn compose_key(
    map_version: u32,
    map_generated: &str,
    research: &[(&str, u32)],
    overlays: &[(&str, u32)],
    plan_revision: u32,
) -> String {
    let list = |items: &[(&str, u32)]| {
        let mut parts: Vec<String> = items.iter().map(|(id, v)| format!("{id}@{v}")).collect();
        parts.sort();
        parts.join(",")
    };
    format!(
        "{KEY_FORMAT};map={map_version}@{map_generated};research={};packs={};plan={plan_revision}",
        list(research),
        list(overlays),
    )
}

/// What a vehicle's last completed automatic run recorded.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AutoRunRecord {
    pub key: String,
    /// SQLite `datetime('now')` (UTC) when the run completed.
    pub at: String,
}

/// Why the run is happening. A stable token, not a sentence: it crosses
/// into `conn-status` and the UI translates it (i18n), while the log line
/// uses [`RunReason::explain`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RunReason {
    /// No completed run recorded for this vehicle yet.
    NeverRun,
    /// The app ships maps the last completed run did not have.
    KnowledgeChanged,
    /// The user pressed "Scan again".
    Requested,
}

impl RunReason {
    pub fn as_str(self) -> &'static str {
        match self {
            RunReason::NeverRun => "never_run",
            RunReason::KnowledgeChanged => "knowledge_changed",
            RunReason::Requested => "requested",
        }
    }

    /// The log line's half-sentence.
    pub fn explain(self) -> &'static str {
        match self {
            RunReason::NeverRun => "this car has not completed a run yet",
            RunReason::KnowledgeChanged => "the shipped knowledge changed since the last run",
            RunReason::Requested => "the user asked for another scan",
        }
    }
}

/// Token for the skipped state, mirroring [`RunReason::as_str`].
pub const SKIP_REASON: &str = "knowledge_unchanged";

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RunDecision {
    Run(RunReason),
    /// Nothing new to find: the same key already completed at this time.
    Skip {
        since: String,
    },
}

/// The gate itself, kept pure so both front doors and the tests agree on it.
pub fn decide(stored: Option<&AutoRunRecord>, key: &str, forced: bool) -> RunDecision {
    if forced {
        return RunDecision::Run(RunReason::Requested);
    }
    match stored {
        None => RunDecision::Run(RunReason::NeverRun),
        Some(record) if record.key != key => RunDecision::Run(RunReason::KnowledgeChanged),
        Some(record) => RunDecision::Skip {
            since: record.at.clone(),
        },
    }
}

/// Only a run that finished the whole protocol counts. One that hit a
/// budget or was cancelled left candidates unprobed, so it must not close
/// the gate — its remainder is what the next connect is for.
pub fn completed(summary: &AutoSummary) -> bool {
    summary.stopped.is_none() && !summary.cancelled
}

pub fn last_auto_run(db: &Db, vehicle_id: i64) -> Option<AutoRunRecord> {
    let raw = db.setting_get(&done_setting_key(vehicle_id))?;
    let (at, key) = raw.split_once('|')?;
    (!key.is_empty()).then(|| AutoRunRecord {
        key: key.to_string(),
        at: at.to_string(),
    })
}

/// Stamp a completed run. Returns the record it wrote so the caller can
/// put the timestamp straight on the status without reading back.
pub fn record_auto_run(db: &Db, vehicle_id: i64, key: &str) -> AutoRunRecord {
    let at = now(db);
    db.setting_set(&done_setting_key(vehicle_id), &format!("{at}|{key}"));
    AutoRunRecord {
        key: key.to_string(),
        at,
    }
}

/// Forget this vehicle's last run, so the next connect runs again. This is
/// the durable half of "Scan again": it survives the app being closed
/// before the car is plugged in.
pub fn clear_auto_run(db: &Db, vehicle_id: i64) {
    db.setting_delete(&done_setting_key(vehicle_id));
}

/// SQLite's clock, which is the one every stored timestamp in this app
/// already uses — a Rust-side clock would drift from the rows it labels.
pub fn now(db: &Db) -> String {
    db.0.lock()
        .unwrap()
        .query_row("SELECT datetime('now')", [], |r| r.get::<_, String>(0))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    const RESEARCH: &[(&str, u32)] = &[("pack-b", 2), ("pack-a", 1)];
    const OVERLAYS: &[(&str, u32)] = &[("overlay-a", 3)];

    fn baseline() -> String {
        compose_key(9, "2026-08-28", RESEARCH, OVERLAYS, 1)
    }

    #[test]
    fn the_key_changes_when_any_input_changes() {
        let variants = [
            baseline(),
            // the trusted map's version and its generation date
            compose_key(10, "2026-08-28", RESEARCH, OVERLAYS, 1),
            compose_key(9, "2026-08-29", RESEARCH, OVERLAYS, 1),
            // a research pack's version, and one more research pack
            compose_key(
                9,
                "2026-08-28",
                &[("pack-b", 3), ("pack-a", 1)],
                OVERLAYS,
                1,
            ),
            compose_key(
                9,
                "2026-08-28",
                &[("pack-b", 2), ("pack-a", 1), ("pack-c", 1)],
                OVERLAYS,
                1,
            ),
            // an overlay pack's version, and one more overlay
            compose_key(9, "2026-08-28", RESEARCH, &[("overlay-a", 4)], 1),
            compose_key(
                9,
                "2026-08-28",
                RESEARCH,
                &[("overlay-a", 3), ("overlay-b", 1)],
                1,
            ),
            // the plan revision
            compose_key(9, "2026-08-28", RESEARCH, OVERLAYS, 2),
        ];
        for (i, a) in variants.iter().enumerate() {
            for (j, b) in variants.iter().enumerate() {
                if i != j {
                    assert_ne!(a, b, "variants {i} and {j} produced the same key");
                }
            }
        }
    }

    #[test]
    fn the_key_does_not_depend_on_index_order() {
        assert_eq!(
            compose_key(
                9,
                "2026-08-28",
                &[("pack-a", 1), ("pack-b", 2)],
                OVERLAYS,
                1
            ),
            baseline()
        );
    }

    #[test]
    fn the_shipped_key_names_every_input() {
        let key = knowledge_key();
        assert!(key.starts_with(KEY_FORMAT), "{key}");
        assert!(
            key.contains(&format!("map={}@", uds_map::map().version)),
            "{key}"
        );
        assert!(key.contains(pack_ext::map_generated()), "{key}");
        for pack in research::packs() {
            assert!(
                key.contains(&format!("{}@{}", pack.pack_id, pack.version)),
                "{key}"
            );
        }
        for pack in packs::overlays() {
            assert!(
                key.contains(&format!("{}@{}", pack.id, pack.version)),
                "{key}"
            );
        }
        assert!(
            key.ends_with(&format!("plan={}", pack_ext::plan_revision())),
            "{key}"
        );
        // Stable across calls: nothing in it is a clock or an allocation address.
        assert_eq!(key, knowledge_key());
    }

    #[test]
    fn a_second_connect_with_the_same_knowledge_skips_and_a_changed_one_runs() {
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        let key = knowledge_key();

        // First connect: nothing recorded, so the run happens.
        assert_eq!(
            decide(last_auto_run(&db, 1).as_ref(), &key, false),
            RunDecision::Run(RunReason::NeverRun)
        );
        let record = record_auto_run(&db, 1, &key);
        assert_eq!(last_auto_run(&db, 1), Some(record.clone()));

        // Second connect, same maps: skipped, and it says since when.
        assert_eq!(
            decide(last_auto_run(&db, 1).as_ref(), &key, false),
            RunDecision::Skip { since: record.at }
        );
        // Another car has its own gate.
        assert_eq!(
            decide(last_auto_run(&db, 2).as_ref(), &key, false),
            RunDecision::Run(RunReason::NeverRun)
        );
        // The app ships new maps: it runs again.
        assert_eq!(
            decide(
                last_auto_run(&db, 1).as_ref(),
                &format!("{key};extra=1"),
                false
            ),
            RunDecision::Run(RunReason::KnowledgeChanged)
        );
        // "Scan again" runs regardless.
        assert_eq!(
            decide(last_auto_run(&db, 1).as_ref(), &key, true),
            RunDecision::Run(RunReason::Requested)
        );
        // ...and clearing the record makes the NEXT connect run it.
        clear_auto_run(&db, 1);
        assert_eq!(last_auto_run(&db, 1), None);
        assert_eq!(
            decide(last_auto_run(&db, 1).as_ref(), &key, false),
            RunDecision::Run(RunReason::NeverRun)
        );
    }

    #[test]
    fn only_a_finished_run_closes_the_gate() {
        let mut summary = AutoSummary {
            vehicle_id: 1,
            plan_version: "test-v1".into(),
            census: Default::default(),
            identity: Default::default(),
            join: None,
            coverage_status: None,
            elapsed_ms: 0,
            cancelled: false,
            stopped: None,
        };
        assert!(completed(&summary));
        summary.stopped = Some("census budget reached".into());
        assert!(!completed(&summary));
        summary.stopped = None;
        summary.cancelled = true;
        assert!(!completed(&summary));
    }
}
