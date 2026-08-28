// @scainner/uds-map — a queryable knowledge map of manufacturer-specific
// UDS (ISO 14229) diagnostic addresses and DID ranges, keyed by VIN.
//
// This is a straight, deliberate port of the query functions in
// apps/desktop/src-tauri/src/elm/uds_map.rs, the Rust engine that reads
// the SAME data/uds-map.json this package ships. Keep the two in sync by
// hand when the query logic changes — see that file's doc comment for the
// full design rationale ("no hardcoded values anywhere": every per-brand
// fact lives in the data file, never in code; no brand is named in code).
//
// READ-ONLY BY DESIGN. This package answers "what address/DID should I
// try for this VIN" — it does not talk to a car. Confidence levels
// (`confirmed`/`high`/`medium`/`low`) reflect how independently verified
// each entry is; treat `medium`/`low` as a starting point to confirm on
// real hardware, not a guarantee. See RESEARCH.md for full per-brand
// provenance and known gaps, and COVERAGE.md (generated) for what the
// pack holds per brand.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Band,
  Brand,
  Confidence,
  Decode,
  EcuFamily,
  GatewayBehaviour,
  IdentityBlock,
  KnownDid,
  ModuleDef,
  OverlayPack,
  Platform,
  ProfiledLevel,
  ReadService,
  Route,
  UdsMap,
} from "./types.js";

export type * from "./types.js";

let cached: UdsMap | undefined;
let cachedPacks: OverlayPack[] | undefined;

function dataDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "data");
}

/** The full parsed map. Cached after first read. */
export function getMap(): UdsMap {
  if (cached) return cached;
  const raw = readFileSync(join(dataDir(), "uds-map.json"), "utf-8");
  cached = JSON.parse(raw) as UdsMap;
  return cached;
}

/** Every knowledge overlay pack under data/packs/ (sorted by file name).
 * Overlays carry their own licence and provenance and are consulted after
 * the main map for module-scoped lookups. */
export function overlayPacks(): OverlayPack[] {
  if (cachedPacks) return cachedPacks;
  const dir = join(dataDir(), "packs");
  cachedPacks = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")) as OverlayPack);
  return cachedPacks;
}

/** Parse a 16-bit hex value — used for DIDs, which span the full
 * 0000-FFFF range. NOT for CAN addresses: use `can11` for those, which
 * additionally enforces the 11-bit range. */
export function hex16(s: string): number | undefined {
  const v = Number.parseInt(s.trim(), 16);
  return Number.isNaN(v) ? undefined : v;
}

/** Parse an 11-bit CAN address. Returns undefined for 29-bit extended
 * addresses — real, correctly recorded in the map, but not what an
 * 11-bit-only sweeper can address; see `extendedModulesForVin` for
 * surfacing those honestly instead of silently dropping them. */
export function can11(s: string): number | undefined {
  const v = Number.parseInt(s.trim(), 16);
  return Number.isNaN(v) || v > 0x7ff ? undefined : v;
}

/** Any hex width — for 29-bit addresses and general validation. */
export function hexAny(s: string): number | undefined {
  const v = Number.parseInt(s.trim(), 16);
  return Number.isNaN(v) ? undefined : v;
}

function confidenceRank(c: Confidence | undefined): number {
  switch (c) {
    case "confirmed":
      return 0;
    case "high":
      return 1;
    case "low":
      return 3;
    case "medium":
    default:
      return 2;
  }
}

function wmiOf(vin: string | null | undefined): string | undefined {
  if (!vin || vin.length < 3) return undefined;
  return vin.slice(0, 3).toUpperCase();
}

/** The brand entry whose WMI list contains this VIN's first three
 * characters. undefined for an unknown or absent VIN — callers then
 * fall back to every brand's data (slower, still bounded) rather than
 * guessing at one. */
export function brandForVin(vin: string | null | undefined): Brand | undefined {
  const wmi = wmiOf(vin);
  if (!wmi) return undefined;
  return getMap().brands.find((b) => b.wmi.some((w) => w.toUpperCase() === wmi));
}

