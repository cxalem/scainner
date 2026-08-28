//! The manufacturer UDS knowledge map, loaded from
//! `packages/uds-map/data/uds-map.json` — the single source of truth,
//! shared with the published `@scainner/uds-map` npm package (same file,
//! two consumers, zero drift by construction).
//!
//! Every per-brand value the discovery engine uses — module addresses,
//! routes, read services, identity layouts, DID neighborhoods, decodes,
//! platforms, gateway semantics, even the scan timings and the ISO
//! identification block — lives in that file, never in these functions.
//! Adding a brand, correcting an address, or narrowing a band is a data
//! edit reviewable by someone who doesn't read Rust; nothing here needs to
//! change. (Owner rule, 2026-08-23: no hardcoded values anywhere. Multi-brand
//! plan rule, 2026-08-28: no brand is named in code — brand names are pack
//! data with a `source`.)
//!
//! Embedded with `include_str!` so the shipped binary is self-contained and
//! a malformed map fails the build, not the car.
//!
//! # Frozen contract for Phase 2 (pack schema v9, 2026-08-28)
//!
//! The runtime track builds on exactly these types and accessors; changing
//! their shape is a schema change that must land in `types.ts`, this file
//! and `docs/uds/pack-schema-v9.md` together.
//!
//! Types: [`Source`], [`Route`] / [`RouteProtocol`], [`ReadService`],
//! [`Decode`] / [`DecodeEncoding`], [`IdentityBlock`] / [`IdentityDid`]
//! ([`IdentityField`], [`IdentityLayout`]), [`Platform`],
//! [`GatewayBehaviour`] / [`SilenceMeans`], [`ProfiledLevel`].
//!
//! Accessors (all VIN-keyed; `req`/`resp` are full-width CAN ids):
//! - [`route_for_module`]`(vin, req, resp) -> Route` — the pack's route for a
//!   documented module (main map, then overlays), else derived from the ids
//!   (11-bit → `can11_500`; `18DA<t>F1`/`18DAF1<t>` → `can29_normal_fixed`
//!   with `target_byte`; other 29-bit → `can29_custom`). Never fails.
//! - [`identity_block_for_vin`]`(vin) -> IdentityBlock` — the brand's block
//!   (ISO DIDs first, vendor layouts after) or the standard ISO block.
//! - [`read_service_for_module`]`(vin, req, resp) -> ReadService` — module
//!   override, then brand default, then the standard default (`22`).
//! - [`decodes_for_did`]`(vin, req, resp, did) -> Vec<Decode>` — every value
//!   of a DID on exactly this module; empty when unbound or address-only.
//! - [`profiled_level_for_vin`]`(vin) -> Option<ProfiledLevel>` — `None` for an
//!   unknown WMI.
//! - [`gateway_behaviour_for_vin`]`(vin) -> GatewayBehaviour` — `unknown` /
//!   `writes_blocked: false` when the pack has no sourced rule.
//! - [`platform_for_vin`]`(vin) -> Option<Platform>` — first platform whose
//!   `vds_pattern` matches VIN characters 4–10; platforms without a pattern
//!   are never selected by VIN.
//! - [`known_did`]`(vin, req, resp, did)` — module-bound entries only (v9:
//!   no unscoped fallback); [`known_did_unscoped`] exists for browsing.
//! - [`decode_value`]`(&Decode, &[u8]) -> Option<f64>` — the shared decode
//!   semantics (be/le/bcd/bitfield, signed, scale, bias).
// The v9 contract lands one phase ahead of its runtime callers (Phase 2 —
// plan generator, identity builder, route setup). Until they land, rustc
// would flag the accessors and the fields only they read as dead code.
#![allow(dead_code)]
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

/// Provenance of one pack entry (v9). Every module, band, known DID,
/// family, identity block, platform and gateway rule carries one.
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq, Eq, Default)]
pub struct Source {
    pub url: String,
    pub date: String,
    /// `oem` | `open_implementation` | `tool_screen` | `parts_catalog` |
    /// `community` | `project_capture`.
    #[serde(rename = "type")]
    pub kind: String,
    pub licence: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

/// An ECU identified by its supplier part reference, with every decode ever
/// verified on it. Brand and address are how the module is *found*; the part
/// reference is how it is *known*, so a decode verified on one car lights up
/// on any other car carrying the same part.
#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct EcuFamily {
    pub id: String,
    #[serde(default)]
    pub supplier: Option<String>,
    pub family: String,
    /// Ten-digit part references (vendor identity layouts) or ISO F187.
    #[serde(default)]
    pub hardware_refs: Vec<String>,
    /// Software/calibration references (vendor layouts or ISO F189/F195).
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
    #[serde(default)]
    pub source: Option<Source>,
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
    /// Machine-readable physical quantity (v9).
    #[serde(default)]
    pub quantity: Option<String>,
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
    /// Read service assumed when neither brand nor module says otherwise.
    #[serde(default)]
    pub read_service: Option<ReadService>,
    /// The ISO 14229-1 identification block every brand inherits (v9).
    #[serde(default)]
    pub identity_block: Option<IdentityBlock>,
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

/// UDS/KWP read service a module answers: ReadDataByIdentifier (`22`),
/// ReadDataByLocalIdentifier (`21`) or ReadEcuIdentification (`1A`).
#[derive(Deserialize, Serialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ReadService {
    #[default]
    #[serde(rename = "22")]
    DataByIdentifier,
    #[serde(rename = "21")]
    DataByLocalIdentifier,
    #[serde(rename = "1A")]
    EcuIdentification,
}

impl ReadService {
    /// The service id as it appears on the wire and in the data (`"22"`).
    pub fn as_str(self) -> &'static str {
        match self {
            ReadService::DataByIdentifier => "22",
            ReadService::DataByLocalIdentifier => "21",
            ReadService::EcuIdentification => "1A",
        }
    }

    pub fn sid(self) -> u8 {
        match self {
            ReadService::DataByIdentifier => 0x22,
            ReadService::DataByLocalIdentifier => 0x21,
            ReadService::EcuIdentification => 0x1A,
        }
    }
}

#[derive(Deserialize, Serialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RouteProtocol {
    #[default]
    #[serde(rename = "can11_500")]
    Can11_500,
    #[serde(rename = "can11_250")]
    Can11_250,
    #[serde(rename = "can29_normal_fixed")]
    Can29NormalFixed,
    #[serde(rename = "can29_target_byte")]
    Can29TargetByte,
    #[serde(rename = "can29_custom")]
    Can29Custom,
    Kwp2000,
    Iso9141,
}

/// How to reach one module: the compatibility tuple of the discovery
/// protocol. `target_byte` is the ECU address carried inside the payload
/// (iterated by target-byte schemes); `address_extension` is the ISO-TP
/// extended-address byte the adapter must send (`ATCEA`); `gateway` names
/// a gateway module id the route passes through.
#[derive(Deserialize, Serialize, Clone, Debug, Default, PartialEq)]
pub struct Route {
    #[serde(default)]
    pub protocol: RouteProtocol,
    pub req: String,
    pub resp: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_byte: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub address_extension: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gateway: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<Source>,
}

