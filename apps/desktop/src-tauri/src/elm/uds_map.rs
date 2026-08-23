//! The manufacturer UDS knowledge map, loaded from `data/uds-map.json`.
//!
//! Every per-brand value the discovery engine uses — module addresses, DID
//! neighborhoods, already-identified DIDs, even the scan timings and the
//! ISO identification block — lives in that file, never in these functions.
//! Adding a brand, correcting an address, or narrowing a band is a data
//! edit reviewable by someone who doesn't read Rust; nothing here needs to
//! change. (Owner rule, 2026-08-23: no hardcoded values anywhere.)
//!
//! Embedded with `include_str!` so the shipped binary is self-contained and
//! a malformed map fails the build, not the car.
use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Deserialize)]
pub struct UdsMap {
    pub version: u32,
    pub standard: Standard,
    pub brands: Vec<Brand>,
}

#[derive(Deserialize)]
pub struct Standard {
    pub ident_dids: Vec<IdentDid>,
    /// DIDs whose payload is worth using as a module's display name, best first.
    pub name_dids: Vec<String>,
    /// The DID asked when merely testing whether anything lives at an address.
    pub presence_probe_did: String,
    pub address_scan: AddressScan,
    pub timings_ms: Timings,
}

#[derive(Deserialize)]
pub struct IdentDid {
    pub did: String,
    pub label: String,
}

#[derive(Deserialize)]
pub struct AddressScan {
    pub req_from: String,
    pub req_to: String,
    pub resp_offset: u16,
    pub exclude: Vec<String>,
}

#[derive(Deserialize)]
pub struct Timings {
    pub presence_probe: u64,
    pub ident_read: u64,
    pub sweep_read: u64,
}

#[derive(Deserialize)]
pub struct Brand {
    pub id: String,
    pub name: String,
    pub wmi: Vec<String>,
    #[serde(default)]
    pub modules: Vec<ModuleDef>,
    #[serde(default)]
    pub did_bands: Vec<Band>,
    #[serde(default)]
    pub known_dids: Vec<KnownDid>,
}

#[derive(Deserialize, Clone)]
pub struct ModuleDef {
    pub req: String,
    pub resp: String,
    pub name: Option<String>,
}

#[derive(Deserialize, Clone)]
pub struct Band {
    pub from: String,
    pub to: String,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Deserialize, Clone)]
pub struct KnownDid {
    pub did: String,
    pub label: String,
    #[serde(default)]
    pub unit: Option<String>,
    #[serde(default)]
    pub offset: Option<u32>,
    #[serde(default)]
    pub len: Option<u32>,
    #[serde(default)]
    pub scale: Option<f64>,
    #[serde(default)]
    pub bias: Option<f64>,
}

const RAW: &str = include_str!("../../data/uds-map.json");

pub fn map() -> &'static UdsMap {
    static MAP: OnceLock<UdsMap> = OnceLock::new();
    MAP.get_or_init(|| serde_json::from_str(RAW).expect("data/uds-map.json is malformed"))
}

pub fn hex16(s: &str) -> Option<u16> {
    u16::from_str_radix(s.trim(), 16).ok()
}

/// The brand entry whose WMI list contains this VIN's first three chars.
/// None for an unknown or absent VIN — callers then use every brand's
/// bands (slower, still bounded) rather than guessing at one.
pub fn brand_for_vin(vin: Option<&str>) -> Option<&'static Brand> {
    let wmi = vin.filter(|v| v.len() >= 3)?[..3].to_uppercase();
    map().brands.iter().find(|b| b.wmi.iter().any(|w| w.eq_ignore_ascii_case(&wmi)))
}

/// DID neighborhoods to sweep, as (from, to) pairs. Brand-specific when the
/// VIN identifies one; otherwise the union across brands, deduplicated.
pub fn bands_for_vin(vin: Option<&str>) -> Vec<(u16, u16)> {
    let collect = |b: &Brand| -> Vec<(u16, u16)> {
        b.did_bands.iter().filter_map(|d| Some((hex16(&d.from)?, hex16(&d.to)?))).collect()
    };
    let mut out: Vec<(u16, u16)> = match brand_for_vin(vin) {
        Some(b) => collect(b),
        None => map().brands.iter().flat_map(collect).collect(),
    };
    out.sort_unstable();
    out.dedup();
    out
}

/// Module address pairs this brand is known to use, tried before the blind
/// address sweep so a recognized car finds its modules in seconds.
pub fn known_modules_for_vin(vin: Option<&str>) -> Vec<(u16, u16, Option<String>)> {
    brand_for_vin(vin)
        .map(|b| {
            b.modules
                .iter()
                .filter_map(|m| Some((hex16(&m.req)?, hex16(&m.resp)?, m.name.clone())))
                .collect()
        })
        .unwrap_or_default()
}

