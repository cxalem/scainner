use super::state::KnowledgeState;
use crate::db::Db;
use crate::elm::uds_map;
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;

pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Serialize)]
pub struct ResearchRequest {
    pub schema_version: u32,
    pub generated_at: String,
    pub wmi: Option<String>,
    pub platform_key: Option<String>,
    pub knowledge_key: String,
    pub modules: Vec<RequestModule>,
    pub route_outcomes: Vec<RequestRouteOutcome>,
    pub unlabeled_dids: Vec<RequestDid>,
    pub conflicts: Vec<RequestConflict>,
    pub open_hypotheses: BTreeMap<String, usize>,
    pub questions: Vec<String>,
    pub constant_since_start: Vec<crate::db::ConstantStandardPid>,
}

#[derive(Debug, Serialize)]
pub struct RequestModule {
    pub address: String,
    pub name: Option<String>,
    pub route_state: Option<String>,
    pub identity: RequestIdentity,
    pub identity_fit: Option<String>,
    pub family_match: Option<String>,
    pub dialect: String,
    pub nrc_ladder: Vec<Value>,
}

#[derive(Debug, Serialize)]
pub struct RequestIdentity {
    pub supplier: Option<String>,
    pub family_id: Option<String>,
    pub hardware_ref: Option<String>,
    pub software_ref: Option<String>,
    pub part_ref: Option<String>,
    pub system_name: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RequestRouteOutcome {
    pub address: String,
    pub state: String,
    pub nrc: Option<i64>,
    pub attempts: i64,
    pub last_seen: String,
}

#[derive(Debug, Serialize)]
pub struct RequestDid {
    pub address: String,
    pub did: String,
    pub byte_length: Option<i64>,
    pub shape_class: String,
    pub samples: i64,
    pub shape: Option<Value>,
    pub correlations: Vec<RequestCorrelation>,
}

#[derive(Debug, Serialize)]
pub struct RequestCorrelation {
    pub reference: String,
    pub r: f64,
    pub slope: f64,
    pub bias: f64,
    pub residual: f64,
}

#[derive(Debug, Serialize)]
pub struct RequestConflict {
    pub address: String,
    pub kind: &'static str,
    pub detail: String,
}

fn hex_did(did: u16) -> String {
    format!("{did:04X}")
}

fn shape_class(shape_json: Option<&str>) -> String {
    let Some(raw) = shape_json else {
        return "unsampled".into();
    };
    serde_json::from_str::<serde_json::Value>(raw)
        .ok()
        .and_then(|value| {
            value
                .get("variability")
                .and_then(|variability| variability.as_str().map(str::to_string))
        })
        .map(|variability| variability.to_ascii_lowercase())
        .unwrap_or_else(|| "unsampled".into())
}

fn compact_shape(raw: Option<&str>) -> Option<Value> {
    let value = serde_json::from_str::<Value>(raw?).ok()?;
    Some(serde_json::json!({
        "min": value.get("min")?,
        "max": value.get("max")?,
        "variability": value.get("variability")?,
        "sentinels": value.get("sentinels").cloned().unwrap_or_else(|| serde_json::json!([])),
    }))
}

fn top_correlations(raw: Option<&str>) -> Vec<RequestCorrelation> {
    let mut rows: Vec<RequestCorrelation> = serde_json::from_str::<Value>(raw.unwrap_or("{}"))
        .ok()
        .and_then(|value| value.get("reference_correlations").cloned())
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|value| {
            Some(RequestCorrelation {
                reference: value.get("reference")?.as_str()?.into(),
                r: value.get("r")?.as_f64()?,
                slope: value.get("slope")?.as_f64()?,
                bias: value.get("bias")?.as_f64()?,
                residual: value.get("residual_sd")?.as_f64()?,
            })
        })
        .collect();
    rows.sort_by(|a, b| b.r.abs().total_cmp(&a.r.abs()));
    rows.truncate(3);
    rows
}

fn silent_family(outcome: &crate::db::RouteOutcomeRow) -> String {
    let route = serde_json::from_str::<Value>(outcome.route_json.as_deref().unwrap_or("{}"))
        .unwrap_or(Value::Null);
    for key in ["catalogue_group", "catalogue", "group"] {
        if let Some(group) = route.get(key).and_then(Value::as_str) {
            return format!("catalogue group {group}");
        }
    }
    let address = outcome.address.to_ascii_uppercase();
    if address
        .split('/')
        .any(|part| part.starts_with("18DA") && part.ends_with("F1"))
    {
        "29-bit 18DAxxF1 range".into()
    } else {
        "11-bit range".into()
    }
}

