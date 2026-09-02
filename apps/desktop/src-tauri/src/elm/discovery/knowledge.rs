use super::auto::AutoSummary;
use super::{pack_ext, packs, research};
use crate::db::Db;
use crate::elm::uds_map;

const KEY_FORMAT: &str = "k1";

pub const AUTO_DONE_PREFIX: &str = "auto_discovery_done:";

pub fn done_setting_key(vehicle_id: i64) -> String {
    format!("{AUTO_DONE_PREFIX}{vehicle_id}")
}

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

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AutoRunRecord {
    pub key: String,
    pub at: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RunReason {
    NeverRun,
    KnowledgeChanged,
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

    pub fn explain(self) -> &'static str {
        match self {
            RunReason::NeverRun => "this car has not completed a run yet",
            RunReason::KnowledgeChanged => "the shipped knowledge changed since the last run",
            RunReason::Requested => "the user asked for another scan",
        }
    }
}

pub const SKIP_REASON: &str = "knowledge_unchanged";

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RunDecision {
    Run(RunReason),
    Skip { since: String },
}

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

pub fn record_auto_run(db: &Db, vehicle_id: i64, key: &str) -> AutoRunRecord {
    let at = now(db);
    // Only a run completed within budget records its key, so truncated runs resume next connect.
    db.setting_set(&done_setting_key(vehicle_id), &format!("{at}|{key}"));
    AutoRunRecord {
        key: key.to_string(),
        at,
    }
}

pub fn clear_auto_run(db: &Db, vehicle_id: i64) {
    db.setting_delete(&done_setting_key(vehicle_id));
}

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
            compose_key(10, "2026-08-28", RESEARCH, OVERLAYS, 1),
            compose_key(9, "2026-08-29", RESEARCH, OVERLAYS, 1),
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
            compose_key(9, "2026-08-28", RESEARCH, &[("overlay-a", 4)], 1),
            compose_key(
                9,
                "2026-08-28",
                RESEARCH,
                &[("overlay-a", 3), ("overlay-b", 1)],
                1,
            ),
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
        assert_eq!(key, knowledge_key());
    }

    #[test]
    fn a_second_connect_with_the_same_knowledge_skips_and_a_changed_one_runs() {
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        let key = knowledge_key();

        assert_eq!(
            decide(last_auto_run(&db, 1).as_ref(), &key, false),
            RunDecision::Run(RunReason::NeverRun)
        );
        let record = record_auto_run(&db, 1, &key);
        assert_eq!(last_auto_run(&db, 1), Some(record.clone()));

        assert_eq!(
            decide(last_auto_run(&db, 1).as_ref(), &key, false),
            RunDecision::Skip { since: record.at }
        );
        assert_eq!(
            decide(last_auto_run(&db, 2).as_ref(), &key, false),
            RunDecision::Run(RunReason::NeverRun)
        );
        assert_eq!(
            decide(
                last_auto_run(&db, 1).as_ref(),
                &format!("{key};extra=1"),
                false
            ),
            RunDecision::Run(RunReason::KnowledgeChanged)
        );
        assert_eq!(
            decide(last_auto_run(&db, 1).as_ref(), &key, true),
            RunDecision::Run(RunReason::Requested)
        );
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
