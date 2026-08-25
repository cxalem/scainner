// Types for data/uds-map.json — kept in lockstep with the Rust structs in
// apps/desktop/src-tauri/src/elm/uds_map.rs by hand (both read the same
// file; there is no schema codegen yet, so a shape change needs updating
// both — see RESEARCH.md for the map's provenance and confidence notes).

export type Confidence = "confirmed" | "high" | "medium" | "low";
export type ScanPolicy =
  | "auto"
  | "none"
  | "conventional_11bit"
  | "normal_fixed_29bit"
  | "conventional_11bit_and_normal_fixed_29bit";

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
}

export interface ModuleDef {
  req: string;
  resp: string;
  name?: string | null;
  confidence?: Confidence;
}

export interface Band {
  from: string;
  to: string;
  note?: string | null;
  confidence?: Confidence;
}

export interface KnownDid {
  did: string;
  label: string;
  /** Exact ECU address pairs this DID meaning/formula belongs to. */
  modules?: { req: string; resp: string }[];
  unit?: string | null;
  offset?: number | null;
  len?: number | null;
  scale?: number | null;
  bias?: number | null;
  confidence?: Confidence;
  note?: string | null;
}

/** How a brand derives a response CAN address from a request address, per
 * address block. A single global offset is wrong for most brands (VW Group
 * proprietary modules are +0x6A, GM is +0x400, FCA is -0x280) and PSA uses
 * TWO rules depending on the block — see RESEARCH.md section 3.1. */
export interface RespOffset {
  from: string;
  to: string;
  delta: number;
}

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
}

export interface UdsMap {
  version: number;
  generated: string;
  note: string;
  standard: Standard;
  brands: Brand[];
}
