import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  candidatesOf,
  formatValidationReport,
  identifierOf,
  immutableSource,
  type Json,
  recipesOf,
  routesOf,
  sha256Of,
  sourcesOf,
  trustedMapBrands,
  trustedRoutePairs,
  validateResearchPack,
} from "./research-pack.ts";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  const value = process.argv[i + 1];
  if (!process.argv[i]?.startsWith("--") || value === undefined) {
    throw new Error("usage: research:compile --input <dir> --output <json> --report <json> --archive <dir>");
  }
  args.set(process.argv[i].slice(2), value);
}

if (["input", "output", "report", "archive"].some((name) => !args.has(name))) {
  throw new Error("input, output, report and archive are required");
}
const input = resolve(args.get("input")!);
const output = resolve(args.get("output")!);
const reportPath = resolve(args.get("report")!);
const archive = resolve(args.get("archive")!);

const validation = validateResearchPack(input);
process.stdout.write(`${formatValidationReport(validation)}\n`);
if (validation.failures.length) {
  throw new Error(`research pack rejected by research:validate (${validation.failures.length} failure(s)); nothing was written`);
}

const pack = validation.pack;
const index = pack.index;
const warnings: string[] = [...validation.warnings];
const manifestFiles = pack.manifestFiles;
const overlay = pack.overlay;
const platformsFile = pack.platforms;
const supportEvidence = pack.supportEvidence;

const sources = new Map<string, Json>(sourcesOf(pack).map((source: Json) => [source.ref, source]));
const routes = new Map<string, Json>(routesOf(pack).map((route: Json) => [route.route_id, route]));
const recipes = new Map<string, Json>();
for (const recipe of recipesOf(pack)) {
  recipes.set(recipe.validation_recipe_id ?? recipe.recipe_id, recipe);
}

const sourceClaims = [...sources.values()].filter(immutableSource).map((source) => ({
  claim_id: `${index.pack_id}.source.${source.ref.toLowerCase()}`,
  exact_claim: `${source.title} supplies research evidence scoped to ${source.scope}.`,
  knowledge_state: "community_reported",
  source_fidelity: source.reliability,
  vehicle_applicability: "untested_by_project",
  scope: source.scope,
  action_if_connected: "Use only after the candidate planner matches this source scope; preserve raw outcomes.",
  promotion_test: "Confirm the route and meaning on project hardware across independent connections before promotion.",
  source: {
    url: source.url,
    revision: source.revision,
    retrieved_at: source.retrieved_at,
    license: source.licence,
  },
}));
const claimForSource = new Map(sourceClaims.map((claim) => [claim.claim_id.split(".").at(-1)!.toUpperCase(), claim.claim_id]));

const candidatesByRoute = new Map<string, Json[]>();
for (const candidate of candidatesOf(pack)) {
  const list = candidatesByRoute.get(candidate.route_id) ?? [];
  list.push(candidate);
  candidatesByRoute.set(candidate.route_id, list);
}

const deferred: Array<{ id: string; reason: string }> = [];
let projectedVariants = 0;
function projectDecoderVariants(candidate: Json): Json[] {
  const projected: Json[] = [];
  for (const variant of candidate.decoder_variants ?? []) {
    if (variant.valid_range == null) {
      deferred.push({ id: `${candidate.candidate_id}:${variant.variant_id}`, reason: "decoder_missing_validation_range" });
      continue;
    }
    const signals = (variant.signals ?? []).filter((signal: Json) => {
      const valid =
        Number.isInteger(signal.offset) && signal.offset >= 0 &&
        Number.isInteger(signal.len) && signal.len >= 1 && signal.len <= 8 &&
        ["be", "le", "bcd", "ascii", "bitfield"].includes(signal.encoding) &&
        Number.isFinite(signal.scale) && Number.isFinite(signal.bias);
      if (signal.encoding === "bitfield" && (!Number.isInteger(signal.bit_offset) || !Number.isInteger(signal.bit_len))) return false;
      return valid;
    });
    if (signals.length !== (variant.signals ?? []).length || signals.length === 0) {
      deferred.push({ id: `${candidate.candidate_id}:${variant.variant_id}`, reason: "decoder_not_canonical" });
      continue;
    }
    projected.push({
      variant_id: variant.variant_id,
      signals,
      source_refs: variant.source_refs ?? candidate.source_refs ?? [],
    });
    projectedVariants += signals.length;
  }
  return projected;
}

