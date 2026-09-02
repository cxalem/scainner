use super::pack_ext::{self, BandClass, ProfileModule};
use super::research::{self, CandidateDecodeHypothesis};
use crate::elm::uds_map::{self, hex16, ReadService, Route, RouteProtocol, UdsMap};
use serde::Serialize;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReadStage {
    Presence,
    Discovery,
    Candidate,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct PlannedRead {
    pub did: u16,
    pub purpose: String,
    pub stage: ReadStage,
    pub candidate_decodes: Vec<CandidateDecodeHypothesis>,
}

#[derive(Serialize, Clone, Debug)]
pub struct PlanTarget {
    pub key: String,
    pub label: String,
    pub expected_family: String,
    pub req: String,
    pub resp: String,
    pub route: Route,
    pub read_service: ReadService,
    pub dids: Vec<PlannedRead>,
    pub sweep: Vec<(u16, u16)>,
    pub source: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct ParkedPlan {
    pub plan_version: String,
    pub brand_id: Option<String>,
    pub platform: Option<String>,
    pub targets: Vec<PlanTarget>,
    pub sweep_budget_secs: u64,
}

pub const SWEEP_BUDGET_SECS: u64 = 240;

pub fn plan_version(vin: Option<&str>) -> String {
    let brand = uds_map::brand_for_vin(vin)
        .map(|b| b.id.clone())
        .unwrap_or_else(|| "unknown".into());
    let platform = uds_map::platform_for_vin(vin)
        .map(|p| p.key)
        .unwrap_or_else(|| "unknown".into());
    format!("{brand}-{platform}-v{}", pack_ext::plan_revision())
}

fn plan_version_for(vin: Option<&str>, platform: Option<&str>) -> String {
    let brand = uds_map::brand_for_vin(vin)
        .map(|brand| brand.id.clone())
        .unwrap_or_else(|| "unknown".into());
    format!(
        "{brand}-{}-v{}",
        platform.unwrap_or("unknown"),
        pack_ext::plan_revision()
    )
}

fn address(value: u32) -> String {
    if value <= 0x7FF {
        format!("{value:03X}")
    } else {
        format!("{value:08X}")
    }
}

fn candidate_protocol(value: &str) -> Option<RouteProtocol> {
    match value {
        "can11_500" => Some(RouteProtocol::Can11_500),
        "can11_250" => Some(RouteProtocol::Can11_250),
        "can29_normal_fixed" => Some(RouteProtocol::Can29NormalFixed),
        "can29_target_byte" => Some(RouteProtocol::Can29TargetByte),
        "can29_custom" => Some(RouteProtocol::Can29Custom),
        _ => None,
    }
}

fn candidate_read_service(value: &str) -> Option<ReadService> {
    match value {
        "21" => Some(ReadService::DataByLocalIdentifier),
        "22" => Some(ReadService::DataByIdentifier),
        _ => None,
    }
}

fn identity_reads(vin: Option<&str>) -> Vec<PlannedRead> {
    let mut reads = vec![PlannedRead {
        did: uds_map::presence_probe_did(),
        purpose: "presence probe / active diagnostic session".into(),
        stage: ReadStage::Discovery,
        candidate_decodes: Vec::new(),
    }];
    let block = uds_map::identity_block_for_vin(vin);
    for entry in &block.dids {
        let Some(did) = hex16(&entry.did) else {
            continue;
        };
        let purpose = format!(
            "identity: {} ({})",
            serde_json::to_value(entry.field)
                .ok()
                .and_then(|v| v.as_str().map(str::to_string))
                .unwrap_or_default(),
            serde_json::to_value(entry.layout)
                .ok()
                .and_then(|v| v.as_str().map(str::to_string))
                .unwrap_or_default()
        );
        match reads.iter_mut().find(|r| r.did == did) {
            Some(existing) => {
                if !existing.purpose.starts_with("identity") {
                    existing.purpose = purpose;
                } else {
                    existing.purpose.push_str(" + ");
                    existing
                        .purpose
                        .push_str(purpose.trim_start_matches("identity: "));
                }
            }
            None => reads.push(PlannedRead {
                did,
                purpose,
                stage: ReadStage::Discovery,
                candidate_decodes: Vec::new(),
            }),
        }
    }
    reads
}

fn data_evidence(map: &UdsMap, vin: Option<&str>, module: &ProfileModule) -> usize {
    let family_decodes = module
        .family_id
        .as_deref()
        .and_then(|id| uds_map::family_by_id(map, id))
        .map(|f| f.decodes.len())
        .unwrap_or(0);
    let bound = uds_map::known_dids_for_module(vin, module.req, module.resp)
        .into_iter()
        .filter(|did| !uds_map::decodes_for_did(vin, module.req, module.resp, *did).is_empty())
        .count();
    family_decodes + bound
}

pub fn sweep_bands(map: &UdsMap, vin: Option<&str>, family_id: Option<&str>) -> Vec<(u16, u16)> {
    let Some(brand) = uds_map::brand_for_vin_in(map, vin) else {
        return Vec::new();
    };
    let classes = pack_ext::band_classes_for_module(map, vin, family_id);
    let mut ranked: Vec<(u8, u16, u16)> = brand
        .did_bands
        .iter()
        .filter(|band| pack_ext::band_class(map, vin, band) == BandClass::Data)
        .filter_map(|band| {
            let (from, to) = (hex16(&band.from)?, hex16(&band.to)?);
            if classes.exclude.iter().any(|(f, t)| *f <= to && from <= *t) {
                return None;
            }
            Some((confidence_rank(band.confidence.as_deref()), from, to))
        })
        .collect();
    ranked.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
    ranked.dedup_by(|a, b| a.1 == b.1 && a.2 == b.2);
    ranked.into_iter().map(|(_, f, t)| (f, t)).collect()
}

fn confidence_rank(c: Option<&str>) -> u8 {
    match c {
        Some("confirmed") => 0,
        Some("high") => 1,
        Some("medium") => 2,
        Some("low") => 3,
        _ => 2,
    }
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn generate(vin: Option<&str>, reached: &[(u32, u32)], map: &UdsMap) -> ParkedPlan {
    generate_for_vehicle(vin, None, reached, map)
}

pub fn generate_for_vehicle(
    vin: Option<&str>,
    model: Option<&str>,
    reached: &[(u32, u32)],
    map: &UdsMap,
) -> ParkedPlan {
    let profile = pack_ext::profile_modules_for_vin(map, vin);
    let brand_id = uds_map::brand_for_vin_in(map, vin).map(|b| b.id.clone());
    let mut modules: Vec<ProfileModule> = if reached.is_empty() {
        profile.clone()
    } else {
        profile
            .iter()
            .filter(|m| reached.contains(&(m.req, m.resp)))
            .cloned()
            .collect()
    };
    for (req, resp) in reached {
        if !modules.iter().any(|m| m.req == *req && m.resp == *resp) {
            modules.push(ProfileModule {
                req: *req,
                resp: *resp,
                name: None,
                family_id: None,
                family_name: None,
            });
        }
    }
    let reads = identity_reads(vin);
    let mut targets: Vec<PlanTarget> = modules
        .iter()
        .map(|m| {
            let (req, resp) = (address(m.req), address(m.resp));
            let key = format!("{}_{}", req.to_lowercase(), resp.to_lowercase());
            PlanTarget {
                label: m.name.clone().unwrap_or_else(|| format!("Module {req}")),
                expected_family: m.family_name.clone().unwrap_or_else(|| "unknown".into()),
                route: uds_map::route_for_module(vin, m.req, m.resp),
                read_service: uds_map::read_service_for_module(vin, m.req, m.resp),
                dids: reads.clone(),
                sweep: Vec::new(),
                source: match (&m.family_id, reached.is_empty()) {
                    (Some(f), false) => format!("reached route; family {f} seen on it in the pack"),
                    (Some(f), true) => format!("profile route; family {f} seen on it in the pack"),
                    (None, false) => "reached route; identity block from the profile".into(),
                    (None, true) => "profile route; identity block from the profile".into(),
                },
                key,
                req,
                resp,
            }
        })
        .collect();
    let platform_key = uds_map::platform_for_vin(vin)
        .map(|platform| platform.key)
        .or_else(|| research::platform_for_vehicle_facts(vin, model));
    // Lower-trust research must not widen a plan from WMI alone; platform routes need an exact match.
    for candidate in research::routes_for_exploration(vin, platform_key.as_deref()) {
        let (Some(protocol), Some(read_service), Some(req), Some(resp)) = (
            candidate_protocol(&candidate.protocol),
            candidate_read_service(&candidate.service),
            u32::from_str_radix(&candidate.req, 16).ok(),
            u32::from_str_radix(&candidate.resp, 16).ok(),
        ) else {
            continue;
        };
        let mut dids = if candidate.service == "21" {
            Vec::new()
        } else if candidate.requires_identity {
            let mut reads = identity_reads(vin);
            if let Some(presence) = reads.first_mut() {
                presence.purpose = "research route presence gate".into();
                presence.stage = ReadStage::Presence;
            }
            reads
        } else {
            vec![PlannedRead {
                did: uds_map::presence_probe_did(),
                purpose: "research route presence probe".into(),
                stage: ReadStage::Presence,
                candidate_decodes: Vec::new(),
            }]
        };
        dids.extend(
            candidate
                .candidate_dids
                .iter()
                .filter(|did| did.executable())
                .filter_map(|did| {
                    Some(PlannedRead {
                        did: hex16(did.did())?,
                        purpose: did.purpose(&candidate.claim_ids),
                        stage: if candidate.service == "21" {
                            ReadStage::Presence
                        } else {
                            ReadStage::Candidate
                        },
                        candidate_decodes: did.decode_hypotheses(&candidate.claim_ids),
                    })
                }),
        );
        if let Some(target) = targets
            .iter_mut()
            .find(|target| target.req == address(req) && target.resp == address(resp))
        {
            for read in dids
                .into_iter()
                .filter(|read| read.stage == ReadStage::Candidate)
            {
                if !target
                    .dids
                    .iter()
                    .any(|existing| existing.did == read.did && existing.stage == read.stage)
                {
                    target.dids.push(read);
                }
            }
            continue;
        }
        targets.push(PlanTarget {
            key: format!("research_{}", candidate.route_id),
            label: candidate
                .module_role
                .as_deref()
                .map(|role| format!("Research candidate: {role} ({})", candidate.platform))
                .unwrap_or_else(|| format!("Research candidate: {}", candidate.platform)),
            expected_family: "unknown".into(),
            req: address(req),
            resp: address(resp),
            route: Route {
                protocol,
                req: address(req),
                resp: address(resp),
                target_byte: None,
                address_extension: candidate.address_extension,
                gateway: None,
                source: None,
            },
            read_service,
            dids,
            sweep: if candidate.exploration_only {
                sweep_bands(map, vin, None)
            } else {
                Vec::new()
            },
            source: format!(
                "untrusted research candidate from {}; vehicle applicability untested",
                candidate.claim_ids.join(", ")
            ),
        });
    }
    let sweep_target = modules
        .iter()
        .enumerate()
        .map(|(i, m)| (data_evidence(map, vin, m), i))
        .filter(|(evidence, _)| *evidence > 0)
        .max_by_key(|(evidence, i)| (*evidence, usize::MAX - *i))
        .map(|(_, i)| i);
    if let Some(index) = sweep_target {
        let module = &modules[index];
        let bands = sweep_bands(map, vin, module.family_id.as_deref());
        if !bands.is_empty() {
            let base = &targets[index];
            let sweep = PlanTarget {
                key: format!("{}_sweep", base.key),
                label: format!("{} data sweep", base.label),
                expected_family: base.expected_family.clone(),
                req: base.req.clone(),
                resp: base.resp.clone(),
                route: base.route.clone(),
                read_service: base.read_service,
                dids: Vec::new(),
                sweep: bands,
                source: "bounded default-session sweep over the brand's data bands (identity and configuration classes excluded), on the route with the most decoded evidence in the pack".into(),
            };
            targets.push(sweep);
        }
    }
    ParkedPlan {
        plan_version: plan_version_for(vin, platform_key.as_deref()),
        brand_id,
        platform: platform_key,
        targets,
        sweep_budget_secs: SWEEP_BUDGET_SECS,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::elm::discovery::pack_ext::tests::verified_brand_vin;
    use crate::elm::uds_map::map;

    fn routes_reached_by_the_verified_vehicle() -> Vec<(u32, u32)> {
        vec![(0x74A, 0x64A), (0x6AD, 0x68D), (0x6B5, 0x695)]
    }

    fn vin_for_brand(id: &str) -> String {
        let brand = map().brands.iter().find(|brand| brand.id == id).unwrap();
        format!("{}EXAMPLE00000000", brand.wmi[0])
    }

    #[test]
    fn the_generator_reproduces_the_recorded_plan_from_pack_data() {
        let vin = verified_brand_vin();
        let plan = generate(Some(&vin), &routes_reached_by_the_verified_vehicle(), map());
        let brand = uds_map::brand_for_vin(Some(&vin)).unwrap();
        assert_eq!(plan.brand_id.as_deref(), Some(brand.id.as_str()));
        assert_eq!(
            plan.plan_version,
            format!("{}-unknown-v{}", brand.id, pack_ext::plan_revision()),
            "no VDS pattern is confirmed for the platform, so it stays unknown"
        );
        let identity: Vec<&PlanTarget> = plan
            .targets
            .iter()
            .filter(|target| target.sweep.is_empty() && !target.key.starts_with("research_"))
            .collect();
        assert_eq!(
            identity.len(),
            3,
            "{:?}",
            plan.targets.iter().map(|t| &t.key).collect::<Vec<_>>()
        );
        let routes: Vec<(String, String)> = identity
            .iter()
            .map(|t| (t.req.clone(), t.resp.clone()))
            .collect();
        for (req, resp) in [("74A", "64A"), ("6AD", "68D"), ("6B5", "695")] {
            assert!(
                routes.contains(&(req.into(), resp.into())),
                "{req}/{resp} missing"
            );
        }
        for target in &identity {
            let dids: Vec<u16> = target.dids.iter().map(|d| d.did).collect();
            for did in [
                0xF186, 0xF18C, 0xF080, 0xF0FE, 0xF187, 0xF191, 0xF195, 0xF197,
            ] {
                assert!(dids.contains(&did), "{}: {did:04X} missing", target.key);
            }
            assert_eq!(target.read_service, ReadService::DataByIdentifier);
            assert_eq!(target.route.protocol, uds_map::RouteProtocol::Can11_500);
            assert_ne!(target.expected_family, "unknown");
        }
        let sweep = plan
            .targets
            .iter()
            .find(|target| target.key.ends_with("_sweep"))
            .expect("a sweep target");
        assert_eq!((sweep.req.as_str(), sweep.resp.as_str()), ("6AD", "68D"));
        assert!(sweep.sweep.contains(&(0xD400, 0xD4FF)), "{:?}", sweep.sweep);
        assert!(sweep.sweep.contains(&(0xD000, 0xD0FF)), "{:?}", sweep.sweep);
        assert_eq!(sweep.sweep[0], (0xD400, 0xD4FF), "confirmed bands first");
        for (from, to) in &sweep.sweep {
            assert!(
                !(0xF000..=0xF1FF).contains(from),
                "identity band swept: {from:04X}-{to:04X}"
            );
            assert!(
                !(0x2100..=0x23FF).contains(from),
                "config band swept: {from:04X}-{to:04X}"
            );
            assert!(
                !(0xD600..=0xD6FF).contains(from),
                "config-class band swept: {from:04X}-{to:04X}"
            );
        }
        assert_eq!(plan.sweep_budget_secs, SWEEP_BUDGET_SECS);
    }

    #[test]
    fn without_reached_routes_every_profile_module_is_a_target() {
        let vin = verified_brand_vin();
        let plan = generate(Some(&vin), &[], map());
        let profile = pack_ext::profile_modules_for_vin(map(), Some(&vin));
        let identity = plan
            .targets
            .iter()
            .filter(|target| target.sweep.is_empty() && !target.key.starts_with("research_"))
            .count();
        assert_eq!(identity, profile.len());
        assert!(plan.targets.iter().any(|t| !t.sweep.is_empty()));
    }

    #[test]
    fn another_brand_gets_its_own_iso_plan_and_service() {
        let (brand, module) = map()
            .brands
            .iter()
            .find_map(|b| {
                b.modules
                    .iter()
                    .find(|m| m.read_service == Some(ReadService::DataByLocalIdentifier))
                    .map(|m| (b, m))
            })
            .expect("a module on service 21 in the pack");
        let vin = format!("{}EXAMPLE0000002", brand.wmi[0]);
        let plan = generate(Some(&vin), &[], map());
        assert!(plan.plan_version.starts_with(&format!("{}-", brand.id)));
        let target = plan
            .targets
            .iter()
            .find(|t| t.req.eq_ignore_ascii_case(&module.req))
            .unwrap();
        assert_eq!(target.read_service, ReadService::DataByLocalIdentifier);
        assert!(target.dids.iter().any(|d| d.did == 0xF187));
        assert!(
            !target.dids.iter().any(|d| d.did == 0xF080),
            "no vendor DIDs of another brand"
        );
    }

    #[test]
    fn an_unknown_vin_plans_only_the_reached_routes_with_the_iso_block() {
        let plan = generate(Some("ZZZ00000000000000"), &[(0x7E0, 0x7E8)], map());
        assert_eq!(
            plan.plan_version,
            format!("unknown-unknown-v{}", pack_ext::plan_revision())
        );
        assert_eq!(plan.targets.len(), 1);
        assert_eq!(plan.targets[0].expected_family, "unknown");
        assert!(plan.targets[0].dids.iter().any(|d| d.did == 0xF187));
        assert!(generate(None, &[], map()).targets.is_empty());
    }

    #[test]
    fn a_weak_existing_brand_gets_candidate_routes_without_trusted_decodes() {
        let vin = vin_for_brand("subaru");
        let plan = generate(Some(&vin), &[], map());
        let candidates: Vec<&PlanTarget> = plan
            .targets
            .iter()
            .filter(|target| target.key.starts_with("research_"))
            .collect();
        assert_eq!(candidates.len(), 2);
        assert!(candidates.iter().all(|target| target.sweep.is_empty()));
        assert!(candidates
            .iter()
            .all(|target| target.source.contains("vehicle applicability untested")));
        for target in candidates {
            let candidate_at = target
                .dids
                .iter()
                .position(|read| read.stage == ReadStage::Candidate);
            if let Some(candidate_at) = candidate_at {
                assert!(
                    candidate_at > 0,
                    "candidate reads must follow discovery reads"
                );
                assert!(target.dids[..candidate_at]
                    .iter()
                    .all(|read| read.stage != ReadStage::Candidate));
                assert!(target.dids[candidate_at..]
                    .iter()
                    .all(|read| read.stage == ReadStage::Candidate));
            }
        }
    }

    #[test]
    fn research_model_selection_never_guesses_an_ambiguous_platform() {
        let vin = vin_for_brand("renault");
        let unknown = generate_for_vehicle(Some(&vin), None, &[], map());
        assert!(unknown
            .targets
            .iter()
            .all(|target| !target.key.starts_with("research_renault_")));

        let ambiguous = generate_for_vehicle(Some(&vin), Some("Zoe"), &[], map());
        assert_eq!(ambiguous.platform, None);
        assert!(ambiguous
            .targets
            .iter()
            .all(|target| !target.key.starts_with("research_renault_")));

        let exact = generate_for_vehicle(Some(&vin), Some("Megane"), &[], map());
        assert_eq!(exact.platform.as_deref(), Some("renault_cmf_cd"));
        assert!(exact
            .targets
            .iter()
            .any(|target| target.dids.iter().any(|read| {
                read.stage == ReadStage::Candidate && read.purpose.contains("research candidate")
            })));
    }

    #[test]
    fn c4_catalogue_routes_are_presence_gated_without_replacing_confirmed_routes() {
        let vin = vin_for_brand("psa");
        let reached = [(0x74A, 0x64A), (0x6AD, 0x68D), (0x6B5, 0x695)];
        let plan = generate_for_vehicle(Some(&vin), Some("C4 III"), &reached, map());
        assert_eq!(plan.platform.as_deref(), Some("psa_c41_project_observed"));

        let camera: Vec<&PlanTarget> = plan
            .targets
            .iter()
            .filter(|target| target.req == "74A" && target.resp == "64A")
            .collect();
        assert_eq!(camera.len(), 1);
        assert!(!camera[0].label.contains("rain_light_or_roof"));

        let airbag = plan
            .targets
            .iter()
            .find(|target| target.key == "research_psa_catalog_airbag_744_644")
            .unwrap();
        assert_eq!(airbag.dids[0].stage, ReadStage::Presence);
        assert!(!airbag.sweep.is_empty());
        assert!(airbag.dids[1..]
            .iter()
            .all(|read| read.stage == ReadStage::Discovery));
        assert!(plan
            .targets
            .iter()
            .all(|target| target.key != "research_psa_mmc_ev_bmu_761_762"));
    }
}
