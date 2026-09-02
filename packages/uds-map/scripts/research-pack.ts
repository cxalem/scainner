// Loading and validation shared by `research:validate` and
// `research:compile` — the manifest/integrity checks the compiler used to
// carry inline, plus the rejections specification §6 asks for and the §23
// report. Both scripts run under `node --experimental-strip-types`, so this
// file stays erasable TypeScript with no runtime dependencies.
//
// Normative contract: docs/uds/brand-research-pack-specification.md.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Json = Record<string, any>;

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- vocabulary

/** §8: transports the runtime can actually configure. */
export const RUNTIME_PROTOCOLS = ["can11_500", "can11_250", "can29_normal_fixed", "can29_target_byte", "can29_custom"];
/** §8: transports research may document but never coerce into a CAN route. */
export const DOCUMENTED_PROTOCOLS = ["kwp2000", "iso9141", "tp2_0", "tp1_6", "doip", "can_fd", "unknown"];
/** §12 */
export const SUPPORT_STATUS = ["candidate", "source_observed", "supported", "physically_supported_on_test_vehicle", "unsupported", "explicitly_unsupported_on_test_vehicle"];
/** §14 */
export const OBSERVATION_STATUS = ["answered", "refused", "unsupported", "timed_out", "transport_failed", "malformed", "skipped_for_safety"];
/** §4 */
export const KNOWLEDGE_STATE = ["research_candidate", "community_reported", "inherited", "locally_confirmed", "community_verified", "oem_confirmed", "unknown"];
export const VEHICLE_FIT = ["untested", "matched", "conflicted", "insufficient"];
export const ROUTE_STATE = ["reached", "refused", "silent", "transport_failed", "closed"];
export const IDENTITY_FIT = ["provisional", "stable", "conflicted"];
export const ACTIVATION = ["disabled", "learning", "enabled"];
/** §15: what a runtime claim may say about this project's own vehicles. */
export const VEHICLE_APPLICABILITY = ["untested_by_project", "partially_project_confirmed"];
/** §16: never automatic, so never a read service. */
export const FORBIDDEN_SERVICES = ["10", "11", "14", "27", "28", "2E", "2F", "31", "34", "35", "36", "37", "3D"];
/** §7: the closed set of scope keys. */
export const SCOPE_KEYS = ["brand_ids", "marques", "platform_ids", "models", "years", "powertrains", "ecu_roles", "ecu_family_ids"];
/** §12: the decoder language is uds-map v9's, with no parallel dialect. */
export const SIGNAL_KEYS = ["offset", "len", "signed", "encoding", "bit_offset", "bit_len", "scale", "bias", "unit", "quantity", "label"];
export const FORBIDDEN_SIGNAL_KEYS = ["div", "divisor", "multiplier", "mult", "add", "addend", "formula", "expr"];
export const ENCODINGS = ["be", "le", "bcd", "ascii", "bitfield"];

/**
 * §17: request budgets are central product policy. A brand pack may only
 * reduce them; raising one is a reviewed change to the central engine.
 */
export const CENTRAL_BUDGET = {
  S0_standard_handshake_seconds: 30,
  S1_census_plus_S2_identity_seconds: 180,
  S4_bounded_parked_sweep_seconds: 240,
  whole_automatic_connection_seconds: 600,
  learning_drive_max_link_occupancy_percent: 20,
};

// ------------------------------------------------------------------- loading

export type LoadedPack = {
  input: string;
  index: Json;
  manifestFiles: Array<{ path: string; sha256: string }>;
  overlayName: string | null;
  overlay: Json;
  routes: Json;
  candidates: Json;
  sources: Json;
  platforms: Json;
  families: Json;
  inventories: Json;
  validation: Json;
  safety: Json;
  supportEvidence: Json;
  conflicts: Json;
  /** Files the manifest lists that could not be read or parsed. */
  unreadable: string[];
};

const readJson = (input: string, name: string): Json => {
  try {
    return JSON.parse(readFileSync(join(input, name), "utf8")) as Json;
  } catch {
    return {};
  }
};

export function sha256Of(input: string, name: string): string {
  return createHash("sha256").update(readFileSync(join(input, name))).digest("hex");
}