#[derive(Deserialize, Serialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DecodeEncoding {
    #[default]
    Be,
    Le,
    Bcd,
    Ascii,
    Bitfield,
}

/// One value inside a DID payload (v9). `offset` counts bytes after the
/// echoed identifier. `bitfield` takes the `len` bytes at `offset` as a
/// big-endian integer, shifts right by `bit_offset` (0 = least significant
/// bit) and masks `bit_len` bits. `signed` means two's complement;
/// offset-binary values are unsigned with a negative `bias`.
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
pub struct Decode {
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "one_u32")]
    pub len: u32,
    #[serde(default)]
    pub signed: bool,
    #[serde(default)]
    pub encoding: DecodeEncoding,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bit_offset: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bit_len: Option<u32>,
    #[serde(default = "one_f64")]
    pub scale: f64,
    #[serde(default)]
    pub bias: f64,
    #[serde(default)]
    pub unit: String,
    #[serde(default)]
    pub quantity: String,
    #[serde(default)]
    pub label: String,
}

#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IdentityField {
    Part,
    Hardware,
    Software,
    System,
    Serial,
    Supplier,
    Vin,
    Other,
}

/// Payload layouts an identity DID may use. Layout ids name encodings,
/// never brands: `iso_ascii` printable string; `bcd_part_refs` packed BCD
/// digits, `len` bytes at `offset`, optionally wrapped in a literal
/// `prefix`/`suffix`; `ascii_part_refs` ASCII references at a fixed
/// offset/length; `raw` the bytes as hex.
#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IdentityLayout {
    IsoAscii,
    BcdPartRefs,
    AsciiPartRefs,
    Raw,
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
pub struct IdentityDid {
    pub did: String,
    pub field: IdentityField,
    pub layout: IdentityLayout,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub offset: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub len: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prefix: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suffix: Option<String>,
}

#[derive(Deserialize, Serialize, Clone, Debug, Default, PartialEq)]
pub struct IdentityBlock {
    #[serde(default)]
    pub dids: Vec<IdentityDid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<Source>,
}

/// A platform/generation split that changes service or addressing (v9).
/// `vds_pattern` is a regex over VIN characters 4–10 restricted to the
/// subset both implementations support (literals, `.`, `[...]` classes
/// with ranges and negation, `^`, `$`, `?`, `*`, `+`); `None` means the
/// platform is selectable by evidence only, never by VIN.
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
pub struct Platform {
    pub key: String,
    #[serde(default)]
    pub vds_pattern: Option<String>,
    /// `[from, to]` model years; `None` = unknown/open.
    #[serde(default)]
    pub years: (Option<i32>, Option<i32>),
    #[serde(default)]
    pub ecu_families_expected: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub read_service: Option<ReadService>,
    #[serde(default)]
    pub notes: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<Source>,
}

#[derive(Deserialize, Serialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SilenceMeans {
    Absent,
    Filtered,
    #[default]
    Unknown,
}

#[derive(Deserialize, Serialize, Clone, Debug, Default, PartialEq)]
pub struct GatewayBehaviour {
    #[serde(default)]
    pub silence_means: SilenceMeans,
    #[serde(default)]
    pub writes_blocked: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<Source>,
}

/// How far a brand is profiled (discovery protocol §5): `standard_only`
/// (no manufacturer routes), `routes_sourced`, `routes_verified` (a route
/// confirmed by a recorded exchange), `decodes_verified` (decodes confirmed
/// on a vehicle by this project).
#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum ProfiledLevel {
    StandardOnly,
    RoutesSourced,
    RoutesVerified,
    DecodesVerified,
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
    /// per address block. A single global "+8" is wrong for most brands and
    /// some need two rules keyed on block — which is exactly why this is a
    /// per-block list and not one number.
    #[serde(default)]
    pub resp_offsets: Vec<RespOffset>,
    /// Optional override for generic enumeration. `auto` derives the safe
    /// strategies from documented module pairs; exceptions are explicit
    /// data, never hardcoded brand checks in the scanner.
    #[serde(default)]
    pub scan_policy: ScanPolicy,
    /// Default read service for this brand's modules (v9).
    #[serde(default)]
    pub read_service: Option<ReadService>,
    #[serde(default)]
    pub identity_block: Option<IdentityBlock>,
    #[serde(default)]
    pub platforms: Vec<Platform>,
    #[serde(default)]
    pub gateway_behaviour: Option<GatewayBehaviour>,
    #[serde(default)]
    pub profiled_level: Option<ProfiledLevel>,
    #[serde(default)]
    pub sources: Vec<Source>,
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
    /// Iterate target bytes on a fixed 11-bit request id as well as the
    /// conventional range. Conventional-only until the target-byte path
    /// lands (Phase 2).
    #[serde(rename = "conventional_11bit_and_target_byte_11bit")]
    Conventional11bitAndTargetByte11bit,
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
    /// Overrides the brand's read service for this module (v9).
    #[serde(default)]
    pub read_service: Option<ReadService>,
    /// Explicit route; derived from `req`/`resp` when absent (v9).
    #[serde(default)]
    pub route: Option<Route>,
    #[serde(default)]
    pub source: Option<Source>,
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
    #[serde(default)]
    pub source: Option<Source>,
}

/// Sweep order: confirmed bands first, guesses last. A cancelled or
/// link-degraded pass then still got the productive neighbourhoods — the
/// research found widely-cited bands that return nothing on a real car,
/// and they must not consume the scan before the productive ones do.
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
    /// not globally meaningful across a vehicle: the same DID number means
    /// different things on different ECUs. Required in v9: empty only
    /// together with `binding: "unknown"`.
    #[serde(default)]
    pub modules: Vec<ModuleRef>,
    /// `"unknown"` when the research does not say which module carries
    /// this DID; such entries never label a module's answer.
    #[serde(default)]
    pub binding: Option<String>,
    #[serde(default)]
    pub unit: Option<String>,
    /// Mirror of `decodes[0]` (v8 shape, kept for existing callers).
    #[serde(default)]
    pub offset: Option<u32>,
    #[serde(default)]
    pub len: Option<u32>,
    #[serde(default)]
    pub scale: Option<f64>,
    #[serde(default)]
    pub bias: Option<f64>,
    /// Every value in this DID's payload (v9); empty when only the address
    /// is known.
    #[serde(default)]
    pub decodes: Vec<Decode>,
    #[serde(default)]
    pub confidence: Option<String>,
    #[serde(default)]
    pub evidence: Option<String>,
    #[serde(default)]
    pub source: Option<Source>,
}

