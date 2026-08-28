//! Read-only research candidates used to prioritize discovery.
//!
//! This is intentionally separate from `packs`: an entry here is evidence
//! about where to look, never a trusted module or decode. Callers must supply
//! a matching platform for platform-scoped routes. Candidate DIDs are only
//! suitable for observations/hypotheses.

use serde::Deserialize;
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

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
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
    pub candidate_dids: Vec<String>,
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
                        assert!(route
                            .claim_ids
                            .iter()
                            .all(|id| claims.contains(id.as_str())));
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
        assert!(route.candidate_dids.contains(&"2A53".to_string()));
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
}