/** Read the manifest and every canonical file. Missing optional files become empty objects. */
export function loadResearchPack(input: string): LoadedPack {
  const index = JSON.parse(readFileSync(join(input, "index.json"), "utf8")) as Json;
  const manifestFiles: Array<{ path: string; sha256: string }> = index.files ?? [];
  const unreadable: string[] = [];
  for (const file of manifestFiles) {
    if (typeof file?.path !== "string") continue;
    try {
      JSON.parse(readFileSync(join(input, file.path), "utf8"));
    } catch (error) {
      if (file.path.endsWith(".json")) unreadable.push(`${file.path}: ${(error as Error).message}`);
    }
  }
  const overlayName = manifestFiles.map((file) => file.path).find((path) => typeof path === "string" && path.endsWith("-profile-overlay.json")) ?? null;
  return {
    input,
    index,
    manifestFiles,
    overlayName,
    overlay: overlayName ? readJson(input, overlayName) : {},
    routes: readJson(input, "ecu-routes.json"),
    candidates: readJson(input, "did-candidates.json"),
    sources: readJson(input, "source-ledger.json"),
    platforms: readJson(input, "platforms.json"),
    families: readJson(input, "ecu-family-hypotheses.json"),
    inventories: readJson(input, "observed-module-inventories.json"),
    validation: readJson(input, "validation-plan.json"),
    safety: readJson(input, "transport-session-safety-policy.json"),
    supportEvidence: readJson(input, "command-support-evidence.json"),
    conflicts: readJson(input, "conflicts-and-gaps.json"),
    unreadable,
  };
}

export const recipesOf = (pack: LoadedPack): Json[] => pack.validation.validation_recipes ?? pack.validation.recipes ?? [];
export const routesOf = (pack: LoadedPack): Json[] => pack.routes.routes ?? [];
export const candidatesOf = (pack: LoadedPack): Json[] => pack.candidates.candidates ?? [];
export const sourcesOf = (pack: LoadedPack): Json[] => pack.sources.sources ?? [];
export const platformsOf = (pack: LoadedPack): Json[] => pack.platforms.platforms ?? [];
export const familiesOf = (pack: LoadedPack): Json[] => pack.families.families ?? [];
export const inventoriesOf = (pack: LoadedPack): Json[] => pack.inventories.inventories ?? [];
export const evidenceOf = (pack: LoadedPack): Json[] => pack.supportEvidence.evidence ?? [];
export const claimsOf = (pack: LoadedPack): Json[] => pack.overlay.claims ?? [];
export const identifierOf = (candidate: Json): unknown => candidate.did ?? candidate.local_identifier;

// ------------------------------------------------------------------ matchers

/** §15: an executable git-derived source pins a 40-character revision inside its own URL. */
export function immutableSource(source: Json | undefined): boolean {
  return Boolean(source?.execution_eligible === true && typeof source.revision === "string" && /^[0-9a-f]{40}$/.test(source.revision) && source.url?.includes(source.revision));
}

/** §8: uppercase hexadecimal, no `0x`, width agreeing with the protocol. */
export function addressOk(value: unknown, protocol: unknown): boolean {
  if (typeof value !== "string") return false;
  if (typeof protocol === "string" && protocol.startsWith("can29")) {
    return /^[0-9A-F]{8}$/.test(value) && Number.parseInt(value, 16) <= 0x1fffffff;
  }
  if (typeof protocol === "string" && protocol.startsWith("can11")) return /^[0-7][0-9A-F]{2}$/.test(value);
  return /^[0-9A-F]{3}$/.test(value) || /^[0-9A-F]{8}$/.test(value);
}

/** §12: a DID is four uppercase hex digits; a service-21 local identifier is two. */
export const didOk = (value: unknown): boolean => typeof value === "string" && /^[0-9A-F]{4}$/.test(value);
export const localIdentifierOk = (value: unknown): boolean => typeof value === "string" && /^[0-9A-F]{2}$/.test(value);

/** The trusted knowledge map. Research never writes to it; it is read here to
 * tell "already known" apart from "proposed". */
export function loadTrustedMap(): Json {
  return JSON.parse(readFileSync(join(HERE, "../data/uds-map.json"), "utf8")) as Json;
}

export const trustedMapBrands = (): Json[] => loadTrustedMap().brands ?? [];

/** Request/response pairs the trusted map already carries for this brand. */
export function trustedRoutePairs(): Set<string> {
  const map = loadTrustedMap();
  const pairs = new Set<string>();
  for (const brand of map.brands ?? []) for (const module of brand.modules ?? []) pairs.add(`${brand.id}:${module.req}:${module.resp}`);
  for (const family of map.ecu_families ?? []) for (const seen of family.modules_seen_on ?? []) pairs.add(`${seen.brand}:${seen.req}:${seen.resp}`);
  return pairs;
}

