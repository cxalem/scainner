// Types for data/uds-map.json (schema v9) — kept in lockstep with the Rust
// structs in apps/desktop/src-tauri/src/elm/uds_map.rs by hand (both read
// the same file; there is no schema codegen yet, so a shape change needs
// updating both — see RESEARCH.md for the map's provenance and confidence
// notes and docs/uds/pack-schema-v9.md for the v9 field semantics).
//
// Rule (multi-brand plan): brand names appear only as pack data with a
// `source`. Layout and encoding identifiers below name encodings
// (`iso_ascii`, `bcd_part_refs`, ...), never brands.

export type Confidence = "confirmed" | "high" | "medium" | "low";
export type ScanPolicy =
  | "auto"
  | "none"
  | "conventional_11bit"
  | "normal_fixed_29bit"
  | "conventional_11bit_and_normal_fixed_29bit"
  /** Iterate target bytes on a fixed 11-bit request id (ISO-TP extended
   * addressing) as well as the conventional range. The engine treats it
   * as conventional-only until the target-byte path lands (Phase 2). */
  | "conventional_11bit_and_target_byte_11bit";

/** UDS/KWP read service a module answers: ReadDataByIdentifier (`22`),
 * ReadDataByLocalIdentifier (`21`) or ReadEcuIdentification (`1A`). */
export type ReadService = "22" | "21" | "1A";

export type SourceType =
  | "oem"
  | "open_implementation"
  | "tool_screen"
  | "parts_catalog"
  | "community"
  | "project_capture";

/** Provenance of one entry. Every module, band, known DID, family, decode,
 * identity block, platform and gateway rule carries one (lint). */
export interface Source {
  url: string;
  /** ISO date the source was consulted. */
  date: string;
  type: SourceType;
  /** SPDX id where known; `unlicensed`, `NOASSERTION` (custom LICENSE) or
   * a free-text note otherwise. GPL and NOASSERTION sources are
   * verification evidence only (acquisition protocol licence gate). */
  licence: string;
  note?: string;
}

export interface IdentDid {
  did: string;
  label: string;
}

export interface AddressScan {
  req_from: string;
  req_to: string;
  resp_offset: number;
  exclude: string[];
}

export interface Timings {
  presence_probe: number;
  ident_read: number;
  sweep_read: number;
}

export interface Standard {
  ident_dids: IdentDid[];
  /** DIDs whose payload is worth using as a module's display name, best first. */
  name_dids: string[];
  /** The DID asked when merely testing whether anything lives at an address. */
  presence_probe_did: string;
  address_scan: AddressScan;
  timings_ms: Timings;
  /** Read service assumed when neither brand nor module says otherwise (v9). */
  read_service?: ReadService;
  /** The ISO 14229-1 identification block every brand inherits (v9). */
  identity_block?: IdentityBlock;
}

export type RouteProtocol =
  | "can11_500"
  | "can11_250"
  | "can29_normal_fixed"
  | "can29_target_byte"
  | "can29_custom"
  | "kwp2000"
  | "iso9141";

/** How to reach one module: the compatibility tuple of the discovery
 * protocol. `req`/`resp` repeat the module's ids so a route is
 * self-contained; `target_byte` is the ECU address carried inside the
 * payload (iterated by target-byte schemes); `address_extension` is the
 * ISO-TP extended-address byte the adapter must send (`ATCEA`);
 * `gateway` names the gateway module id a route passes through. */
export interface Route {
  protocol: RouteProtocol;
  req: string;
  resp: string;
  target_byte?: string;
  address_extension?: string;
  gateway?: string;
  source?: Source;
}

export type DiscoverySession = "default_only" | "default_then_extended";

export interface ModuleDef {
  req: string;
  resp: string;
  name?: string | null;
  confidence?: Confidence;
  discovery_session?: DiscoverySession;
  /** Overrides the brand's read service for this module (v9). */
  read_service?: ReadService;
  /** Explicit route; derived from `req`/`resp` when absent (v9). */
  route?: Route;
  source?: Source;
}