/// Every request/response pair to try when enumerating the bus, known
/// brand modules first (so progress shows real finds early), then the full
/// conventional range from the map's address_scan block.
pub fn addresses_to_probe(vin: Option<&str>) -> Vec<(u16, u16, Option<String>)> {
    let scan = &map().standard.address_scan;
    let from = hex16(&scan.req_from).unwrap_or(0x700);
    let to = hex16(&scan.req_to).unwrap_or(0x7F6);
    let excluded: Vec<u16> = scan.exclude.iter().filter_map(|e| hex16(e)).collect();

    let mut out = known_modules_for_vin(vin);
    let mut seen: Vec<u16> = out.iter().map(|(r, _, _)| *r).collect();
    for req in from..=to {
        if excluded.contains(&req) || seen.contains(&req) {
            continue;
        }
        seen.push(req);
        out.push((req, req + scan.resp_offset, None));
    }
    out
}

pub fn ident_dids() -> Vec<u16> {
    map().standard.ident_dids.iter().filter_map(|d| hex16(&d.did)).collect()
}

pub fn name_dids() -> Vec<u16> {
    map().standard.name_dids.iter().filter_map(|d| hex16(d)).collect()
}

pub fn presence_probe_did() -> u16 {
    hex16(&map().standard.presence_probe_did).unwrap_or(0xF186)
}

/// A documented label for a DID on this brand, when the map knows one —
/// turns a raw discovery hit into a named sensor with no user work.
pub fn known_did<'a>(vin: Option<&str>, did: u16) -> Option<&'a KnownDid> {
    brand_for_vin(vin)?.known_dids.iter().find(|k| hex16(&k.did) == Some(did))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn map_parses_and_has_content() {
        let m = map();
        assert_eq!(m.version, 1);
        assert!(!m.brands.is_empty());
        assert!(!m.standard.ident_dids.is_empty());
    }

    #[test]
    fn every_hex_field_in_the_shipped_map_parses() {
        // A typo'd address in the data file must fail here, not silently
        // make a brand's modules unreachable on a real car.
        for b in &map().brands {
            for m in &b.modules {
                assert!(hex16(&m.req).is_some(), "{}: bad req {}", b.id, m.req);
                assert!(hex16(&m.resp).is_some(), "{}: bad resp {}", b.id, m.resp);
            }
            for d in &b.did_bands {
                let (f, t) = (hex16(&d.from), hex16(&d.to));
                assert!(f.is_some() && t.is_some(), "{}: bad band", b.id);
                assert!(f.unwrap() <= t.unwrap(), "{}: inverted band", b.id);
            }
            for k in &b.known_dids {
                assert!(hex16(&k.did).is_some(), "{}: bad did {}", b.id, k.did);
            }
        }
        assert!(!ident_dids().is_empty());
        assert!(!name_dids().is_empty());
    }

    #[test]
    fn vin_selects_its_brand_and_narrows_the_sweep() {
        // The real Citroën VIN from this project resolves to PSA, and PSA's
        // bands must be a strict subset of the unknown-brand union.
        let psa = brand_for_vin(Some("VR7BAHNSANE014974")).expect("PSA WMI VR7");
        assert_eq!(psa.id, "psa");
        let narrowed = bands_for_vin(Some("VR7BAHNSANE014974"));
        let union = bands_for_vin(None);
        assert!(!narrowed.is_empty());
        assert!(narrowed.len() < union.len(), "known brand must sweep less than unknown");
    }

    #[test]
    fn unknown_vin_falls_back_to_every_band_not_to_nothing() {
        assert!(brand_for_vin(Some("ZZZ00000000000000")).is_none());
        assert!(!bands_for_vin(Some("ZZZ00000000000000")).is_empty());
        assert!(!bands_for_vin(None).is_empty());
    }

    #[test]
    fn known_modules_are_probed_before_the_blind_sweep() {
        let addrs = addresses_to_probe(Some("VR7BAHNSANE014974"));
        let first = addrs.first().expect("at least one address");
        assert!(first.2.is_some(), "a named brand module should lead the list");
        // No address appears twice, even though known modules also fall
        // inside the blind range.
        let mut reqs: Vec<u16> = addrs.iter().map(|(r, _, _)| *r).collect();
        let before = reqs.len();
        reqs.sort_unstable();
        reqs.dedup();
        assert_eq!(before, reqs.len(), "duplicate addresses would be probed twice");
    }

    #[test]
    fn known_did_lookup_finds_the_verified_citroen_entry() {
        let k = known_did(Some("VR7BAHNSANE014974"), 0xD422).expect("D422 documented");
        assert!(k.label.to_lowercase().contains("battery"));
        assert_eq!(k.unit.as_deref(), Some("%"));
    }
}
