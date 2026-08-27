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
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

#[derive(Deserialize)]
pub struct UdsMap {
    pub version: u32,
    pub standard: Standard,
    pub brands: Vec<Brand>,
    /// Cross-brand ECU families keyed by part reference — the reuse unit of
    /// the Universal Discovery Protocol (§2, L3). Empty on maps older than
    /// v8; `known_dids` remain the backwards-compatible per-brand path.
    #[serde(default)]
    pub ecu_families: Vec<EcuFamily>,
}

/// An ECU identified by its supplier part reference, with every decode ever
/// verified on it. Brand and address are how the module is *found*; the part
/// reference is how it is *known*, so a Continental MK100 decoded on a C4
/// lights up on any other car carrying the same part.
#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct EcuFamily {
    pub id: String,
    #[serde(default)]
    pub supplier: Option<String>,
    pub family: String,
    /// Ten-digit PSA-style references (F080 reference 1) or ISO F187.
    #[serde(default)]
    pub hardware_refs: Vec<String>,
    /// Software/calibration references (PSA F0FE, ISO F189/F195).
    #[serde(default)]
    pub software_refs: Vec<String>,
    /// Read service the decodes were verified with ("22", "21", "1A").
    #[serde(default)]
    pub diagnostic_service: Option<String>,
    #[serde(default)]
    pub modules_seen_on: Vec<FamilyModuleRef>,
    #[serde(default)]
    pub evidence: Option<String>,
    #[serde(default)]
    pub decodes: Vec<FamilyDecode>,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct FamilyModuleRef {
    pub brand: String,
    pub req: String,
    pub resp: String,
}

/// One decode of a family: the formula plus the state and evidence that
/// justify it. `knowledge_state` is the protocol's vocabulary as a string so
/// the data file never depends on a Rust enum; `discovery::state` parses it.
#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct FamilyDecode {
    pub did: String,
    pub label: String,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "one_u32")]
    pub len: u32,
    #[serde(default = "one_f64")]
    pub scale: f64,
    #[serde(default)]
    pub bias: f64,
    #[serde(default)]
    pub signed: bool,
    #[serde(default)]
    pub unit: String,
    pub knowledge_state: String,
    #[serde(default)]
    pub evidence: String,
    #[serde(default)]
    pub vehicles_confirmed: u32,
    #[serde(default)]
    pub discriminating_test: Option<String>,
}

fn one_u32() -> u32 {
    1
}

fn one_f64() -> f64 {
    1.0
}

#[derive(Deserialize)]
struct KnowledgeOverlay {
    id: String,
    version: u32,
    license: String,
    source: String,
    brands: Vec<Brand>,
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
    /// Optional override for generic enumeration. `auto` derives the safe
    /// strategies from documented module pairs; exceptions such as Tesla are
    /// explicit data, never hardcoded brand checks in the scanner.
    #[serde(default)]
    pub scan_policy: ScanPolicy,
}

#[derive(Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ScanPolicy {
    #[default]
    Auto,
    None,
    #[serde(rename = "conventional_11bit")]
    Conventional11bit,
    #[serde(rename = "normal_fixed_29bit")]
    NormalFixed29bit,
    #[serde(rename = "conventional_11bit_and_normal_fixed_29bit")]
    Conventional11bitAndNormalFixed29bit,
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
    /// Automatic discovery session policy for this exact ECU address pair.
    /// Missing means default-session only; session changes must be an
    /// explicit, reviewed map decision rather than inferred from brand or
    /// address confidence.
    #[serde(default)]
    pub discovery_session: DiscoverySession,
}

#[derive(Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DiscoverySession {
    #[default]
    DefaultOnly,
    DefaultThenExtended,
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
    /// Exact ECU address pairs this meaning/formula belongs to. A DID is
    /// not globally meaningful across a vehicle: D410 on PSA's battery
    /// ECU is state of charge, while D410 on engine/ABS/EPS is unrelated.
    #[serde(default)]
    pub modules: Vec<ModuleRef>,
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

#[derive(Deserialize, Clone)]
pub struct ModuleRef {
    pub req: String,
    pub resp: String,
}

const RAW: &str = include_str!("../../../../../packages/uds-map/data/uds-map.json");
const OBDB_CITROEN_RAW: &str =
    include_str!("../../../../../packages/uds-map/data/packs/obdb-citroen.json");