export interface Band {
  from: string;
  to: string;
  note?: string | null;
  confidence?: Confidence;
  source?: Source;
}

export type DecodeEncoding = "be" | "le" | "bcd" | "ascii" | "bitfield";

/** One value inside a DID payload (v9). `offset` counts bytes after the
 * echoed identifier (RESEARCH.md section 2). `bitfield` takes the `len`
 * bytes at `offset` as a big-endian integer, shifts right by `bit_offset`
 * (0 = least significant bit) and masks `bit_len` bits. `signed` means
 * two's complement over `len` bytes (or `bit_len` bits); offset-binary
 * values are unsigned with a negative `bias`. */
export interface Decode {
  offset: number;
  len: number;
  signed: boolean;
  encoding: DecodeEncoding;
  bit_offset?: number;
  bit_len?: number;
  scale: number;
  bias: number;
  unit: string;
  /** Machine-readable physical quantity (`speed`, `voltage`, `temperature`,
   * `pressure`, `percentage`, `distance`, `flag`, `identifier`, ...). */
  quantity: string;
  label: string;
}

export interface KnownDid {
  /** How this decode was established (vehicle sessions, sources, caveats). */
  evidence?: string;
  did: string;
  label: string;
  /** Exact ECU address pairs this DID meaning/formula belongs to. Required
   * in v9: empty only together with `binding: "unknown"`. */
  modules?: { req: string; resp: string }[];
  /** Set when the research does not say which module carries this DID.
   * Such entries are never matched by module-scoped lookups. */
  binding?: "unknown";
  unit?: string | null;
  /** Mirror of `decodes[0]` (kept for v8 consumers; lint checks agreement). */
  offset?: number | null;
  len?: number | null;
  scale?: number | null;
  bias?: number | null;
  /** Every value in this DID's payload (v9). Empty when only the address
   * is known. */
  decodes?: Decode[];
  confidence?: Confidence;
  note?: string | null;
  source?: Source;
}

/** How a brand derives a response CAN address from a request address, per
 * address block. A single global offset is wrong for most brands and some
 * brands need two rules depending on the block — see RESEARCH.md 3.1. */
export interface RespOffset {
  from: string;
  to: string;
  delta: number;
}

export type IdentityField =
  | "part"
  | "hardware"
  | "software"
  | "system"
  | "serial"
  | "supplier"
  | "vin"
  | "other";

/** Payload layouts an identity DID may use. `iso_ascii`: printable ASCII
 * string. `bcd_part_refs`: packed BCD digits, `len` bytes at `offset`,
 * optionally wrapped in a literal `prefix`/`suffix` (a 3-byte group
 * printed as `96xxxxxx80`). `ascii_part_refs`: ASCII references at a
 * fixed offset/length. `raw`: the bytes as hex. */
export type IdentityLayout = "iso_ascii" | "bcd_part_refs" | "ascii_part_refs" | "raw";

export interface IdentityDid {
  did: string;
  field: IdentityField;
  layout: IdentityLayout;
  offset?: number;
  len?: number;
  prefix?: string;
  suffix?: string;
}

export interface IdentityBlock {
  dids: IdentityDid[];
  source: Source;
}

/** A platform/generation split that changes service or addressing (v9).
 * `vds_pattern` is a regex over VIN characters 4-10 (seven characters)
 * restricted to the subset both implementations support: literals, `.`,
 * `[...]` classes with ranges and negation, `^`, `$`, `?`, `*`, `+`. Null
 * when no registry confirmed a pattern — the platform is then selectable
 * by evidence only, never by VIN. */
export interface Platform {
  key: string;
  vds_pattern: string | null;
  /** [from, to] model years; null = unknown/open. */
  years: [number | null, number | null];
  ecu_families_expected: string[];
  read_service?: ReadService;
  notes: string;
  source: Source;
}

