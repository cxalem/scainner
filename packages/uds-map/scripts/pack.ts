// Shared, dependency-free helpers for the pack scripts (coverage.ts,
// lint.ts). Runs under `node --experimental-strip-types`, so this file uses
// only erasable TypeScript syntax and imports the data directly rather
// than going through src/index.ts (whose `.js` specifiers need a build).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Brand, Decode, KnownDid, OverlayPack, Source, UdsMap } from "../src/types.ts";

export const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

export function loadMap(): UdsMap {
  return JSON.parse(readFileSync(join(PKG_DIR, "data", "uds-map.json"), "utf-8")) as UdsMap;
}

export function loadPacks(): OverlayPack[] {
  const dir = join(PKG_DIR, "data", "packs");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")) as OverlayPack);
}

export function fullScalar(k: KnownDid): boolean {
  return k.offset != null && k.len != null && k.scale != null && k.bias != null;
}

export function scalarAgrees(k: KnownDid): boolean {
  const first = k.decodes?.[0];
  if (!first) return !fullScalar(k);
  return k.offset === first.offset && k.len === first.len && k.scale === first.scale && k.bias === first.bias;
}

export function isBound(k: KnownDid): boolean {
  return (k.modules ?? []).length > 0;
}

export function sourceOk(s: Source | undefined): boolean {
  return !!s && typeof s.url === "string" && s.url.trim().length > 0 && typeof s.date === "string" && s.date.trim().length > 0 && !!s.type && typeof s.licence === "string" && s.licence.trim().length > 0;
}

/** Brand tokens that must not appear in code: every brand id, every word
 * of every brand name (longer than three characters), and every WMI. */
export function brandTokens(map: UdsMap): string[] {
  const tokens = new Set<string>();
  for (const b of map.brands) {
    tokens.add(b.id.toLowerCase());
    for (const part of b.id.split("_")) if (part.length > 2) tokens.add(part.toLowerCase());
    for (const word of b.name.split(/[^A-Za-zÀ-ž]+/)) if (word.length > 3) tokens.add(word.toLowerCase());
  }
  // Generic words that happen to be in brand names are not brand tokens.
  for (const generic of ["group", "platform", "shared", "diagnostic", "stack", "before", "onward", "from", "incl", "and", "europe", "north", "america"]) {
    tokens.delete(generic);
  }
  return [...tokens].sort();
}

export type BrandStats = {
  id: string;
  wmi: number;
  modules: number;
  modules29bit: number;
  knownDids: number;
  decodable: number;
  moduleBound: number;
  bindingUnknown: number;
  families: number;
  decodes: number;
  decodesWithEvidence: number;
  onVehicle: number;
  readServices: string[];
  identityBlock: string;
  platforms: number;
  platformsWithVds: number;
  profiledLevel: string;
  gateway: string;
  confidence: string;
  sourceTypes: string[];
};

export function brandStats(map: UdsMap, b: Brand): BrandStats {
  const dids = b.known_dids ?? [];
  const families = (map.ecu_families ?? []).filter((f) => f.modules_seen_on.some((m) => m.brand === b.id));
  const services = new Set<string>();
  if (b.read_service) services.add(b.read_service);
  for (const m of b.modules ?? []) if (m.read_service) services.add(m.read_service);
  for (const p of b.platforms ?? []) if (p.read_service) services.add(p.read_service);
  for (const k of dids) if (k.read_service) services.add(k.read_service);
  const iso = new Set((map.standard.identity_block?.dids ?? []).map((d) => d.did.toUpperCase()));
  const vendor = (b.identity_block?.dids ?? []).filter((d) => !iso.has(d.did.toUpperCase()));
  const projectDecodes = dids.filter((k) => k.source?.type === "project_capture" && (k.decodes ?? []).length > 0);
  const types = new Set<string>();
  for (const s of b.sources ?? []) types.add(s.type);
  return {
    id: b.id,
    wmi: b.wmi.length,
    modules: (b.modules ?? []).length,
    modules29bit: (b.modules ?? []).filter((m) => m.req.trim().length > 3).length,
    knownDids: dids.length,
    decodable: dids.filter((k) => (k.decodes ?? []).length > 0).length,
    moduleBound: dids.filter(isBound).length,
    bindingUnknown: dids.filter((k) => k.binding === "unknown").length,
    families: families.length,
    decodes: dids.reduce((n, k) => n + (k.decodes ?? []).length, 0),
    decodesWithEvidence: dids.filter((k) => !!k.evidence && (k.decodes ?? []).length > 0).length,
    onVehicle: projectDecodes.length,
    readServices: [...services].sort(),
    identityBlock: b.identity_block ? (vendor.length > 0 ? `iso + ${vendor.length} vendor` : "iso") : "none",
    platforms: (b.platforms ?? []).length,
    platformsWithVds: (b.platforms ?? []).filter((p) => p.vds_pattern != null).length,
    profiledLevel: b.profiled_level ?? "missing",
    gateway: b.gateway_behaviour ? `${b.gateway_behaviour.silence_means}${b.gateway_behaviour.writes_blocked ? ", writes blocked" : ""}` : "unknown",
    confidence: b.confidence,
    sourceTypes: [...types].sort(),
  };
}

