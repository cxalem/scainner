use crate::db::{Db, DiscoveredModuleRow, HypothesisUpsert};
use crate::elm::discovery::family::{match_family, matched_family, CompatibilityKey, FamilyMatch};
use crate::elm::discovery::state::{is_hypothesis_candidate, IdentityFit, KnowledgeState};
use crate::elm::uds_map::{hex16, FamilyDecode, UdsMap};
use serde::Serialize;
use serde_json::json;

#[derive(Serialize, Clone, Debug)]
pub struct JoinedModule {
    pub module_id: i64,
    pub address: String,
    pub identity_fit: Option<String>,
    pub family_id: Option<String>,
    pub family_match: String,
    pub inherited: usize,
    pub unknown: usize,
    pub filtered: usize,
    pub skipped: Option<String>,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct JoinSummary {
    pub vehicle_id: i64,
    pub modules: Vec<JoinedModule>,
    pub inherited_created: usize,
    pub inherited_refreshed: usize,
    pub unknown_created: usize,
    pub unknown_refreshed: usize,
    pub filtered: usize,
    pub hypothesis_ids: Vec<i64>,
}

pub fn parse_hex(raw: &str) -> Vec<u8> {
    let compact: String = raw.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    compact
        .as_bytes()
        .chunks(2)
        .filter(|pair| pair.len() == 2)
        .filter_map(|pair| u8::from_str_radix(std::str::from_utf8(pair).ok()?, 16).ok())
        .collect()
}

fn decode_json(decode: &FamilyDecode, family_id: &str, m: &FamilyMatch) -> String {
    json!({
        "label": decode.label,
        "offset": decode.offset,
        "len": decode.len,
        "scale": decode.scale,
        "bias": decode.bias,
        "signed": decode.signed,
        "unit": decode.unit,
        "family_id": family_id,
        "family_match": m.as_str(),
        "inherited_knowledge_state": decode.knowledge_state,
        "vehicles_confirmed": decode.vehicles_confirmed,
        "evidence": decode.evidence,
    })
    .to_string()
}

fn effective_identity(module: &DiscoveredModuleRow) -> Option<IdentityFit> {
    match module.identity_fit.as_deref().and_then(IdentityFit::parse) {
        Some(fit) => Some(fit),
        None if module.fingerprint_fields_answered > 0 => Some(IdentityFit::Provisional),
        None => None,
    }
}

pub fn join_vehicle(db: &Db, map: &UdsMap, vehicle_id: i64) -> JoinSummary {
    let mut summary = JoinSummary {
        vehicle_id,
        ..Default::default()
    };
    let vin = db.vehicle(vehicle_id).and_then(|v| v.vin);
    for module in db.discovered_summary(vehicle_id) {
        let (req, resp) = module
            .address
            .split_once('/')
            .map(|(r, s)| {
                (
                    crate::elm::uds_map::can_address(r),
                    crate::elm::uds_map::can_address(s),
                )
            })
            .unwrap_or((None, None));
        let mapped_service = match (req, resp) {
            (Some(req), Some(resp)) => {
                crate::elm::uds_map::read_service_for_module(vin.as_deref(), req, resp)
            }
            _ => crate::elm::uds_map::ReadService::default(),
        };
        let service = module
            .route_json
            .as_deref()
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
            .and_then(|route| {
                route
                    .get("read_service")
                    .and_then(|value| value.as_str())
                    .map(str::to_string)
            })
            .and_then(|value| match value.as_str() {
                "21" => Some(crate::elm::uds_map::ReadService::DataByLocalIdentifier),
                "1A" => Some(crate::elm::uds_map::ReadService::EcuIdentification),
                "22" => Some(crate::elm::uds_map::ReadService::DataByIdentifier),
                _ => None,
            })
            .unwrap_or(mapped_service);
        let mut joined = JoinedModule {
            module_id: module.id,
            address: module.address.clone(),
            identity_fit: effective_identity(&module).map(|f| f.as_str().to_string()),
            family_id: None,
            family_match: FamilyMatch::None.as_str().into(),
            inherited: 0,
            unknown: 0,
            filtered: 0,
            skipped: None,
        };
        let identity = effective_identity(&module);
        let mut family_dids: Vec<u16> = Vec::new();
        match identity {
            Some(fit) if !fit.joinable() => {
                joined.skipped = Some(format!(
                    "identity {}: two reads disagreed, not joined",
                    fit.as_str()
                ));
            }
            Some(_) => {
                let key = CompatibilityKey::from_fingerprint(
                    module.spare_part_number.as_deref(),
                    module.software_version.as_deref(),
                    module.system_name.as_deref(),
                    module.supplier.as_deref(),
                    service.as_str(),
                );
                let m = match_family(&key, map);
                db.set_module_family(module.id, m.family_id(), m.as_str());
                joined.family_id = m.family_id().map(str::to_string);
                joined.family_match = m.as_str().into();
                if let Some(family) = matched_family(map, &m) {
                    for decode in &family.decodes {
                        let Some(did) = hex16(&decode.did) else {
                            continue;
                        };
                        family_dids.push(did);
                        let knowledge = if matches!(m, FamilyMatch::Strong { .. }) {
                            KnowledgeState::parse(&decode.knowledge_state)
                                .unwrap_or(KnowledgeState::ResearchCandidate)
                        } else {
                            KnowledgeState::ResearchCandidate
                        };
                        let (id, created) = db.upsert_hypothesis(&HypothesisUpsert {
                            vehicle_id,
                            module_id: module.id,
                            did,
                            knowledge_state: knowledge.as_str().into(),
                            label: Some(decode.label.clone()),
                            decode_json: Some(decode_json(decode, &family.id, &m)),
                            discriminating_test: decode.discriminating_test.clone(),
                            family_id: Some(family.id.clone()),
                        });
                        summary.hypothesis_ids.push(id);
                        joined.inherited += 1;
                        if created {
                            summary.inherited_created += 1;
                        } else {
                            summary.inherited_refreshed += 1;
                        }
                    }
                }
            }
            None => {
                joined.skipped = Some("no fingerprint: identity block not answered yet".into());
            }
        }
        let classes = crate::elm::discovery::pack_ext::band_classes_for_module(
            map,
            vin.as_deref(),
            joined.family_id.as_deref(),
        );
        for did_row in db.discovered_dids(module.id) {
            if family_dids.contains(&did_row.did) {
                continue;
            }
            let sample = did_row
                .raw_sample
                .as_deref()
                .map(parse_hex)
                .unwrap_or_default();
            let len = did_row
                .byte_length
                .map(|l| l.max(0) as usize)
                .unwrap_or(sample.len());
            if !is_hypothesis_candidate(did_row.did, len, &sample, &classes) {
                joined.filtered += 1;
                summary.filtered += 1;
                continue;
            }
            let (id, created) = db.upsert_hypothesis(&HypothesisUpsert {
                vehicle_id,
                module_id: module.id,
                did: did_row.did,
                knowledge_state: KnowledgeState::Unknown.as_str().into(),
                label: did_row.label.clone(),
                decode_json: None,
                discriminating_test: None,
                family_id: None,
            });
            summary.hypothesis_ids.push(id);
            joined.unknown += 1;
            if created {
                summary.unknown_created += 1;
            } else {
                summary.unknown_refreshed += 1;
            }
        }
        summary.modules.push(joined);
    }
    summary
}

#[cfg(test)]
pub(crate) mod fixtures {
    use crate::db::Db;
    use crate::elm::uds::EcuFingerprint;
    use crate::elm::uds_map::{map, ReadService};

