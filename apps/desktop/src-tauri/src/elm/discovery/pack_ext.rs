use crate::elm::uds_map::{
    self, brand_for_vin_in, can_address, hex16, Band, EcuFamily, IdentityBlock, UdsMap,
};
use serde_json::Value;
use std::sync::OnceLock;

const RAW: &str = include_str!("../../../../../../packages/uds-map/data/uds-map.json");

fn raw() -> &'static Value {
    static RAW_VALUE: OnceLock<Value> = OnceLock::new();
    RAW_VALUE.get_or_init(|| serde_json::from_str(RAW).expect("data/uds-map.json is malformed"))
}

fn raw_brand(brand_id: &str) -> Option<&'static Value> {
    raw()["brands"]
        .as_array()?
        .iter()
        .find(|b| b["id"].as_str() == Some(brand_id))
}

fn raw_family(family_id: &str) -> Option<&'static Value> {
    raw()["ecu_families"]
        .as_array()?
        .iter()
        .find(|f| f["id"].as_str() == Some(family_id))
}

fn bands_from_value(value: Option<&Value>) -> Vec<(u16, u16)> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|band| {
                    let from = band["from"].as_str().and_then(hex16)?;
                    let to = band["to"].as_str().and_then(hex16)?;
                    (from <= to).then_some((from, to))
                })
                .collect()
        })
        .unwrap_or_default()
}

pub fn map_generated() -> &'static str {
    raw()["generated"].as_str().unwrap_or("")
}

pub fn plan_revision() -> u32 {
    raw()["plan_revision"].as_u64().unwrap_or(1) as u32
}

pub fn brand_exclude_bands(vin: Option<&str>) -> Vec<(u16, u16)> {
    let Some(brand) = uds_map::brand_for_vin(vin) else {
        return Vec::new();
    };
    bands_from_value(raw_brand(&brand.id).map(|b| &b["hypothesis_exclude_bands"]))
}

pub fn family_exclude_bands(family_id: &str) -> Vec<(u16, u16)> {
    bands_from_value(raw_family(family_id).map(|f| &f["hypothesis_exclude_bands"]))
}

fn declared_band_class(brand_id: &str, band: &Band) -> Option<String> {
    raw_brand(brand_id)?["did_bands"]
        .as_array()?
        .iter()
        .find(|b| b["from"].as_str() == Some(&band.from) && b["to"].as_str() == Some(&band.to))
        .and_then(|b| b["class"].as_str())
        .map(str::to_string)
}

pub fn identity_dids(block: &IdentityBlock) -> Vec<u16> {
    let mut out: Vec<u16> = Vec::new();
    for entry in &block.dids {
        if let Some(did) = hex16(&entry.did) {
            if !out.contains(&did) {
                out.push(did);
            }
        }
    }
    out
}