export type SilenceMeans = "absent" | "filtered" | "unknown";

export interface GatewayBehaviour {
  silence_means: SilenceMeans;
  writes_blocked: boolean;
  notes?: string;
  source?: Source;
}

/** How far a brand is profiled (discovery protocol section 5), derived
 * from what the pack holds: `standard_only` (no manufacturer routes),
 * `routes_sourced` (routes from open implementations or community
 * tables), `routes_verified` (at least one route confirmed by a recorded
 * request/response capture — a project capture or an open corpus test
 * fixture with raw bytes), `decodes_verified` (decodes confirmed on a
 * vehicle by this project). */
export type ProfiledLevel = "standard_only" | "routes_sourced" | "routes_verified" | "decodes_verified";

export interface Brand {
  id: string;
  name: string;
  /** VIN World Manufacturer Identifier prefixes (first 3 VIN characters). */
  wmi: string[];
  confidence: Confidence;
  modules?: ModuleDef[];
  did_bands?: Band[];
  known_dids?: KnownDid[];
  resp_offsets?: RespOffset[];
  scan_policy?: ScanPolicy;
  /** Default read service for this brand's modules (v9). */
  read_service?: ReadService;
  identity_block?: IdentityBlock;
  platforms?: Platform[];
  gateway_behaviour?: GatewayBehaviour;
  profiled_level?: ProfiledLevel;
  /** Every source this brand's entries cite (v9). */
  sources?: Source[];
}

export interface UdsMap {
  version: number;
  generated: string;
  note: string;
  standard: Standard;
  brands: Brand[];
  /** Cross-brand ECU families keyed by part reference (v8+). */
  ecu_families?: EcuFamily[];
}

/** A knowledge overlay pack under data/packs/ (same brand shape, its own
 * licence and provenance). */
export interface OverlayPack {
  id: string;
  version: number;
  license: string;
  source: string;
  brands: Brand[];
}

/** Knowledge state of one decode (Universal Discovery Protocol §3). */
export type KnowledgeState =
  | "research_candidate"
  | "community_reported"
  | "reached_on_vehicle"
  | "verified_on_vehicle"
  | "inherited"
  | "locally_confirmed"
  | "community_verified"
  | "oem_confirmed"
  | "unknown";

/** One decode of an ECU family: how to read a DID on every module carrying
 * this part reference, on any brand. */
export interface FamilyDecode {
  did: string;
  label: string;
  offset: number;
  len: number;
  scale: number;
  bias: number;
  signed: boolean;
  unit: string;
  /** Machine-readable physical quantity (v9). */
  quantity?: string;
  knowledge_state: KnowledgeState;
  /** How this decode was established and why it holds its state. */
  evidence: string;
  /** Vehicles on which this decode was confirmed byte-for-byte. */
  vehicles_confirmed: number;
  /** The cheapest physical check that confirms this decode on a new car. */
  discriminating_test?: string;
}

/** Where a family was seen: brand profile plus the exact address pair. */
export interface FamilyModuleRef {
  brand: string;
  req: string;
  resp: string;
}

/** The reuse unit (protocol §2, L3): an ECU identified by supplier part
 * reference, with every decode ever verified on it. Brand is how a module
 * is found; the part reference is how it is known. */
export interface EcuFamily {
  id: string;
  supplier?: string | null;
  family: string;
  /** Ten-digit part references (vendor identity layouts) or ISO F187. */
  hardware_refs: string[];
  /** Software/calibration references (vendor layouts or ISO F189/F195). */
  software_refs: string[];
  /** Read service the decodes were verified with ("22", "21", "1A"). */
  diagnostic_service: string;
  modules_seen_on: FamilyModuleRef[];
  evidence?: string;
  decodes: FamilyDecode[];
  source?: Source;
}