    pub struct SeededC4 {
        pub vehicle_id: i64,
        pub abs: i64,
        pub eps: i64,
        pub camera: i64,
        pub engine: i64,
    }

    pub fn fingerprint(req: &str, resp: &str, part: &str, sw: &str) -> EcuFingerprint {
        EcuFingerprint {
            request_address: req.into(),
            response_address: resp.into(),
            spare_part_number: Some(part.into()),
            hardware_version: None,
            software_version: Some(sw.into()),
            system_name: None,
            supplier: None,
            match_key: Some(format!("part={part}|sw={sw}")),
            fields_answered: 2,
            fields_total: 4,
            evidence: Vec::new(),
        }
    }

    pub fn verified_vin() -> String {
        crate::elm::discovery::pack_ext::tests::verified_brand_vin()
    }

    pub struct SeededSecondBrand {
        pub vin: String,
        pub brand_id: String,
        pub vehicle_id: i64,
        pub engine: i64,
        pub local_id_module: i64,
        pub local_id_address: String,
    }

    pub fn seed_second_brand(db: &Db) -> SeededSecondBrand {
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
        let (vehicle_id, _) = db.ensure_vehicle(&vin);
        let engine = db.upsert_discovered_module(vehicle_id, "7E0/7E8", Some("Engine"));
        db.update_ecu_fingerprint(
            engine,
            &EcuFingerprint {
                request_address: "7E0".into(),
                response_address: "7E8".into(),
                spare_part_number: Some("1K0907530A".into()),
                hardware_version: Some("H01".into()),
                software_version: Some("0210".into()),
                system_name: Some("ENGINE".into()),
                supplier: None,
                match_key: Some("part=1K0907530A|hw=H01|sw=0210|sys=ENGINE".into()),
                fields_answered: 4,
                fields_total: 4,
                evidence: Vec::new(),
            },
        );
        db.set_module_route_state(engine, "reached");
        db.upsert_discovered_did(engine, 0x0200, "00 3C", 2, None);
        let local_id_address = format!(
            "{}/{}",
            module.req.to_uppercase(),
            module.resp.to_uppercase()
        );
        let local_id_module =
            db.upsert_discovered_module(vehicle_id, &local_id_address, module.name.as_deref());
        db.set_module_route_state(local_id_module, "reached");
        db.upsert_discovered_did(local_id_module, 0x01, "00 3C 01 F4 5A", 5, None);
        SeededSecondBrand {
            vin,
            brand_id: brand.id.clone(),
            vehicle_id,
            engine,
            local_id_module,
            local_id_address,
        }
    }