/** Overlay brand entries whose WMI list contains this VIN's prefix. */
export function overlayBrandsForVin(vin: string | null | undefined): Brand[] {
  const wmi = wmiOf(vin);
  if (!wmi) return [];
  return overlayPacks().flatMap((p) => p.brands.filter((b) => b.wmi.some((w) => w.toUpperCase() === wmi)));
}

/** DID neighborhoods worth sweeping, as [from, to] pairs ordered
 * confidence-first (confirmed before high before medium before low) so a
 * cancelled or link-degraded scan still got the productive
 * neighborhoods first. Brand-specific when the VIN identifies one;
 * otherwise the union across every brand, deduplicated. */
export function bandsForVin(vin: string | null | undefined): [number, number][] {
  const collect = (b: Brand): [number, number, number][] =>
    (b.did_bands ?? []).flatMap((d: Band) => {
      const f = hex16(d.from);
      const t = hex16(d.to);
      if (f === undefined || t === undefined) return [];
      return [[confidenceRank(d.confidence), f, t]];
    });
  const brand = brandForVin(vin);
  const ranked = brand ? collect(brand) : getMap().brands.flatMap(collect);
  ranked.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const out: [number, number][] = [];
  const seen = new Set<string>();
  for (const [, f, t] of ranked) {
    const key = `${f}-${t}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push([f, t]);
    }
  }
  return out;
}

/** Module address pairs this brand is known to use, tried before a
 * generic sweep so a recognized car finds its real modules first. */
export function knownModulesForVin(
  vin: string | null | undefined,
): { req: number; resp: number; name: string | null }[] {
  const brand = brandForVin(vin);
  if (!brand) return [];
  const out: { req: number; resp: number; name: string | null }[] = [];
  for (const m of brand.modules ?? []) {
    const req = hexAny(m.req);
    const resp = hexAny(m.resp);
    if (req !== undefined && resp !== undefined) out.push({ req, resp, name: m.name ?? null });
  }
  return out;
}

/** How many documented modules use 29-bit addressing. */
export function extendedModulesForVin(vin: string | null | undefined): number {
  const brand = brandForVin(vin);
  if (!brand) return 0;
  return (brand.modules ?? []).filter((m: ModuleDef) => can11(m.req) === undefined && hexAny(m.req) !== undefined)
    .length;
}

/** The response CAN address for a request address on this brand: the
 * brand's own per-block rule when the map has one (see `RespOffset` —
 * some brands need two different rules depending on the address block),
 * else the standard fallback offset. */
export function responseAddr(brand: Brand | undefined, req: number): number {
  if (brand) {
    for (const r of brand.resp_offsets ?? []) {
      const from = can11(r.from);
      const to = can11(r.to);
      if (from !== undefined && to !== undefined && req >= from && req <= to) {
        return Math.min(0x7ff, Math.max(0, req + r.delta));
      }
    }
  }
  return req + getMap().standard.address_scan.resp_offset;
}

export type CandidateSource = "profile" | "conventional_11bit" | "normal_fixed_29bit";
export type AddressCandidate = {
  req: number;
  resp: number;
  name: string | null;
  profile_candidate: boolean;
  source: CandidateSource;
};

function normalFixed29bitTarget(req: number, resp: number): number | undefined {
  if ((req & 0xffff00ff) !== 0x18da00f1 || (resp & 0xffffff00) !== 0x18daf100) return undefined;
  const target = (req >>> 8) & 0xff;
  return (resp & 0xff) === target ? target : undefined;
}

function scanStrategies(
  brand: Brand | undefined,
  known: { req: number; resp: number }[],
): { scan11bit: boolean; scan29bit: boolean } {
  if (!brand) return { scan11bit: true, scan29bit: true };
  switch (brand.scan_policy ?? "auto") {
    case "none":
      return { scan11bit: false, scan29bit: false };
    case "conventional_11bit":
    case "conventional_11bit_and_target_byte_11bit":
      return { scan11bit: true, scan29bit: false };
    case "normal_fixed_29bit":
      return { scan11bit: false, scan29bit: true };
    case "conventional_11bit_and_normal_fixed_29bit":
      return { scan11bit: true, scan29bit: true };
    case "auto":
      return { scan11bit: true, scan29bit: known.some(({ req, resp }) => normalFixed29bitTarget(req, resp) !== undefined) };
  }
}

/** Build an evidence-driven enumeration plan: documented pairs first, then
 * only the generic addressing schemes allowed by this brand's policy. */
export function addressesToProbe(
  vin: string | null | undefined,
): AddressCandidate[] {
  const scan = getMap().standard.address_scan;
  const from = can11(scan.req_from) ?? 0x700;
  const to = can11(scan.req_to) ?? 0x7f6;
  const excluded = new Set((scan.exclude ?? []).map((e) => can11(e)).filter((v): v is number => v !== undefined));

  const brand = brandForVin(vin);
  const known = knownModulesForVin(vin);
  const strategies = scanStrategies(brand, known);
  const out: AddressCandidate[] = known.map((candidate) => ({
    ...candidate,
    profile_candidate: true,
    source: "profile",
  }));
  const seen = new Set(out.map((m) => m.req));
  if (strategies.scan11bit) {
    for (let req = from; req <= to; req++) {
      if (excluded.has(req) || seen.has(req)) continue;
      seen.add(req);
      out.push({ req, resp: responseAddr(brand, req), name: null, profile_candidate: false, source: "conventional_11bit" });
    }
  }
  if (strategies.scan29bit) {
    for (let target = 0; target <= 0xff; target++) {
      if (target === 0xf1 || target === 0xfe || target === 0xff) continue;
      const req = 0x18da00f1 | (target << 8);
      if (seen.has(req)) continue;
      seen.add(req);
      out.push({ req, resp: 0x18daf100 | target, name: null, profile_candidate: false, source: "normal_fixed_29bit" });
    }
  }
  return out;
}

/** The standardized (ISO 14229-1) identification DIDs — genuinely
 * universal, not brand-specific. */
export function identDids(): number[] {
  return getMap()
    .standard.ident_dids.map((d) => hex16(d.did))
    .filter((v): v is number => v !== undefined);
}

/** DIDs whose payload is worth using as a module's display name, best first. */
export function nameDids(): number[] {
  return getMap()
    .standard.name_dids.map(hex16)
    .filter((v): v is number => v !== undefined);
}

/** The DID asked when merely testing whether anything lives at an address. */
export function presenceProbeDid(): number {
  return hex16(getMap().standard.presence_probe_did) ?? 0xf186;
}

function moduleMatches(k: KnownDid, module: { req: number; resp: number }): boolean {
  return (k.modules ?? []).some((m) => hexAny(m.req) === module.req && hexAny(m.resp) === module.resp);
}

function knownDidCandidates(vin: string | null | undefined, did: number): KnownDid[] {
  const brand = brandForVin(vin);
  const brands = brand ? [brand, ...overlayBrandsForVin(vin)] : overlayBrandsForVin(vin);
  return brands.flatMap((b) => (b.known_dids ?? []).filter((k) => hex16(k.did) === did));
}

/** A documented label (and decodes, when known) for a DID on exactly this
 * module of this brand — turns a raw discovery hit into a named sensor
 * instead of anonymous hex. A DID is not globally meaningful across a
 * vehicle, so an entry bound to another module, or to no module
 * (`binding: "unknown"`), is never returned (v9: no unscoped fallback). */
export function knownDid(
  vin: string | null | undefined,
  did: number,
  module: { req: number; resp: number },
): KnownDid | undefined {
  return knownDidCandidates(vin, did).find((k) => moduleMatches(k, module));
}

/** The first documented entry for a DID on this brand regardless of
 * module binding — for browsing and research tooling only, never for
 * labelling what a specific module answered. */
export function knownDidUnscoped(vin: string | null | undefined, did: number): KnownDid | undefined {
  return knownDidCandidates(vin, did)[0];
}

/** The scalar decode of a known DID: `decodes[0]` when present, else the
 * legacy offset/len/scale/bias fields (v8 shape). undefined when the map
 * documents only the address. */
export function primaryDecode(known: KnownDid): Decode | undefined {
  if (known.decodes && known.decodes.length > 0) return known.decodes[0];
  const { offset, len, scale, bias } = known;
  if (offset == null || len == null || scale == null || bias == null) return undefined;
  return {
    offset,
    len,
    signed: false,
    encoding: "be",
    scale,
    bias,
    unit: known.unit ?? "",
    quantity: "raw",
    label: known.label,
  };
}

/** Apply one decode to raw payload bytes (after the echoed identifier).
 * undefined when the payload is too short, or for `ascii` (use
 * `decodeString`). */
export function decodeValue(decode: Decode, bytes: number[] | Uint8Array): number | undefined {
  const arr = Array.from(bytes);
  const { offset, len } = decode;
  if (offset + len > arr.length || len <= 0) return undefined;
  const slice = arr.slice(offset, offset + len);
  let raw: number;
  switch (decode.encoding) {
    case "ascii":
      return undefined;
    case "le":
      raw = slice.reduceRight((acc, b) => acc * 256 + b, 0);
      break;
    case "bcd": {
      let digits = "";
      for (const b of slice) {
        const hi = b >> 4;
        const lo = b & 0x0f;
        if (hi > 9 || lo > 9) return undefined;
        digits += `${hi}${lo}`;
      }
      raw = Number.parseInt(digits, 10);
      break;
    }
    case "bitfield": {
      const whole = slice.reduce((acc, b) => acc * 256 + b, 0);
      const bitLen = decode.bit_len ?? len * 8;
      const shifted = Math.floor(whole / 2 ** (decode.bit_offset ?? 0));
      raw = shifted % 2 ** bitLen;
      if (decode.signed && raw >= 2 ** (bitLen - 1)) raw -= 2 ** bitLen;
      return raw * decode.scale + decode.bias;
    }
    case "be":
    default:
      raw = slice.reduce((acc, b) => acc * 256 + b, 0);
  }
  if (decode.signed && decode.encoding !== "bcd" && raw >= 2 ** (len * 8 - 1)) raw -= 2 ** (len * 8);
  return raw * decode.scale + decode.bias;
}

/** The printable ASCII string of an `ascii` decode (or the whole payload
 * when `len` is 0). */
export function decodeString(decode: Decode, bytes: number[] | Uint8Array): string | undefined {
  const arr = Array.from(bytes);
  const end = decode.len > 0 ? decode.offset + decode.len : arr.length;
  if (decode.offset > arr.length) return undefined;
  return String.fromCharCode(...arr.slice(decode.offset, end).filter((b) => b >= 0x20 && b < 0x7f));
}

/** Decode a KnownDid's raw byte payload with its primary decode. Returns
 * undefined when the map doesn't have a full decode formula for this DID
 * (a real, honest outcome — many entries only document the address). */
export function decodeKnownDid(known: KnownDid, bytes: number[] | Uint8Array): number | undefined {
  const decode = primaryDecode(known);
  return decode ? decodeValue(decode, bytes) : undefined;
}

/** Every ECU family in the map (empty on maps older than v8). */
export function ecuFamilies(): EcuFamily[] {
  return getMap().ecu_families ?? [];
}

/** The family whose hardware references contain this part reference —
 * the byte-level match the protocol calls a Strong/Weak join. */
export function familyForHardwareRef(hardwareRef: string): EcuFamily | undefined {
  const wanted = hardwareRef.trim();
  return ecuFamilies().find((f) => f.hardware_refs.some((r) => r === wanted));
}

// ---------------------------------------------------------------------------
// v9 accessors — the contract mirrored by uds_map.rs for Phase 2.
// ---------------------------------------------------------------------------

function moduleDef(vin: string | null | undefined, req: number, resp: number): ModuleDef | undefined {
  const brand = brandForVin(vin);
  const brands = brand ? [brand, ...overlayBrandsForVin(vin)] : overlayBrandsForVin(vin);
  return brands.flatMap((b) => b.modules ?? []).find((m) => hexAny(m.req) === req && hexAny(m.resp) === resp);
}

/** Derive a route from a request/response pair alone: 11-bit ids are
 * conventional 500 kbit/s; a normal-fixed 29-bit pair (`18DA<t>F1` /
 * `18DAF1<t>`) names its target byte; any other 29-bit pair is custom. */
export function deriveRoute(req: number, resp: number): Route {
  const hex = (v: number, width: number) => v.toString(16).toUpperCase().padStart(width, "0");
  if (req > 0x7ff || resp > 0x7ff) {
    const target = normalFixed29bitTarget(req, resp);
    if (target !== undefined) {
      return { protocol: "can29_normal_fixed", req: hex(req, 8), resp: hex(resp, 8), target_byte: hex(target, 2) };
    }
    return { protocol: "can29_custom", req: hex(req, 8), resp: hex(resp, 8) };
  }
  return { protocol: "can11_500", req: hex(req, 3), resp: hex(resp, 3) };
}

/** The route tuple for a module: the pack's explicit route when the
 * module is documented with one, else derived from the ids. */
export function routeForModule(vin: string | null | undefined, req: number, resp: number): Route {
  return moduleDef(vin, req, resp)?.route ?? deriveRoute(req, resp);
}

/** The identity block to read on this VIN's modules: the brand's block
 * (ISO DIDs plus vendor layouts) or the standard ISO block. */
export function identityBlockForVin(vin: string | null | undefined): IdentityBlock {
  const brand = brandForVin(vin);
  return brand?.identity_block ?? getMap().standard.identity_block ?? { dids: [], source: standardSource() };
}

function standardSource() {
  return { url: "packages/uds-map/RESEARCH.md#1-what-is-in-scope", date: "2026-08-23", type: "community" as const, licence: "MIT" };
}

/** The read service for one module: module override, then brand default,
 * then the standard default (`22`). */
export function readServiceForModule(vin: string | null | undefined, req: number, resp: number): ReadService {
  return (
    moduleDef(vin, req, resp)?.read_service ??
    brandForVin(vin)?.read_service ??
    getMap().standard.read_service ??
    "22"
  );
}

/** Every decode of a DID on exactly this module (empty when the pack has
 * no module-bound entry or only the address). */
export function decodesForDid(vin: string | null | undefined, req: number, resp: number, did: number): Decode[] {
  const known = knownDid(vin, did, { req, resp });
  if (!known) return [];
  if (known.decodes && known.decodes.length > 0) return known.decodes;
  const primary = primaryDecode(known);
  return primary ? [primary] : [];
}

/** How far this VIN's brand is profiled; undefined for an unknown WMI. */
export function profiledLevelForVin(vin: string | null | undefined): ProfiledLevel | undefined {
  return brandForVin(vin)?.profiled_level;
}

/** What silence from a module means on this brand, and whether writes
 * are gateway-blocked. Unknown brands (and brands without a sourced rule)
 * get `unknown`/`false` with no source. */
export function gatewayBehaviourForVin(vin: string | null | undefined): GatewayBehaviour {
  return brandForVin(vin)?.gateway_behaviour ?? { silence_means: "unknown", writes_blocked: false };
}

/** The platform whose `vds_pattern` matches VIN characters 4-10 (first
 * match in pack order). Platforms without a pattern are never selected
 * by VIN. */
export function platformForVin(vin: string | null | undefined): Platform | undefined {
  const brand = brandForVin(vin);
  if (!brand || !vin || vin.length < 10) return undefined;
  const vds = vin.slice(3, 10).toUpperCase();
  return (brand.platforms ?? []).find((p) => p.vds_pattern != null && new RegExp(p.vds_pattern).test(vds));
}