pub fn map() -> &'static UdsMap {
    static MAP: OnceLock<UdsMap> = OnceLock::new();
    MAP.get_or_init(|| serde_json::from_str(RAW).expect("data/uds-map.json is malformed"))
}

fn obdb_citroen() -> &'static KnowledgeOverlay {
    static PACK: OnceLock<KnowledgeOverlay> = OnceLock::new();
    PACK.get_or_init(|| {
        let pack: KnowledgeOverlay = serde_json::from_str(OBDB_CITROEN_RAW)
            .expect("data/packs/obdb-citroen.json is malformed");
        assert_eq!(pack.id, "obdb-citroen");
        assert!(pack.version > 0, "overlay versions must be positive");
        assert_eq!(pack.license, "CC-BY-SA-4.0");
        assert!(pack.source.starts_with("https://github.com/OBDb/"));
        pack
    })
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

/// Parse a valid CAN identifier of either supported width.
pub fn can_address(s: &str) -> Option<u32> {
    match u32::from_str_radix(s.trim(), 16) {
        Ok(v) if v <= 0x1FFF_FFFF => Some(v),
        _ => None,
    }
}

/// Kept for callers that need general map validation.
pub fn hex_any(s: &str) -> Option<u32> {
    can_address(s)
}

/// Modules this brand has that the engine cannot address yet (29-bit).
/// Counted so discovery can say so out loud instead of pretending the
/// brand simply has fewer modules.
pub fn extended_modules_for_vin(vin: Option<&str>) -> usize {
    brand_for_vin(vin)
        .map(|b| {
            b.modules
                .iter()
                .filter(|m| can11(&m.req).is_none() && hex_any(&m.req).is_some())
                .count()
        })
        .unwrap_or(0)
}

/// The brand entry whose WMI list contains this VIN's first three chars.
/// None for an unknown or absent VIN — callers then use every brand's
/// bands (slower, still bounded) rather than guessing at one.
pub fn brand_for_vin(vin: Option<&str>) -> Option<&'static Brand> {
    brand_for_vin_in(map(), vin)
}

/// Same lookup against an explicit map (fixtures, the discovery layer).
pub fn brand_for_vin_in<'a>(map: &'a UdsMap, vin: Option<&str>) -> Option<&'a Brand> {
    let wmi = vin.filter(|v| v.len() >= 3)?[..3].to_uppercase();
    map.brands
        .iter()
        .find(|b| b.wmi.iter().any(|w| w.eq_ignore_ascii_case(&wmi)))
}

fn overlay_brand_for_vin(vin: Option<&str>) -> Option<&'static Brand> {
    let wmi = vin.filter(|v| v.len() >= 3)?[..3].to_uppercase();
    obdb_citroen().brands.iter().find(|b| {
        b.wmi
            .iter()
            .any(|candidate| candidate.eq_ignore_ascii_case(&wmi))
    })
}

/// Session policy for one exact, VIN-selected module. Unknown VINs and
/// address pairs not explicitly present in that brand profile are always
/// default-only.
pub fn discovery_session_for_module(vin: Option<&str>, req: u32, resp: u32) -> DiscoverySession {
    brand_for_vin(vin)
        .into_iter()
        .chain(overlay_brand_for_vin(vin))
        .flat_map(|brand| &brand.modules)
        .find(|module| {
            can_address(&module.req) == Some(req) && can_address(&module.resp) == Some(resp)
        })
        .map(|module| module.discovery_session)
        .unwrap_or_default()
}

