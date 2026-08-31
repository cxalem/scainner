import { createHash } from "node:crypto";
import { copyFileSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

type Json = Record<string, any>;

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

const load = (name: string): Json => JSON.parse(readFileSync(join(input, name), "utf8"));
const sha256 = (name: string): string =>
  createHash("sha256").update(readFileSync(join(input, name))).digest("hex");

const index = load("index.json");
const failures: string[] = [];
const warnings: string[] = [];
const manifestFiles: Array<{ path: string; sha256: string }> = index.files ?? [];
const manifestPaths = new Set<string>();
for (const file of manifestFiles) {
  if (typeof file.path !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file.path)) {
    failures.push(`unsafe manifest path: ${String(file.path)}`);
    continue;
  }
  if (manifestPaths.has(file.path)) {
    failures.push(`duplicate manifest path: ${file.path}`);
    continue;
  }
  manifestPaths.add(file.path);
  const stat = lstatSync(join(input, file.path));
  if (!stat.isFile() || stat.isSymbolicLink()) {
    failures.push(`manifest entry is not a regular file: ${file.path}`);
    continue;
  }
  if (!/^[0-9a-f]{64}$/.test(file.sha256 ?? "")) {
    failures.push(`invalid manifest hash: ${file.path}`);
    continue;
  }
  if (sha256(file.path) !== file.sha256) failures.push(`hash mismatch: ${file.path}`);
}
const indexStat = lstatSync(join(input, "index.json"));
if (!indexStat.isFile() || indexStat.isSymbolicLink()) {
  failures.push("index.json is not a regular file");
}

const overlayName = (index.files ?? [])
  .map((file: Json) => file.path)
  .find((path: unknown) => typeof path === "string" && path.endsWith("-profile-overlay.json"));
if (!overlayName) throw new Error("research pack has no profile overlay");
const overlay = load(overlayName);
const routesFile = load("ecu-routes.json");
const candidatesFile = load("did-candidates.json");
const sourcesFile = load("source-ledger.json");
const platformsFile = load("platforms.json");
const validationFile = load("validation-plan.json");
const safety = load("transport-session-safety-policy.json");
const supportEvidence = load("command-support-evidence.json");
const trustedMap: Json = JSON.parse(
  readFileSync(join(dirname(import.meta.filename), "../data/uds-map.json"), "utf8"),
);

if (!(overlay.brand_ids ?? []).length) failures.push("profile overlay has no brand ids");
if (safety.automatic_discovery?.read_only !== true || safety.automatic_discovery?.default_session_only !== true) {
  failures.push("automatic discovery policy is not read-only/default-session-only");
}
if (safety.automatic_discovery?.max_outstanding_requests !== 1) failures.push("research policy allows concurrent requests");

const sources = new Map<string, Json>((sourcesFile.sources ?? []).map((source: Json) => [source.ref, source]));
const routes = new Map<string, Json>((routesFile.routes ?? []).map((route: Json) => [route.route_id, route]));
const recipes = new Map<string, Json>();
for (const recipe of validationFile.recipes ?? validationFile.validation_recipes ?? []) {
  recipes.set(recipe.validation_recipe_id ?? recipe.recipe_id, recipe);
}

const exactHex = (value: unknown): value is string =>
  typeof value === "string" && (/^[0-9A-F]{3}$/.test(value) || /^[0-9A-F]{8}$/.test(value));
const exactIdentifier = (value: unknown): value is string => typeof value === "string" && /^([0-9A-F]{2}|[0-9A-F]{4})$/.test(value);
const immutableSource = (source: Json | undefined): boolean =>
  Boolean(
    source?.execution_eligible === true &&
      typeof source.revision === "string" &&
      /^[0-9a-f]{40}$/.test(source.revision) &&
      source.url?.includes(source.revision),
  );

for (const route of routes.values()) {
  if (!route.route_id || !exactHex(route.route?.req) || !exactHex(route.route?.resp)) {
    failures.push(`invalid route/address: ${route.route_id ?? "?"}`);
  }
  for (const ref of route.source_refs ?? []) if (!sources.has(ref)) failures.push(`${route.route_id}: unknown source ${ref}`);
}
for (const candidate of candidatesFile.candidates ?? []) {
  const identifier = candidate.did ?? candidate.local_identifier;
  if (!candidate.candidate_id || !exactIdentifier(identifier)) failures.push(`invalid candidate identifier: ${candidate.candidate_id ?? "?"}`);
  if (!routes.has(candidate.route_id)) failures.push(`${candidate.candidate_id}: unknown route ${candidate.route_id}`);
  if (candidate.validation_recipe_id && !recipes.has(candidate.validation_recipe_id)) {
    failures.push(`${candidate.candidate_id}: unknown validation recipe ${candidate.validation_recipe_id}`);
  }
}
if (failures.length) throw new Error(`research pack rejected:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);

const sourceClaims = [...sources.values()].filter(immutableSource).map((source) => ({
  claim_id: `${index.pack_id}.source.${source.ref.toLowerCase()}`,
  exact_claim: `${source.title} supplies research evidence scoped to ${source.scope}.`,
  knowledge_state: source.reliability === "high" ? "community_verified" : "community_reported",
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
for (const candidate of candidatesFile.candidates ?? []) {
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
    did: candidate.did ?? candidate.local_identifier,
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
const trustedPairs = new Set<string>();
for (const brand of trustedMap.brands ?? []) {
  for (const module of brand.modules ?? []) trustedPairs.add(`${brand.id}:${module.req}:${module.resp}`);
}
for (const family of trustedMap.ecu_families ?? []) {
  for (const seen of family.modules_seen_on ?? []) trustedPairs.add(`${seen.brand}:${seen.req}:${seen.resp}`);
}
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
const platformHasVinRule = (platform: Json): boolean =>
  Boolean(platform.vds_patterns?.length || platform.vin_rules?.length || platform.classifier);
const vinSelectablePlatforms = (platformsFile.platforms ?? []).filter(platformHasVinRule).map((platform: Json) => platform.platform_id);
const modelCounts = new Map<string, number>();
for (const platform of projectedPlatforms) {
  for (const model of platform.models) modelCounts.set(model, (modelCounts.get(model) ?? 0) + 1);
}
const vehicleFactSelectablePlatforms = projectedPlatforms
  .filter((platform: Json) => platform.models.some((model: string) => modelCounts.get(model) === 1))
  .map((platform: Json) => platform.platform_id);
if (!vinSelectablePlatforms.length) warnings.push("VIN alone cannot classify a platform; exact normalized vehicle-model facts may select only an unambiguous platform");

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
    input_candidates: candidatesFile.candidates?.length ?? 0,
    projected_candidates: projectedRoutes.reduce((total, route) => total + route.candidate_dids.length, 0),
    projected_decoder_signals: projectedVariants,
    deferred: deferred.length,
    confirmed_route_matches: confirmedRoutes.length,
  },
  vin_selectable_platforms: vinSelectablePlatforms,
  vehicle_fact_selectable_platforms: vehicleFactSelectablePlatforms,
  warnings,
  confirmed_routes: confirmedRoutes,
  archived_files: [
    { path: "index.json", sha256: sha256("index.json") },
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
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
