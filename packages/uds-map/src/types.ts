
export type Confidence = "confirmed" | "high" | "medium" | "low";
export type ScanPolicy =
  | "auto"
  | "none"
  | "conventional_11bit"
  | "normal_fixed_29bit"
  | "conventional_11bit_and_normal_fixed_29bit"
  | "conventional_11bit_and_target_byte_11bit";

export type ReadService = "22" | "21" | "1A";

export type SourceType =
  | "oem"
  | "open_implementation"
  | "tool_screen"
  | "parts_catalog"
  | "community"
  | "project_capture";

export interface Source {
  url: string;
  date: string;
  type: SourceType;
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
  name_dids: string[];
  presence_probe_did: string;
  address_scan: AddressScan;
  timings_ms: Timings;
  read_service?: ReadService;
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
  read_service?: ReadService;
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
  quantity: string;
  label: string;
}

export interface KnownDid {
  evidence?: string;
  did: string;
  label: string;
  modules?: { req: string; resp: string }[];
  binding?: "unknown";
  read_service?: ReadService;
  unit?: string | null;
  offset?: number | null;
  len?: number | null;
  scale?: number | null;
  bias?: number | null;
  decodes?: Decode[];
  confidence?: Confidence;
  note?: string | null;
  source?: Source;
}

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

export interface Platform {
  key: string;
  vds_pattern: string | null;
  years: [number | null, number | null];
  ecu_families_expected: string[];
  read_service?: ReadService;
  notes: string;
  source: Source;
}

export type SilenceMeans = "absent" | "filtered" | "unreachable_pins" | "unknown";

export interface GatewayBehaviour {
  silence_means: SilenceMeans;
  writes_blocked: boolean;
  notes?: string;
  source?: Source;
}

export type ProfiledLevel = "standard_only" | "routes_sourced" | "routes_verified" | "decodes_verified";

export interface Brand {
  id: string;
  name: string;
  wmi: string[];
  confidence: Confidence;
  modules?: ModuleDef[];
  did_bands?: Band[];
  known_dids?: KnownDid[];
  resp_offsets?: RespOffset[];
  scan_policy?: ScanPolicy;
  read_service?: ReadService;
  identity_block?: IdentityBlock;
  platforms?: Platform[];
  gateway_behaviour?: GatewayBehaviour;
  profiled_level?: ProfiledLevel;
  sources?: Source[];
}

export interface UdsMap {
  version: number;
  generated: string;
  note: string;
  standard: Standard;
  brands: Brand[];
  ecu_families?: EcuFamily[];
}

export interface OverlayPack {
  id: string;
  version: number;
  license: string;
  source: string;
  brands: Brand[];
}

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

export interface FamilyDecode {
  did: string;
  label: string;
  offset: number;
  len: number;
  scale: number;
  bias: number;
  signed: boolean;
  unit: string;
  quantity?: string;
  knowledge_state: KnowledgeState;
  evidence: string;
  vehicles_confirmed: number;
  discriminating_test?: string;
}

export interface FamilyModuleRef {
  brand: string;
  req: string;
  resp: string;
}

export interface EcuFamily {
  id: string;
  supplier?: string | null;
  family: string;
  hardware_refs: string[];
  software_refs: string[];
  diagnostic_service: string;
  modules_seen_on: FamilyModuleRef[];
  evidence?: string;
  decodes: FamilyDecode[];
  source?: Source;
}