impl KnownDid {
    /// The scalar decode: `decodes[0]` when present, else the legacy
    /// offset/len/scale/bias fields; `None` when only the address is known.
    pub fn primary_decode(&self) -> Option<Decode> {
        if let Some(first) = self.decodes.first() {
            return Some(first.clone());
        }
        Some(Decode {
            offset: self.offset?,
            len: self.len?,
            signed: false,
            encoding: DecodeEncoding::Be,
            bit_offset: None,
            bit_len: None,
            scale: self.scale?,
            bias: self.bias?,
            unit: self.unit.clone().unwrap_or_default(),
            quantity: "raw".into(),
            label: self.label.clone(),
        })
    }
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
/// range. NOT for CAN addresses: use `can11` for those, which additionally
/// enforces the 11-bit range.
pub fn hex16(s: &str) -> Option<u16> {
    u16::from_str_radix(s.trim(), 16).ok()
}

/// Parse an 11-bit CAN address. Returns None for 29-bit extended addresses
/// — real, correctly recorded in the map; a 29-bit module needs the
/// route's protocol (ATSP7 plus 29-bit ATSH/ATCRA) rather than an 11-bit
/// header, so returning None keeps it from being mis-addressed.
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

/// The brand profile followed by every overlay entry for the same WMI.
fn profiles_for_vin(vin: Option<&str>) -> impl Iterator<Item = &'static Brand> {
    brand_for_vin(vin)
        .into_iter()
        .chain(overlay_brand_for_vin(vin))
}

fn module_def(vin: Option<&str>, req: u32, resp: u32) -> Option<&'static ModuleDef> {
    profiles_for_vin(vin)
        .flat_map(|brand| &brand.modules)
        .find(|module| {
            can_address(&module.req) == Some(req) && can_address(&module.resp) == Some(resp)
        })
}

/// Session policy for one exact, VIN-selected module. Unknown VINs and
/// address pairs not explicitly present in that brand profile are always
/// default-only.
pub fn discovery_session_for_module(vin: Option<&str>, req: u32, resp: u32) -> DiscoverySession {
    module_def(vin, req, resp)
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
    profiles_for_vin(vin)
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
        ScanPolicy::Conventional11bit | ScanPolicy::Conventional11bitAndTargetByte11bit => {
            (true, false)
        }
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

fn known_did_candidates(vin: Option<&str>, did: u16) -> impl Iterator<Item = &'static KnownDid> {
    profiles_for_vin(vin)
        .flat_map(|brand| &brand.known_dids)
        .filter(move |k| hex16(&k.did) == Some(did))
}

/// A documented label (and decodes) for a DID on exactly this module of
/// this brand — turns a raw discovery hit into a named sensor with no user
/// work. `req`/`resp` are u32 so a 29-bit module can be scoped like any
/// other; an 11-bit caller just widens its address. A DID is not globally
/// meaningful across a vehicle, so an entry bound to another module, or
/// to no module (`binding: "unknown"`), is never returned — v9 removed the
/// unscoped fallback; see [`known_did_unscoped`] for browsing.
pub fn known_did(vin: Option<&str>, req: u32, resp: u32, did: u16) -> Option<&'static KnownDid> {
    known_did_candidates(vin, did).find(|k| {
        k.modules
            .iter()
            .any(|m| can_address(&m.req) == Some(req) && can_address(&m.resp) == Some(resp))
    })
}

/// The first documented entry for a DID on this brand regardless of module
/// binding — for browsing and research tooling only, never for labelling
/// what a specific module answered.
pub fn known_did_unscoped(vin: Option<&str>, did: u16) -> Option<&'static KnownDid> {
    known_did_candidates(vin, did).next()
}

/// Exact documented DIDs for one module. These are added to that module's
/// brand-band sweep without widening the sweep for every other ECU.
pub fn known_dids_for_module(vin: Option<&str>, req: u32, resp: u32) -> Vec<u16> {
    let mut dids: Vec<u16> = profiles_for_vin(vin)
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

/// Every family whose hardware references contain this exact part reference,
/// in map order — the byte-level lookup behind the protocol's S3 join. More
/// than one family can share a part (a software change that moved DIDs is
/// itself a family); the caller disambiguates by software reference. Takes
/// the map explicitly so the discovery layer and its tests can pass a
/// fixture; production callers pass `map()`.
pub fn families_for_hardware_ref<'a>(map: &'a UdsMap, hardware_ref: &str) -> Vec<&'a EcuFamily> {
    let wanted = hardware_ref.trim();
    if wanted.is_empty() {
        return Vec::new();
    }
    map.ecu_families
        .iter()
        .filter(|f| f.hardware_refs.iter().any(|r| r == wanted))
        .collect()
}

/// A family by id (the `family_id` stored on modules and hypotheses).
pub fn family_by_id<'a>(map: &'a UdsMap, id: &str) -> Option<&'a EcuFamily> {
    map.ecu_families.iter().find(|f| f.id == id)
}

// ---------------------------------------------------------------------------
// v9 accessors — the frozen contract for Phase 2 (see the module doc).
// ---------------------------------------------------------------------------

/// Derive a route from a request/response pair alone: 11-bit ids are
/// conventional 500 kbit/s; a normal-fixed 29-bit pair names its target
/// byte; any other 29-bit pair is custom.
pub fn derive_route(req: u32, resp: u32) -> Route {
    if req > 0x7FF || resp > 0x7FF {
        if let Some(target) = normal_fixed_29bit_target(req, resp) {
            return Route {
                protocol: RouteProtocol::Can29NormalFixed,
                req: format!("{req:08X}"),
                resp: format!("{resp:08X}"),
                target_byte: Some(format!("{target:02X}")),
                ..Route::default()
            };
        }
        return Route {
            protocol: RouteProtocol::Can29Custom,
            req: format!("{req:08X}"),
            resp: format!("{resp:08X}"),
            ..Route::default()
        };
    }
    Route {
        protocol: RouteProtocol::Can11_500,
        req: format!("{req:03X}"),
        resp: format!("{resp:03X}"),
        ..Route::default()
    }
}

/// The route tuple for a module: the pack's explicit route when the module
/// is documented with one (main map, then overlays), else derived.
pub fn route_for_module(vin: Option<&str>, req: u32, resp: u32) -> Route {
    module_def(vin, req, resp)
        .and_then(|m| m.route.clone())
        .unwrap_or_else(|| derive_route(req, resp))
}

/// The identity block to read on this VIN's modules: the brand's block
/// (ISO DIDs plus vendor layouts) or the standard ISO block.
pub fn identity_block_for_vin(vin: Option<&str>) -> IdentityBlock {
    brand_for_vin(vin)
        .and_then(|b| b.identity_block.clone())
        .or_else(|| map().standard.identity_block.clone())
        .unwrap_or_default()
}

/// The read service for one module: module override, then brand default,
/// then the standard default.
pub fn read_service_for_module(vin: Option<&str>, req: u32, resp: u32) -> ReadService {
    module_def(vin, req, resp)
        .and_then(|m| m.read_service)
        .or_else(|| brand_for_vin(vin).and_then(|b| b.read_service))
        .or(map().standard.read_service)
        .unwrap_or_default()
}