function projectCandidate(candidate: Json): Json | null {
  if (candidate.automatic_execution_authorized !== true) {
    deferred.push({ id: candidate.candidate_id, reason: "candidate_not_authorized" });
    return null;
  }
  const variants = projectDecoderVariants(candidate);
  const recipe = recipes.get(candidate.validation_recipe_id);
  return {
    did: identifierOf(candidate),
    semantic: candidate.semantic ?? null,
    ...(variants.length ? { decode_format: "uds_map_v9", decoder_variants: variants } : {}),
    ...(recipe
      ? {
          validation: {
            kind: recipe.kind,
            instructions: recipe.instructions ?? [],
            expected_behavior: recipe.expected_behavior ?? [],
          },
        }
      : {}),
    validation_recipe_id: candidate.validation_recipe_id ?? null,
    automatic_execution_authorized: true,
    support_status: candidate.support_status,
    knowledge_state: candidate.knowledge_state,
    vehicle_fit: candidate.vehicle_fit,
    identity_fit: candidate.identity_fit,
    activation: candidate.activation,
    route_status: candidate.route_status,
    did_status: candidate.did_status,
    decode_status: candidate.decode_status,
  };
}

const projectedRoutes: Json[] = [];
const confirmedRoutes: Json[] = [];
const trustedPairs = trustedRoutePairs();
const supportedRouteIds = new Set((supportEvidence.evidence ?? []).map((entry: Json) => entry.route_id));
for (const route of routes.values()) {
  if (route.automatic_execution_authorized !== true) {
    deferred.push({ id: route.route_id, reason: "route_not_authorized" });
    continue;
  }
  const readServices = (route.read_services ?? []).filter((service: string) => service === "21" || service === "22");
  if (route.session !== "default_only" || !readServices.length) {
    deferred.push({ id: route.route_id, reason: "unsupported_service_or_session" });
    continue;
  }
  const readService = readServices.includes("22") ? "22" : "21";
  const eligibleRefs = (route.source_refs ?? []).filter((ref: string) => immutableSource(sources.get(ref)));
  if (!eligibleRefs.length) {
    const brandIds = route.scope?.brand_ids ?? overlay.brand_ids ?? [];
    const trusted = brandIds.some((brand: string) =>
      trustedPairs.has(`${brand}:${route.route.req}:${route.route.resp}`),
    );
    if (trusted) {
      confirmedRoutes.push({
        route_id: route.route_id,
        req: route.route.req,
        resp: route.route.resp,
        status: "confirmed_in_trusted_map",
      });
      if (!supportedRouteIds.has(route.route_id)) {
        warnings.push(`${route.route_id} is locally confirmed but missing from command-support evidence`);
      }
      continue;
    }
    deferred.push({ id: route.route_id, reason: "no_immutable_execution_source" });
    continue;
  }
  const platformIds = route.scope?.platform_ids ?? [];
  if (!platformIds.length) {
    deferred.push({ id: route.route_id, reason: "route_has_no_platform_scope" });
    continue;
  }
  projectedRoutes.push({
    route_id: route.route_id,
    platform: platformIds.length === 1 ? platformIds[0] : "catalogue_exploration",
    ...(platformIds.length > 1
      ? { platform_alternatives: platformIds, exploration_only: true }
      : {}),
    protocol: route.route.protocol,
    req: route.route.req,
    resp: route.route.resp,
    address_extension: route.route.address_extension ?? null,
    service: readService,
    session: "default_only",
    claim_ids: eligibleRefs.map((ref: string) => claimForSource.get(ref)!).filter(Boolean),
    module_role: route.module_role ?? null,
    requires_identity: route.requires_identity !== false,
    candidate_dids: (candidatesByRoute.get(route.route_id) ?? []).map(projectCandidate).filter(Boolean),
    knowledge_state: route.knowledge_state,
    vehicle_fit: route.vehicle_fit,
    identity_fit: route.identity_fit,
    activation: route.activation,
  });
}

const projectedPlatforms = (platformsFile.platforms ?? [])
  .filter((platform: Json) => (platform.scope?.models ?? []).length)
  .map((platform: Json) => ({
    platform_id: platform.platform_id,
    models: platform.scope.models,
    powertrains: platform.scope.powertrains ?? [],
  }));
const vdsPatternsOf = (platform: Json): string[] =>
  (platform.vds_patterns ?? platform.vin_rules ?? []).filter((pattern: unknown): pattern is string => typeof pattern === "string" && pattern.length > 0);
const platformHasVinRule = (platform: Json): boolean => Boolean(vdsPatternsOf(platform).length || platform.classifier);
const trustedVdsPattern = (platform: Json): string | null => {
  const patterns = vdsPatternsOf(platform);
  if (!patterns.length) return null;
  if (patterns.length === 1) return patterns[0];
  return `^(${patterns.map((pattern) => pattern.replace(/^\^/, "")).join("|")})`;
};
const vinSelectablePlatforms = (platformsFile.platforms ?? []).filter(platformHasVinRule).map((platform: Json) => platform.platform_id);
const modelCounts = new Map<string, number>();
for (const platform of projectedPlatforms) {
  for (const model of platform.models) modelCounts.set(model, (modelCounts.get(model) ?? 0) + 1);
}
const vehicleFactSelectablePlatforms = projectedPlatforms
  .filter((platform: Json) => platform.models.some((model: string) => modelCounts.get(model) === 1))
  .map((platform: Json) => platform.platform_id);
if (!vinSelectablePlatforms.length) warnings.push("VIN alone cannot classify a platform; exact normalized vehicle-model facts may select only an unambiguous platform");