// ---------------------------------------------------------------- validation

export type ValidationReport = {
  pack_id: unknown;
  pack_version: unknown;
  research_date: unknown;
  files: number;
  valid_records: number;
  documentation_only_records: number;
  executable_routes: number;
  executable_dids: number;
  negative_evidence: number;
  blocked_transport_records: number;
  missing_immutable_sources: number;
  unresolved_references: number;
  scope_conflicts: number;
  decoder_variants: number;
};

export type ValidationResult = {
  pack: LoadedPack;
  failures: string[];
  warnings: string[];
  report: ValidationReport;
};

/**
 * Every §6 rejection plus the §23 quality gates, over one authoring
 * directory. Never throws on pack content: the caller decides whether a
 * failure means "print and exit 1" or "refuse to compile".
 */
export function validateResearchPack(input: string): ValidationResult {
  const pack = loadResearchPack(input);
  const failures: string[] = [];
  const warnings: string[] = [];
  // Failure messages are written as "<kind> <id>: <what>", so the record a
  // failure invalidates falls out of the message itself and feeds the §23
  // valid-record count without a second bookkeeping path.
  const invalid = new Set<string>();
  const RECORD_KINDS = /^(route|candidate|platform|ecu family|evidence|inventory|claim|source|validation recipe|conflict|gap) /;
  const fail = (message: string) => {
    failures.push(message);
    const head = message.split(": ")[0].split(" variant ")[0];
    if (RECORD_KINDS.test(head)) invalid.add(head);
  };

  // ---- manifest and integrity (§6)
  const manifestPaths = new Set<string>();
  for (const file of pack.manifestFiles) {
    if (typeof file?.path !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file.path)) {
      fail(`unsafe manifest path: ${String(file?.path)}`);
      continue;
    }
    if (manifestPaths.has(file.path)) {
      fail(`duplicate manifest path: ${file.path}`);
      continue;
    }
    manifestPaths.add(file.path);
    let stat;
    try {
      stat = lstatSync(join(input, file.path));
    } catch {
      fail(`manifest lists a file that is not present: ${file.path}`);
      continue;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      fail(`manifest entry is not a regular file: ${file.path}`);
      continue;
    }
    if (!/^[0-9a-f]{64}$/.test(file.sha256 ?? "")) {
      fail(`invalid manifest hash: ${file.path}`);
      continue;
    }
    if (sha256Of(input, file.path) !== file.sha256) fail(`hash mismatch: ${file.path}`);
  }
  const indexStat = lstatSync(join(input, "index.json"));
  if (!indexStat.isFile() || indexStat.isSymbolicLink()) fail("index.json is not a regular file");
  for (const problem of pack.unreadable) fail(`file does not parse: ${problem}`);
  if (typeof pack.index.pack_id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(pack.index.pack_id)) fail(`pack_id must be a lowercase id: ${String(pack.index.pack_id)}`);
  if (!Number.isInteger(pack.index.pack_version) || pack.index.pack_version < 1) fail(`pack_version must be a positive integer: ${String(pack.index.pack_version)}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pack.index.research_date ?? "")) fail(`research_date must be YYYY-MM-DD: ${String(pack.index.research_date)}`);
  if (!pack.overlayName) fail("pack has no <brand>-profile-overlay.json in its manifest");
  if (!(pack.overlay.brand_ids ?? []).length) fail("profile overlay has no brand ids");
  for (const canonical of ["ecu-routes.json", "did-candidates.json", "source-ledger.json", "platforms.json", "validation-plan.json", "conflicts-and-gaps.json", "transport-session-safety-policy.json"]) {
    if (!manifestPaths.has(canonical)) fail(`manifest is missing the canonical file ${canonical}`);
  }

  // ---- declared counts (§6)
  const actualCounts: Record<string, number> = {
    sources: sourcesOf(pack).length,
    platforms: platformsOf(pack).length,
    routes: routesOf(pack).length,
    did_candidates: candidatesOf(pack).length,
    command_evidence: evidenceOf(pack).length,
    ecu_families: familiesOf(pack).length,
    module_inventories: inventoriesOf(pack).length,
    validation_recipes: recipesOf(pack).length,
    claims: claimsOf(pack).length,
    conflicts: (pack.conflicts.conflicts ?? []).length,
    gaps: (pack.conflicts.gaps ?? []).length,
  };
  const declared: Json = pack.index.declared_counts ?? {};
  for (const [name, actual] of Object.entries(actualCounts)) {
    if (declared[name] != null && declared[name] !== actual) fail(`declared ${name} = ${declared[name]}, actual ${actual}`);
  }
  for (const [file, key] of [["ecu-routes.json", "routes"], ["did-candidates.json", "did_candidates"], ["command-support-evidence.json", "command_evidence"]] as Array<[string, string]>) {
    const local = file === "ecu-routes.json" ? pack.routes.declared_count : file === "did-candidates.json" ? pack.candidates.declared_count : pack.supportEvidence.declared_count;
    if (local != null && local !== actualCounts[key]) fail(`${file} declares ${local} records, actual ${actualCounts[key]}`);
  }

  // ---- unique ids across files (§6)
  const seen = new Map<string, string>();
  const unique = (kind: string, id: unknown, where: string) => {
    if (typeof id !== "string" || !id.length) {
      fail(`${where} has no ${kind}`);
      return;
    }
    const key = `${kind}:${id}`;
    if (seen.has(key)) fail(`duplicate ${kind} ${id} (${seen.get(key)} and ${where})`);
    else seen.set(key, where);
  };
  for (const route of routesOf(pack)) unique("route_id", route.route_id, "ecu-routes.json");
  for (const candidate of candidatesOf(pack)) unique("candidate_id", candidate.candidate_id, "did-candidates.json");
  for (const platform of platformsOf(pack)) unique("platform_id", platform.platform_id, "platforms.json");
  for (const family of familiesOf(pack)) unique("ecu_family_id", family.ecu_family_id, "ecu-family-hypotheses.json");
  for (const claim of claimsOf(pack)) unique("claim_id", claim.claim_id, pack.overlayName ?? "profile overlay");
  for (const source of sourcesOf(pack)) unique("source_ref", source.ref, "source-ledger.json");
  for (const recipe of recipesOf(pack)) unique("validation_recipe_id", recipe.validation_recipe_id ?? recipe.recipe_id, "validation-plan.json");
  for (const evidence of evidenceOf(pack)) unique("evidence_id", evidence.evidence_id, "command-support-evidence.json");
  for (const inventory of inventoriesOf(pack)) unique("inventory_id", inventory.inventory_id, "observed-module-inventories.json");
  for (const conflict of pack.conflicts.conflicts ?? []) unique("conflict_id", conflict.conflict_id, "conflicts-and-gaps.json");
  for (const gap of pack.conflicts.gaps ?? []) unique("gap_id", gap.gap_id, "conflicts-and-gaps.json");

  // ---- reference resolution (§6)
  const sourceRefs = new Map<string, Json>(sourcesOf(pack).map((source) => [source.ref, source]));
  const routeIds = new Set(routesOf(pack).map((route) => route.route_id));
  const candidateIds = new Set(candidatesOf(pack).map((candidate) => candidate.candidate_id));
  const platformIds = new Set(platformsOf(pack).map((platform) => platform.platform_id));
  const familyIds = new Set(familiesOf(pack).map((family) => family.ecu_family_id));
  const recipeIds = new Set(recipesOf(pack).map((recipe) => recipe.validation_recipe_id ?? recipe.recipe_id));
  let unresolved = 0;
  const resolve = (ok: boolean, message: string) => {
    if (!ok) {
      unresolved += 1;
      fail(message);
    }
  };
  const checkRefs = (record: Json, where: string) => {
    for (const ref of record.source_refs ?? []) resolve(sourceRefs.has(ref), `${where}: unknown source ${ref}`);
  };
  const checkScope = (scope: Json | undefined, where: string) => {
    if (scope == null) return;
    for (const [key, value] of Object.entries(scope)) {
      if (!SCOPE_KEYS.includes(key)) {
        fail(`${where}: unknown scope key ${key}`);
        continue;
      }
      if (key === "years") {
        const years = value as Json;
        if (years == null) continue;
        if (typeof years !== "object" || Array.isArray(years) || Object.keys(years).some((bound) => !["from", "to"].includes(bound))) fail(`${where}: scope.years must be {from, to}`);
        else for (const bound of ["from", "to"]) if (years[bound] != null && !Number.isInteger(years[bound])) fail(`${where}: scope.years.${bound} must be an integer or null`);
        continue;
      }
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.length)) {
        fail(`${where}: scope.${key} must be an array of ids`);
        continue;
      }
      if (value.includes("unknown")) fail(`${where}: scope.${key} contains the literal "unknown"`);
      if (key === "platform_ids") for (const id of value) resolve(platformIds.has(id), `${where}: unknown platform ${id}`);
      if (key === "ecu_family_ids") for (const id of value) resolve(familyIds.has(id), `${where}: unknown ecu family ${id}`);
    }
  };
  const checkEnum = (value: unknown, allowed: string[], where: string, field: string, required: boolean) => {
    if (value == null) {
      if (required) fail(`${where}: missing ${field}`);
      return;
    }
    if (typeof value !== "string" || !allowed.includes(value)) fail(`${where}: ${field} "${String(value)}" is not one of ${allowed.join(" | ")}`);
  };

  // ---- routes (§8, §10)
  const trusted = trustedRoutePairs();
  const brandIds: string[] = pack.overlay.brand_ids ?? [];
  const executableRoutes = new Set<string>();
  const documentationOnlyRoutes = new Set<string>();
  let blockedTransports = 0;
  let missingImmutable = 0;
  for (const route of routesOf(pack)) {
    const where = `route ${route.route_id ?? "?"}`;
    checkRefs(route, where);
    checkScope(route.scope, where);
    const transport: Json = route.route ?? {};
    const protocol = transport.protocol;
    if (DOCUMENTED_PROTOCOLS.includes(protocol)) {
      blockedTransports += 1;
      if (route.automatic_execution_authorized === true) fail(`${where}: transport ${protocol} is documentation-only and cannot be authorized for execution`);
    } else if (!RUNTIME_PROTOCOLS.includes(protocol)) {
      fail(`${where}: protocol "${String(protocol)}" is not a runtime or documented transport`);
    }
    for (const field of ["req", "resp"]) {
      if (typeof transport[field] === "string" && transport[field].includes("/")) fail(`${where}: ${field} encodes route alternatives ("${transport[field]}") — create one route per address pair`);
      else if (!addressOk(transport[field], protocol)) fail(`${where}: ${field} "${String(transport[field])}" is not uppercase hex of the protocol's width`);
    }
    for (const service of route.read_services ?? []) {
      if (typeof service !== "string" || !/^[0-9A-F]{2}$/.test(service)) fail(`${where}: read service "${String(service)}" is not two uppercase hex digits`);
      else if (FORBIDDEN_SERVICES.includes(service)) fail(`${where}: read service ${service} is never automatic (specification §16)`);
    }
    checkEnum(route.knowledge_state, KNOWLEDGE_STATE, where, "knowledge_state", false);
    checkEnum(route.vehicle_fit, VEHICLE_FIT, where, "vehicle_fit", false);
    checkEnum(route.route_state, ROUTE_STATE, where, "route_state", false);
    checkEnum(route.identity_fit, IDENTITY_FIT, where, "identity_fit", false);
    checkEnum(route.activation, ACTIVATION, where, "activation", false);
    if (route.automatic_execution_authorized !== true) {
      documentationOnlyRoutes.add(route.route_id);
      continue;
    }
    if (route.session !== "default_only") {
      fail(`${where}: automatic execution requires session "default_only", not "${String(route.session)}"`);
      continue;
    }
    const immutable = (route.source_refs ?? []).some((ref: string) => immutableSource(sourceRefs.get(ref)));
    const confirmed = brandIds.some((brand) => trusted.has(`${brand}:${transport.req}:${transport.resp}`));
    if (!immutable) {
      missingImmutable += 1;
      if (confirmed) warnings.push(`${where}: authorized without an immutable source, accepted only because the trusted map already carries ${transport.req}/${transport.resp}`);
      else fail(`${where}: automatic_execution_authorized without a 40-character immutable source revision embedded in its URL`);
    }
    executableRoutes.add(route.route_id);
  }

  // ---- DID candidates and decoders (§12)
  let decoderVariants = 0;
  let executableDids = 0;
  let documentationOnlyCandidates = 0;
  for (const candidate of candidatesOf(pack)) {
    const where = `candidate ${candidate.candidate_id ?? "?"}`;
    checkRefs(candidate, where);
    checkScope(candidate.scope, where);
    resolve(routeIds.has(candidate.route_id), `${where}: unknown route ${String(candidate.route_id)}`);
    if (candidate.validation_recipe_id != null) resolve(recipeIds.has(candidate.validation_recipe_id), `${where}: unknown validation recipe ${candidate.validation_recipe_id}`);
    if (candidate.did != null && !didOk(candidate.did)) fail(`${where}: did "${String(candidate.did)}" is not four uppercase hex digits`);
    if (candidate.local_identifier != null && !localIdentifierOk(candidate.local_identifier)) fail(`${where}: local_identifier "${String(candidate.local_identifier)}" is not two uppercase hex digits`);
    if (identifierOf(candidate) == null) fail(`${where}: has neither did nor local_identifier`);
    checkEnum(candidate.support_status, SUPPORT_STATUS, where, "support_status", true);
    checkEnum(candidate.knowledge_state, KNOWLEDGE_STATE, where, "knowledge_state", false);
    checkEnum(candidate.vehicle_fit, VEHICLE_FIT, where, "vehicle_fit", false);
    checkEnum(candidate.route_state, ROUTE_STATE, where, "route_state", false);
    checkEnum(candidate.identity_fit, IDENTITY_FIT, where, "identity_fit", false);
    checkEnum(candidate.activation, ACTIVATION, where, "activation", false);
    for (const variant of candidate.decoder_variants ?? []) {
      decoderVariants += 1;
      const variantWhere = `${where} variant ${variant.variant_id ?? "?"}`;
      if (typeof variant.variant_id !== "string" || !variant.variant_id.length) fail(`${variantWhere}: missing variant_id`);
      for (const ref of variant.source_refs ?? []) resolve(sourceRefs.has(ref), `${variantWhere}: unknown source ${ref}`);
      for (const [index, signal] of (variant.signals ?? []).entries()) {
        for (const key of Object.keys(signal)) {
          if (FORBIDDEN_SIGNAL_KEYS.includes(key)) fail(`${variantWhere}: decoder field "${key}" is a second formula dialect — use scale and bias`);
          else if (!SIGNAL_KEYS.includes(key)) fail(`${variantWhere}: unknown decoder field "${key}"`);
        }
        if (!Number.isInteger(signal.offset) || signal.offset < 0) fail(`${variantWhere}: offset must be a byte count from zero`);
        if (!Number.isInteger(signal.len) || signal.len < 1 || signal.len > 8) fail(`${variantWhere}: len must be 1..8 bytes`);
        if (!ENCODINGS.includes(signal.encoding)) fail(`${variantWhere}: encoding "${String(signal.encoding)}" is not one of ${ENCODINGS.join(" | ")}`);
        if (signal.signed != null && typeof signal.signed !== "boolean") fail(`${variantWhere}: signed must be a boolean`);
        if (!Number.isFinite(signal.scale)) fail(`${variantWhere}: scale must be a finite number`);
        if (!Number.isFinite(signal.bias)) fail(`${variantWhere}: bias must be a finite number`);
        // A bitfield without explicit bits stays preserved evidence: the
        // projector cannot make it executable, so this is not a rejection.
        if (signal.encoding === "bitfield" && (!Number.isInteger(signal.bit_offset) || !Number.isInteger(signal.bit_len))) {
          warnings.push(`${variantWhere}: bitfield signal ${index} has no bit_offset/bit_len, so the variant stays documentation-only`);
        }
      }
    }
    if (candidate.automatic_execution_authorized !== true) {
      documentationOnlyCandidates += 1;
      continue;
    }
    const immutable = (candidate.source_refs ?? []).some((ref: string) => immutableSource(sourceRefs.get(ref)));
    if (!immutable) {
      missingImmutable += 1;
      fail(`${where}: automatic_execution_authorized without a 40-character immutable source revision embedded in its URL`);
    }
    if (["unsupported", "explicitly_unsupported_on_test_vehicle"].includes(candidate.support_status)) {
      fail(`${where}: support_status ${candidate.support_status} cannot be automatically executed`);
    }
    if (documentationOnlyRoutes.has(candidate.route_id)) fail(`${where}: authorized for execution on documentation-only route ${candidate.route_id}`);
    executableDids += 1;
  }

  // ---- families, inventories, evidence, recipes, claims and sources
  for (const family of familiesOf(pack)) {
    const where = `ecu family ${family.ecu_family_id ?? "?"}`;
    checkRefs(family, where);
    checkScope(family.scope, where);
    for (const id of family.observed_route_ids ?? []) resolve(routeIds.has(id), `${where}: unknown route ${id}`);
    for (const id of family.proposed_candidate_ids ?? []) resolve(candidateIds.has(id), `${where}: unknown candidate ${id}`);
    checkEnum(family.knowledge_state, KNOWLEDGE_STATE, where, "knowledge_state", false);
    checkEnum(family.vehicle_fit, VEHICLE_FIT, where, "vehicle_fit", false);
    checkEnum(family.identity_fit, IDENTITY_FIT, where, "identity_fit", false);
    checkEnum(family.activation, ACTIVATION, where, "activation", false);
  }
  for (const inventory of inventoriesOf(pack)) {
    const where = `inventory ${inventory.inventory_id ?? "?"}`;
    checkRefs(inventory, where);
    checkScope(inventory.scope, where);
    for (const id of inventory.route_ids ?? []) resolve(routeIds.has(id), `${where}: unknown route ${id}`);
  }
  let negativeEvidence = 0;
  for (const evidence of evidenceOf(pack)) {
    const where = `evidence ${evidence.evidence_id ?? "?"}`;
    checkRefs(evidence, where);
    checkScope(evidence.scope, where);
    if (evidence.route_id != null) resolve(routeIds.has(evidence.route_id), `${where}: unknown route ${evidence.route_id}`);
    if (evidence.did != null && !didOk(evidence.did) && !localIdentifierOk(evidence.did)) fail(`${where}: did "${String(evidence.did)}" is not uppercase hex`);
    checkEnum(evidence.outcome?.status, OBSERVATION_STATUS, where, "outcome.status", true);
    checkEnum(evidence.support_status, SUPPORT_STATUS, where, "support_status", true);
    if (evidence.outcome?.nrc != null && !Number.isInteger(evidence.outcome.nrc)) fail(`${where}: outcome.nrc must be an integer`);
    if (["refused", "unsupported", "timed_out", "transport_failed", "malformed"].includes(evidence.outcome?.status) || ["unsupported", "explicitly_unsupported_on_test_vehicle"].includes(evidence.support_status)) negativeEvidence += 1;
  }
  for (const platform of platformsOf(pack)) {
    const where = `platform ${platform.platform_id ?? "?"}`;
    checkRefs(platform, where);
    checkScope(platform.scope, where);
    checkEnum(platform.knowledge_state, KNOWLEDGE_STATE, where, "knowledge_state", false);
    for (const transport of platform.transport_candidates ?? []) if (!RUNTIME_PROTOCOLS.includes(transport)) fail(`${where}: transport candidate "${String(transport)}" is not a runtime transport`);
    for (const transport of platform.unsupported_transport_candidates ?? []) {
      blockedTransports += 1;
      if (!DOCUMENTED_PROTOCOLS.includes(transport)) fail(`${where}: unsupported transport "${String(transport)}" is not a documented transport`);
    }
  }
  for (const claim of claimsOf(pack)) {
    const where = `claim ${claim.claim_id ?? "?"}`;
    checkRefs(claim, where);
    checkScope(claim.scope, where);
    for (const field of ["exact_claim", "action_if_connected", "promotion_test", "non_generalization_boundary"]) {
      if (typeof claim[field] !== "string" || !claim[field].trim().length) fail(`${where}: missing ${field}`);
    }
    if (claim.vehicle_applicability != null) checkEnum(claim.vehicle_applicability, VEHICLE_APPLICABILITY, where, "vehicle_applicability", false);
  }
  for (const source of sourcesOf(pack)) {
    const where = `source ${source.ref ?? "?"}`;
    for (const field of ["title", "url", "licence", "scope", "reliability"]) if (typeof source[field] !== "string" || !source[field].length) fail(`${where}: missing ${field}`);
    if (source.retrieved_at != null && !/^\d{4}-\d{2}-\d{2}$/.test(source.retrieved_at)) fail(`${where}: retrieved_at must be YYYY-MM-DD`);
    if (source.execution_eligible === true && !immutableSource(source)) fail(`${where}: execution_eligible needs a 40-character revision that appears in its url`);
  }
  for (const recipe of recipesOf(pack)) {
    const where = `validation recipe ${recipe.validation_recipe_id ?? recipe.recipe_id ?? "?"}`;
    if (typeof recipe.kind !== "string" || !recipe.kind.length) fail(`${where}: missing kind`);
  }

  // ---- safety policy and budgets (§16, §17)
  const automatic: Json = pack.safety.automatic_discovery ?? {};
  if (automatic.read_only !== true || automatic.default_session_only !== true) fail("automatic discovery policy is not read-only/default-session-only");
  if (automatic.max_outstanding_requests !== 1) fail("research policy allows concurrent requests");
  const budget: Json = pack.safety.brand_budget_reductions ?? {};
  for (const [name, ceiling] of Object.entries(CENTRAL_BUDGET)) {
    const value = budget[name];
    if (value == null) continue;
    if (!Number.isFinite(value) || value <= 0) fail(`budget ${name} must be a positive number`);
    else if (value > ceiling) fail(`budget ${name} = ${value} exceeds the central ceiling ${ceiling}; a brand pack may only narrow`);
  }
  if ((pack.safety["29bit_policy"] ?? {}).generic_enumeration_authorized === true) fail("generic 29-bit enumeration is deny-by-default and a pack cannot authorize it");
  for (const id of (pack.safety["29bit_policy"] ?? {}).exact_platform_routes_authorized ?? []) resolve(routeIds.has(id), `29-bit policy: unknown route ${id}`);

  // ---- conflicts and gaps (§22)
  for (const conflict of pack.conflicts.conflicts ?? []) {
    checkRefs(conflict, `conflict ${conflict.conflict_id ?? "?"}`);
    if (typeof conflict.finding !== "string" || !conflict.finding.length) fail(`conflict ${conflict.conflict_id ?? "?"}: missing finding`);
  }
  for (const gap of pack.conflicts.gaps ?? []) {
    checkRefs(gap, `gap ${gap.gap_id ?? "?"}`);
    if (typeof gap.safe_next_action !== "string" || !gap.safe_next_action.length) fail(`gap ${gap.gap_id ?? "?"}: missing safe_next_action`);
  }

  const totalRecords = routesOf(pack).length + candidatesOf(pack).length + platformsOf(pack).length + familiesOf(pack).length + evidenceOf(pack).length + inventoriesOf(pack).length + recipesOf(pack).length + claimsOf(pack).length + sourcesOf(pack).length + (pack.conflicts.conflicts ?? []).length + (pack.conflicts.gaps ?? []).length;
  return {
    pack,
    failures,
    warnings,
    report: {
      pack_id: pack.index.pack_id,
      pack_version: pack.index.pack_version,
      research_date: pack.index.research_date,
      files: pack.manifestFiles.length + 1,
      valid_records: totalRecords - invalid.size,
      documentation_only_records: documentationOnlyRoutes.size + documentationOnlyCandidates,
      executable_routes: executableRoutes.size,
      executable_dids: executableDids,
      negative_evidence: negativeEvidence,
      blocked_transport_records: blockedTransports,
      missing_immutable_sources: missingImmutable,
      unresolved_references: unresolved,
      scope_conflicts: (pack.conflicts.conflicts ?? []).length,
      decoder_variants: decoderVariants,
    },
  };
}