/// DID neighborhoods to sweep, as (from, to) pairs. Brand-specific when the
/// VIN identifies one; otherwise the union across brands, deduplicated.
pub fn bands_for_vin(vin: Option<&str>) -> Vec<(u16, u16)> {
    let collect = |b: &Brand| -> Vec<(u8, u16, u16)> {
        b.did_bands
            .iter()
            .filter_map(|d| {
                Some((
                    confidence_rank(d.confidence.as_deref()),
                    hex16(&d.from)?,
                    hex16(&d.to)?,
                ))
            })
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
pub fn known_modules_for_vin(vin: Option<&str>) -> Vec<(u32, u32, Option<String>)> {
    brand_for_vin(vin)
        .into_iter()
        .chain(overlay_brand_for_vin(vin))
        .flat_map(|brand| &brand.modules)
        .filter_map(|module| {
            Some((
                can_address(&module.req)?,
                can_address(&module.resp)?,
                module.name.clone(),
            ))
        })
        .collect()
}

/// Every request/response pair to try when enumerating the bus, known
/// brand modules first (so progress shows real finds early), then the full
/// conventional range from the map's address_scan block.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CandidateSource {
    Profile,
    #[serde(rename = "conventional_11bit")]
    Conventional11bit,
    #[serde(rename = "normal_fixed_29bit")]
    NormalFixed29bit,
}

#[derive(Clone, Debug)]
pub struct AddressCandidate {
    pub req: u32,
    pub resp: u32,
    pub name: Option<String>,
    /// True when the selected brand profile explicitly documents this pair;
    /// false when it came from the generic conventional-address sweep.
    pub profile_candidate: bool,
    pub source: CandidateSource,
}

fn normal_fixed_29bit_target(req: u32, resp: u32) -> Option<u8> {
    if req & 0xFFFF_00FF != 0x18DA_00F1 || resp & 0xFFFF_FF00 != 0x18DA_F100 {
        return None;
    }
    let target = ((req >> 8) & 0xFF) as u8;
    (resp & 0xFF == u32::from(target)).then_some(target)
}

fn scan_strategies(vin: Option<&str>, known: &[(u32, u32, Option<String>)]) -> (bool, bool) {
    let Some(brand) = brand_for_vin(vin) else {
        // Missing/unknown VIN must degrade to broader read-only discovery.
        return (true, true);
    };
    match brand.scan_policy {
        ScanPolicy::None => (false, false),
        ScanPolicy::Conventional11bit => (true, false),
        ScanPolicy::NormalFixed29bit => (false, true),
        ScanPolicy::Conventional11bitAndNormalFixed29bit => (true, true),
        ScanPolicy::Auto => (
            true,
            known
                .iter()
                .any(|(req, resp, _)| normal_fixed_29bit_target(*req, *resp).is_some()),
        ),
    }
}

pub fn addresses_to_probe(vin: Option<&str>) -> Vec<AddressCandidate> {
    let scan = &map().standard.address_scan;
    let from = can11(&scan.req_from).unwrap_or(0x700);
    let to = can11(&scan.req_to).unwrap_or(0x7F6);
    let excluded: Vec<u16> = scan.exclude.iter().filter_map(|e| can11(e)).collect();

    let brand = brand_for_vin(vin);
    let known = known_modules_for_vin(vin);
    let (scan_11bit, scan_29bit) = scan_strategies(vin, &known);
    let mut out: Vec<AddressCandidate> = known
        .iter()
        .cloned()
        .map(|(req, resp, name)| AddressCandidate {
            req,
            resp,
            name,
            profile_candidate: true,
            source: CandidateSource::Profile,
        })
        .collect();
    let mut seen: Vec<u32> = out.iter().map(|candidate| candidate.req).collect();
    if scan_11bit {
        for req in from..=to {
            if excluded.contains(&req) || seen.contains(&u32::from(req)) {
                continue;
            }
            seen.push(req.into());
            out.push(AddressCandidate {
                req: req.into(),
                resp: response_addr(brand, req).into(),
                name: None,
                profile_candidate: false,
                source: CandidateSource::Conventional11bit,
            });
        }
    }
    if scan_29bit {
        for target in 0u32..=0xFF {
            // F1 is this tester; FE/FF are functional/broadcast targets, not
            // physical ECUs. Enumeration must remain physically addressed.
            if matches!(target, 0xF1 | 0xFE | 0xFF) {
                continue;
            }
            let req = 0x18DA_00F1 | (target << 8);
            if seen.contains(&req) {
                continue;
            }
            seen.push(req);
            out.push(AddressCandidate {
                req,
                resp: 0x18DA_F100 | target,
                name: None,
                profile_candidate: false,
                source: CandidateSource::NormalFixed29bit,
            });
        }
    }
    out
}

pub fn ident_dids() -> Vec<u16> {
    map()
        .standard
        .ident_dids
        .iter()
        .filter_map(|d| hex16(&d.did))
        .collect()
}

pub fn name_dids() -> Vec<u16> {
    map()
        .standard
        .name_dids
        .iter()
        .filter_map(|d| hex16(d))
        .collect()
}

pub fn presence_probe_did() -> u16 {
    hex16(&map().standard.presence_probe_did).unwrap_or(0xF186)
}

/// A documented label for a DID on this brand, when the map knows one —
/// turns a raw discovery hit into a named sensor with no user work.
/// `req`/`resp` are u32 rather than u16 so a 29-bit module (PSA's TPMS at
/// 18DAC7F1, GM's Ultium modules) can be scoped like any other. An 11-bit
/// caller just widens its address.
pub fn known_did(vin: Option<&str>, req: u32, resp: u32, did: u16) -> Option<&'static KnownDid> {
    let mut candidates = brand_for_vin(vin)
        .into_iter()
        .chain(overlay_brand_for_vin(vin))
        .flat_map(|brand| &brand.known_dids)
        .filter(|k| hex16(&k.did) == Some(did));
    // Prefer an exact module binding. Unscoped entries remain a backwards-
    // compatible fallback while the rest of the multi-brand map is
    // migrated, but newly verified entries should always carry modules.
    candidates
        .clone()
        .find(|k| {
            k.modules
                .iter()
                .any(|m| can_address(&m.req) == Some(req) && can_address(&m.resp) == Some(resp))
        })
        .or_else(|| candidates.find(|k| k.modules.is_empty()))
}