/// Every decode of a DID on exactly this module (empty when the pack has
/// no module-bound entry or only the address).
pub fn decodes_for_did(vin: Option<&str>, req: u32, resp: u32, did: u16) -> Vec<Decode> {
    match known_did(vin, req, resp, did) {
        Some(k) if !k.decodes.is_empty() => k.decodes.clone(),
        Some(k) => k.primary_decode().into_iter().collect(),
        None => Vec::new(),
    }
}

/// How far this VIN's brand is profiled; `None` for an unknown WMI.
pub fn profiled_level_for_vin(vin: Option<&str>) -> Option<ProfiledLevel> {
    brand_for_vin(vin).and_then(|b| b.profiled_level)
}

/// What silence from a module means on this brand, and whether writes are
/// gateway-blocked. Brands without a sourced rule get the honest default.
pub fn gateway_behaviour_for_vin(vin: Option<&str>) -> GatewayBehaviour {
    brand_for_vin(vin)
        .and_then(|b| b.gateway_behaviour.clone())
        .unwrap_or_default()
}

/// The platform whose `vds_pattern` matches VIN characters 4–10 (first
/// match in pack order). Platforms without a pattern are never selected
/// by VIN.
pub fn platform_for_vin(vin: Option<&str>) -> Option<Platform> {
    let brand = brand_for_vin(vin)?;
    let vin = vin?;
    if vin.len() < 10 {
        return None;
    }
    let vds = vin[3..10].to_uppercase();
    brand
        .platforms
        .iter()
        .find(|p| {
            p.vds_pattern
                .as_deref()
                .is_some_and(|pattern| vds_matches(pattern, &vds))
        })
        .cloned()
}

/// Apply one decode to raw payload bytes (after the echoed identifier).
/// `None` when the payload is too short, for `ascii` decodes, or for
/// non-decimal BCD nibbles.
pub fn decode_value(decode: &Decode, bytes: &[u8]) -> Option<f64> {
    let offset = decode.offset as usize;
    let len = decode.len as usize;
    if len == 0 || len > 8 || offset.checked_add(len)? > bytes.len() {
        return None;
    }
    let slice = &bytes[offset..offset + len];
    let bits = (len * 8) as u32;
    let raw: f64 = match decode.encoding {
        DecodeEncoding::Ascii => return None,
        DecodeEncoding::Be => {
            let v = slice.iter().fold(0u64, |acc, b| (acc << 8) | u64::from(*b));
            signed_or_not(v, bits, decode.signed)
        }
        DecodeEncoding::Le => {
            let v = slice
                .iter()
                .rev()
                .fold(0u64, |acc, b| (acc << 8) | u64::from(*b));
            signed_or_not(v, bits, decode.signed)
        }
        DecodeEncoding::Bcd => {
            let mut v = 0u64;
            for b in slice {
                let (hi, lo) = (b >> 4, b & 0x0F);
                if hi > 9 || lo > 9 {
                    return None;
                }
                v = v * 100 + u64::from(hi) * 10 + u64::from(lo);
            }
            v as f64
        }
        DecodeEncoding::Bitfield => {
            let whole = slice.iter().fold(0u64, |acc, b| (acc << 8) | u64::from(*b));
            let bit_len = decode.bit_len.unwrap_or(bits).min(64);
            let shifted = whole >> decode.bit_offset.unwrap_or(0).min(63);
            let masked = if bit_len >= 64 {
                shifted
            } else {
                shifted & ((1u64 << bit_len) - 1)
            };
            signed_or_not(masked, bit_len, decode.signed)
        }
    };
    Some(raw * decode.scale + decode.bias)
}

fn signed_or_not(v: u64, bits: u32, signed: bool) -> f64 {
    if signed && bits > 0 && bits < 64 && v >= (1u64 << (bits - 1)) {
        (v as i64 - (1i64 << bits)) as f64
    } else {
        v as f64
    }
}

// ---------------------------------------------------------------------------
// The VDS pattern subset: literals, `.`, `[...]` classes with ranges and
// negation, `^`, `$`, and the `?`/`*`/`+` quantifiers. Small enough to
// implement without a regex dependency and identical to what the
// TypeScript side accepts (the pack lint rejects anything richer).
// ---------------------------------------------------------------------------

enum VdsAtom {
    Any,
    Char(char),
    Class {
        negated: bool,
        ranges: Vec<(char, char)>,
    },
}

impl VdsAtom {
    fn matches(&self, c: char) -> bool {
        match self {
            VdsAtom::Any => true,
            VdsAtom::Char(x) => *x == c,
            VdsAtom::Class { negated, ranges } => {
                ranges.iter().any(|(lo, hi)| *lo <= c && c <= *hi) != *negated
            }
        }
    }
}

#[derive(Clone, Copy)]
enum VdsQuant {
    One,
    Opt,
    Star,
    Plus,
}

struct VdsPattern {
    anchored_start: bool,
    anchored_end: bool,
    tokens: Vec<(VdsAtom, VdsQuant)>,
}

fn parse_vds_pattern(pattern: &str) -> Option<VdsPattern> {
    let chars: Vec<char> = pattern.chars().collect();
    let mut i = 0;
    let mut anchored_start = false;
    let mut anchored_end = false;
    if chars.first() == Some(&'^') {
        anchored_start = true;
        i = 1;
    }
    let mut end = chars.len();
    if end > i && chars[end - 1] == '$' {
        anchored_end = true;
        end -= 1;
    }
    let mut tokens = Vec::new();
    while i < end {
        let atom = match chars[i] {
            '.' => {
                i += 1;
                VdsAtom::Any
            }
            '[' => {
                i += 1;
                let negated = chars.get(i) == Some(&'^');
                if negated {
                    i += 1;
                }
                let mut ranges = Vec::new();
                while i < end && chars[i] != ']' {
                    let lo = chars[i];
                    if chars.get(i + 1) == Some(&'-') && i + 2 < end && chars[i + 2] != ']' {
                        ranges.push((lo, chars[i + 2]));
                        i += 3;
                    } else {
                        ranges.push((lo, lo));
                        i += 1;
                    }
                }
                if i >= end {
                    return None;
                }
                i += 1;
                VdsAtom::Class { negated, ranges }
            }
            '?' | '*' | '+' | ']' | '^' | '$' => return None,
            c => {
                i += 1;
                VdsAtom::Char(c)
            }
        };
        let quant = match chars.get(i).filter(|_| i < end) {
            Some('?') => {
                i += 1;
                VdsQuant::Opt
            }
            Some('*') => {
                i += 1;
                VdsQuant::Star
            }
            Some('+') => {
                i += 1;
                VdsQuant::Plus
            }
            _ => VdsQuant::One,
        };
        tokens.push((atom, quant));
    }
    Some(VdsPattern {
        anchored_start,
        anchored_end,
        tokens,
    })
}

