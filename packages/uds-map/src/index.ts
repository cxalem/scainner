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

export function getMap(): UdsMap {
  if (cached) return cached;
  const raw = readFileSync(join(dataDir(), "uds-map.json"), "utf-8");
  cached = JSON.parse(raw) as UdsMap;
  return cached;
}

export function overlayPacks(): OverlayPack[] {
  if (cachedPacks) return cachedPacks;
  const dir = join(dataDir(), "packs");
  cachedPacks = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")) as OverlayPack);
  return cachedPacks;
}

export function hex16(s: string): number | undefined {
  const v = Number.parseInt(s.trim(), 16);
  return Number.isNaN(v) ? undefined : v;
}

export function can11(s: string): number | undefined {
  const v = Number.parseInt(s.trim(), 16);
  return Number.isNaN(v) || v > 0x7ff ? undefined : v;
}

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

export function brandForVin(vin: string | null | undefined): Brand | undefined {
  const wmi = wmiOf(vin);
  if (!wmi) return undefined;
  return getMap().brands.find((b) => b.wmi.some((w) => w.toUpperCase() === wmi));
}

export function overlayBrandsForVin(vin: string | null | undefined): Brand[] {
  const wmi = wmiOf(vin);
  if (!wmi) return [];
  return overlayPacks().flatMap((p) => p.brands.filter((b) => b.wmi.some((w) => w.toUpperCase() === wmi)));
}

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

export function extendedModulesForVin(vin: string | null | undefined): number {
  const brand = brandForVin(vin);
  if (!brand) return 0;
  return (brand.modules ?? []).filter((m: ModuleDef) => can11(m.req) === undefined && hexAny(m.req) !== undefined)
    .length;
}

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

export function identDids(): number[] {
  return getMap()
    .standard.ident_dids.map((d) => hex16(d.did))
    .filter((v): v is number => v !== undefined);
}

export function nameDids(): number[] {
  return getMap()
    .standard.name_dids.map(hex16)
    .filter((v): v is number => v !== undefined);
}

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

export function knownDid(
  vin: string | null | undefined,
  did: number,
  module: { req: number; resp: number },
): KnownDid | undefined {
  return knownDidCandidates(vin, did).find((k) => moduleMatches(k, module));
}

export function knownDidUnscoped(vin: string | null | undefined, did: number): KnownDid | undefined {
  return knownDidCandidates(vin, did)[0];
}

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
      raw = signedBigInt(slice.reduceRight((acc, b) => (acc << 8n) | BigInt(b), 0n), len * 8, decode.signed);
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
      const whole = slice.reduce((acc, b) => (acc << 8n) | BigInt(b), 0n);
      const bitLen = decode.bit_len ?? len * 8;
      const shifted = whole >> BigInt(decode.bit_offset ?? 0);
      const masked = shifted & ((1n << BigInt(bitLen)) - 1n);
      raw = signedBigInt(masked, bitLen, decode.signed);
      return raw * decode.scale + decode.bias;
    }
    case "be":
    default:
      raw = signedBigInt(slice.reduce((acc, b) => (acc << 8n) | BigInt(b), 0n), len * 8, decode.signed);
  }
  return raw * decode.scale + decode.bias;
}

function signedBigInt(raw: bigint, bits: number, signed: boolean): number {
  if (signed && bits > 0 && raw >= (1n << BigInt(bits - 1))) raw -= 1n << BigInt(bits);
  return Number(raw);
}

export function decodeString(decode: Decode, bytes: number[] | Uint8Array): string | undefined {
  const arr = Array.from(bytes);
  const end = decode.len > 0 ? decode.offset + decode.len : arr.length;
  if (decode.offset > arr.length) return undefined;
  return String.fromCharCode(...arr.slice(decode.offset, end).filter((b) => b >= 0x20 && b < 0x7f));
}

export function decodeKnownDid(known: KnownDid, bytes: number[] | Uint8Array): number | undefined {
  const decode = primaryDecode(known);
  return decode ? decodeValue(decode, bytes) : undefined;
}

export function ecuFamilies(): EcuFamily[] {
  return getMap().ecu_families ?? [];
}

export function familyForHardwareRef(hardwareRef: string): EcuFamily | undefined {
  const wanted = hardwareRef.trim();
  return ecuFamilies().find((f) => f.hardware_refs.some((r) => r === wanted));
}


function moduleDef(vin: string | null | undefined, req: number, resp: number): ModuleDef | undefined {
  const brand = brandForVin(vin);
  const brands = brand ? [brand, ...overlayBrandsForVin(vin)] : overlayBrandsForVin(vin);
  return brands.flatMap((b) => b.modules ?? []).find((m) => hexAny(m.req) === req && hexAny(m.resp) === resp);
}

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

export function routeForModule(vin: string | null | undefined, req: number, resp: number): Route {
  return moduleDef(vin, req, resp)?.route ?? deriveRoute(req, resp);
}

export function identityBlockForVin(vin: string | null | undefined): IdentityBlock {
  const brand = brandForVin(vin);
  return brand?.identity_block ?? getMap().standard.identity_block ?? { dids: [], source: standardSource() };
}

function standardSource() {
  return { url: "packages/uds-map/RESEARCH.md#1-what-is-in-scope", date: "2026-08-23", type: "community" as const, licence: "MIT" };
}

export function resolveReadService(levels: {
  did?: ReadService;
  module?: ReadService;
  platform?: ReadService;
  brand?: ReadService;
  standard?: ReadService;
}): ReadService {
  return levels.did ?? levels.module ?? levels.platform ?? levels.brand ?? levels.standard ?? "22";
}

export function readServiceForModule(vin: string | null | undefined, req: number, resp: number): ReadService {
  return resolveReadService({
    module: moduleDef(vin, req, resp)?.read_service,
    platform: platformForVin(vin)?.read_service,
    brand: brandForVin(vin)?.read_service,
    standard: getMap().standard.read_service,
  });
}

export function readServiceForDid(vin: string | null | undefined, req: number, resp: number, did: number): ReadService {
  return resolveReadService({
    did: knownDid(vin, did, { req, resp })?.read_service,
    module: moduleDef(vin, req, resp)?.read_service,
    platform: platformForVin(vin)?.read_service,
    brand: brandForVin(vin)?.read_service,
    standard: getMap().standard.read_service,
  });
}

export function decodesForDid(vin: string | null | undefined, req: number, resp: number, did: number): Decode[] {
  const known = knownDid(vin, did, { req, resp });
  if (!known) return [];
  if (known.decodes && known.decodes.length > 0) return known.decodes;
  const primary = primaryDecode(known);
  return primary ? [primary] : [];
}

export function profiledLevelForVin(vin: string | null | undefined): ProfiledLevel | undefined {
  return brandForVin(vin)?.profiled_level;
}

export function gatewayBehaviourForVin(vin: string | null | undefined): GatewayBehaviour {
  return brandForVin(vin)?.gateway_behaviour ?? { silence_means: "unknown", writes_blocked: false };
}

export function platformForVin(vin: string | null | undefined): Platform | undefined {
  const brand = brandForVin(vin);
  if (!brand || !vin || vin.length < 10) return undefined;
  const vds = vin.slice(3, 10).toUpperCase();
  return (brand.platforms ?? []).find((p) => p.vds_pattern != null && new RegExp(p.vds_pattern).test(vds));
}