const trustedPlatformKeys = new Map<string, string[]>();
for (const brand of trustedMapBrands()) trustedPlatformKeys.set(brand.id, (brand.platforms ?? []).map((platform: Json) => String(platform.key)));
const packBrandIds: string[] = overlay.brand_ids ?? [];
const knownKeys = packBrandIds.flatMap((brand) => trustedPlatformKeys.get(brand) ?? []);
const alreadyMapped = (platformId: string): boolean =>
  knownKeys.some((key) => key === platformId || packBrandIds.some((brand) => `${brand}_${key}` === platformId));
const platformProposals = (platformsFile.platforms ?? [])
  .filter((platform: Json) => !alreadyMapped(platform.platform_id))
  .map((platform: Json) => ({
    platform_id: platform.platform_id,
    brand_ids: platform.scope?.brand_ids ?? packBrandIds,
    marques: platform.scope?.marques ?? [],
    models: platform.scope?.models ?? [],
    powertrains: platform.scope?.powertrains ?? [],
    years: platform.scope?.years ?? null,
    vds_patterns: vdsPatternsOf(platform),
    vds_pattern: trustedVdsPattern(platform),
    vin_selectable: platformHasVinRule(platform),
    architecture: platform.architecture ?? null,
    transport_candidates: platform.transport_candidates ?? [],
    confidence: platform.confidence ?? null,
    knowledge_state: platform.knowledge_state ?? null,
    related_existing_keys: knownKeys.filter((key) => platform.platform_id.split("_").includes(key)),
    sources: (platform.source_refs ?? []).map((ref: string) => {
      const source = sources.get(ref);
      return { ref, url: source?.url ?? null, revision: source?.revision ?? null, retrieved_at: source?.retrieved_at ?? null, licence: source?.licence ?? null, reliability: source?.reliability ?? null };
    }),
    accept_by: "Add as brands[].platforms[] in data/uds-map.json once a VIN or vehicle-fact rule confirms it; until then platform-scoped candidates stay inert. `vds_pattern` is the single regex platform_for_vin matches, against VIN characters 4-10; several VIN families arrive here as one alternation.",
  }))
  .sort((a: Json, b: Json) => a.platform_id.localeCompare(b.platform_id));

const compiled = {
  schema_version: 1,
  pack_id: `${index.pack_id}-runtime-v${index.pack_version}`,
  version: index.pack_version,
  research_date: index.research_date,
  mode: "candidate_discovery_only",
  policy: {
    read_only: true,
    default_session_only: true,
    max_outstanding_requests: 1,
    forbidden_services: ["10", "11", "14", "27", "28", "2E", "2F", "31", "34", "35", "36", "37", "3D"],
    candidate_decodes_are_hypotheses: true,
  },
  profiles: [
    {
      brand_id: overlay.brand_ids[0],
      brand_name: (overlay.marques ?? overlay.brand_ids).map((value: string) => value[0].toUpperCase() + value.slice(1)).join(" / "),
      status: "research_candidate",
      wmis: [],
      platforms: projectedPlatforms,
      routes: projectedRoutes,
    },
  ],
  claims: sourceClaims,
};

const report = {
  schema_version: 1,
  compiler: basename(import.meta.filename),
  input_pack: index.pack_id,
  input_version: index.pack_version,
  output_pack: compiled.pack_id,
  counts: {
    input_routes: routes.size,
    projected_routes: projectedRoutes.length,
    input_candidates: candidatesOf(pack).length,
    projected_candidates: projectedRoutes.reduce((total, route) => total + route.candidate_dids.length, 0),
    projected_decoder_signals: projectedVariants,
    deferred: deferred.length,
    confirmed_route_matches: confirmedRoutes.length,
  },
  vin_selectable_platforms: vinSelectablePlatforms,
  vehicle_fact_selectable_platforms: vehicleFactSelectablePlatforms,
  warnings,
  platform_proposals: platformProposals.length,
  confirmed_routes: confirmedRoutes,
  archived_files: [
    { path: "index.json", sha256: sha256Of(input, "index.json") },
    ...manifestFiles.map((file) => ({ path: file.path, sha256: file.sha256 })),
  ],
  deferred,
};

mkdirSync(archive, { recursive: true });
copyFileSync(join(input, "index.json"), join(archive, "index.json"));
for (const file of manifestFiles) {
  copyFileSync(join(input, file.path), join(archive, file.path));
}
writeFileSync(output, `${JSON.stringify(compiled, null, 2)}\n`);
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
if (platformProposals.length) {
  const proposals = {
    schema_version: 1,
    pack_id: index.pack_id,
    pack_version: index.pack_version,
    research_date: index.research_date,
    note: "Platforms this pack declares that data/uds-map.json does not carry for these brands. Review and move accepted entries into brands[].platforms[]; the compiler never writes to the trusted map.",
    proposals: platformProposals,
  };
  writeFileSync(join(dirname(reportPath), "platform-proposals.json"), `${JSON.stringify(proposals, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