/** The §23 report, as text. */
export function formatValidationReport(result: ValidationResult): string {
  const report = result.report;
  const lines = [`pack ${String(report.pack_id)} v${String(report.pack_version)} (${String(report.research_date)}) — ${report.files} manifest files`, ""];
  const rows: Array<[string, number]> = [
    ["valid records", report.valid_records],
    ["documentation-only records", report.documentation_only_records],
    ["executable routes", report.executable_routes],
    ["executable DIDs", report.executable_dids],
    ["negative evidence", report.negative_evidence],
    ["blocked transport records", report.blocked_transport_records],
    ["missing immutable sources", report.missing_immutable_sources],
    ["unresolved references", report.unresolved_references],
    ["scope conflicts", report.scope_conflicts],
    ["decoder variants", report.decoder_variants],
  ];
  for (const [label, value] of rows) lines.push(`  ${label.padEnd(30)}${value}`);
  if (result.warnings.length) {
    lines.push("", `warnings (${result.warnings.length}):`);
    for (const warning of result.warnings) lines.push(`  - ${warning}`);
  }
  if (result.failures.length) {
    lines.push("", `failures (${result.failures.length}):`);
    for (const failure of result.failures) lines.push(`  - ${failure}`);
  } else {
    lines.push("", "valid: no failures");
  }
  return lines.join("\n");
}
