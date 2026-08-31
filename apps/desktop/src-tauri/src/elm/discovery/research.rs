//! Read-only research candidates used to prioritize discovery.
//!
//! This is intentionally separate from `packs`: an entry here is evidence
//! about where to look, never a trusted module or decode. Callers must supply
//! a matching platform for platform-scoped routes. Candidate DIDs are only
//! suitable for observations/hypotheses.

use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeSet;
use std::sync::OnceLock;

const INDEX_RAW: &str = include_str!("../../../../../../packages/uds-map/data/research-packs.json");
const EMBEDDED: &[(&str, &str)] = &[
    (
        "research/research-candidates-v2.json",
        include_str!(
            "../../../../../../packages/uds-map/data/research/research-candidates-v2.json"
        ),
    ),
    (
        "research/existing-brand-hypotheses-v3.json",
        include_str!(
            "../../../../../../packages/uds-map/data/research/existing-brand-hypotheses-v3.json"
        ),
    ),
];

#[derive(Debug, Deserialize)]
struct ResearchIndex {
    schema_version: u32,
    packs: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct ResearchPack {
    pub schema_version: u32,
    pub pack_id: String,
    pub version: u32,
    pub research_date: String,
    pub mode: String,
    pub policy: ResearchPolicy,
    pub profiles: Vec<CandidateProfile>,
    pub claims: Vec<ResearchClaim>,
}

#[derive(Debug, Deserialize)]
pub struct ResearchPolicy {
    pub read_only: bool,
    pub default_session_only: bool,
    pub max_outstanding_requests: u32,
    pub forbidden_services: Vec<String>,
    pub candidate_decodes_are_hypotheses: bool,
}

#[derive(Debug, Deserialize)]
pub struct CandidateProfile {
    pub brand_id: String,
    pub brand_name: String,
    pub status: String,
    pub wmis: Vec<String>,
    pub routes: Vec<CandidateRoute>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct CandidateRoute {
    pub route_id: String,
    pub platform: String,
    pub protocol: String,
    pub req: String,
    pub resp: String,
    pub address_extension: Option<String>,
    pub service: String,
    pub session: String,
    pub claim_ids: Vec<String>,
    #[serde(default)]
    pub module_role: Option<String>,
    #[serde(default = "default_true")]
    pub requires_identity: bool,
    #[serde(default)]
    pub candidate_dids: Vec<CandidateDid>,
}

fn default_true() -> bool {
    true
}

/// A research DID may remain a bare identifier, or carry enough hypothesis
/// metadata to tell the verifier what the source claims and how to test it.
/// None of these fields enter the trusted decode path.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum CandidateDid {
    Id(String),
    Detailed(CandidateDidHypothesis),
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct CandidateDidHypothesis {
    pub did: String,
    #[serde(default)]
    pub semantic: Option<String>,
    #[serde(default)]
    pub decode: Option<Value>,
    #[serde(default)]
    pub validation: Option<ValidationRecipe>,
    #[serde(default = "default_true")]
    pub automatic_execution_authorized: bool,
    #[serde(default)]
    pub support_status: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct ValidationRecipe {
    pub kind: String,
    #[serde(default)]
    pub instructions: Vec<String>,
    #[serde(default)]
    pub expected_behavior: Vec<String>,
}

impl CandidateDid {
    const SUPPORT_STATUSES: [&'static str; 6] = [
        "candidate",
        "source_observed",
        "supported",
        "physically_supported_on_test_vehicle",
        "unsupported",
        "explicitly_unsupported_on_test_vehicle",
    ];

    pub fn did(&self) -> &str {
        match self {
            Self::Id(did) => did,
            Self::Detailed(candidate) => &candidate.did,
        }
    }

    /// Unsupported and explicitly non-executable records remain available as
    /// evidence, but never become vehicle-facing requests.
    pub fn executable(&self) -> bool {
        match self {
            Self::Id(_) => true,
            Self::Detailed(candidate) => {
                candidate.automatic_execution_authorized
                    && matches!(
                        candidate.support_status.as_deref(),
                        None | Some(
                            "candidate"
                                | "source_observed"
                                | "supported"
                                | "physically_supported_on_test_vehicle"
                        )
                    )
            }
        }
    }

    fn support_status_valid(&self) -> bool {
        match self {
            Self::Id(_) => true,
            Self::Detailed(candidate) => candidate
                .support_status
                .as_deref()
                .is_none_or(|status| Self::SUPPORT_STATUSES.contains(&status)),
        }
    }

    pub fn purpose(&self, claim_ids: &[String]) -> String {
        let claims = claim_ids.join(", ");
        match self {
            Self::Id(_) => format!("research candidate only; claims {claims}"),
            Self::Detailed(candidate) => {
                let semantic = candidate.semantic.as_deref().unwrap_or("meaning unknown");
                let validation = candidate
                    .validation
                    .as_ref()
                    .map(|recipe| format!("; validate with {}", recipe.kind))
                    .unwrap_or_default();
                let proposed_decode = candidate
                    .decode
                    .as_ref()
                    .map(|_| "; proposed decode retained as an untrusted hypothesis")
                    .unwrap_or_default();
                format!(
                    "research candidate: {semantic}{proposed_decode}{validation}; claims {claims}"
                )
            }
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct ResearchClaim {
    pub claim_id: String,
    pub exact_claim: String,
    pub knowledge_state: String,
    pub source_fidelity: String,
    pub vehicle_applicability: String,
    pub scope: String,
    #[serde(default)]
    pub action_if_connected: String,
    #[serde(default)]
    pub promotion_test: String,
    pub source: ResearchSource,
}

#[derive(Debug, Deserialize)]
pub struct ResearchSource {
    pub url: String,
    pub revision: String,
    pub retrieved_at: String,
    pub license: String,
}

fn index() -> &'static ResearchIndex {
    static INDEX: OnceLock<ResearchIndex> = OnceLock::new();
    INDEX.get_or_init(|| {
        serde_json::from_str(INDEX_RAW).expect("data/research-packs.json is malformed")
    })
}

pub fn packs() -> &'static [ResearchPack] {
    static PACKS: OnceLock<Vec<ResearchPack>> = OnceLock::new();
    PACKS.get_or_init(|| {
        assert_eq!(
            index().schema_version,
            1,
            "unsupported research index schema"
        );
        index()
            .packs
            .iter()
            .map(|name| {
                let raw = EMBEDDED
                    .iter()
                    .find(|(file, _)| file == name)
                    .map(|(_, raw)| *raw)
                    .unwrap_or_else(|| panic!("research index lists unembedded pack {name}"));
                let pack: ResearchPack = serde_json::from_str(raw)
                    .unwrap_or_else(|e| panic!("research pack {name} is malformed: {e}"));
                assert_eq!(pack.schema_version, 1, "unsupported schema in {name}");
                assert!(!pack.pack_id.is_empty(), "{name} has no pack id");
                assert!(pack.version > 0, "{name} has no version");
                assert!(
                    !pack.research_date.is_empty(),
                    "{name} has no research date"
                );
                assert_eq!(
                    pack.mode, "candidate_discovery_only",
                    "unsafe mode in {name}"
                );
                assert!(pack.policy.read_only, "{name} is not read-only");
                assert!(pack.policy.default_session_only, "{name} changes session");
                assert_eq!(
                    pack.policy.max_outstanding_requests, 1,
                    "{name} request concurrency"
                );
                assert!(pack.policy.candidate_decodes_are_hypotheses);
                assert!(pack.policy.forbidden_services.iter().any(|s| s == "27"));
                let claims: BTreeSet<&str> = pack
                    .claims
                    .iter()
                    .map(|claim| claim.claim_id.as_str())
                    .collect();
                for profile in &pack.profiles {
                    assert!(!profile.brand_id.is_empty());
                    assert!(!profile.brand_name.is_empty());
                    assert!(!profile.status.is_empty());
                    for route in &profile.routes {
                        assert!(
                            matches!(
                                route.protocol.as_str(),
                                "can11_500"
                                    | "can11_250"
                                    | "can29_normal_fixed"
                                    | "can29_target_byte"
                                    | "can29_custom"
                            ),
                            "unsupported protocol {} on {}",
                            route.protocol,
                            route.route_id
                        );
                        assert!(
                            u32::from_str_radix(&route.req, 16).is_ok()
                                && u32::from_str_radix(&route.resp, 16).is_ok(),
                            "non-hex route address on {}: {}/{}",
                            route.route_id,
                            route.req,
                            route.resp
                        );
                        assert!(route
                            .claim_ids
                            .iter()
                            .all(|id| claims.contains(id.as_str())));
                        assert!(route.candidate_dids.iter().all(|did| u16::from_str_radix(
                            did.did(),
                            16
                        )
                        .is_ok()));
                        assert!(
                            route
                                .candidate_dids
                                .iter()
                                .all(CandidateDid::support_status_valid),
                            "unknown candidate support_status on {}",
                            route.route_id
                        );
                    }
                }
                for evidence in &pack.claims {
                    assert!(!evidence.exact_claim.is_empty());
                    assert!(!evidence.knowledge_state.is_empty());
                    assert!(!evidence.source_fidelity.is_empty());
                    assert!(!evidence.vehicle_applicability.is_empty());
                    assert!(!evidence.scope.is_empty());
                    if pack.pack_id == "existing-brand-hypotheses-v3-delta" {
                        assert!(!evidence.action_if_connected.is_empty());
                        assert!(!evidence.promotion_test.is_empty());
                    }
                    assert!(!evidence.source.url.is_empty());
                    assert!(!evidence.source.revision.is_empty());
                    assert!(!evidence.source.retrieved_at.is_empty());
                    assert!(!evidence.source.license.is_empty());
                }
                pack
            })
            .collect()
    })
}

fn wmi(vin: Option<&str>) -> Option<String> {
    vin.filter(|value| value.len() >= 3)
        .map(|value| value[..3].to_ascii_uppercase())
}

/// Candidate profiles selected only by a source-backed WMI.
pub fn profiles_for_vin(vin: Option<&str>) -> Vec<&'static CandidateProfile> {
    let Some(wmi) = wmi(vin) else {
        return Vec::new();
    };
    let mapped_brand = crate::elm::uds_map::brand_for_vin(vin).map(|brand| brand.id.as_str());
    packs()
        .iter()
        .flat_map(|pack| &pack.profiles)
        .filter(|profile| {
            mapped_brand == Some(profile.brand_id.as_str())
                || profile.wmis.iter().any(|known| known == &wmi)
        })
        .collect()
}

/// Routes safe to prioritize for this exact context.
///
/// Platform-scoped evidence requires an exact platform match. A route whose
/// platform is `unknown` is make-level research and can be returned after a
/// WMI match, but remains a candidate and never enters trusted lookups.
pub fn routes_for_context(vin: Option<&str>, platform: Option<&str>) -> Vec<CandidateRoute> {
    let mut routes: Vec<CandidateRoute> = profiles_for_vin(vin)
        .into_iter()
        .flat_map(|profile| &profile.routes)
        .filter(|route| {
            route.platform == "unknown"
                || platform.is_some_and(|actual| actual.eq_ignore_ascii_case(&route.platform))
        })
        .cloned()
        .collect();
    routes.sort_by(|a, b| {
        a.req
            .cmp(&b.req)
            .then(a.resp.cmp(&b.resp))
            .then(a.route_id.cmp(&b.route_id))
    });
    routes.dedup_by(|a, b| a.route_id == b.route_id);
    routes
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn vin_for_brand(id: &str) -> String {
        let brand = crate::elm::uds_map::map()
            .brands
            .iter()
            .find(|brand| brand.id == id)
            .unwrap();
        format!("{}EXAMPLE00000000", brand.wmi[0])
    }

    #[test]
    fn index_and_embedded_packs_match_and_are_safe() {
        let listed: Vec<&str> = index().packs.iter().map(String::as_str).collect();
        let embedded: Vec<&str> = EMBEDDED.iter().map(|(name, _)| *name).collect();
        assert_eq!(listed, embedded);
        for pack in packs() {
            assert_eq!(pack.schema_version, 1);
            assert_eq!(pack.mode, "candidate_discovery_only");
            assert!(pack.policy.read_only);
            assert!(pack.policy.default_session_only);
            assert!(pack.policy.candidate_decodes_are_hypotheses);
            assert_eq!(pack.policy.max_outstanding_requests, 1);
            assert!(!pack.pack_id.is_empty());
            assert!(pack.version > 0);
            assert!(!pack.research_date.is_empty());
        }
    }

    #[test]
    fn every_route_has_claims_and_only_read_service_22() {
        let claims: BTreeSet<&str> = packs()
            .iter()
            .flat_map(|pack| &pack.claims)
            .map(|claim| claim.claim_id.as_str())
            .collect();
        for profile in packs().iter().flat_map(|pack| &pack.profiles) {
            for route in &profile.routes {
                assert_eq!(route.service, "22", "{}", route.route_id);
                assert_eq!(route.session, "default_only", "{}", route.route_id);
                assert!(!route.claim_ids.is_empty(), "{}", route.route_id);
                assert!(route
                    .claim_ids
                    .iter()
                    .all(|id| claims.contains(id.as_str())));
            }
        }
    }

    #[test]
    fn sources_are_immutable_and_claim_ids_are_unique() {
        let mut ids = BTreeSet::new();
        for claim in packs().iter().flat_map(|pack| &pack.claims) {
            assert!(ids.insert(&claim.claim_id), "duplicate {}", claim.claim_id);
            assert_eq!(claim.source.revision.len(), 40);
            assert!(claim.source.url.contains(&claim.source.revision));
            assert!(!claim.source.license.is_empty());
            assert!(!claim.source.retrieved_at.is_empty());
            assert!(!claim.exact_claim.is_empty());
            assert!(!claim.scope.is_empty());
            assert!(!claim.knowledge_state.is_empty());
            assert!(!claim.source_fidelity.is_empty());
            assert!(matches!(
                claim.vehicle_applicability.as_str(),
                "untested_by_project" | "partially_project_confirmed"
            ));
        }
    }

    #[test]
    fn platform_routes_require_an_exact_platform_match() {
        assert!(routes_for_context(Some("WP0EXAMPLE00000000"), None).is_empty());
        assert!(routes_for_context(Some("WP0EXAMPLE00000000"), Some("911")).is_empty());
        let routes = routes_for_context(Some("WP0EXAMPLE00000000"), Some("Taycan"));
        assert_eq!(routes.len(), 1);
        assert_eq!(routes[0].route_id, "porsche_taycan_710_77a");
    }

    #[test]
    fn candidates_do_not_enter_the_trusted_decode_path() {
        let route = &routes_for_context(Some("WP0EXAMPLE00000000"), Some("Taycan"))[0];
        assert!(route.candidate_dids.iter().any(|did| did.did() == "2A53"));
        let req = u32::from_str_radix(&route.req, 16).unwrap();
        let resp = u32::from_str_radix(&route.resp, 16).unwrap();
        let did = u16::from_str_radix("2A53", 16).unwrap();
        assert!(
            crate::elm::uds_map::known_did(Some("WP0EXAMPLE00000000"), req, resp, did).is_none()
        );
        assert!(
            super::super::packs::overlay_known_did(Some("WP0EXAMPLE00000000"), req, resp, did)
                .is_none()
        );
    }

    #[test]
    fn detailed_candidates_retain_decode_and_validation_without_authorizing_every_read() {
        let candidate: CandidateDid = serde_json::from_value(serde_json::json!({
            "did": "18A0",
            "semantic": "HV battery temperature",
            "decode": {"encoding": "be", "len": 2, "scale": 0.1, "unit": "degC"},
            "validation": {
                "kind": "temperature_cross_check",
                "instructions": ["allow the parked vehicle to equilibrate"],
                "expected_behavior": ["changes slowly"]
            },
            "automatic_execution_authorized": false
        }))
        .unwrap();
        assert_eq!(candidate.did(), "18A0");
        assert!(!candidate.executable());
        let purpose = candidate.purpose(&["S07".into()]);
        assert!(purpose.contains("HV battery temperature"));
        assert!(purpose.contains("untrusted hypothesis"));
        assert!(purpose.contains("temperature_cross_check"));

        let unsupported: CandidateDid = serde_json::from_value(serde_json::json!({
            "did": "18A1",
            "support_status": "explicitly_unsupported_on_test_vehicle"
        }))
        .unwrap();
        assert!(!unsupported.executable());

        let misspelled: CandidateDid = serde_json::from_value(serde_json::json!({
            "did": "18A2",
            "support_status": "unsuported"
        }))
        .unwrap();
        assert!(!misspelled.support_status_valid());
        assert!(!misspelled.executable());
    }

    #[test]
    fn candidate_order_is_deterministic() {
        let first = routes_for_context(Some("SAJEXAMPLE00000000"), Some("Jaguar I-PACE"));
        let second = routes_for_context(Some("SAJEXAMPLE00000000"), Some("Jaguar I-PACE"));
        assert_eq!(first, second);
        let keys: BTreeMap<&str, &str> = first
            .iter()
            .map(|route| (route.req.as_str(), route.route_id.as_str()))
            .collect();
        assert_eq!(keys.len(), first.len());
    }

    #[test]
    fn existing_brand_delta_uses_the_main_maps_wmis_without_copying_them() {
        let routes = routes_for_context(Some(&vin_for_brand("subaru")), None);
        let ids: Vec<&str> = routes.iter().map(|route| route.route_id.as_str()).collect();
        assert_eq!(ids, ["subaru_tpms_753_75b", "subaru_engine_7a2_7aa"]);
    }

    #[test]
    fn supporting_psa_research_does_not_change_the_verified_cars_routes() {
        let routes = routes_for_context(Some(&vin_for_brand("psa")), None);
        assert!(routes.is_empty());
        let claim = packs()
            .iter()
            .flat_map(|pack| &pack.claims)
            .find(|claim| claim.claim_id == "psa.route_grammar.supporting")
            .unwrap();
        assert_eq!(claim.vehicle_applicability, "partially_project_confirmed");
        assert!(claim.action_if_connected.contains("never overwrite C4"));
    }

    #[test]
    fn seat_deep_research_delta_serves_make_wide_candidates_with_dids() {
        // No platform match yet: SEAT has zero `platforms[]` entries in the
        // trusted map (no confirmed `vds_pattern`), so only the `platform:
        // "unknown"` (make-wide) candidates from the delta can apply today —
        // the Mii Electric-specific routes stay inert until a real VIN
        // confirms that platform. See docs/product/research/
        // seat-deep-research-v1/ and packages/uds-map/scripts/
        // ingest-seat-research.py for where this data came from.
        let routes = routes_for_context(Some(&vin_for_brand("seat")), None);
        assert!(!routes.is_empty(), "expected make-wide SEAT candidates");
        assert!(
            routes.iter().all(|r| r.platform == "unknown"),
            "no platform resolved for this VIN, so only unknown-platform routes should surface"
        );
        assert!(
            routes.iter().any(|r| !r.candidate_dids.is_empty()),
            "expected at least one candidate route to carry candidate DIDs"
        );
        // The Mii Electric-scoped routes require an exact platform match and
        // must not leak in without one.
        assert!(routes.iter().all(|r| !r.route_id.starts_with("seat_mii_")));

        // With an exact (hypothetical) platform match, the Mii-scoped routes
        // become reachable too.
        let mii_routes = routes_for_context(
            Some(&vin_for_brand("seat")),
            Some("seat_mii_electric_shared_up"),
        );
        assert!(mii_routes
            .iter()
            .any(|r| r.route_id.starts_with("seat_mii_")));
    }
}
