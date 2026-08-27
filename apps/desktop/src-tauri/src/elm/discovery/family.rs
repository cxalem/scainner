//! ECU-family compatibility matching (protocol §2, L3; plan A2).
//!
//! A module is *found* by brand and address but *known* by its part
//! reference. The key built here deliberately carries no VIN, serial or
//! address, so the same Continental MK100 matches on a Peugeot, an Opel or a
//! Citroën — and so nothing in the key can identify an individual car.

use crate::elm::uds_map::{EcuFamily, UdsMap};
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
    /// software reference. `f0fe` is the raw PSA `F0FE` payload when the
    /// module answered it; byte 4 carries a supplier code on that brand.
    pub fn from_fingerprint(
        spare_part_number: Option<&str>,
        software_version: Option<&str>,
        system_name: Option<&str>,
        f0fe: Option<&[u8]>,
    ) -> Self {
        let clean = |s: Option<&str>| {
            s.map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        };
        Self {
            supplier: f0fe.and_then(supplier_code_from_f0fe),
            family: clean(system_name),
            hardware_ref: clean(spare_part_number),
            software_ref: clean(software_version),
            payload_variant: None,
            service: Some("22".into()),
        }
    }
}

/// PSA `F0FE` byte 4 is documented (Diagbox-derived tables) as a supplier
/// code. It is returned as an opaque code string — no name table has been
/// verified yet, so nothing is invented from it.
pub fn supplier_code_from_f0fe(payload: &[u8]) -> Option<String> {
    payload
        .get(4)
        .filter(|b| **b != 0 && **b != 0xFF)
        .map(|b| format!("psa-f0fe-{b:02X}"))
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

    /// Inherited decodes are only created for byte-level matches.
    pub fn is_byte_level(&self) -> bool {
        matches!(self, Self::Strong { .. } | Self::Weak { .. })
    }
}

fn name_matches(key: Option<&str>, candidate: Option<&str>) -> bool {
    match (key, candidate) {
        (Some(k), Some(c)) => {
            let (k, c) = (k.trim().to_lowercase(), c.trim().to_lowercase());
            !k.is_empty() && !c.is_empty() && (k == c || k.contains(&c) || c.contains(&k))
        }
        _ => false,
    }
}

/// Match a key against every family in the map. Byte-level matches win
/// over name matches; the first family in map order wins ties.
pub fn match_family(key: &CompatibilityKey, map: &UdsMap) -> FamilyMatch {
    if let Some(hw) = key.hardware_ref.as_deref() {
        if let Some(family) = map
            .ecu_families
            .iter()
            .find(|f| f.hardware_refs.iter().any(|r| r == hw))
        {
            let sw_known = key
                .software_ref
                .as_deref()
                .map(|sw| family.software_refs.iter().any(|r| r == sw))
                .unwrap_or(false);
            return if sw_known {
                FamilyMatch::Strong {
                    family_id: family.id.clone(),
                }
            } else {
                FamilyMatch::Weak {
                    family_id: family.id.clone(),
                }
            };
        }
    }
    if let Some(family) = map.ecu_families.iter().find(|f| {
        name_matches(key.family.as_deref(), Some(f.family.as_str()))
            || name_matches(key.supplier.as_deref(), f.supplier.as_deref())
    }) {
        return FamilyMatch::NameOnly {
            family_id: family.id.clone(),
        };
    }
    FamilyMatch::None
}

/// The family behind a match, for callers that need its decodes.
pub fn matched_family<'a>(map: &'a UdsMap, m: &FamilyMatch) -> Option<&'a EcuFamily> {
    m.family_id()
        .and_then(|id| map.ecu_families.iter().find(|f| f.id == id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::elm::uds_map;

    fn key(hw: Option<&str>, sw: Option<&str>) -> CompatibilityKey {
        CompatibilityKey::from_fingerprint(hw, sw, None, None)
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
        assert!(m.is_byte_level());
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
        let k = CompatibilityKey::from_fingerprint(None, None, Some("ESP MK100"), None);
        let m = match_family(&k, uds_map::map());
        assert_eq!(
            m,
            FamilyMatch::NameOnly {
                family_id: "cont_esp_mk100_psa".into()
            }
        );
        assert!(!m.is_byte_level());
        let k = CompatibilityKey {
            supplier: Some("continental/ate".into()),
            ..Default::default()
        };
        assert_eq!(match_family(&k, uds_map::map()).as_str(), "name_only");
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
    fn f0fe_supplier_code_is_opaque_and_skips_padding() {
        assert_eq!(
            supplier_code_from_f0fe(&[0, 0, 0, 0, 0x2A, 0]),
            Some("psa-f0fe-2A".into())
        );
        assert_eq!(supplier_code_from_f0fe(&[0, 0, 0, 0, 0xFF]), None);
        assert_eq!(supplier_code_from_f0fe(&[0, 0]), None);
    }
}
