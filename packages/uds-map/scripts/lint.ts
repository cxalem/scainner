// Pack lints (multi-brand plan, Phase 1, P1.6). `pnpm lint:pack` fails on:
//   - a known DID with no module binding and no `binding: "unknown"`;
//   - a module, band, known DID, family, platform, identity block or
//     gateway rule without a complete `source`;
//   - a known DID whose legacy scalar fields disagree with `decodes[0]`;
//   - a brand without `profiled_level` (or without `sources[]`), or a
//     level its sources cannot support;
//   - malformed decodes (bitfields without bit_len, unknown encodings);
//   - platform `vds_pattern` outside the shared regex subset;
//   - brand tokens (ids, name words, WMIs) in src/*.ts outside tests and
//     comments — brands live in data, never in code.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { brandTokens, fullScalar, loadMap, loadPacks, PKG_DIR, scalarAgrees, sourceOk } from "./pack.ts";
import type { Source } from "../src/types.ts";
import type { Brand, Decode } from "../src/types.ts";

const ENCODINGS = new Set(["be", "le", "bcd", "ascii", "bitfield"]);
const LEVELS = new Set(["standard_only", "routes_sourced", "routes_verified", "decodes_verified"]);
// The regex subset `elm/uds_map.rs::vds_matches` parses, over a VIN-legal
// alphabet: I, O and Q never appear in a VIN. `(a|b)` alternation is how
// one platform carries several VIN families in a single pattern.
const VDS_SUBSET = /^[\^$.\[\]\-?*+()|A-HJ-NPR-Z0-9]+$/;
const SHA40 = /^[0-9a-f]{40}$/;

/** GitHub's heading slug: lowercase, drop everything but letters, digits,
 * spaces and hyphens, spaces to hyphens. */
export function headingSlug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} -]/gu, "")
    .replace(/ /g, "-");
}

export function researchAnchors(): Set<string> {
  const text = readFileSync(join(PKG_DIR, "RESEARCH.md"), "utf-8");
  const out = new Set<string>();
  for (const line of text.split("\n")) {
    const m = /^#{1,6}\s+(.*)$/.exec(line);
    if (m) out.add(headingSlug(m[1]));
  }
  return out;
}

/** Every `Source` in a brand, wherever it sits. */
function sourcesIn(b: Brand): Source[] {
  const out: Source[] = [];
  for (const m of b.modules ?? []) {
    if (m.source) out.push(m.source);
    if (m.route?.source) out.push(m.route.source);
  }
  for (const band of b.did_bands ?? []) if (band.source) out.push(band.source);
  for (const k of b.known_dids ?? []) if (k.source) out.push(k.source);
  if (b.identity_block?.source) out.push(b.identity_block.source);
  for (const p of b.platforms ?? []) if (p.source) out.push(p.source);
  if (b.gateway_behaviour?.source) out.push(b.gateway_behaviour.source);
  out.push(...(b.sources ?? []));
  return out;
}

