//! ECU-family compatibility matching (protocol §2, L3; plan A2).
//!
//! A module is *found* by brand and address but *known* by its part
//! reference. The key built here deliberately carries no VIN, serial or
//! address, so the same Continental MK100 matches on a Peugeot, an Opel or a
//! Citroën — and so nothing in the key can identify an individual car.

use crate::elm::uds_map::{families_for_hardware_ref, family_by_id, EcuFamily, UdsMap};
use serde::{Deserialize, Serialize};

/// The comparison material of one module, built from its fingerprint.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompatibilityKey {
    /// Supplier name or code, when the identity payload names one.
    pub supplier: Option<String>,
    /// Family / system name (ISO `F197`, PSA `F08F`, …), when answered.
    pub family: Option<String>,
    /// Part reference: PSA `F080` reference 1 / ISO `F187`.
    pub hardware_ref: Option<String>,
    /// Software / calibration reference: PSA `F0FE` / ISO `F189`, `F195`.
    pub software_ref: Option<String>,
    /// Reserved for brands whose same part answers with a different payload
    /// layout (not populated by any parser yet).
    pub payload_variant: Option<String>,
    /// Read service the module answered with ("22", "21", "1A").
    pub service: Option<String>,
}

impl CompatibilityKey {
    /// From the fingerprint columns on `discovered_modules`: the spare part
    /// number is the hardware reference and the software version the
    /// software reference. `supplier` is whatever the identity block's
    /// `supplier` field decoded to (an opaque code or a name — no table is
    /// applied to it); `service` the read service the module answers per
    /// the pack (`read_service_for_module`).
    pub fn from_fingerprint(
        spare_part_number: Option<&str>,
        software_version: Option<&str>,
        system_name: Option<&str>,
        supplier: Option<&str>,
        service: &str,
    ) -> Self {
        let clean = |s: Option<&str>| {
            s.map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        };
        Self {
            supplier: clean(supplier),
            family: clean(system_name),
            hardware_ref: clean(spare_part_number),
            software_ref: clean(software_version),
            payload_variant: None,
            service: Some(service.into()),
        }
    }
}

/// How well a module's key matches a family (protocol §2 rules).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "match", rename_all = "snake_case")]
pub enum FamilyMatch {
    /// Same part reference *and* same software reference: decodes apply at
    /// their existing state, flagged inherited until this car confirms them.
    Strong {
        family_id: String,
    },
    /// Same part reference, software unknown or different: same decodes,
    /// flagged weak — a calibration change can move a DID.
    Weak {
        family_id: String,
    },
    /// Only the family or supplier name matches: decodes become
    /// `research_candidate` hypotheses here.
    NameOnly {
        family_id: String,
    },
    None,
}

impl FamilyMatch {
    pub fn family_id(&self) -> Option<&str> {
        match self {
            Self::Strong { family_id }
            | Self::Weak { family_id }
            | Self::NameOnly { family_id } => Some(family_id),
            Self::None => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Strong { .. } => "strong",
            Self::Weak { .. } => "weak",
            Self::NameOnly { .. } => "name_only",
            Self::None => "none",
        }
    }
}

/// Exact, case-insensitive, whitespace-trimmed equality. No substring
/// matching: "MK100" must not claim every family whose name mentions it.
fn name_matches(key: Option<&str>, candidate: Option<&str>) -> bool {
    match (key, candidate) {
        (Some(k), Some(c)) => {
            let (k, c) = (k.trim(), c.trim());
            !k.is_empty() && k.eq_ignore_ascii_case(c)
        }
        _ => false,
    }
}

/// Match a key against every family in the map. Byte-level matches win
/// over name matches. When several families share the hardware reference,
/// the one that also lists the software reference wins (Strong); otherwise
/// the first of them in map order is a Weak match.
pub fn match_family(key: &CompatibilityKey, map: &UdsMap) -> FamilyMatch {
    if let Some(hw) = key.hardware_ref.as_deref() {
        let sharing = families_for_hardware_ref(map, hw);
        if let Some(sw) = key.software_ref.as_deref() {
            if let Some(strong) = sharing
                .iter()
                .find(|f| f.software_refs.iter().any(|r| r == sw))
            {
                return FamilyMatch::Strong {
                    family_id: strong.id.clone(),
                };
            }
        }
        if let Some(first) = sharing.first() {
            return FamilyMatch::Weak {
                family_id: first.id.clone(),
            };
        }
    }
    // Name-only: the family name must match exactly; a supplier on its own
    // (Bosch makes many ESP generations) never identifies a family.
    if let Some(family) = map
        .ecu_families
        .iter()
        .find(|f| name_matches(key.family.as_deref(), Some(f.family.as_str())))
    {
        return FamilyMatch::NameOnly {
            family_id: family.id.clone(),
        };
    }
    FamilyMatch::None
}