/// Exact documented DIDs for one module. These are added to that module's
/// brand-band sweep without widening the sweep for every other ECU.
pub fn known_dids_for_module(vin: Option<&str>, req: u32, resp: u32) -> Vec<u16> {
    let mut dids: Vec<u16> = brand_for_vin(vin)
        .into_iter()
        .chain(overlay_brand_for_vin(vin))
        .flat_map(|brand| &brand.known_dids)
        .filter(|known| {
            known.modules.iter().any(|module| {
                can_address(&module.req) == Some(req) && can_address(&module.resp) == Some(resp)
            })
        })
        .filter_map(|known| hex16(&known.did))
        .collect();
    dids.sort_unstable();
    dids.dedup();
    dids
}

/// The family whose hardware references contain this exact part reference —
/// the byte-level lookup behind the protocol's S3 join. Takes the map
/// explicitly so the discovery layer and its tests can pass a fixture;
/// production callers pass `map()`.
pub fn family_for_hardware_ref<'a>(map: &'a UdsMap, hardware_ref: &str) -> Option<&'a EcuFamily> {
    let wanted = hardware_ref.trim();
    if wanted.is_empty() {
        return None;
    }
    map.ecu_families
        .iter()
        .find(|f| f.hardware_refs.iter().any(|r| r == wanted))
}