const RESEARCH_URL = /^packages\/uds-map\/RESEARCH\.md(?:#(.*))?$/;

function lintResearchAnchors(map: ReturnType<typeof loadMap>, problems: string[]): void {
  const anchors = researchAnchors();
  const seen = new Set<string>();
  const check = (where: string, s: Source | undefined) => {
    if (!s) return;
    const m = RESEARCH_URL.exec(s.url);
    if (!m) return;
    const anchor = m[1];
    if (anchor === undefined || anchors.has(anchor)) return;
    const key = `${where}:${anchor}`;
    if (seen.has(key)) return;
    seen.add(key);
    problems.push(`${where}: RESEARCH.md anchor #${anchor} does not match any heading`);
  };
  if (map.standard.identity_block) check("standard.identity_block", map.standard.identity_block.source);
  for (const b of map.brands) for (const s of sourcesIn(b)) check(b.id, s);
  for (const f of map.ecu_families ?? []) check(`family ${f.id}`, f.source);
}

function lintDecode(where: string, d: Decode, problems: string[]): void {
  if (!ENCODINGS.has(d.encoding)) problems.push(`${where}: unknown encoding ${d.encoding}`);
  if (!(d.len >= 0) || !(d.offset >= 0)) problems.push(`${where}: bad offset/len`);
  if (d.encoding === "bitfield" && (d.bit_len == null || d.bit_offset == null)) problems.push(`${where}: bitfield without bit_offset/bit_len`);
  if (d.encoding === "bitfield" && d.bit_len != null && d.bit_offset != null) {
    if (d.bit_len <= 0) problems.push(`${where}: bit_len must be positive`);
    if (d.bit_offset < 0 || d.bit_offset + d.bit_len > d.len * 8) problems.push(`${where}: bitfield exceeds its ${d.len}-byte slice`);
  }
  if (d.encoding !== "ascii" && d.len > 8) problems.push(`${where}: numeric decodes are limited to 8 bytes`);
  if (typeof d.scale !== "number" || typeof d.bias !== "number") problems.push(`${where}: scale/bias must be numbers`);
  if (!d.quantity) problems.push(`${where}: missing quantity`);
  if (!d.label) problems.push(`${where}: missing label`);
}

function lintBrand(b: Brand, problems: string[], overlay: boolean): void {
  const at = (s: string) => `${overlay ? "overlay " : ""}${b.id}: ${s}`;
  for (const m of b.modules ?? []) {
    if (!sourceOk(m.source)) problems.push(at(`module ${m.req}/${m.resp} has no source`));
    if (m.route && (m.route.req !== m.req || m.route.resp !== m.resp)) problems.push(at(`module ${m.req}/${m.resp} route ids differ from the module ids`));
  }
  for (const band of b.did_bands ?? []) {
    if (!sourceOk(band.source)) problems.push(at(`band ${band.from}-${band.to} has no source`));
  }
  for (const k of b.known_dids ?? []) {
    const where = at(`DID ${k.did}`);
    if (!sourceOk(k.source)) problems.push(`${where} has no source`);
    const bound = (k.modules ?? []).length > 0;
    if (!bound && k.binding !== "unknown") problems.push(`${where} is not module-bound and not marked binding: unknown`);
    if (bound && k.binding === "unknown") problems.push(`${where} is bound but marked binding: unknown`);
    if (!scalarAgrees(k)) problems.push(`${where}: offset/len/scale/bias disagree with decodes[0]`);
    if (fullScalar(k) && !(k.decodes ?? []).length) problems.push(`${where}: scalar formula without decodes[]`);
    for (const [i, d] of (k.decodes ?? []).entries()) lintDecode(`${where} decodes[${i}]`, d, problems);
  }
  if (!overlay) {
    if (!b.profiled_level || !LEVELS.has(b.profiled_level)) problems.push(at("missing or invalid profiled_level"));
    if (!(b.sources ?? []).length) problems.push(at("no sources[]"));
    for (const s of b.sources ?? []) if (!sourceOk(s)) problems.push(at(`malformed source ${JSON.stringify(s)}`));
    if (!b.identity_block) problems.push(at("missing identity_block"));
    else if (!sourceOk(b.identity_block.source)) problems.push(at("identity_block has no source"));
    for (const p of b.platforms ?? []) {
      if (!sourceOk(p.source)) problems.push(at(`platform ${p.key} has no source`));
      if (p.vds_pattern != null && !VDS_SUBSET.test(p.vds_pattern)) problems.push(at(`platform ${p.key} vds_pattern uses syntax outside the shared subset`));
      if (!Array.isArray(p.years) || p.years.length !== 2) problems.push(at(`platform ${p.key} years must be [from, to]`));
    }
    if (b.gateway_behaviour && !sourceOk(b.gateway_behaviour.source)) problems.push(at("gateway_behaviour has no source"));
    // Level vs evidence.
    const modules = (b.modules ?? []).length;
    const projectDecode = (b.known_dids ?? []).some((k) => k.source?.type === "project_capture" && (k.decodes ?? []).length > 0);
    const captureRoute = (b.modules ?? []).some((m) => m.source?.type === "project_capture") || (b.sources ?? []).some((s) => s.type === "project_capture");
    switch (b.profiled_level) {
      case "standard_only":
        if (modules > 0) problems.push(at("standard_only but documents manufacturer modules"));
        break;
      case "routes_sourced":
        if (modules === 0) problems.push(at("routes_sourced without any module"));
        break;
      case "routes_verified":
        if (!captureRoute) problems.push(at("routes_verified without a repository-owned raw capture/fixture"));
        break;
      case "decodes_verified":
        if (!projectDecode) problems.push(at("decodes_verified without a project-captured decode"));
        break;
    }
  }
}

function lintCodeForBrandTokens(tokens: string[], problems: string[]): void {
  const srcDir = join(PKG_DIR, "src");
  const patterns = tokens.map((t) => [t, new RegExp(`(?<![0-9a-z_])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![0-9a-z_])`, "i")] as const);
  for (const file of readdirSync(srcDir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
    const text = readFileSync(join(srcDir, file), "utf-8").replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
    text.split("\n").forEach((line, i) => {
      const code = line.split("//")[0];
      if (!code.trim()) return;
      for (const [token, re] of patterns) {
        if (re.test(code)) problems.push(`src/${file}:${i + 1}: brand token "${token}" in code — brands live in data, not code`);
      }
    });
  }
}

type ResearchClaim = {
  claim_id?: string;
  exact_claim?: string;
  knowledge_state?: string;
  source_fidelity?: string;
  vehicle_applicability?: string;
  scope?: string;
  action_if_connected?: string;
  promotion_test?: string;
  source?: { url?: string; revision?: string; retrieved_at?: string; license?: string };
}

// Mirrors research.rs's CandidateDid: either a bare hex string, or an
// object carrying an untrusted hypothesis (semantic/decode/validation) plus
// execution gating (automatic_execution_authorized, support_status). Keep
// this in sync with apps/desktop/src-tauri/src/elm/discovery/research.rs -
// this is the second of the "same file, two consumers" pair for research
// packs, same principle as uds-map.json's TS/Rust pair.
type ResearchCandidateDid =
  | string
  | {
      did?: string;
      semantic?: string;
      decode?: Record<string, unknown>;
      decode_format?: string;
      decoder_variants?: Array<{ variant_id?: string; signals?: Array<Record<string, unknown>>; source_refs?: string[] }>;
      validation?: { kind?: string; instructions?: string[]; expected_behavior?: string[] };
      validation_recipe_id?: string | null;
      automatic_execution_authorized?: boolean;
      support_status?: string;
      knowledge_state?: string;
      vehicle_fit?: string;
      identity_fit?: string;
      activation?: string;
      route_status?: string;
      did_status?: string;
      decode_status?: string;
    };

// docs/uds/brand-research-pack-specification.md §12: "the required pack
// vocabulary for support_status is closed... The pack validator and
// projector must reject unknown authoring values rather than silently
// broadening execution."
const SUPPORT_STATUS_VALUES = new Set([
  "candidate",
  "source_observed",
  "supported",
  "physically_supported_on_test_vehicle",
  "unsupported",
  "explicitly_unsupported_on_test_vehicle",
]);

type ResearchRoute = {
  route_id?: string;
  platform?: string;
  protocol?: string;
  req?: string;
  resp?: string;
  service?: string;
  session?: string;
  claim_ids?: string[];
  candidate_dids?: ResearchCandidateDid[];
  decodes?: unknown;
};
const RESEARCH_DECODE_KEYS = new Set([
  "offset", "len", "signed", "encoding", "bit_offset", "bit_len",
  "scale", "bias", "unit", "quantity", "label",
]);

function lintResearchDecode(decode: Record<string, unknown>, where: string, problems: string[]): void {
  for (const key of Object.keys(decode)) {
    if (!RESEARCH_DECODE_KEYS.has(key)) problems.push(`${where}: unknown candidate decode field ${key}`);
  }
  const len = decode.len ?? 1;
  if (!Number.isInteger(len) || (len as number) < 1 || (len as number) > 8) problems.push(`${where}: candidate decode len must be 1..8`);
  if (decode.offset !== undefined && (!Number.isInteger(decode.offset) || (decode.offset as number) < 0)) problems.push(`${where}: candidate decode offset must be a non-negative integer`);
  if (decode.scale !== undefined && (typeof decode.scale !== "number" || !Number.isFinite(decode.scale))) problems.push(`${where}: candidate decode scale must be finite`);
  if (decode.bias !== undefined && (typeof decode.bias !== "number" || !Number.isFinite(decode.bias))) problems.push(`${where}: candidate decode bias must be finite`);
  if (decode.encoding !== undefined && !new Set(["be", "le", "bcd", "ascii", "bitfield"]).has(String(decode.encoding))) problems.push(`${where}: invalid candidate decode encoding`);
}

function lintResearchCandidate(candidate: ResearchCandidateDid, where: string, problems: string[]): void {
  const did = typeof candidate === "string" ? candidate : candidate.did;
  if (!did || !/^([0-9A-F]{2}|[0-9A-F]{4})$/.test(did)) problems.push(`${where}: malformed candidate identifier ${String(did)}`);
  if (typeof candidate === "string") return;
  if (candidate.automatic_execution_authorized !== undefined && typeof candidate.automatic_execution_authorized !== "boolean") {
    problems.push(`${where}: candidate DID ${did}: automatic_execution_authorized must be boolean`);
  }
  if (candidate.support_status !== undefined && !SUPPORT_STATUS_VALUES.has(candidate.support_status)) {
    problems.push(`${where}: unknown candidate support_status ${candidate.support_status}`);
  }
  const decode = candidate.decode;
  if (candidate.decode_format !== undefined && candidate.decode_format !== "uds_map_v9") {
    problems.push(`${where}: unknown candidate decode_format ${candidate.decode_format}`);
  }
  if (candidate.decode_format !== "uds_map_v9") return;
  const variants = candidate.decoder_variants ?? [];
  if (decode === undefined && variants.length === 0) {
    problems.push(`${where}: canonical candidate decode is missing its formula`);
    return;
  }
  if (decode !== undefined) lintResearchDecode(decode, where, problems);
  for (const variant of variants) {
    if (!variant.variant_id || !variant.signals?.length) problems.push(`${where}: empty candidate decoder variant`);
    for (const signal of variant.signals ?? []) lintResearchDecode(signal, `${where} variant ${variant.variant_id ?? "?"}`, problems);
  }
}

type ResearchPack = {
  schema_version?: number;
  pack_id?: string;
  version?: number;
  mode?: string;
  policy?: {
    read_only?: boolean;
    default_session_only?: boolean;
    max_outstanding_requests?: number;
    forbidden_services?: string[];
    candidate_decodes_are_hypotheses?: boolean;
  };
  profiles?: { brand_id?: string; status?: string; wmis?: string[]; routes?: ResearchRoute[] }[];
  claims?: ResearchClaim[];
};

function lintResearchPacks(problems: string[]): void {
  const indexPath = join(PKG_DIR, "data", "research-packs.json");
  const index = JSON.parse(readFileSync(indexPath, "utf-8")) as { schema_version?: number; packs?: string[] };
  if (index.schema_version !== 1) problems.push("research index: unsupported schema_version");
  if (!Array.isArray(index.packs)) {
    problems.push("research index: packs must be an array");
    return;
  }
  const listed = new Set(index.packs);
  if (listed.size !== index.packs.length) problems.push("research index: duplicate pack path");
  const researchDir = join(PKG_DIR, "data", "research");
  const onDisk = readdirSync(researchDir).filter((name) => name.endsWith(".json")).map((name) => `research/${name}`);
  for (const file of onDisk) if (!listed.has(file)) problems.push(`research pack ${file} is not indexed`);
  for (const relative of index.packs) {
    if (!/^research\/[a-z0-9._-]+\.json$/.test(relative)) {
      problems.push(`research index: unsafe pack path ${relative}`);
      continue;
    }
    const pack = JSON.parse(readFileSync(join(PKG_DIR, "data", relative), "utf-8")) as ResearchPack;
    const at = (message: string) => `research ${pack.pack_id ?? relative}: ${message}`;
    if (pack.schema_version !== 1 || !pack.pack_id || !pack.version) problems.push(at("missing identity/schema"));
    if (pack.mode !== "candidate_discovery_only") problems.push(at("mode must be candidate_discovery_only"));
    if (pack.policy?.read_only !== true || pack.policy?.default_session_only !== true) problems.push(at("policy must be read-only/default-session-only"));
    if (pack.policy?.max_outstanding_requests !== 1) problems.push(at("only one outstanding request is allowed"));
    if (pack.policy?.candidate_decodes_are_hypotheses !== true) problems.push(at("candidate decodes must remain hypotheses"));
    const forbidden = new Set(pack.policy?.forbidden_services ?? []);
    for (const service of ["10", "11", "14", "27", "2E", "2F", "31", "34", "35", "36", "37", "3D"]) {
      if (!forbidden.has(service)) problems.push(at(`unsafe service ${service} is not forbidden`));
    }
    const claims = new Set<string>();
    for (const claim of pack.claims ?? []) {
      const where = at(`claim ${claim.claim_id ?? "?"}`);
      if (!claim.claim_id || claims.has(claim.claim_id)) problems.push(`${where}: missing or duplicate id`);
      else claims.add(claim.claim_id);
      if (!claim.exact_claim || !claim.scope || !claim.knowledge_state || !claim.source_fidelity) problems.push(`${where}: incomplete evidence fields`);
      if (!new Set(["untested_by_project", "partially_project_confirmed"]).has(claim.vehicle_applicability ?? "")) problems.push(`${where}: invalid vehicle applicability`);
      if (pack.pack_id === "existing-brand-hypotheses-v3-delta" && (!claim.action_if_connected || !claim.promotion_test)) problems.push(`${where}: cleaned v3 claims require an action and promotion test`);
      const revision = claim.source?.revision;
      if (!revision || !SHA40.test(revision)) problems.push(`${where}: source revision must be a 40-character commit SHA`);
      if (!claim.source?.url || (revision && !claim.source.url.includes(revision))) problems.push(`${where}: source URL must be pinned to its revision`);
      if (!claim.source?.retrieved_at || !claim.source?.license) problems.push(`${where}: incomplete source provenance`);
    }
    const routeIds = new Set<string>();
    for (const profile of pack.profiles ?? []) {
      if (!profile.brand_id || !profile.status) problems.push(at("profile missing brand_id/status"));
      for (const wmi of profile.wmis ?? []) if (!/^[A-Z0-9]{3}$/.test(wmi)) problems.push(at(`invalid WMI ${wmi}`));
      for (const route of profile.routes ?? []) {
        const where = at(`route ${route.route_id ?? "?"}`);
        if (!route.route_id || routeIds.has(route.route_id)) problems.push(`${where}: missing or duplicate route id`);
        else routeIds.add(route.route_id);
        if (!route.platform || !route.protocol || !route.req || !route.resp) problems.push(`${where}: incomplete route`);
        if (!new Set(["21", "22"]).has(route.service ?? "") || route.session !== "default_only") problems.push(`${where}: candidates may only use read services 21/22 in the default session`);
        if (route.decodes !== undefined) problems.push(`${where}: trusted decodes are forbidden in research routes`);
        if (!(route.claim_ids?.length)) problems.push(`${where}: route has no evidence claims`);
        for (const id of route.claim_ids ?? []) if (!claims.has(id)) problems.push(`${where}: unknown claim ${id}`);
        for (const candidate of route.candidate_dids ?? []) lintResearchCandidate(candidate, where, problems);
      }
    }
  }
}

export function lintPack(): string[] {
  const problems: string[] = [];
  const map = loadMap();
  if (map.version < 9) problems.push(`map version ${map.version} < 9`);
  if (!map.standard.identity_block || !sourceOk(map.standard.identity_block.source)) problems.push("standard.identity_block missing or unsourced");
  const ids = new Set<string>();
  for (const b of map.brands) {
    if (ids.has(b.id)) problems.push(`duplicate brand id ${b.id}`);
    ids.add(b.id);
    lintBrand(b, problems, false);
  }
  for (const f of map.ecu_families ?? []) {
    if (!sourceOk(f.source)) problems.push(`family ${f.id} has no source`);
    for (const d of f.decodes) if (!d.quantity) problems.push(`family ${f.id} decode ${d.did} has no quantity`);
  }
  for (const p of loadPacks()) {
    if (!p.id || !p.license || !p.source) problems.push(`overlay ${p.id ?? "?"}: missing id/license/source`);
    for (const b of p.brands) lintBrand(b, problems, true);
  }
  lintResearchAnchors(map, problems);
  lintResearchPacks(problems);
  lintCodeForBrandTokens(brandTokens(map), problems);
  return problems;
}

const isMain = process.argv[1] && decodeURIComponent(new URL(import.meta.url).pathname) === process.argv[1];
if (isMain) {
  const problems = lintPack();
  if (problems.length) {
    console.error(`lint:pack FAIL (${problems.length})`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log("lint:pack OK");
}