    pub fn seed_c4(db: &Db) -> SeededC4 {
        let (vehicle_id, _) = db.ensure_vehicle(&verified_vin());
        let abs = db.upsert_discovered_module(vehicle_id, "6AD/68D", Some("ABS / ESP"));
        db.update_ecu_fingerprint(abs, &fingerprint("6AD", "68D", "9846124980", "9695041580"));
        let eps = db.upsert_discovered_module(vehicle_id, "6B5/695", Some("EPS"));
        db.update_ecu_fingerprint(eps, &fingerprint("6B5", "695", "9844551780", "9695027380"));
        let camera = db.upsert_discovered_module(vehicle_id, "74A/64A", Some("CVM3 camera"));
        db.update_ecu_fingerprint(
            camera,
            &fingerprint("74A", "64A", "9817137180", "9694921880"),
        );
        let engine = db.upsert_discovered_module(vehicle_id, "6A8/688", Some("Engine ECU"));
        db.upsert_discovered_did(abs, 0xD400, "00 00", 2, Some("Wheel speed rear-left"));
        db.upsert_discovered_did(abs, 0xD435, "0A", 1, None);
        db.upsert_discovered_did(abs, 0xF080, "98 46 12 49 80 00 00 98 20 60 93 80", 12, None);
        db.upsert_discovered_did(
            abs,
            0xD619,
            "44 53 47 69 52 45 53 43 30 30 2E 31 31 37 30 30 30 31",
            18,
            None,
        );
        db.upsert_discovered_did(abs, 0xD636, "3A 91 C4 07 EE 52 B8 1D 6F A0 29 D3", 12, None);
        db.upsert_discovered_did(engine, 0xD422, "00 8C", 2, Some("Battery voltage"));
        db.upsert_discovered_did(engine, 0xD4A0, "12 34 00", 3, None);
        db.upsert_discovered_did(engine, 0xD622, "00 07", 2, None);
        db.upsert_discovered_did(camera, 0xD404, "00", 1, None);
        SeededC4 {
            vehicle_id,
            abs,
            eps,
            camera,
            engine,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::fixtures::*;
    use super::*;
    use crate::elm::uds_map;

    fn test_db() -> Db {
        Db::open(std::path::Path::new(":memory:")).expect("in-memory db")
    }

    #[test]
    fn the_c4_inherits_twelve_abs_and_four_eps_hypotheses_untested_and_disabled() {
        let db = test_db();
        let c4 = seed_c4(&db);
        let summary = join_vehicle(&db, uds_map::map(), c4.vehicle_id);
        assert_eq!(summary.inherited_created, 16);
        let abs = summary
            .modules
            .iter()
            .find(|m| m.module_id == c4.abs)
            .unwrap();
        assert_eq!((abs.family_match.as_str(), abs.inherited), ("strong", 12));
        assert_eq!(abs.family_id.as_deref(), Some("cont_esp_mk100_psa"));
        let eps = summary
            .modules
            .iter()
            .find(|m| m.module_id == c4.eps)
            .unwrap();
        assert_eq!((eps.family_match.as_str(), eps.inherited), ("strong", 4));
        let cam = summary
            .modules
            .iter()
            .find(|m| m.module_id == c4.camera)
            .unwrap();
        assert_eq!((cam.family_match.as_str(), cam.inherited), ("strong", 0));
        let engine = summary
            .modules
            .iter()
            .find(|m| m.module_id == c4.engine)
            .unwrap();
        assert_eq!(engine.family_match, "none");
        assert!(engine
            .skipped
            .as_deref()
            .unwrap()
            .contains("no fingerprint"));

        let rows = db.list_hypotheses(c4.vehicle_id);
        let inherited: Vec<_> = rows.iter().filter(|h| h.family_id.is_some()).collect();
        assert_eq!(inherited.len(), 16);
        for h in &inherited {
            assert_eq!(h.vehicle_fit, "untested");
            assert_eq!(h.activation, "disabled");
            assert!(h.decode_json.is_some());
        }
        let d400 = rows
            .iter()
            .find(|h| h.module_id == c4.abs && h.did == 0xD400)
            .unwrap();
        assert_eq!(d400.knowledge_state, "locally_confirmed");
        assert_eq!(d400.label.as_deref(), Some("Wheel speed rear-left"));
        let decode: serde_json::Value =
            serde_json::from_str(d400.decode_json.as_deref().unwrap()).unwrap();
        assert_eq!(decode["inherited_knowledge_state"], "locally_confirmed");
        assert_eq!(decode["family_match"], "strong");
        let d40c = rows
            .iter()
            .find(|h| h.module_id == c4.abs && h.did == 0xD40C)
            .unwrap();
        assert_eq!(d40c.knowledge_state, "research_candidate");
        assert!(d40c.discriminating_test.is_some());
        let modules = db.discovered_summary(c4.vehicle_id);
        let abs_row = modules.iter().find(|m| m.id == c4.abs).unwrap();
        assert_eq!(abs_row.family_match.as_deref(), Some("strong"));
    }

    #[test]
    fn unknown_dids_become_hypotheses_only_when_they_pass_the_class_filter() {
        let db = test_db();
        let c4 = seed_c4(&db);
        let summary = join_vehicle(&db, uds_map::map(), c4.vehicle_id);
        let rows = db.list_hypotheses(c4.vehicle_id);
        let unknown: Vec<u16> = rows
            .iter()
            .filter(|h| h.knowledge_state == "unknown")
            .map(|h| h.did)
            .collect();
        assert_eq!(unknown.len(), 5, "{unknown:04X?}");
        assert!(
            unknown.contains(&0xD622),
            "engine D6xx 2-byte value is a hypothesis"
        );
        assert!(unknown.contains(&0xD435));
        assert!(unknown.contains(&0xD422));
        assert!(unknown.contains(&0xD4A0));
        assert!(unknown.contains(&0xD404));
        assert!(!rows
            .iter()
            .any(|h| h.did == 0xF080 || h.did == 0xD619 || h.did == 0xD636));
        assert_eq!(summary.filtered, 3);
        assert_eq!(
            rows.iter()
                .filter(|h| h.module_id == c4.abs && h.did == 0xD400)
                .count(),
            1
        );
    }

    #[test]
    fn rerunning_the_join_refreshes_without_duplicating_or_downgrading() {
        let db = test_db();
        let c4 = seed_c4(&db);
        let first = join_vehicle(&db, uds_map::map(), c4.vehicle_id);
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
                label: Some("RL wheel (my label)".into()),
                ..Default::default()
            },
            false,
        )
        .unwrap();
        let second = join_vehicle(&db, uds_map::map(), c4.vehicle_id);
        assert_eq!(second.inherited_created, 0);
        assert_eq!(second.inherited_refreshed, first.inherited_created);
        assert_eq!(second.unknown_created, 0);
        assert_eq!(
            db.list_hypotheses(c4.vehicle_id).len(),
            first.hypothesis_ids.len()
        );
        let d400 = db.hypothesis(d400.id).unwrap();
        assert_eq!(d400.vehicle_fit, "matched");
        assert_eq!(d400.activation, "enabled");
        assert_eq!(
            d400.label.as_deref(),
            Some("RL wheel (my label)"),
            "a re-join must not overwrite a user-set label"
        );
    }

