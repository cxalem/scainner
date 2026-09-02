//! The research request: what one car actually said, de-identified, in the
//! research pack's own conflicts-and-gaps vocabulary.
//!
//! It closes the loop the other way round from `research.rs`: a pack tells
//! discovery where to look, and this tells the next round of research what
//! the looking found — which routes stayed silent, which modules answered
//! without matching a family, which identifiers are still unlabelled.
//! Generated, never authored, and pasted into the next deep-research prompt.
//!
//! **Nothing identifying leaves here.** The VIN contributes only its
//! three-character WMI, module identity is limited to the part/hardware/
//! software references and the system name, and no raw payload is exported:
//! an unlabelled identifier's bytes may well be the serial nobody has
//! classified yet. `research_request_carries_no_vin_or_serial` is the test.

use super::state::KnowledgeState;
use crate::db::Db;
use crate::elm::uds_map;
use serde::Serialize;
use std::collections::BTreeMap;

pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Serialize)]
pub struct ResearchRequest {
    pub schema_version: u32,
    pub generated_at: String,
    /// The VIN's world manufacturer identifier and nothing else from it.
    pub wmi: Option<String>,
    pub platform_key: Option<String>,
    pub knowledge_key: String,
    pub modules: Vec<RequestModule>,
    pub route_outcomes: Vec<RequestRouteOutcome>,
    pub unlabeled_dids: Vec<RequestDid>,
    pub conflicts: Vec<RequestConflict>,
    pub open_hypotheses: BTreeMap<String, usize>,
    pub questions: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct RequestModule {
    pub address: String,
    pub name: Option<String>,
    pub route_state: Option<String>,
    pub identity: RequestIdentity,
    pub identity_fit: Option<String>,
    pub family_match: Option<String>,
}

/// The fingerprint tuple only: no VIN, no serial, nothing owner-specific.
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
    /// How the value behaves over the samples taken: `constant`, `slow`,
    /// `fast`, `event_like`, or `unsampled` when nothing has read it twice.
    pub shape_class: String,
    /// How many samples that classification rests on. The payloads
    /// themselves stay on the vehicle.
    pub samples: i64,
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

/// The correlation engine stores its shape beside the hypothesis; the class
/// is the part a research prompt can act on without the payloads.
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

/// De-identified evidence for one vehicle. `None` when the vehicle is unknown.
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
        .map(|module| RequestModule {
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

    // An identifier is worth asking research about when the vehicle answered
    // it and nothing in the trusted map, the overlays or a family join could
    // say what it means.
    let mut unlabeled_dids: Vec<RequestDid> = Vec::new();
    for module in &module_rows {
        let shapes: BTreeMap<u16, (Option<String>, i64)> = hypotheses
            .iter()
            .filter(|hypothesis| hypothesis.module_id == module.id)
            .map(|hypothesis| {
                (
                    hypothesis.did,
                    (hypothesis.shape_json.clone(), hypothesis.sample_count),
                )
            })
            .collect();
        for did in db.discovered_dids(module.id) {
            if did.label.is_some() {
                continue;
            }
            let (shape, samples) = shapes.get(&did.did).cloned().unwrap_or((None, 0));
            unlabeled_dids.push(RequestDid {
                address: module.address.clone(),
                did: hex_did(did.did),
                byte_length: did.byte_length,
                shape_class: shape_class(shape.as_deref()),
                samples,
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
    for outcome in &route_outcomes {
        match outcome.state.as_str() {
            "silent" => questions.push(format!(
                "route {} silent on {} connection(s): is there a module there on this platform, and behind which gateway?",
                outcome.address, outcome.attempts
            )),
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

        // The labelled identity DID is knowledge; only the unlabelled one is
        // a question for research.
        let dids: Vec<&str> = request
            .unlabeled_dids
            .iter()
            .map(|did| did.did.as_str())
            .collect();
        assert_eq!(dids, ["D410"]);
        assert_eq!(request.unlabeled_dids[0].byte_length, Some(2));
        assert_eq!(request.unlabeled_dids[0].shape_class, "unsampled");

        assert_eq!(request.open_hypotheses.get("unknown"), Some(&1));
        assert!(request
            .questions
            .iter()
            .any(|question| question.contains("752/652") && question.contains("silent on 2")));
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
        // A serial-looking identity value must not survive into the export,
        // and neither must the VIN or its raw payload.
        db.upsert_discovered_did(module_id, 0xF18C, "53 4E 31 32 33", 5, Some("ECU serial"));
        let request = research_request(&db, vehicle_id).unwrap();
        let json = serde_json::to_string(&request).unwrap();

        assert!(!json.contains("VF7EXAMPLE0000123"), "{json}");
        assert!(!json.contains("EXAMPLE0000123"), "{json}");
        assert!(!json.contains("SN123"), "{json}");
        assert!(!json.contains("53 4E 31 32 33"), "{json}");
        assert!(!json.contains("56 46 37"), "{json}");
        assert!(!json.contains("raw_sample"), "{json}");
        // The WMI, which is brand routing rather than owner identity, stays.
        assert!(json.contains("\"wmi\":\"VF7\""), "{json}");
    }

    #[test]
    fn an_unknown_vehicle_has_no_research_request() {
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        assert!(research_request(&db, 999).is_none());
    }
}
