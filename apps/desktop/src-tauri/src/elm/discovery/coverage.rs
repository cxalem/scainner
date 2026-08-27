//! The coverage report (protocol §8; plan A5): what is known about one
//! vehicle, from data, with every line carrying the ids that back it. It
//! never claims more than the tables hold — where a count is not stored
//! yet (refused / silent / closed routes) the report says so in
//! `limitations` instead of printing a zero that looks like a fact.

use crate::db::{Db, HypothesisRow};
use crate::elm::discovery::state::{IdentityFit, LEARNING_STATE_SETTING};
use crate::elm::uds_map::{brand_for_vin_in, UdsMap};
use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
pub struct VehicleLine {
    pub id: i64,
    pub display_name: Option<String>,
    /// VIN present locally; the VIN itself is not repeated here.
    pub vin_known: bool,
    pub wmi: Option<String>,
    pub brand_id: Option<String>,
    pub brand_name: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct LatestDtcScan {
    pub id: i64,
    pub ts: String,
    pub mil_on: bool,
    pub stored: usize,
    pub pending: usize,
    pub permanent: usize,
}

#[derive(Serialize, Clone, Debug)]
pub struct StandardLine {
    pub reading_keys: i64,
    pub readings: i64,
    pub latest_dtc_scan: Option<LatestDtcScan>,
}

#[derive(Serialize, Clone, Debug)]
pub struct RoutesLine {
    pub reached: usize,
    pub module_ids: Vec<i64>,
    pub limitations: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct IdentifiedModule {
    pub module_id: i64,
    pub address: String,
    pub name: Option<String>,
    pub fingerprint_fields_answered: i64,
    pub identity_fit: Option<String>,
    pub identity_reads: i64,
    pub family_id: Option<String>,
    pub family_match: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct IdentifiedLine {
    pub fingerprinted: usize,
    pub total: usize,
    pub stable: usize,
    pub provisional: usize,
    pub conflicted: usize,
    pub family_matches: usize,
    pub modules: Vec<IdentifiedModule>,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct DecodeBucket {
    pub count: usize,
    pub hypothesis_ids: Vec<i64>,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct DecodesLine {
    pub total: usize,
    /// Registered from a family match, not yet tested on this car.
    pub inherited_untested: DecodeBucket,
    pub matched: DecodeBucket,
    pub conflicted: DecodeBucket,
    pub insufficient: DecodeBucket,
    pub research_candidate: DecodeBucket,
    pub unknown: DecodeBucket,
    pub enabled: DecodeBucket,
}

#[derive(Serialize, Clone, Debug)]
pub struct HypothesisSummary {
    pub id: i64,
    pub module_id: i64,
    pub address: String,
    pub did: String,
    pub label: Option<String>,
    pub knowledge_state: String,
    pub vehicle_fit: String,
    pub activation: String,
    pub family_id: Option<String>,
    pub sample_count: i64,
    pub discriminating_test: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct GuidedStep {
    pub hypothesis_id: i64,
    pub address: String,
    pub did: String,
    pub label: Option<String>,
    pub test: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct LearningLine {
    pub learning_state_on: bool,
    /// Hypotheses a passive learning drive would test: they carry an
    /// inherited decode the correlation engine can check against references.
    pub passive_would_validate: Vec<i64>,
    /// Hypotheses that need a person: their discriminating test is known.
    pub guided_steps: Vec<GuidedStep>,
}

#[derive(Serialize, Clone, Debug)]
pub struct EvidenceLine {
    pub run_ids: Vec<i64>,
    pub module_ids: Vec<i64>,
    pub hypothesis_ids: Vec<i64>,
}

#[derive(Serialize, Clone, Debug)]
pub struct CoverageReport {
    pub vehicle: VehicleLine,
    pub standard: Option<StandardLine>,
    pub routes: RoutesLine,
    pub identified: IdentifiedLine,
    pub decodes: DecodesLine,
    pub hypotheses: Vec<HypothesisSummary>,
    pub learning: LearningLine,
    pub evidence: EvidenceLine,
    /// `complete` when every reached module is fingerprinted with a stable
    /// identity and no hypothesis is untested; otherwise `partial`.
    pub status: &'static str,
    pub remaining: Vec<String>,
}

fn push(bucket: &mut DecodeBucket, id: i64) {
    bucket.count += 1;
    bucket.hypothesis_ids.push(id);
}

fn classify(h: &HypothesisRow, decodes: &mut DecodesLine) {
    decodes.total += 1;
    match h.vehicle_fit.as_str() {
        "matched" => push(&mut decodes.matched, h.id),
        "conflicted" => push(&mut decodes.conflicted, h.id),
        "insufficient" => push(&mut decodes.insufficient, h.id),
        _ if h.family_id.is_some() => push(&mut decodes.inherited_untested, h.id),
        _ if h.knowledge_state == "unknown" => push(&mut decodes.unknown, h.id),
        _ => push(&mut decodes.research_candidate, h.id),
    }
    if h.activation == "enabled" {
        push(&mut decodes.enabled, h.id);
    }
}

pub fn coverage(db: &Db, map: &UdsMap, vehicle_id: i64) -> Option<CoverageReport> {
    let vehicle = db.vehicle(vehicle_id)?;
    let brand = brand_for_vin_in(map, vehicle.vin.as_deref());
    let vehicle_line = VehicleLine {
        id: vehicle.id,
        display_name: vehicle.display_name.clone(),
        vin_known: vehicle.vin.is_some(),
        wmi: vehicle
            .vin
            .as_deref()
            .filter(|v| v.len() >= 3)
            .map(|v| v[..3].to_uppercase()),
        brand_id: brand.map(|b| b.id.clone()),
        brand_name: brand.map(|b| b.name.clone()),
    };

    let (reading_keys, readings) = db.standard_coverage(vehicle_id);
    let latest = db.dtc_history(Some(vehicle_id), 1).into_iter().next();
    let standard = (readings > 0 || latest.is_some()).then(|| StandardLine {
        reading_keys,
        readings,
        latest_dtc_scan: latest.map(|s| LatestDtcScan {
            id: s.id,
            ts: s.ts,
            mil_on: s.mil_on,
            stored: s.stored.len(),
            pending: s.pending.len(),
            permanent: s.permanent.len(),
        }),
    });

    let modules = db.discovered_summary(vehicle_id);
    let module_ids: Vec<i64> = modules.iter().map(|m| m.id).collect();
    let routes = RoutesLine {
        reached: modules.len(),
        module_ids: module_ids.clone(),
        limitations: vec![
            "discovered_modules stores only routes that answered; refused (NRC), silent and closed routes are counted in verification_runs summaries and not yet persisted per route".into(),
        ],
    };

    let mut identified = IdentifiedLine {
        fingerprinted: 0,
        total: modules.len(),
        stable: 0,
        provisional: 0,
        conflicted: 0,
        family_matches: 0,
        modules: Vec::new(),
    };
    let mut remaining = Vec::new();
    for m in &modules {
        let fingerprinted = m.fingerprint_fields_answered > 0;
        if fingerprinted {
            identified.fingerprinted += 1;
        } else {
            remaining.push(format!(
                "module {} ({}) reached but not fingerprinted",
                m.address,
                m.name.as_deref().unwrap_or("unnamed")
            ));
        }
        match m.identity_fit.as_deref().and_then(IdentityFit::parse) {
            Some(IdentityFit::Stable) => identified.stable += 1,
            Some(IdentityFit::Provisional) => {
                identified.provisional += 1;
                remaining.push(format!(
                    "module {} identity read once; a second byte-identical read makes it stable",
                    m.address
                ));
            }
            Some(IdentityFit::Conflicted) => {
                identified.conflicted += 1;
                remaining.push(format!(
                    "module {} identity conflicted: two reads disagreed, needs review",
                    m.address
                ));
            }
            None if fingerprinted => {
                identified.provisional += 1;
                remaining.push(format!(
                    "module {} fingerprinted before identity confidence existed; treated as provisional",
                    m.address
                ));
            }
            None => {}
        }
        if m.family_match
            .as_deref()
            .map(|f| f != "none")
            .unwrap_or(false)
        {
            identified.family_matches += 1;
        }
        identified.modules.push(IdentifiedModule {
            module_id: m.id,
            address: m.address.clone(),
            name: m.name.clone(),
            fingerprint_fields_answered: m.fingerprint_fields_answered,
            identity_fit: m.identity_fit.clone(),
            identity_reads: m.identity_reads,
            family_id: m.family_id.clone(),
            family_match: m.family_match.clone(),
        });
    }
    if modules.is_empty() {
        remaining
            .push("no module has answered yet: run discovery or the parked verification".into());
    }

    let rows = db.list_hypotheses(vehicle_id);
    let mut decodes = DecodesLine::default();
    let mut passive = Vec::new();
    let mut guided = Vec::new();
    let mut hypotheses = Vec::new();
    for h in &rows {
        classify(h, &mut decodes);
        if h.vehicle_fit == "untested" && h.decode_json.is_some() {
            passive.push(h.id);
        }
        if h.vehicle_fit != "matched" {
            if let Some(test) = &h.discriminating_test {
                guided.push(GuidedStep {
                    hypothesis_id: h.id,
                    address: h.module_address.clone(),
                    did: format!("{:04X}", h.did),
                    label: h.label.clone(),
                    test: test.clone(),
                });
            }
        }
        hypotheses.push(HypothesisSummary {
            id: h.id,
            module_id: h.module_id,
            address: h.module_address.clone(),
            did: format!("{:04X}", h.did),
            label: h.label.clone(),
            knowledge_state: h.knowledge_state.clone(),
            vehicle_fit: h.vehicle_fit.clone(),
            activation: h.activation.clone(),
            family_id: h.family_id.clone(),
            sample_count: h.sample_count,
            discriminating_test: h.discriminating_test.clone(),
        });
    }
    if decodes.inherited_untested.count > 0 {
        remaining.push(format!(
            "{} inherited decodes await confirmation on this vehicle (a learning drive)",
            decodes.inherited_untested.count
        ));
    }
    if decodes.unknown.count > 0 {
        remaining.push(format!(
            "{} unlabeled DIDs are open hypotheses",
            decodes.unknown.count
        ));
    }
    if decodes.conflicted.count > 0 {
        remaining.push(format!(
            "{} inherited decodes conflicted with this vehicle's behaviour (same part, different behaviour: review)",
            decodes.conflicted.count
        ));
    }

    let learning_state_on = db
        .setting_get(LEARNING_STATE_SETTING)
        .map(|v| v == "on")
        .unwrap_or(false);
    let run_ids: Vec<i64> = db
        .list_verification_runs(Some(vehicle_id), None, 200)
        .into_iter()
        .map(|r| r.id)
        .collect();
    let hypothesis_ids: Vec<i64> = rows.iter().map(|h| h.id).collect();

    let status = if remaining.is_empty() {
        "complete"
    } else {
        "partial"
    };
    Some(CoverageReport {
        vehicle: vehicle_line,
        standard,
        routes,
        identified,
        decodes,
        hypotheses,
        learning: LearningLine {
            learning_state_on,
            passive_would_validate: passive,
            guided_steps: guided,
        },
        evidence: EvidenceLine {
            run_ids,
            module_ids,
            hypothesis_ids,
        },
        status,
        remaining,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::elm::discovery::join::{fixtures::seed_c4, join_vehicle};
    use crate::elm::uds_map;

    #[test]
    fn the_seeded_c4_reports_honest_partial_coverage_with_evidence_ids() {
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        let c4 = seed_c4(&db);
        let connection = db.start_connection("ELM327", "test");
        db.link_connection_vehicle(connection, c4.vehicle_id);
        let run = db
            .insert_verification_run(c4.vehicle_id, connection, "citroen-c41-v4", "{}")
            .unwrap();
        join_vehicle(&db, uds_map::map(), c4.vehicle_id);

        let report = coverage(&db, uds_map::map(), c4.vehicle_id).expect("vehicle exists");
        assert_eq!(report.vehicle.brand_id.as_deref(), Some("psa"));
        assert_eq!(report.vehicle.wmi.as_deref(), Some("VR7"));
        assert!(
            report.standard.is_none(),
            "no readings: section omitted, not zeroed"
        );
        assert_eq!(report.routes.reached, 4);
        assert!(!report.routes.limitations.is_empty());
        assert_eq!(report.identified.fingerprinted, 3);
        assert_eq!(report.identified.total, 4);
        assert_eq!(report.identified.family_matches, 3);
        assert_eq!(report.decodes.inherited_untested.count, 16);
        assert_eq!(report.decodes.unknown.count, 4);
        assert_eq!(report.decodes.matched.count, 0);
        assert_eq!(report.decodes.total, 20);
        assert_eq!(report.hypotheses.len(), 20);
        assert_eq!(report.learning.passive_would_validate.len(), 16);
        assert_eq!(report.learning.guided_steps.len(), 16);
        assert!(!report.learning.learning_state_on);
        assert_eq!(report.evidence.run_ids, vec![run]);
        assert_eq!(report.evidence.module_ids.len(), 4);
        assert_eq!(report.evidence.hypothesis_ids.len(), 20);
        assert_eq!(report.status, "partial");
        assert!(report
            .remaining
            .iter()
            .any(|r| r.contains("6A8/688") && r.contains("not fingerprinted")));
        assert!(report.remaining.iter().any(|r| r.contains("16 inherited")));
        // Serialises: the API returns it as-is.
        let json = serde_json::to_value(&report).unwrap();
        assert_eq!(json["decodes"]["inherited_untested"]["count"], 16);
        assert!(
            json["vehicle"].get("vin").is_none(),
            "the VIN is not repeated"
        );
    }

    #[test]
    fn confirming_and_enabling_moves_a_decode_between_buckets() {
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        let c4 = seed_c4(&db);
        join_vehicle(&db, uds_map::map(), c4.vehicle_id);
        let d400 = db
            .list_hypotheses(c4.vehicle_id)
            .into_iter()
            .find(|h| h.module_id == c4.abs && h.did == 0xD400)
            .unwrap();
        db.patch_hypothesis(
            d400.id,
            &crate::db::HypothesisPatch {
                vehicle_fit: Some("matched".into()),
                activation: Some("enabled".into()),
                ..Default::default()
            },
            false,
        )
        .unwrap();
        db.setting_set(LEARNING_STATE_SETTING, "on");
        let report = coverage(&db, uds_map::map(), c4.vehicle_id).unwrap();
        assert_eq!(report.decodes.matched.hypothesis_ids, vec![d400.id]);
        assert_eq!(report.decodes.enabled.hypothesis_ids, vec![d400.id]);
        assert_eq!(report.decodes.inherited_untested.count, 15);
        assert_eq!(report.learning.passive_would_validate.len(), 15);
        assert!(report.learning.learning_state_on);
        assert!(!report
            .learning
            .guided_steps
            .iter()
            .any(|g| g.hypothesis_id == d400.id));
    }

    #[test]
    fn an_unknown_vehicle_yields_no_report() {
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        assert!(coverage(&db, uds_map::map(), 42).is_none());
    }
}
