// @scainner/uds-map — a queryable knowledge map of manufacturer-specific
// UDS (ISO 14229) diagnostic addresses and DID ranges, keyed by VIN.
//
// This is a straight, deliberate port of the query functions in
// apps/desktop/src-tauri/src/elm/uds_map.rs, the Rust engine that reads
// the SAME data/uds-map.json this package ships. Keep the two in sync by
// hand when the query logic changes — see that file's doc comment for the
// full design rationale ("no hardcoded values anywhere": every per-brand
// fact lives in the data file, never in code).
//
// READ-ONLY BY DESIGN. This package answers "what address/DID should I
// try for this VIN" — it does not talk to a car. Confidence levels
// (`confirmed`/`high`/`medium`/`low`) reflect how independently verified
// each entry is; treat `medium`/`low` as a starting point to confirm on
// real hardware, not a guarantee. See RESEARCH.md for full per-brand
// provenance, what was verified this project's own hardware vs. sourced
// from the community, and known gaps.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Band, Brand, Confidence, KnownDid, ModuleDef, UdsMap } from "./types.js";

export type * from "./types.js";

let cached: UdsMap | undefined;

/** The full parsed map. Cached after first read. */
export function getMap(): UdsMap {
  if (cached) return cached;
  const dir = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(dir, "..", "data", "uds-map.json"), "utf-8");
  cached = JSON.parse(raw) as UdsMap;
  return cached;
}

/** Parse a 16-bit hex value — used for DIDs, which span the full
 * 0000-FFFF range (D422, F190, ...). NOT for CAN addresses: use `can11`
 * for those, which additionally enforces the 11-bit range. */
export function hex16(s: string): number | undefined {
  const v = Number.parseInt(s.trim(), 16);
  return Number.isNaN(v) ? undefined : v;
}

/** Parse an 11-bit CAN address. Returns undefined for 29-bit extended
 * addresses (e.g. GM's 14DACBF1) — real, correctly recorded in the map,
 * but not what an 11-bit-only sweeper can address; see
 * `extendedModulesForVin` for surfacing those honestly instead of
 * silently dropping them. */
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

/** The brand entry whose WMI list contains this VIN's first three
 * characters. undefined for an unknown or absent VIN — callers then
 * fall back to every brand's data (slower, still bounded) rather than
 * guessing at one. */
export function brandForVin(vin: string | null | undefined): Brand | undefined {
  if (!vin || vin.length < 3) return undefined;
  const wmi = vin.slice(0, 3).toUpperCase();
  return getMap().brands.find((b) => b.wmi.some((w) => w.toUpperCase() === wmi));
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
 * PSA alone needs two different rules depending on the address block),
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

/** A documented label (and decode hints, when known) for a DID on this
 * brand — turns a raw discovery hit into a named sensor instead of
 * anonymous hex. */
export function knownDid(
  vin: string | null | undefined,
  did: number,
  module?: { req: number; resp: number },
): KnownDid | undefined {
  const brand = brandForVin(vin);
  if (!brand) return undefined;
  const candidates = (brand.known_dids ?? []).filter((k) => hex16(k.did) === did);
  if (module) {
    const exact = candidates.find((k) =>
      (k.modules ?? []).some((m) => can11(m.req) === module.req && can11(m.resp) === module.resp),
    );
    if (exact) return exact;
    return candidates.find((k) => (k.modules ?? []).length === 0);
  }
  return candidates[0];
}

/** Decode a KnownDid's raw byte payload using its offset/len/scale/bias
 * hints, when all four are documented. Returns undefined when the map
 * doesn't have a full decode formula for this DID (a real, honest
 * outcome — many entries only document the address, not the formula). */
export function decodeKnownDid(known: KnownDid, bytes: number[] | Uint8Array): number | undefined {
  const { offset, len, scale, bias } = known;
  if (offset == null || len == null || scale == null || bias == null) return undefined;
  const arr = Array.from(bytes);
  if (offset + len > arr.length) return undefined;
  let raw = 0;
  for (let i = 0; i < len; i++) raw = raw * 256 + arr[offset + i];
  return raw * scale + bias;
}