/// A family by id (the `family_id` stored on modules and hypotheses).
pub fn family_by_id<'a>(map: &'a UdsMap, id: &str) -> Option<&'a EcuFamily> {
    map.ecu_families.iter().find(|f| f.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ecu_families_parse_with_ten_digit_references_and_the_c4_abs_joins() {
        let families = &map().ecu_families;
        assert!(families.len() >= 3, "v8 seeds three families");
        for f in families {
            for r in f.hardware_refs.iter().chain(&f.software_refs) {
                assert!(
                    r.len() == 10 && r.chars().all(|c| c.is_ascii_digit()),
                    "{}: bad reference {r}",
                    f.id
                );
            }
            for m in &f.modules_seen_on {
                assert!(hex_any(&m.req).is_some() && hex_any(&m.resp).is_some());
            }
            for d in &f.decodes {
                assert!(hex16(&d.did).is_some(), "{}: bad did {}", f.id, d.did);
                assert!(d.len > 0);
                assert!(!d.evidence.is_empty(), "{} {}: no evidence", f.id, d.did);
                if d.knowledge_state == "locally_confirmed" {
                    assert!(d.vehicles_confirmed >= 1);
                }
            }
        }
        let m = map();
        let abs = family_for_hardware_ref(m, "9846124980").expect("C4 ABS family");
        assert_eq!(abs.id, "cont_esp_mk100_psa");
        assert_eq!(abs.decodes.len(), 12);
        assert_eq!(
            family_for_hardware_ref(m, "9844551780")
                .unwrap()
                .decodes
                .len(),
            4
        );
        assert!(family_for_hardware_ref(m, "9817137180")
            .unwrap()
            .decodes
            .is_empty());
        assert!(family_for_hardware_ref(m, "0000000000").is_none());
        assert!(family_for_hardware_ref(m, "").is_none());
        assert_eq!(family_by_id(m, "cvm3_psa").unwrap().family, "CVM3");
        assert!(family_by_id(m, "nope").is_none());
    }

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
                for m in &k.modules {
                    assert!(
                        hex_any(&m.req).is_some(),
                        "{} {}: bad module req {}",
                        b.id,
                        k.did,
                        m.req
                    );
                    assert!(
                        hex_any(&m.resp).is_some(),
                        "{} {}: bad module resp {}",
                        b.id,
                        k.did,
                        m.resp
                    );
                }
            }
        }
        assert!(!ident_dids().is_empty());
        assert!(!name_dids().is_empty());
    }

    #[test]
    fn vin_selects_its_brand_and_narrows_the_sweep() {
        // The real Citroën VIN from this project resolves to PSA, and PSA's
        // bands must be a strict subset of the unknown-brand union.
        let psa = brand_for_vin(Some("VR7EXAMPLE0000001")).expect("PSA WMI VR7");
        assert_eq!(psa.id, "psa");
        let narrowed = bands_for_vin(Some("VR7EXAMPLE0000001"));
        let union = bands_for_vin(None);
        assert!(!narrowed.is_empty());
        assert!(
            narrowed.len() < union.len(),
            "known brand must sweep less than unknown"
        );
    }

    #[test]
    fn unknown_vin_falls_back_to_every_band_not_to_nothing() {
        assert!(brand_for_vin(Some("ZZZ00000000000000")).is_none());
        assert!(!bands_for_vin(Some("ZZZ00000000000000")).is_empty());
        assert!(!bands_for_vin(None).is_empty());
    }

    #[test]
    fn known_modules_are_probed_before_the_blind_sweep() {
        let addrs = addresses_to_probe(Some("VR7EXAMPLE0000001"));
        let first = addrs.first().expect("at least one address");
        assert!(
            first.profile_candidate && first.name.is_some(),
            "a named brand module should lead the list"
        );
        // No address appears twice, even though known modules also fall
        // inside the blind range.
        let mut reqs: Vec<u32> = addrs.iter().map(|candidate| candidate.req).collect();
        let before = reqs.len();
        reqs.sort_unstable();
        reqs.dedup();
        assert_eq!(
            before,
            reqs.len(),
            "duplicate addresses would be probed twice"
        );
    }

    #[test]
    fn normal_fixed_29bit_targets_are_physical_unique_and_correctly_paired() {
        assert_eq!(
            serde_json::to_value(CandidateSource::NormalFixed29bit).unwrap(),
            "normal_fixed_29bit"
        );
        let candidates = addresses_to_probe(None);
        let extended: Vec<_> = candidates
            .iter()
            .filter(|candidate| candidate.source == CandidateSource::NormalFixed29bit)
            .collect();
        assert_eq!(
            extended.len(),
            253,
            "three non-physical targets are excluded"
        );
        for candidate in extended {
            let target = normal_fixed_29bit_target(candidate.req, candidate.resp)
                .expect("standard request/response pair");
            assert!(!matches!(target, 0xF1 | 0xFE | 0xFF));
        }
        let mut requests: Vec<_> = candidates.iter().map(|candidate| candidate.req).collect();
        let before = requests.len();
        requests.sort_unstable();
        requests.dedup();
        assert_eq!(requests.len(), before, "no request is sent twice");
    }

    #[test]
    fn brand_policy_prevents_known_unsafe_generic_sweeps() {
        assert!(addresses_to_probe(Some("5YJEXAMPLE0000000")).is_empty());
        assert!(addresses_to_probe(Some("JA3EXAMPLE0000000")).is_empty());

        let volvo = addresses_to_probe(Some("YV1EXAMPLE0000000"));
        assert!(!volvo.is_empty());
        assert!(volvo.iter().all(|candidate| candidate.req > 0x7FF));
        assert!(volvo
            .iter()
            .any(|candidate| candidate.source == CandidateSource::Profile));
        assert!(volvo
            .iter()
            .any(|candidate| candidate.source == CandidateSource::NormalFixed29bit));
    }

    #[test]
    fn automatic_extended_discovery_requires_an_exact_vin_and_module_rule() {
        assert_eq!(
            discovery_session_for_module(Some("VR7EXAMPLE0000001"), 0x6A8, 0x688),
            DiscoverySession::DefaultThenExtended
        );
        assert_eq!(
            discovery_session_for_module(Some("VR7EXAMPLE0000001"), 0x6B5, 0x695),
            DiscoverySession::DefaultOnly
        );
        assert_eq!(
            discovery_session_for_module(None, 0x6A8, 0x688),
            DiscoverySession::DefaultOnly
        );
        assert_eq!(
            discovery_session_for_module(Some("WVWEXAMPLE000000"), 0x6A8, 0x688),
            DiscoverySession::DefaultOnly
        );
    }

    #[test]
    fn extended_29bit_addresses_are_preserved_not_truncated() {
        // GM's 14DACBF1 is a real 29-bit address. It must not parse as an
        // 11-bit one (that would point the ELM somewhere wrong) and must
        // remain a full-width value for protocol-7 addressing.
        assert!(can11("14DACBF1").is_none());
        assert_eq!(hex_any("14DACBF1"), Some(0x14DACBF1));
        assert!(can11("7E0").is_some());
        // A DID is 16-bit and must NOT be constrained to the CAN range —
        // the bug this split exists to prevent.
        assert_eq!(hex16("D422"), Some(0xD422));
        assert_eq!(hex16("F190"), Some(0xF190));
        assert!(can11("D422").is_none());
        for candidate in addresses_to_probe(Some("VR7EXAMPLE0000001")) {
            assert_eq!(
                candidate.req > 0x7FF,
                candidate.resp > 0x7FF,
                "request and response IDs must use the same CAN width"
            );
        }
    }

    #[test]
    fn psa_uses_two_response_offset_rules_not_one() {
        // The research reconciled this project's own anchors: 6B4/694 is
        // the 6xx rule (-0x20), 752/652 is the 7xx rule (-0x100). A single
        // global offset gets one of them wrong, which is the bug this
        // per-block table exists to prevent.
        let psa = brand_for_vin(Some("VR7EXAMPLE0000001")).expect("PSA");
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
        let bands = bands_for_vin(Some("VR7EXAMPLE0000001"));
        let pos = |target: u16| bands.iter().position(|(f, _)| *f == target);
        if let (Some(d4), Some(d0)) = (pos(0xD400), pos(0xD000)) {
            assert!(
                d4 < d0,
                "confirmed D4xx must sweep before low-confidence D0xx"
            );
        }
    }

    #[test]
    fn researched_map_covers_the_brands_the_owner_asked_for() {
        let ids: Vec<&str> = map().brands.iter().map(|b| b.id.as_str()).collect();
        for wanted in [
            "psa",
            "hyundai_kia",
            "vag",
            "seat",
            "cupra",
            "bmw",
            "renault",
            "ford",
            "toyota",
        ] {
            assert!(ids.contains(&wanted), "missing brand {wanted}");
        }
        assert!(
            map().brands.len() >= 20,
            "expected the researched multi-brand map"
        );
    }

    #[test]
    fn known_did_lookup_finds_the_verified_citroen_entry() {
        // Research corrected this: D422 is battery VOLTAGE, not state of
        // charge — proven by this project's own live correlation against
        // PID 0142 (UDS_INVESTIGATION_LOG.md).
        let k =
            known_did(Some("VR7EXAMPLE0000001"), 0x6A8, 0x688, 0xD422).expect("D422 documented");
        assert!(k.label.to_lowercase().contains("battery"));
        assert_eq!(k.unit.as_deref(), Some("V"));
    }

    #[test]
    fn known_did_meaning_is_scoped_to_the_module_that_answered() {
        assert!(known_did(Some("VR7EXAMPLE0000001"), 0x6B4, 0x694, 0xD410).is_some());
        assert!(known_did(Some("VR7EXAMPLE0000001"), 0x6A8, 0x688, 0xD410).is_none());
        assert!(known_did(Some("VR7EXAMPLE0000001"), 0x6AD, 0x68D, 0xD410).is_none());
    }
}