pub fn research_request(db: &Db, vehicle_id: i64) -> Option<ResearchRequest> {
    let vehicle = db.vehicle(vehicle_id)?;
    let vin = vehicle.vin.as_deref();
    let wmi = vin
        .filter(|value| value.len() >= 3)
        .map(|value| value[..3].to_ascii_uppercase());
    let platform_key = uds_map::platform_for_vin(vin)
        .map(|platform| platform.key)
        .or_else(|| super::research::platform_for_vehicle_facts(vin, vehicle.model.as_deref()));

    let module_rows = db.discovered_summary(vehicle_id);
    let hypotheses = db.list_hypotheses(vehicle_id);

    let modules: Vec<RequestModule> = module_rows
        .iter()
        .map(|module| {
            let route = serde_json::from_str::<Value>(module.route_json.as_deref().unwrap_or("{}"))
                .unwrap_or(Value::Null);
            RequestModule {
                address: module.address.clone(),
                name: module.name.clone(),
                route_state: module.route_state.clone(),
                identity: RequestIdentity {
                    supplier: module.supplier.clone(),
                    family_id: module.family_id.clone(),
                    hardware_ref: module.hardware_version.clone(),
                    software_ref: module.software_version.clone(),
                    part_ref: module.spare_part_number.clone(),
                    system_name: module.system_name.clone(),
                },
                identity_fit: module.identity_fit.clone(),
                family_match: module.family_match.clone(),
                dialect: route
                    .get("dialect")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown")
                    .into(),
                nrc_ladder: route
                    .get("nrc_ladder")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default(),
            }
        })
        .collect();

    let route_outcomes: Vec<RequestRouteOutcome> = db
        .route_outcomes(vehicle_id)
        .into_iter()
        .map(|outcome| RequestRouteOutcome {
            address: outcome.address,
            state: outcome.route_state,
            nrc: outcome.nrc,
            attempts: outcome.attempts,
            last_seen: outcome.observed_at,
        })
        .collect();

    let mut unlabeled_dids: Vec<RequestDid> = Vec::new();
    for module in &module_rows {
        let shapes: BTreeMap<u16, (Option<String>, Option<String>, i64)> = hypotheses
            .iter()
            .filter(|hypothesis| hypothesis.module_id == module.id)
            .map(|hypothesis| {
                (
                    hypothesis.did,
                    (
                        hypothesis.shape_json.clone(),
                        hypothesis.interpretations_json.clone(),
                        hypothesis.sample_count,
                    ),
                )
            })
            .collect();
        for did in db.discovered_dids(module.id) {
            if did.label.is_some() {
                continue;
            }
            let (shape, interpretations, samples) =
                shapes.get(&did.did).cloned().unwrap_or((None, None, 0));
            unlabeled_dids.push(RequestDid {
                address: module.address.clone(),
                did: hex_did(did.did),
                byte_length: did.byte_length,
                shape_class: shape_class(shape.as_deref()),
                samples,
                shape: compact_shape(shape.as_deref()),
                correlations: top_correlations(interpretations.as_deref()),
            });
        }
    }

    let conflicts: Vec<RequestConflict> = module_rows
        .iter()
        .filter_map(|module| match module.identity_fit.as_deref() {
            Some("conflicted") => Some(RequestConflict {
                address: module.address.clone(),
                kind: "identity_conflicted",
                detail: "two identity reads on independent connections disagreed".into(),
            }),
            _ => None,
        })
        .chain(module_rows.iter().filter_map(|module| {
            (module.family_match.as_deref() == Some("none")
                && module.fingerprint_fields_answered > 0)
                .then(|| RequestConflict {
                    address: module.address.clone(),
                    kind: "identified_without_family",
                    detail: format!(
                        "{} identity fields answered, no compatible ECU family",
                        module.fingerprint_fields_answered
                    ),
                })
        }))
        .collect();

    let mut open_hypotheses: BTreeMap<String, usize> = BTreeMap::new();
    for hypothesis in &hypotheses {
        let state = KnowledgeState::parse(&hypothesis.knowledge_state)
            .map(|state| state.as_str().to_string())
            .unwrap_or_else(|| hypothesis.knowledge_state.clone());
        *open_hypotheses.entry(state).or_default() += 1;
    }

    let mut questions: Vec<String> = Vec::new();
    for module in &modules {
        if module.dialect == "kwp21"
            && module.identity.hardware_ref.is_none()
            && module.identity.software_ref.is_none()
            && module.identity.part_ref.is_none()
            && module.identity.system_name.is_none()
        {
            questions.push(format!(
                "module {} speaks 0x21; which local identifiers does it expose and how is it identified?",
                module.address
            ));
        }
    }
    let mut silent_counts: BTreeMap<String, usize> = BTreeMap::new();
    for outcome in &db.route_outcomes(vehicle_id) {
        if outcome.route_state == "silent" {
            *silent_counts.entry(silent_family(outcome)).or_default() += 1;
        }
    }
    for (family, count) in silent_counts {
        questions.push(format!("{count} silent routes in the {family}: which modules are fitted or gateway-routed on this platform?"));
    }
    for outcome in &route_outcomes {
        match outcome.state.as_str() {
            "silent" => {}
            "refused" if modules.iter().any(|module| {
                module.address == outcome.address && module.dialect == "kwp21"
            }) => {}
            "refused" => questions.push(match outcome.nrc {
                Some(nrc) => format!(
                    "route {} refused with NRC 0x{nrc:02X} on {} connection(s): which read service and session does it want?",
                    outcome.address, outcome.attempts
                ),
                None => format!(
                    "route {} refused on {} connection(s): which read service and session does it want?",
                    outcome.address, outcome.attempts
                ),
            }),
            _ => {}
        }
    }
    for conflict in &conflicts {
        if conflict.kind == "identified_without_family" {
            questions.push(format!(
                "module {} identified, no family match: which ECU family do these part and software references belong to?",
                conflict.address
            ));
        }
    }
    for did in &unlabeled_dids {
        if did.shape_class == "constant" || did.shape_class == "unsampled" {
            continue;
        }
        questions.push(format!(
            "DID {} on {} answers {} byte(s) and is {}, unlabeled: what does this identifier carry?",
            did.did,
            did.address,
            did.byte_length.unwrap_or_default(),
            did.shape_class
        ));
    }
    for hypothesis in &hypotheses {
        let disagreements = hypothesis
            .interpretations_json
            .as_deref()
            .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
            .and_then(|value| {
                value
                    .get("candidate_interpretations")
                    .and_then(Value::as_array)
                    .map(Vec::len)
            })
            .unwrap_or(0);
        if hypothesis
            .confidence
            .is_some_and(|confidence| confidence >= 0.8)
            && disagreements > 1
        {
            questions.push(format!("high-confidence interpretations disagree for DID {} on {}: which discriminating test resolves them?", hex_did(hypothesis.did), hypothesis.module_address));
        }
    }

    Some(ResearchRequest {
        schema_version: SCHEMA_VERSION,
        generated_at: super::knowledge::now(db),
        wmi,
        platform_key,
        knowledge_key: super::knowledge_key(),
        modules,
        route_outcomes,
        unlabeled_dids,
        conflicts,
        open_hypotheses,
        questions,
        constant_since_start: db.constant_standard_pids(vehicle_id),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::HypothesisUpsert;

    fn seed(db: &Db) -> i64 {
        let (vehicle_id, _) = db.ensure_vehicle("VF7EXAMPLE0000123");
        db.record_route_outcome(vehicle_id, None, "6A8/688", "reached", None, None, None);
        db.record_route_outcome(vehicle_id, None, "752/652", "silent", None, None, None);
        db.record_route_outcome(vehicle_id, None, "752/652", "silent", None, None, None);
        db.record_route_outcome(
            vehicle_id,
            None,
            "75F/65F",
            "refused",
            None,
            Some("requestOutOfRange"),
            Some(0x31),
        );
        let module_id = db.upsert_discovered_module(vehicle_id, "6A8/688", Some("engine"));
        db.set_module_route_state(module_id, "reached");
        db.set_module_route(
            module_id,
            r#"{"dialect":"kwp21","nrc_ladder":[{"request":"2100","nrc":18,"status":"refused"}]}"#,
        );
        db.upsert_discovered_did(module_id, 0xD410, "00 12", 2, None);
        db.upsert_discovered_did(module_id, 0xF190, "56 46 37", 3, Some("VIN"));
        db.upsert_hypothesis(&HypothesisUpsert {
            vehicle_id,
            module_id,
            did: 0xD410,
            knowledge_state: "unknown".into(),
            ..Default::default()
        });
        vehicle_id
    }

    #[test]
    fn research_request_reports_outcomes_unlabeled_dids_and_questions() {
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        let vehicle_id = seed(&db);
        let hypothesis_id = db.list_hypotheses(vehicle_id)[0].id;
        db.insert_hypothesis_sample(hypothesis_id, 1, "00 12", Some("[]"));
        db.write_hypothesis_analysis(
            hypothesis_id,
            r#"{"byte_length":2,"variability":"fast","min":[0,1],"max":[3,9],"sentinels":[]}"#,
            r#"{"reference_correlations":[{"reference":"speed","r":0.95,"slope":1.0,"bias":0.0,"residual_sd":0.2}]}"#,
            0.7,
            None,
        );
        let connection_id = db.start_connection("ELM327", "test");
        db.link_connection_vehicle(connection_id, vehicle_id);
        for index in 0..200 {
            db.insert_reading(connection_id, Some(vehicle_id), "ltft", 0.0);
            db.insert_reading(
                connection_id,
                Some(vehicle_id),
                "rpm",
                if index < 100 { 650.0 } else { 1800.0 },
            );
        }
        let request = research_request(&db, vehicle_id).unwrap();

        assert_eq!(request.schema_version, 1);
        assert_eq!(request.wmi.as_deref(), Some("VF7"));
        assert!(!request.knowledge_key.is_empty());

        let silent = request
            .route_outcomes
            .iter()
            .find(|outcome| outcome.address == "752/652")
            .unwrap();
        assert_eq!(silent.state, "silent");
        assert_eq!(silent.attempts, 2, "a repeated census counts as an attempt");
        let refused = request
            .route_outcomes
            .iter()
            .find(|outcome| outcome.address == "75F/65F")
            .unwrap();
        assert_eq!(refused.nrc, Some(0x31));

        let dids: Vec<&str> = request
            .unlabeled_dids
            .iter()
            .map(|did| did.did.as_str())
            .collect();
        assert_eq!(dids, ["D410"]);
        assert_eq!(request.unlabeled_dids[0].byte_length, Some(2));
        assert_eq!(request.unlabeled_dids[0].shape_class, "fast");
        assert_eq!(request.unlabeled_dids[0].samples, 1);
        assert_eq!(
            request.unlabeled_dids[0].shape.as_ref().unwrap()["min"],
            serde_json::json!([0, 1])
        );
        assert_eq!(request.unlabeled_dids[0].correlations[0].reference, "speed");

        assert_eq!(request.open_hypotheses.get("unknown"), Some(&1));
        assert_eq!(request.constant_since_start[0].key, "ltft");
        assert_eq!(request.constant_since_start[0].samples, 200);
        assert_eq!(request.modules[0].dialect, "kwp21");
        assert_eq!(request.modules[0].nrc_ladder[0]["request"], "2100");
        assert!(request.questions.iter().any(|question| question
            == "module 6A8/688 speaks 0x21; which local identifiers does it expose and how is it identified?"));
        assert!(request
            .questions
            .iter()
            .any(|question| question.contains("1 silent routes")
                && question.contains("11-bit range")));
        assert_eq!(
            request
                .questions
                .iter()
                .filter(|question| question.contains("silent routes"))
                .count(),
            1
        );
        assert!(request
            .questions
            .iter()
            .any(|question| question.contains("75F/65F") && question.contains("0x31")));
    }

    #[test]
    fn research_request_carries_no_vin_or_serial() {
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        let vehicle_id = seed(&db);
        let module_id = db.upsert_discovered_module(vehicle_id, "6A8/688", Some("engine"));
        db.upsert_discovered_did(module_id, 0xF18C, "53 4E 31 32 33", 5, Some("ECU serial"));
        let request = research_request(&db, vehicle_id).unwrap();
        let json = serde_json::to_string(&request).unwrap();

        assert!(!json.contains("VF7EXAMPLE0000123"), "{json}");
        assert!(!json.contains("EXAMPLE0000123"), "{json}");
        assert!(!json.contains("SN123"), "{json}");
        assert!(!json.contains("53 4E 31 32 33"), "{json}");
        assert!(!json.contains("56 46 37"), "{json}");
        assert!(!json.contains("raw_sample"), "{json}");
        assert!(json.contains("\"wmi\":\"VF7\""), "{json}");
    }

    #[test]
    fn an_unknown_vehicle_has_no_research_request() {
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        assert!(research_request(&db, 999).is_none());
    }
}