fn vds_match_here(p: &VdsPattern, ti: usize, text: &[char], pos: usize) -> bool {
    if ti == p.tokens.len() {
        return !p.anchored_end || pos == text.len();
    }
    let (atom, quant) = &p.tokens[ti];
    let (min, max) = match quant {
        VdsQuant::One => (1, 1),
        VdsQuant::Opt => (0, 1),
        VdsQuant::Star => (0, usize::MAX),
        VdsQuant::Plus => (1, usize::MAX),
    };
    let mut count = 0;
    while count < max && pos + count < text.len() && atom.matches(text[pos + count]) {
        count += 1;
    }
    if count < min {
        return false;
    }
    let mut n = count;
    loop {
        if vds_match_here(p, ti + 1, text, pos + n) {
            return true;
        }
        if n == min {
            return false;
        }
        n -= 1;
    }
}

/// Match a VDS pattern (the subset above) against text. Malformed patterns
/// never match.
pub fn vds_matches(pattern: &str, text: &str) -> bool {
    let Some(p) = parse_vds_pattern(pattern) else {
        return false;
    };
    let chars: Vec<char> = text.chars().collect();
    if p.anchored_start {
        return vds_match_here(&p, 0, &chars, 0);
    }
    (0..=chars.len()).any(|start| vds_match_here(&p, 0, &chars, start))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A synthetic VIN for a brand id: its first WMI plus filler.
    fn vin_for(brand_id: &str, vds: &str) -> String {
        let brand = map()
            .brands
            .iter()
            .find(|b| b.id == brand_id)
            .unwrap_or_else(|| panic!("no brand {brand_id}"));
        let mut vds: String = vds.chars().take(7).collect();
        while vds.len() < 7 {
            vds.push('0');
        }
        format!("{}{}0000000", brand.wmi[0], vds)
    }

    fn brand_with<F: Fn(&Brand) -> bool>(f: F) -> &'static Brand {
        map()
            .brands
            .iter()
            .find(|b| f(b))
            .expect("a brand matching the predicate")
    }

    #[test]
    fn ecu_families_parse_with_ten_digit_references_and_the_abs_joins() {
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
            assert!(f.source.is_some(), "{}: family without source", f.id);
            for d in &f.decodes {
                assert!(hex16(&d.did).is_some(), "{}: bad did {}", f.id, d.did);
                assert!(d.len > 0);
                assert!(!d.evidence.is_empty(), "{} {}: no evidence", f.id, d.did);
                assert!(d.quantity.is_some(), "{} {}: no quantity", f.id, d.did);
                if d.knowledge_state == "locally_confirmed" {
                    assert!(d.vehicles_confirmed >= 1);
                }
            }
        }
        let m = map();
        let abs = families_for_hardware_ref(m, "9846124980");
        assert_eq!(abs.len(), 1, "one family carries the ABS part");
        assert_eq!(abs[0].id, "cont_esp_mk100_psa");
        assert_eq!(abs[0].decodes.len(), 12);
        assert_eq!(
            families_for_hardware_ref(m, "9844551780")[0].decodes.len(),
            4
        );
        assert!(families_for_hardware_ref(m, "9817137180")[0]
            .decodes
            .is_empty());
        assert!(families_for_hardware_ref(m, "0000000000").is_empty());
        assert!(families_for_hardware_ref(m, "").is_empty());
        assert_eq!(family_by_id(m, "cvm3_psa").unwrap().family, "CVM3");
        assert!(family_by_id(m, "nope").is_none());
    }

    #[test]
    fn map_parses_and_has_content() {
        let m = map();
        // >= 9: version bumps happen on pure data updates that must NOT
        // require touching this file; v9 is the schema this contract needs.
        assert!(m.version >= 9);
        assert!(!m.brands.is_empty());
        assert!(!m.standard.ident_dids.is_empty());
        assert!(m.standard.identity_block.is_some());
        assert_eq!(m.standard.read_service, Some(ReadService::DataByIdentifier));
    }

    #[test]
    fn every_hex_field_in_the_shipped_map_parses() {
        // A typo'd address in the data file must fail here, not silently
        // make a brand's modules unreachable on a real car.
        for b in &map().brands {
            for m in &b.modules {
                assert!(hex_any(&m.req).is_some(), "{}: bad req {}", b.id, m.req);
                assert!(hex_any(&m.resp).is_some(), "{}: bad resp {}", b.id, m.resp);
                if let Some(route) = &m.route {
                    assert_eq!(route.req, m.req, "{}: route req differs", b.id);
                    assert_eq!(route.resp, m.resp, "{}: route resp differs", b.id);
                }
                assert!(m.source.is_some(), "{}: module {} unsourced", b.id, m.req);
            }
            for d in &b.did_bands {
                let (f, t) = (hex16(&d.from), hex16(&d.to));
                assert!(f.is_some() && t.is_some(), "{}: bad band", b.id);
                assert!(f.unwrap() <= t.unwrap(), "{}: inverted band", b.id);
            }
            for k in &b.known_dids {
                assert!(hex16(&k.did).is_some(), "{}: bad did {}", b.id, k.did);
                assert!(
                    !k.modules.is_empty() || k.binding.as_deref() == Some("unknown"),
                    "{} {}: unbound without binding: unknown",
                    b.id,
                    k.did
                );
                for m in &k.modules {
                    assert!(hex_any(&m.req).is_some(), "{} {}: bad req", b.id, k.did);
                    assert!(hex_any(&m.resp).is_some(), "{} {}: bad resp", b.id, k.did);
                }
                if let Some(first) = k.decodes.first() {
                    assert_eq!((k.offset, k.len), (Some(first.offset), Some(first.len)));
                    assert_eq!((k.scale, k.bias), (Some(first.scale), Some(first.bias)));
                }
            }
            assert!(b.profiled_level.is_some(), "{}: no profiled_level", b.id);
            assert!(b.identity_block.is_some(), "{}: no identity_block", b.id);
            for p in &b.platforms {
                assert!(p.source.is_some(), "{}: platform {} unsourced", b.id, p.key);
                if let Some(pattern) = &p.vds_pattern {
                    assert!(
                        parse_vds_pattern(pattern).is_some(),
                        "{}: platform {} pattern outside the subset",
                        b.id,
                        p.key
                    );
                }
            }
        }
        assert!(!ident_dids().is_empty());
        assert!(!name_dids().is_empty());
    }

    #[test]
    fn vin_selects_its_brand_and_narrows_the_sweep() {
        let psa = brand_for_vin(Some("VR7EXAMPLE0000001")).expect("brand for WMI VR7");
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

        // The target-byte policy stays conventional-only until Phase 2.
        let tb = brand_with(|b| b.scan_policy == ScanPolicy::Conventional11bitAndTargetByte11bit);
        let probes = addresses_to_probe(Some(&vin_for(&tb.id, "EXAMPLE")));
        assert!(probes
            .iter()
            .any(|c| c.source == CandidateSource::Conventional11bit));
        assert!(!probes
            .iter()
            .any(|c| c.source == CandidateSource::NormalFixed29bit));
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
        assert!(can11("14DACBF1").is_none());
        assert_eq!(hex_any("14DACBF1"), Some(0x14DACBF1));
        assert!(can11("7E0").is_some());
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
    fn two_response_offset_rules_not_one() {
        let psa = brand_for_vin(Some("VR7EXAMPLE0000001")).expect("brand");
        assert_eq!(response_addr(Some(psa), 0x6B4), 0x694);
        assert_eq!(response_addr(Some(psa), 0x752), 0x652);
    }

    #[test]
    fn unknown_brand_falls_back_to_the_standard_offset() {
        assert_eq!(response_addr(None, 0x7E0), 0x7E8);
    }

    #[test]
    fn bands_sweep_confirmed_before_low_confidence() {
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
    fn the_mode01_mirror_band_is_low_on_every_brand() {
        for b in &map().brands {
            for band in &b.did_bands {
                if band.from.eq_ignore_ascii_case("F400") && band.to.eq_ignore_ascii_case("F4FF") {
                    assert_eq!(band.confidence.as_deref(), Some("low"), "{}", b.id);
                }
            }
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
    fn known_did_lookup_finds_the_verified_entry() {
        let k =
            known_did(Some("VR7EXAMPLE0000001"), 0x6A8, 0x688, 0xD422).expect("D422 documented");
        assert!(k.label.to_lowercase().contains("battery"));
        assert_eq!(k.unit.as_deref(), Some("V"));
        assert_eq!(k.decodes.len(), 1);
        assert_eq!(
            k.source.as_ref().map(|s| s.kind.as_str()),
            Some("project_capture")
        );
    }

    #[test]
    fn known_did_meaning_is_scoped_to_the_module_that_answered() {
        assert!(known_did(Some("VR7EXAMPLE0000001"), 0x6B4, 0x694, 0xD410).is_some());
        assert!(known_did(Some("VR7EXAMPLE0000001"), 0x6A8, 0x688, 0xD410).is_none());
        assert!(known_did(Some("VR7EXAMPLE0000001"), 0x6AD, 0x68D, 0xD410).is_none());
    }

    #[test]
    fn known_did_has_no_unscoped_fallback_but_browsing_still_works() {
        // An entry whose module the research does not name must never label
        // what some module happened to answer — on any brand.
        let (brand, entry) = map()
            .brands
            .iter()
            .flat_map(|b| b.known_dids.iter().map(move |k| (b, k)))
            .find(|(_, k)| k.binding.as_deref() == Some("unknown"))
            .expect("at least one honest unknown binding");
        let vin = vin_for(&brand.id, "EXAMPLE");
        let did = hex16(&entry.did).unwrap();
        for m in &brand.modules {
            let (req, resp) = (can_address(&m.req).unwrap(), can_address(&m.resp).unwrap());
            assert!(
                known_did(Some(&vin), req, resp, did).is_none(),
                "{} {}",
                brand.id,
                entry.did
            );
            assert!(decodes_for_did(Some(&vin), req, resp, did).is_empty());
        }
        assert_eq!(
            known_did_unscoped(Some(&vin), did).map(|k| k.did.as_str()),
            Some(entry.did.as_str())
        );
    }

    #[test]
    fn overlay_entries_are_module_scoped_and_carry_every_decode() {
        let vin = Some("VR7EXAMPLE0000001");
        let k = known_did(vin, 0x18DAC7F1, 0x18DAF1C7, 0x013C).expect("overlay pressure DID");
        assert_eq!(k.unit.as_deref(), Some("bar"));
        let decodes = decodes_for_did(vin, 0x18DAC7F1, 0x18DAF1C7, 0x013C);
        assert_eq!(decodes.len(), 2, "pressure plus the imported temperature");
        let bytes = [0x08, 0xCA, 0x1E];
        assert!((decode_value(&decodes[0], &bytes).unwrap() - 2.25).abs() < 1e-6);
        assert_eq!(decode_value(&decodes[1], &bytes), Some(-20.0));
    }

    #[test]
    fn route_for_module_uses_data_then_derives_on_two_brands() {
        // A brand documenting an 11-bit target-byte route (ISO-TP extended
        // addressing) and one documenting normal-fixed 29-bit routes.
        let tb = brand_with(|b| {
            b.modules.iter().any(|m| {
                m.route.as_ref().is_some_and(|r| {
                    r.protocol == RouteProtocol::Can11_500 && r.target_byte.is_some()
                })
            })
        });
        let m = tb
            .modules
            .iter()
            .find(|m| m.route.as_ref().is_some_and(|r| r.target_byte.is_some()))
            .unwrap();
        let route = route_for_module(
            Some(&vin_for(&tb.id, "EXAMPLE")),
            can_address(&m.req).unwrap(),
            can_address(&m.resp).unwrap(),
        );
        assert_eq!(route.protocol, RouteProtocol::Can11_500);
        assert_eq!(route.target_byte, m.route.as_ref().unwrap().target_byte);
        assert_eq!(route.address_extension, route.target_byte);
        assert!(route.source.is_some());

        let nf = brand_with(|b| {
            b.id != tb.id
                && b.modules.iter().any(|m| {
                    m.route
                        .as_ref()
                        .is_some_and(|r| r.protocol == RouteProtocol::Can29NormalFixed)
                })
        });
        let m = nf
            .modules
            .iter()
            .find(|m| {
                m.route
                    .as_ref()
                    .is_some_and(|r| r.protocol == RouteProtocol::Can29NormalFixed)
            })
            .unwrap();
        let req = can_address(&m.req).unwrap();
        let route = route_for_module(
            Some(&vin_for(&nf.id, "EXAMPLE")),
            req,
            can_address(&m.resp).unwrap(),
        );
        assert_eq!(route.protocol, RouteProtocol::Can29NormalFixed);
        assert_eq!(
            route.target_byte.as_deref(),
            Some(format!("{:02X}", (req >> 8) & 0xFF).as_str())
        );

        // Undocumented pairs derive.
        let derived = route_for_module(None, 0x7E0, 0x7E8);
        assert_eq!(derived.protocol, RouteProtocol::Can11_500);
        assert_eq!(
            (derived.req.as_str(), derived.resp.as_str()),
            ("7E0", "7E8")
        );
        assert_eq!(
            derive_route(0x14DACBF1, 0x142AF1CB).protocol,
            RouteProtocol::Can29Custom
        );
        assert_eq!(
            derive_route(0x18DA10F1, 0x18DAF110),
            Route {
                protocol: RouteProtocol::Can29NormalFixed,
                req: "18DA10F1".into(),
                resp: "18DAF110".into(),
                target_byte: Some("10".into()),
                ..Route::default()
            }
        );
        assert_eq!(
            serde_json::to_value(RouteProtocol::Can29NormalFixed).unwrap(),
            "can29_normal_fixed"
        );
        assert_eq!(
            serde_json::to_value(RouteProtocol::Can11_500).unwrap(),
            "can11_500"
        );
    }

    #[test]
    fn identity_block_is_iso_everywhere_plus_vendor_layouts_where_sourced() {
        let iso = map().standard.identity_block.as_ref().unwrap();
        assert!(iso
            .dids
            .iter()
            .any(|d| d.did == "F187" && d.field == IdentityField::Part));
        for b in &map().brands {
            let block = identity_block_for_vin(Some(&vin_for(&b.id, "EXAMPLE")));
            for d in &iso.dids {
                assert!(
                    block.dids.iter().any(|x| x.did == d.did),
                    "{} lacks {}",
                    b.id,
                    d.did
                );
            }
        }
        // The packed-BCD layout: part reference at offset 0 (5 bytes), a
        // second hardware reference at 7, and the software reference in a
        // second DID at bytes 21–23 wrapped as `96…80`.
        let bcd = brand_with(|b| {
            b.identity_block.as_ref().is_some_and(|ib| {
                ib.dids
                    .iter()
                    .any(|d| d.layout == IdentityLayout::BcdPartRefs)
            })
        });
        let block = identity_block_for_vin(Some(&vin_for(&bcd.id, "EXAMPLE")));
        let part = block
            .dids
            .iter()
            .find(|d| d.layout == IdentityLayout::BcdPartRefs && d.field == IdentityField::Part)
            .unwrap();
        assert_eq!((part.offset, part.len), (Some(0), Some(5)));
        let hw = block
            .dids
            .iter()
            .find(|d| d.layout == IdentityLayout::BcdPartRefs && d.field == IdentityField::Hardware)
            .unwrap();
        assert_eq!((hw.offset, hw.len), (Some(7), Some(5)));
        let sw = block
            .dids
            .iter()
            .find(|d| d.layout == IdentityLayout::BcdPartRefs && d.field == IdentityField::Software)
            .unwrap();
        assert_eq!((sw.offset, sw.len), (Some(21), Some(3)));
        assert_eq!(
            (sw.prefix.as_deref(), sw.suffix.as_deref()),
            (Some("96"), Some("80"))
        );
        // A second brand with a vendor field on top of ISO, and the ISO
        // fallback for an unknown WMI.
        let other = brand_with(|b| {
            b.id != bcd.id
                && b.identity_block
                    .as_ref()
                    .is_some_and(|ib| ib.dids.len() > iso.dids.len())
        });
        assert!(
            identity_block_for_vin(Some(&vin_for(&other.id, "EXAMPLE")))
                .dids
                .len()
                > iso.dids.len()
        );
        assert_eq!(identity_block_for_vin(Some("ZZZ00000000000000")), *iso);
        assert_eq!(identity_block_for_vin(None), *iso);
    }

    #[test]
    fn read_service_resolves_module_then_brand_then_standard_on_two_brands() {
        let with21 = brand_with(|b| {
            b.modules
                .iter()
                .any(|m| m.read_service == Some(ReadService::DataByLocalIdentifier))
        });
        let vin = vin_for(&with21.id, "EXAMPLE");
        let m21 = with21
            .modules
            .iter()
            .find(|m| m.read_service == Some(ReadService::DataByLocalIdentifier))
            .unwrap();
        let m22 = with21
            .modules
            .iter()
            .find(|m| m.read_service.is_none())
            .unwrap();
        assert_eq!(
            read_service_for_module(
                Some(&vin),
                can_address(&m21.req).unwrap(),
                can_address(&m21.resp).unwrap()
            ),
            ReadService::DataByLocalIdentifier
        );
        assert_eq!(
            read_service_for_module(
                Some(&vin),
                can_address(&m22.req).unwrap(),
                can_address(&m22.resp).unwrap()
            ),
            ReadService::DataByIdentifier
        );
        let with1a = brand_with(|b| {
            b.modules
                .iter()
                .any(|m| m.read_service == Some(ReadService::EcuIdentification))
        });
        let m1a = with1a
            .modules
            .iter()
            .find(|m| m.read_service == Some(ReadService::EcuIdentification))
            .unwrap();
        let svc = read_service_for_module(
            Some(&vin_for(&with1a.id, "EXAMPLE")),
            can_address(&m1a.req).unwrap(),
            can_address(&m1a.resp).unwrap(),
        );
        assert_eq!(svc, ReadService::EcuIdentification);
        assert_eq!((svc.as_str(), svc.sid()), ("1A", 0x1A));
        assert_eq!(
            read_service_for_module(Some("ZZZ00000000000000"), 0x7E0, 0x7E8),
            ReadService::DataByIdentifier
        );
        assert_eq!(read_service_for_module(None, 0x7E0, 0x7E8).as_str(), "22");
        assert_eq!(
            serde_json::to_value(ReadService::DataByLocalIdentifier).unwrap(),
            "21"
        );
    }

    #[test]
    fn decodes_for_did_returns_every_value_of_a_multi_value_did_on_two_brands() {
        let vin = Some("VR7EXAMPLE0000001");
        let steering = decodes_for_did(vin, 0x6AD, 0x68D, 0xD41F);
        assert_eq!(steering.len(), 1);
        assert_eq!(
            (steering[0].offset, steering[0].len, steering[0].bias),
            (0, 2, -1250.0)
        );
        assert!(decodes_for_did(vin, 0x6A8, 0x688, 0xD41F).is_empty());

        let (brand, entry) = map()
            .brands
            .iter()
            .flat_map(|b| b.known_dids.iter().map(move |k| (b, k)))
            .find(|(b, k)| b.id != "psa" && !k.modules.is_empty() && k.decodes.len() >= 4)
            .expect("a module-bound multi-value DID on another brand");
        let m = &entry.modules[0];
        let decodes = decodes_for_did(
            Some(&vin_for(&brand.id, "EXAMPLE")),
            can_address(&m.req).unwrap(),
            can_address(&m.resp).unwrap(),
            hex16(&entry.did).unwrap(),
        );
        assert_eq!(decodes.len(), entry.decodes.len());
        let payload = [0x10u8; 64];
        for d in &decodes {
            if d.encoding != DecodeEncoding::Ascii {
                assert!(
                    decode_value(d, &payload).is_some(),
                    "{} {} {}",
                    brand.id,
                    entry.did,
                    d.label
                );
            }
        }
        // A signed decode exists somewhere off the primary brand.
        assert!(map().brands.iter().any(|b| b.id != "psa"
            && b.known_dids
                .iter()
                .any(|k| k.decodes.iter().any(|d| d.signed))));
    }

    #[test]
    fn decode_value_covers_every_encoding() {
        let d = |encoding, len, signed| Decode {
            offset: 0,
            len,
            signed,
            encoding,
            bit_offset: None,
            bit_len: None,
            scale: 1.0,
            bias: 0.0,
            unit: String::new(),
            quantity: "raw".into(),
            label: "t".into(),
        };
        assert_eq!(
            decode_value(&d(DecodeEncoding::Be, 2, false), &[0x01, 0x02]),
            Some(258.0)
        );
        assert_eq!(
            decode_value(&d(DecodeEncoding::Le, 2, false), &[0x01, 0x02]),
            Some(513.0)
        );
        assert_eq!(
            decode_value(&d(DecodeEncoding::Be, 2, true), &[0xFF, 0xFE]),
            Some(-2.0)
        );
        assert_eq!(
            decode_value(&d(DecodeEncoding::Be, 1, true), &[0x80]),
            Some(-128.0)
        );
        assert_eq!(
            decode_value(&d(DecodeEncoding::Bcd, 3, false), &[0x12, 0x34, 0x56]),
            Some(123456.0)
        );
        assert_eq!(
            decode_value(&d(DecodeEncoding::Bcd, 1, false), &[0xFF]),
            None
        );
        assert_eq!(
            decode_value(&d(DecodeEncoding::Ascii, 1, false), &[0x41]),
            None
        );
        assert_eq!(
            decode_value(&d(DecodeEncoding::Be, 2, false), &[0x01]),
            None
        );
        let mut flag = d(DecodeEncoding::Bitfield, 1, false);
        flag.bit_offset = Some(3);
        flag.bit_len = Some(1);
        assert_eq!(decode_value(&flag, &[0b0000_1000]), Some(1.0));
        assert_eq!(decode_value(&flag, &[0b1111_0111]), Some(0.0));
        let mut nibble = d(DecodeEncoding::Bitfield, 1, false);
        nibble.bit_offset = Some(4);
        nibble.bit_len = Some(4);
        assert_eq!(decode_value(&nibble, &[0xA5]), Some(10.0));
        let mut scaled = d(DecodeEncoding::Be, 2, false);
        scaled.scale = 0.1;
        scaled.bias = -3276.8;
        assert!((decode_value(&scaled, &[0x80, 0x00]).unwrap()).abs() < 1e-9);
        // Round-trip through serde keeps the shape.
        let json = serde_json::to_string(&flag).unwrap();
        let back: Decode = serde_json::from_str(&json).unwrap();
        assert_eq!(back, flag);
    }

    #[test]
    fn profiled_level_and_gateway_behaviour_come_from_data_on_two_brands() {
        assert_eq!(
            profiled_level_for_vin(Some("VR7EXAMPLE0000001")),
            Some(ProfiledLevel::DecodesVerified)
        );
        assert_eq!(profiled_level_for_vin(Some("ZZZ00000000000000")), None);
        assert_eq!(profiled_level_for_vin(None), None);
        let standard_only = brand_with(|b| b.profiled_level == Some(ProfiledLevel::StandardOnly));
        assert_eq!(
            profiled_level_for_vin(Some(&vin_for(&standard_only.id, "EXAMPLE"))),
            Some(ProfiledLevel::StandardOnly)
        );
        assert!(standard_only.modules.is_empty());
        assert!(ProfiledLevel::StandardOnly < ProfiledLevel::DecodesVerified);
        for b in &map().brands {
            assert!(
                profiled_level_for_vin(Some(&vin_for(&b.id, "EXAMPLE"))).is_some(),
                "{}",
                b.id
            );
        }

        let filtered = brand_with(|b| {
            b.gateway_behaviour
                .as_ref()
                .is_some_and(|g| g.silence_means == SilenceMeans::Filtered)
        });
        let g = gateway_behaviour_for_vin(Some(&vin_for(&filtered.id, "EXAMPLE")));
        assert_eq!(g.silence_means, SilenceMeans::Filtered);
        assert!(g.source.is_some());
        let blocked = brand_with(|b| {
            b.gateway_behaviour
                .as_ref()
                .is_some_and(|g| g.writes_blocked)
        });
        assert!(gateway_behaviour_for_vin(Some(&vin_for(&blocked.id, "EXAMPLE"))).writes_blocked);
        assert_eq!(
            gateway_behaviour_for_vin(Some("ZZZ00000000000000")),
            GatewayBehaviour::default()
        );
        assert_eq!(
            gateway_behaviour_for_vin(None).silence_means,
            SilenceMeans::Unknown
        );
    }

    #[test]
    fn platform_for_vin_matches_vds_patterns_on_two_brands_and_never_guesses() {
        let patterned: Vec<&Brand> = map()
            .brands
            .iter()
            .filter(|b| b.platforms.iter().any(|p| p.vds_pattern.is_some()))
            .collect();
        assert!(
            patterned.len() >= 2,
            "at least two brands carry VIN-selectable platforms"
        );
        for b in &patterned {
            let p = b
                .platforms
                .iter()
                .find(|p| p.vds_pattern.is_some())
                .unwrap();
            let pattern = p.vds_pattern.as_deref().unwrap();
            // Build a matching VDS from the pattern: literal characters, or
            // the first member of a class.
            let mut literal = String::new();
            let mut chars = pattern.trim_start_matches('^').chars().peekable();
            while let Some(c) = chars.next() {
                match c {
                    '[' => {
                        let first = chars.next().unwrap();
                        literal.push(first);
                        for x in chars.by_ref() {
                            if x == ']' {
                                break;
                            }
                        }
                    }
                    '$' | '?' | '*' | '+' => {}
                    '.' => literal.push('A'),
                    c => literal.push(c),
                }
            }
            let hit = platform_for_vin(Some(&vin_for(&b.id, &literal)));
            assert_eq!(
                hit.as_ref().map(|p| p.key.as_str()),
                Some(p.key.as_str()),
                "{} {pattern}",
                b.id
            );
            let miss = platform_for_vin(Some(&vin_for(&b.id, "ZZZZZZZ")));
            assert_ne!(miss.map(|p| p.key), Some(p.key.clone()));
        }
        assert!(platform_for_vin(Some("ZZZ00000000000000")).is_none());
        assert!(platform_for_vin(Some("VR7")).is_none());
        assert!(platform_for_vin(None).is_none());
        // Platforms without a pattern are data for the evidence path only.
        let unpatterned = brand_with(|b| {
            !b.platforms.is_empty() && b.platforms.iter().all(|p| p.vds_pattern.is_none())
        });
        assert!(platform_for_vin(Some(&vin_for(&unpatterned.id, "EXAMPLE"))).is_none());
    }

    #[test]
    fn vds_pattern_subset_behaves_like_a_regex() {
        assert!(vds_matches("^AZ1", "AZ1CP00"));
        assert!(!vds_matches("^AZ1", "XAZ1000"));
        assert!(vds_matches("AZ1", "XAZ1000"));
        assert!(vds_matches("^[3Y]", "3E1EA00"));
        assert!(vds_matches("^[3Y]", "YGDEE00"));
        assert!(!vds_matches("^[3Y]", "SA1E200"));
        assert!(vds_matches("^[^3Y]", "SA1E200"));
        assert!(vds_matches("^E.3", "ED3UM00"));
        assert!(vds_matches("^A[A-C]?1$", "AB1"));
        assert!(vds_matches("^A[A-C]?1$", "A1"));
        assert!(!vds_matches("^A[A-C]?1$", "AD1"));
        assert!(vds_matches("^A0*1", "A00001X"));
        assert!(vds_matches("^A0+1", "A01"));
        assert!(!vds_matches("^A0+1", "A1"));
        assert!(vds_matches("1$", "AZ1"));
        assert!(!vds_matches("[unclosed", "ABC"));
        assert!(!vds_matches("*bad", "ABC"));
    }
}