    #[test]
    fn a_weak_match_inherits_the_same_rows_flagged_weak() {
        let db = test_db();
        let (vehicle_id, _) = db.ensure_vehicle("VR3EXAMPLE0000002");
        let abs = db.upsert_discovered_module(vehicle_id, "6AD/68D", Some("ABS / ESP"));
        db.update_ecu_fingerprint(abs, &fingerprint("6AD", "68D", "9846124980", "9600000080"));
        let summary = join_vehicle(&db, uds_map::map(), vehicle_id);
        assert_eq!(summary.modules[0].family_match, "weak");
        assert_eq!(summary.inherited_created, 12);
        for h in db.list_hypotheses(vehicle_id) {
            assert_eq!(h.activation, "disabled");
            assert_eq!(h.vehicle_fit, "untested");
            assert_eq!(h.knowledge_state, "research_candidate");
            let decode: serde_json::Value =
                serde_json::from_str(h.decode_json.as_deref().unwrap()).unwrap();
            assert_eq!(decode["family_match"], "weak");
            if h.did == 0xD400 {
                assert_eq!(decode["inherited_knowledge_state"], "locally_confirmed");
            }
        }
    }

    #[test]
    fn a_name_only_match_yields_research_candidates_and_a_conflicted_identity_is_skipped() {
        let db = test_db();
        let (vehicle_id, _) = db.ensure_vehicle("VR3EXAMPLE0000003");
        let abs = db.upsert_discovered_module(vehicle_id, "6AD/68D", None);
        db.update_ecu_fingerprint(
            abs,
            &crate::elm::uds::EcuFingerprint {
                request_address: "6AD".into(),
                response_address: "68D".into(),
                spare_part_number: None,
                hardware_version: None,
                software_version: None,
                system_name: Some("ESP MK100".into()),
                supplier: None,
                match_key: Some("sys=ESP MK100".into()),
                fields_answered: 1,
                fields_total: 4,
                evidence: Vec::new(),
            },
        );
        let summary = join_vehicle(&db, uds_map::map(), vehicle_id);
        assert_eq!(summary.modules[0].family_match, "name_only");
        assert_eq!(summary.inherited_created, 12);
        assert!(db
            .list_hypotheses(vehicle_id)
            .iter()
            .all(|h| h.knowledge_state == "research_candidate"));

        db.record_identity(abs, "h1", 1);
        db.record_identity(abs, "h2", 2);
        let summary = join_vehicle(&db, uds_map::map(), vehicle_id);
        assert!(summary.modules[0]
            .skipped
            .as_deref()
            .unwrap()
            .contains("conflicted"));
        assert_eq!(summary.inherited_created + summary.inherited_refreshed, 0);
    }

