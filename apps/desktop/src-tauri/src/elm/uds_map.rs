//! The manufacturer UDS knowledge map, loaded from
//! `packages/uds-map/data/uds-map.json` — the single source of truth,
//! shared with the published `@scainner/uds-map` npm package (same file,
//! two consumers, zero drift by construction).
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
    /// How this brand derives a response address from a request address,
    /// per address block. The research behind data/uds-map.json proved a
    /// single global "+8" is wrong for most brands (VAG +0x6A, GM +0x400,
    /// FCA -0x280) and that PSA uses TWO rules keyed on block (6xx -0x20,
    /// 7xx -0x100) — which is exactly why this is a per-block list and not
    /// one number.
    #[serde(default)]
    pub resp_offsets: Vec<RespOffset>,
}

#[derive(Deserialize, Clone)]
pub struct RespOffset {
    pub from: String,
    pub to: String,
    pub delta: i32,
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
    #[serde(default)]
    pub confidence: Option<String>,
}

/// Sweep order: confirmed bands first, guesses last. A cancelled or
/// link-degraded pass then still got the productive neighbourhoods — the
/// research found a widely-cited PSA band (D0xx) that returns nothing on
/// a real car, and it must not consume the scan before D4xx does.
fn confidence_rank(c: Option<&str>) -> u8 {
    match c {
        Some("confirmed") => 0,
        Some("high") => 1,
        Some("medium") => 2,
        Some("low") => 3,
        _ => 2,
    }
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

const RAW: &str = include_str!("../../../../../packages/uds-map/data/uds-map.json");

pub fn map() -> &'static UdsMap {
    static MAP: OnceLock<UdsMap> = OnceLock::new();
    MAP.get_or_init(|| serde_json::from_str(RAW).expect("data/uds-map.json is malformed"))
}

/// Parse a 16-bit hex value — used for DIDs, which span the full 0000-FFFF
/// range (D422, F190, ...). NOT for CAN addresses: use `can11` for those,
/// which additionally enforces the 11-bit range.
pub fn hex16(s: &str) -> Option<u16> {
    u16::from_str_radix(s.trim(), 16).ok()
}

/// Parse an 11-bit CAN address. Returns None for 29-bit extended addresses
/// (e.g. GM's 14DACBF1) — real, correctly recorded in the map, but not
/// addressable by this engine yet: extended addressing needs a different
/// ELM setup (ATSP7 plus 29-bit ATSH/ATCRA). Returning None means such a
/// module is skipped cleanly rather than mis-addressed as 11-bit.
pub fn can11(s: &str) -> Option<u16> {
    match u32::from_str_radix(s.trim(), 16) {
        Ok(v) if v <= 0x7FF => Some(v as u16),
        _ => None,
    }
}

/// Any hex width — for validating the data file, where 29-bit addresses
/// are legitimate content.
pub fn hex_any(s: &str) -> Option<u32> {
    u32::from_str_radix(s.trim(), 16).ok()
}

/// Modules this brand has that the engine cannot address yet (29-bit).
/// Counted so discovery can say so out loud instead of pretending the
/// brand simply has fewer modules.
pub fn extended_modules_for_vin(vin: Option<&str>) -> usize {
    brand_for_vin(vin)
        .map(|b| b.modules.iter().filter(|m| can11(&m.req).is_none() && hex_any(&m.req).is_some()).count())
        .unwrap_or(0)
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
    let collect = |b: &Brand| -> Vec<(u8, u16, u16)> {
        b.did_bands
            .iter()
            .filter_map(|d| Some((confidence_rank(d.confidence.as_deref()), hex16(&d.from)?, hex16(&d.to)?)))
            .collect()
    };
    let mut ranked: Vec<(u8, u16, u16)> = match brand_for_vin(vin) {
        Some(b) => collect(b),
        None => map().brands.iter().flat_map(collect).collect(),
    };
    ranked.sort_unstable();
    ranked.dedup_by(|a, b| a.1 == b.1 && a.2 == b.2);
    ranked.into_iter().map(|(_, f, t)| (f, t)).collect()
}

/// The response address for a request address on this brand: the brand's
/// own block rule when the map has one, else the standard fallback.
pub fn response_addr(brand: Option<&Brand>, req: u16) -> u16 {
    if let Some(b) = brand {
        for r in &b.resp_offsets {
            let (from, to) = (can11(&r.from), can11(&r.to));
            if let (Some(f), Some(t)) = (from, to) {
                if req >= f && req <= t {
                    return (req as i32 + r.delta).clamp(0, 0x7FF) as u16;
                }
            }
        }
    }
    req + map().standard.address_scan.resp_offset
}

/// Module address pairs this brand is known to use, tried before the blind
/// address sweep so a recognized car finds its modules in seconds.
pub fn known_modules_for_vin(vin: Option<&str>) -> Vec<(u16, u16, Option<String>)> {
    brand_for_vin(vin)
        .map(|b| {
            b.modules
                .iter()
                .filter_map(|m| Some((can11(&m.req)?, can11(&m.resp)?, m.name.clone())))
                .collect()
        })
        .unwrap_or_default()
}