export function decodeShape(d: Decode): string {
  return `${d.encoding}${d.signed ? "/signed" : ""}${d.encoding === "bitfield" ? `[${d.bit_offset}+${d.bit_len}]` : ""}`;
}

// ---- research candidate packs (data/research/*.json, listed by data/research-packs.json)
// Research is evidence about where to look, never trusted knowledge, so it is
// counted separately from the map above and never merged into `brandStats`.

export type ResearchPack = {
  pack_id: string;
  version: number;
  research_date: string;
  profiles: Array<{
    brand_id: string;
    platforms?: Array<{ platform_id: string }>;
    routes: Array<{
      platform: string;
      exploration_only?: boolean;
      candidate_dids?: Array<string | { support_status?: string; automatic_execution_authorized?: boolean }>;
    }>;
  }>;
};

export type ResearchBrandStats = {
  id: string;
  packs: string[];
  routes: number;
  explorationRoutes: number;
  platformScopedRoutes: number;
  candidateDids: number;
  negativeEvidence: number;
};

export function loadResearchPacks(): ResearchPack[] {
  const index = JSON.parse(readFileSync(join(PKG_DIR, "data", "research-packs.json"), "utf-8")) as { packs: string[] };
  return index.packs.map((name) => JSON.parse(readFileSync(join(PKG_DIR, "data", name), "utf-8")) as ResearchPack);
}

/** A candidate the pack itself marks as never-to-be-requested: preserved evidence, not a read. */
function isNegativeEvidence(did: string | { support_status?: string; automatic_execution_authorized?: boolean }): boolean {
  if (typeof did === "string") return false;
  return did.automatic_execution_authorized === false || did.support_status === "unsupported" || did.support_status === "explicitly_unsupported_on_test_vehicle";
}

/** Per-brand research totals, keyed by brand id, in the packs' listed order. */
export function researchStats(packs: ResearchPack[] = loadResearchPacks()): Map<string, ResearchBrandStats> {
  const stats = new Map<string, ResearchBrandStats>();
  for (const pack of packs) {
    for (const profile of pack.profiles ?? []) {
      const entry = stats.get(profile.brand_id) ?? { id: profile.brand_id, packs: [], routes: 0, explorationRoutes: 0, platformScopedRoutes: 0, candidateDids: 0, negativeEvidence: 0 };
      if (!entry.packs.includes(pack.pack_id)) entry.packs.push(pack.pack_id);
      for (const route of profile.routes ?? []) {
        entry.routes += 1;
        if (route.exploration_only) entry.explorationRoutes += 1;
        if (route.platform !== "unknown") entry.platformScopedRoutes += 1;
        for (const did of route.candidate_dids ?? []) {
          entry.candidateDids += 1;
          if (isNegativeEvidence(did)) entry.negativeEvidence += 1;
        }
      }
      stats.set(profile.brand_id, entry);
    }
  }
  return stats;
}