    #[test]
    fn a_second_brand_joins_from_its_iso_block_and_pack_read_service() {
        let db = test_db();
        let second = seed_second_brand(&db);
        let summary = join_vehicle(&db, uds_map::map(), second.vehicle_id);
        assert_eq!(summary.modules.len(), 2);
        let engine = summary
            .modules
            .iter()
            .find(|m| m.module_id == second.engine)
            .unwrap();
        assert_eq!(engine.family_match, "none");
        assert_eq!(engine.identity_fit.as_deref(), Some("provisional"));
        assert_eq!(engine.unknown, 1);
        let local = summary
            .modules
            .iter()
            .find(|m| m.module_id == second.local_id_module)
            .unwrap();
        assert!(local.skipped.as_deref().unwrap().contains("no fingerprint"));
        assert_eq!(local.unknown, 1, "a 21 group answer is a hypothesis too");
        let rows = db.list_hypotheses(second.vehicle_id);
        assert!(rows.iter().all(|h| h.knowledge_state == "unknown"));
        let (req, resp) = second.local_id_address.split_once('/').unwrap();
        assert_eq!(
            uds_map::read_service_for_module(
                Some(&second.vin),
                uds_map::can_address(req).unwrap(),
                uds_map::can_address(resp).unwrap()
            ),
            uds_map::ReadService::DataByLocalIdentifier
        );
    }