fn identity_bands(map: &UdsMap, vin: Option<&str>) -> Vec<(u16, u16)> {
    let dids = identity_dids(&uds_map::identity_block_for_vin(vin));
    let Some(brand) = brand_for_vin_in(map, vin) else {
        return Vec::new();
    };
    brand
        .did_bands
        .iter()
        .filter_map(|b| Some((hex16(&b.from)?, hex16(&b.to)?)))
        .filter(|(from, to)| dids.iter().any(|d| from <= d && d <= to))
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BandClass {
    Identity,
    Config,
    Data,
}

pub fn band_class(map: &UdsMap, vin: Option<&str>, band: &Band) -> BandClass {
    let (Some(from), Some(to)) = (hex16(&band.from), hex16(&band.to)) else {
        return BandClass::Data;
    };
    let brand = brand_for_vin_in(map, vin);
    if let Some(declared) = brand.and_then(|b| declared_band_class(&b.id, band)) {
        return match declared.as_str() {
            "identity" => BandClass::Identity,
            "config" => BandClass::Config,
            _ => BandClass::Data,
        };
    }
    let identity = identity_dids(&uds_map::identity_block_for_vin(vin));
    if identity.iter().any(|d| from <= *d && *d <= to) {
        return BandClass::Identity;
    }
    let Some(brand) = brand else {
        return BandClass::Data;
    };
    let bound: Vec<&uds_map::KnownDid> = brand
        .known_dids
        .iter()
        .filter(|k| !k.modules.is_empty())
        .filter(|k| hex16(&k.did).is_some_and(|d| from <= d && d <= to))
        .collect();
    if !bound.is_empty() && bound.iter().all(|k| k.primary_decode().is_none()) {
        return BandClass::Config;
    }
    BandClass::Data
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BandClasses {
    pub exclude: Vec<(u16, u16)>,
    pub identity: Vec<(u16, u16)>,
    pub config: Vec<(u16, u16)>,
}

impl BandClasses {
    pub fn is_excluded(&self, did: u16) -> bool {
        self.exclude
            .iter()
            .chain(&self.identity)
            .any(|(from, to)| *from <= did && did <= *to)
    }

    pub fn is_config(&self, did: u16) -> bool {
        self.config
            .iter()
            .any(|(from, to)| *from <= did && did <= *to)
    }
}

pub fn band_classes_for_module(
    map: &UdsMap,
    vin: Option<&str>,
    family_id: Option<&str>,
) -> BandClasses {
    let mut classes = BandClasses {
        exclude: brand_exclude_bands(vin),
        identity: identity_bands(map, vin),
        config: Vec::new(),
    };
    if let Some(family) = family_id {
        classes.exclude.extend(family_exclude_bands(family));
    }
    if let Some(brand) = brand_for_vin_in(map, vin) {
        for band in &brand.did_bands {
            if band_class(map, vin, band) == BandClass::Config {
                if let (Some(f), Some(t)) = (hex16(&band.from), hex16(&band.to)) {
                    classes.config.push((f, t));
                }
            }
        }
    }
    classes
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfileModule {
    pub req: u32,
    pub resp: u32,
    pub name: Option<String>,
    pub family_id: Option<String>,
    pub family_name: Option<String>,
}

pub fn families_seen_on<'a>(
    map: &'a UdsMap,
    brand_id: &str,
    req: u32,
    resp: u32,
) -> Vec<&'a EcuFamily> {
    map.ecu_families
        .iter()
        .filter(|f| {
            f.modules_seen_on.iter().any(|m| {
                m.brand == brand_id
                    && can_address(&m.req) == Some(req)
                    && can_address(&m.resp) == Some(resp)
            })
        })
        .collect()
}

pub fn profile_modules_for_vin(map: &UdsMap, vin: Option<&str>) -> Vec<ProfileModule> {
    let Some(brand) = brand_for_vin_in(map, vin) else {
        return Vec::new();
    };
    let mut out: Vec<ProfileModule> = Vec::new();
    for (req, resp, name) in super::packs::known_modules_for_vin(vin) {
        if out.iter().any(|m| m.req == req && m.resp == resp) {
            continue;
        }
        let family = families_seen_on(map, &brand.id, req, resp)
            .into_iter()
            .next();
        out.push(ProfileModule {
            req,
            resp,
            name,
            family_id: family.map(|f| f.id.clone()),
            family_name: family.map(|f| f.family.clone()),
        });
    }
    for family in &map.ecu_families {
        for seen in family
            .modules_seen_on
            .iter()
            .filter(|m| m.brand == brand.id)
        {
            let (Some(req), Some(resp)) = (can_address(&seen.req), can_address(&seen.resp)) else {
                continue;
            };
            if out.iter().any(|m| m.req == req && m.resp == resp) {
                continue;
            }
            out.push(ProfileModule {
                req,
                resp,
                name: Some(family.family.clone()),
                family_id: Some(family.id.clone()),
                family_name: Some(family.family.clone()),
            });
        }
    }
    out
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::elm::uds_map::map;

    pub(crate) fn verified_brand_vin() -> String {
        let brand = map()
            .brands
            .iter()
            .find(|b| b.profiled_level == Some(uds_map::ProfiledLevel::DecodesVerified))
            .expect("one brand is decodes_verified");
        format!("{}EXAMPLE0000001", brand.wmi[0])
    }

    #[test]
    fn plan_revision_defaults_to_one_without_pack_data() {
        assert!(plan_revision() >= 1);
    }

    #[test]
    fn identity_bands_and_config_bands_are_derived_from_bindings() {
        let vin = verified_brand_vin();
        let classes = band_classes_for_module(map(), Some(&vin), None);
        let block = uds_map::identity_block_for_vin(Some(&vin));
        for did in identity_dids(&block) {
            assert!(classes.is_excluded(did), "{did:04X} must be identity class");
        }
        let brand = uds_map::brand_for_vin(Some(&vin)).unwrap();
        let decoded_band = brand
            .did_bands
            .iter()
            .find(|b| {
                brand.known_dids.iter().any(|k| {
                    !k.modules.is_empty()
                        && k.primary_decode().is_some()
                        && hex16(&k.did).is_some_and(|d| {
                            hex16(&b.from).unwrap() <= d && d <= hex16(&b.to).unwrap()
                        })
                })
            })
            .expect("a band with decoded DIDs");
        assert_eq!(band_class(map(), Some(&vin), decoded_band), BandClass::Data);
        assert!(!classes.config.is_empty(), "the brand has config bands");
        for (from, _) in &classes.config {
            assert!(!classes.is_excluded(*from));
        }
    }

    #[test]
    fn profile_modules_include_family_routes_and_nothing_for_unknown_vins() {
        let vin = verified_brand_vin();
        let modules = profile_modules_for_vin(map(), Some(&vin));
        let brand = uds_map::brand_for_vin(Some(&vin)).unwrap();
        assert!(
            modules.len() > brand.modules.len(),
            "overlay + family routes"
        );
        for family in map()
            .ecu_families
            .iter()
            .filter(|f| f.modules_seen_on.iter().any(|m| m.brand == brand.id))
        {
            assert!(
                modules
                    .iter()
                    .any(|m| m.family_id.as_deref() == Some(&family.id)),
                "{} route present",
                family.id
            );
        }
        assert!(profile_modules_for_vin(map(), Some("ZZZ00000000000000")).is_empty());
        assert!(profile_modules_for_vin(map(), None).is_empty());
    }
}