/// The family behind a match, for callers that need its decodes.
pub fn matched_family<'a>(map: &'a UdsMap, m: &FamilyMatch) -> Option<&'a EcuFamily> {
    m.family_id().and_then(|id| family_by_id(map, id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::elm::uds_map;

    fn key(hw: Option<&str>, sw: Option<&str>) -> CompatibilityKey {
        CompatibilityKey::from_fingerprint(hw, sw, None, None, "22")
    }

    #[test]
    fn the_c4_abs_matches_the_continental_family_strongly() {
        let m = match_family(&key(Some("9846124980"), Some("9695041580")), uds_map::map());
        assert_eq!(
            m,
            FamilyMatch::Strong {
                family_id: "cont_esp_mk100_psa".into()
            }
        );
        assert_eq!(
            matched_family(uds_map::map(), &m).unwrap().decodes.len(),
            12
        );
    }

    #[test]
    fn same_part_with_a_different_or_unknown_software_reference_is_weak() {
        let m = match_family(&key(Some("9846124980"), Some("9600000080")), uds_map::map());
        assert_eq!(m.as_str(), "weak");
        assert_eq!(m.family_id(), Some("cont_esp_mk100_psa"));
        let m = match_family(&key(Some("9846124980"), None), uds_map::map());
        assert_eq!(m.as_str(), "weak");
    }

    #[test]
    fn a_family_or_supplier_name_alone_is_name_only() {
        let k = CompatibilityKey::from_fingerprint(None, None, Some("ESP MK100"), None, "22");
        let m = match_family(&k, uds_map::map());
        assert_eq!(
            m,
            FamilyMatch::NameOnly {
                family_id: "cont_esp_mk100_psa".into()
            }
        );
        // Exact equality only: a substring or a supplier alone is nothing.
        let k = CompatibilityKey::from_fingerprint(None, None, Some("MK100"), None, "22");
        assert_eq!(match_family(&k, uds_map::map()), FamilyMatch::None);
        let k = CompatibilityKey {
            supplier: Some("continental/ate".into()),
            ..Default::default()
        };
        assert_eq!(match_family(&k, uds_map::map()), FamilyMatch::None);
        let k = CompatibilityKey::from_fingerprint(None, None, Some("  esp mk100 "), None, "22");
        assert_eq!(match_family(&k, uds_map::map()).as_str(), "name_only");
    }

    #[test]
    fn two_families_sharing_a_part_are_split_by_software_reference() {
        let map: UdsMap = serde_json::from_value(serde_json::json!({
            "version": 8,
            "standard": {
                "ident_dids": [], "name_dids": [], "presence_probe_did": "F186",
                "address_scan": {"req_from": "700", "req_to": "7F6", "resp_offset": 8, "exclude": []},
                "timings_ms": {"presence_probe": 1, "ident_read": 1, "sweep_read": 1}
            },
            "brands": [],
            "ecu_families": [
                {"id": "gen1", "family": "X", "hardware_refs": ["1111111111"],
                 "software_refs": ["2222222222"], "modules_seen_on": [], "decodes": []},
                {"id": "gen2", "family": "X", "hardware_refs": ["1111111111"],
                 "software_refs": ["3333333333"], "modules_seen_on": [], "decodes": []}
            ]
        }))
        .unwrap();
        assert_eq!(
            match_family(&key(Some("1111111111"), Some("3333333333")), &map),
            FamilyMatch::Strong {
                family_id: "gen2".into()
            }
        );
        assert_eq!(
            match_family(&key(Some("1111111111"), Some("2222222222")), &map),
            FamilyMatch::Strong {
                family_id: "gen1".into()
            }
        );
        assert_eq!(
            match_family(&key(Some("1111111111"), Some("9999999999")), &map),
            FamilyMatch::Weak {
                family_id: "gen1".into()
            }
        );
        assert_eq!(
            match_family(&key(Some("1111111111"), None), &map).as_str(),
            "weak"
        );
    }

    #[test]
    fn unknown_parts_match_nothing() {
        assert_eq!(
            match_family(&key(Some("0000000000"), Some("0000000000")), uds_map::map()),
            FamilyMatch::None
        );
        assert_eq!(
            match_family(&key(None, None), uds_map::map()),
            FamilyMatch::None
        );
        assert_eq!(
            match_family(&key(Some("  "), None), uds_map::map()),
            FamilyMatch::None
        );
    }

    #[test]
    fn the_key_never_carries_vin_serial_or_address() {
        let k = key(Some("9846124980"), Some("9695041580"));
        let json = serde_json::to_string(&k).unwrap();
        for forbidden in ["vin", "serial", "address", "req", "resp"] {
            assert!(!json.contains(forbidden), "{forbidden} leaked into {json}");
        }
    }

    #[test]
    fn the_supplier_and_the_read_service_come_from_the_caller_not_a_parser() {
        let k =
            CompatibilityKey::from_fingerprint(Some("1111111111"), None, None, Some(" 2A "), "21");
        assert_eq!(k.supplier.as_deref(), Some("2A"));
        assert_eq!(k.service.as_deref(), Some("21"));
        let k = CompatibilityKey::from_fingerprint(None, None, None, Some("  "), "1A");
        assert_eq!(k.supplier, None);
        assert_eq!(k.service.as_deref(), Some("1A"));
    }
}