    #[test]
    fn two_brands_in_one_database_never_see_each_others_rows() {
        let db = test_db();
        let c4 = seed_c4(&db);
        let second = seed_second_brand(&db);
        assert_ne!(&c4.vehicle_id, &second.vehicle_id);
        assert_ne!(
            uds_map::brand_for_vin(Some(&verified_vin())).unwrap().id,
            second.brand_id
        );
        let first = join_vehicle(&db, uds_map::map(), c4.vehicle_id);
        let other = join_vehicle(&db, uds_map::map(), second.vehicle_id);
        assert_eq!(first.inherited_created, 16);
        assert_eq!(other.inherited_created, 0);
        let mine: Vec<i64> = db
            .list_hypotheses(c4.vehicle_id)
            .iter()
            .map(|h| h.id)
            .collect();
        let theirs: Vec<i64> = db
            .list_hypotheses(second.vehicle_id)
            .iter()
            .map(|h| h.id)
            .collect();
        assert!(mine.iter().all(|id| !theirs.contains(id)));
        assert!(db
            .discovered_summary(second.vehicle_id)
            .iter()
            .all(|m| !m.address.starts_with("6AD")));
        assert_eq!(db.discovered_summary(c4.vehicle_id).len(), 4);
    }

    #[test]
    fn hex_parsing_tolerates_both_stored_shapes() {
        assert_eq!(parse_hex("00 8C"), vec![0x00, 0x8C]);
        assert_eq!(parse_hex("008C"), vec![0x00, 0x8C]);
        assert_eq!(parse_hex(" 0a\tff "), vec![0x0A, 0xFF]);
        assert!(parse_hex("").is_empty());
    }
}