/// Every request/response pair to try when enumerating the bus, known
/// brand modules first (so progress shows real finds early), then the full
/// conventional range from the map's address_scan block.
pub fn addresses_to_probe(vin: Option<&str>) -> Vec<(u16, u16, Option<String>)> {
    let scan = &map().standard.address_scan;
    let from = can11(&scan.req_from).unwrap_or(0x700);
    let to = can11(&scan.req_to).unwrap_or(0x7F6);
    let excluded: Vec<u16> = scan.exclude.iter().filter_map(|e| can11(e)).collect();

    let brand = brand_for_vin(vin);
    let mut out = known_modules_for_vin(vin);
    let mut seen: Vec<u16> = out.iter().map(|(r, _, _)| *r).collect();
    for req in from..=to {
        if excluded.contains(&req) || seen.contains(&req) {
            continue;
        }
        seen.push(req);
        out.push((req, response_addr(brand, req), None));
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
        // >= 2, not an exact match: version bumps happen on pure data
        // updates (new brands, corrected DIDs) that must NOT require
        // touching this file — that coupling is exactly what "no hardcoded
        // values" (2026-08-23) rules out. See uds-map-research.md for the
        // version history.
        assert!(m.version >= 2);
        assert!(!m.brands.is_empty());
        assert!(!m.standard.ident_dids.is_empty());
    }

    #[test]
    fn every_hex_field_in_the_shipped_map_parses() {
        // A typo'd address in the data file must fail here, not silently
        // make a brand's modules unreachable on a real car.
        for b in &map().brands {
            for m in &b.modules {
                // hex_any, not hex16: 29-bit extended addresses (GM) are
                // legitimate data the engine can't drive yet — the file
                // must still be well-formed.
                assert!(hex_any(&m.req).is_some(), "{}: bad req {}", b.id, m.req);
                assert!(hex_any(&m.resp).is_some(), "{}: bad resp {}", b.id, m.resp);
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
    fn extended_29bit_addresses_are_skipped_not_misaddressed() {
        // GM's 14DACBF1 is a real 29-bit address. It must not parse as an
        // 11-bit one (that would point the ELM somewhere wrong), must be
        // valid data, and must be counted so the UI can say why GM finds
        // fewer modules than its map lists.
        assert!(can11("14DACBF1").is_none());
        assert_eq!(hex_any("14DACBF1"), Some(0x14DACBF1));
        assert!(can11("7E0").is_some());
        // A DID is 16-bit and must NOT be constrained to the CAN range —
        // the bug this split exists to prevent.
        assert_eq!(hex16("D422"), Some(0xD422));
        assert_eq!(hex16("F190"), Some(0xF190));
        assert!(can11("D422").is_none());
        for (_, resp, _) in addresses_to_probe(Some("VR7BAHNSANE014974")) {
            assert!(resp <= 0x7FF, "an 11-bit sweep produced an out-of-range response id");
        }
    }

    #[test]
    fn psa_uses_two_response_offset_rules_not_one() {
        // The research reconciled this project's own anchors: 6B4/694 is
        // the 6xx rule (-0x20), 752/652 is the 7xx rule (-0x100). A single
        // global offset gets one of them wrong, which is the bug this
        // per-block table exists to prevent.
        let psa = brand_for_vin(Some("VR7BAHNSANE014974")).expect("PSA");
        assert_eq!(response_addr(Some(psa), 0x6B4), 0x694);
        assert_eq!(response_addr(Some(psa), 0x752), 0x652);
    }

    #[test]
    fn unknown_brand_falls_back_to_the_standard_offset() {
        assert_eq!(response_addr(None, 0x7E0), 0x7E8);
    }

    #[test]
    fn bands_sweep_confirmed_before_low_confidence() {
        // A widely-cited PSA band (D0xx) returned zero hits on the real
        // car, so it must not consume a scan before the productive D4xx.
        let bands = bands_for_vin(Some("VR7BAHNSANE014974"));
        let pos = |target: u16| bands.iter().position(|(f, _)| *f == target);
        if let (Some(d4), Some(d0)) = (pos(0xD400), pos(0xD000)) {
            assert!(d4 < d0, "confirmed D4xx must sweep before low-confidence D0xx");
        }
    }

    #[test]
    fn researched_map_covers_the_brands_the_owner_asked_for() {
        let ids: Vec<&str> = map().brands.iter().map(|b| b.id.as_str()).collect();
        for wanted in ["psa", "hyundai_kia", "vag", "seat", "cupra", "bmw", "renault", "ford", "toyota"] {
            assert!(ids.contains(&wanted), "missing brand {wanted}");
        }
        assert!(map().brands.len() >= 20, "expected the researched multi-brand map");
    }

    #[test]
    fn known_did_lookup_finds_the_verified_citroen_entry() {
        // Research corrected this: D422 is battery VOLTAGE, not state of
        // charge — proven by this project's own live correlation against
        // PID 0142 (UDS_INVESTIGATION_LOG.md).
        let k = known_did(Some("VR7BAHNSANE014974"), 0xD422).expect("D422 documented");
        assert!(k.label.to_lowercase().contains("battery"));
        assert_eq!(k.unit.as_deref(), Some("V"));
    }
}
