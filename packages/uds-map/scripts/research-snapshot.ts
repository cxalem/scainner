import { fileURLToPath } from "node:url";
import type { Brand, EcuFamily, KnownDid, ModuleDef } from "../src/types.ts";
import { loadMap, loadResearchPacks, researchStats } from "./pack.ts";

const dash = (value: unknown): string => (value == null || value === "" ? "—" : String(value));
const list = (values: readonly string[] | undefined): string => (values?.length ? [...values].sort().join(", ") : "—");
const cell = (value: unknown): string => dash(value).replaceAll("|", "\\|");

const byAddress = (a: ModuleDef, b: ModuleDef): number => a.req.localeCompare(b.req) || a.resp.localeCompare(b.resp);
const byDid = (a: KnownDid, b: KnownDid): number => a.did.localeCompare(b.did);

export function renderSnapshot(brandId: string): string {
  const map = loadMap();
  const brand: Brand | undefined = map.brands.find((candidate) => candidate.id === brandId);
  if (!brand) {
    const known = map.brands.map((candidate) => candidate.id).sort().join(", ");
    throw new Error(`no brand "${brandId}" in data/uds-map.json. Known ids: ${known}`);
  }
  const lines: string[] = [];
  const push = (...values: string[]) => lines.push(...values);

  push(`## Coverage snapshot: ${brand.id}`, "");
  push(`Generated from \`data/uds-map.json\` v${map.version} (${map.generated}) by \`research:snapshot\`. Everything below is what the project already holds; research should add to it, never restate it.`, "");

  push("### Brand", "");
  push("| Field | Value |", "|---|---|");
  push(`| name | ${cell(brand.name)} |`);
  push(`| wmi | ${cell(list(brand.wmi))} |`);
  push(`| profiled_level | ${cell(brand.profiled_level)} |`);
  push(`| confidence | ${cell(brand.confidence)} |`);
  push(`| read_service | ${cell(brand.read_service ?? map.standard.read_service)} |`);
  push(`| resp_offsets | ${cell((brand.resp_offsets ?? []).map((offset) => `${offset.from}-${offset.to} +${offset.delta}`).sort().join(", ") || null)} |`);
  const gateway = brand.gateway_behaviour;
  push(`| gateway_behaviour | ${cell(gateway ? `silence means ${gateway.silence_means}${gateway.writes_blocked ? ", writes blocked" : ""}` : null)} |`);
  const isoDids = [...new Set((map.standard.identity_block?.dids ?? []).map((did) => did.did.toUpperCase()))].sort();
  const brandDids = [...new Set((brand.identity_block?.dids ?? []).map((did) => did.did.toUpperCase()))].sort();
  push(`| identity_block (iso) | ${cell(isoDids.join(", ") || null)} |`);
  push(`| identity_block (brand) | ${cell(brandDids.filter((did) => !isoDids.includes(did)).join(", ") || null)} |`);
  push("");

  push("### Platforms", "");
  const platforms = [...(brand.platforms ?? [])].sort((a, b) => a.key.localeCompare(b.key));
  if (!platforms.length) {
    push("None. Every platform-scoped research candidate for this brand is inert until a platform lands here.", "");
  } else {
    push("| Key | vds_pattern | Years | read_service | ECU families expected |", "|---|---|---|---|---|");
    for (const platform of platforms) {
      const years = `${platform.years?.[0] ?? "…"}–${platform.years?.[1] ?? "…"}`;
      push(`| ${cell(platform.key)} | ${cell(platform.vds_pattern)} | ${cell(years)} | ${cell(platform.read_service)} | ${cell(list(platform.ecu_families_expected))} |`);
    }
    push("");
  }

  push("### Known modules and routes", "");
  const modules = [...(brand.modules ?? [])].sort(byAddress);
  if (!modules.length) {
    push("None. This brand has no manufacturer routes in the map yet.", "");
  } else {
    push("| Name | req/resp | Protocol | read_service | discovery_session |", "|---|---|---|---|---|");
    for (const module of modules) {
      push(`| ${cell(module.name)} | ${cell(`${module.req}/${module.resp}`)} | ${cell(module.route?.protocol ?? "can11_500")} | ${cell(module.read_service ?? brand.read_service)} | ${cell(module.discovery_session ?? "default_only")} |`);
    }
    push("");
  }

  push("### DID bands", "");
  const bands = [...(brand.did_bands ?? [])].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  if (!bands.length) {
    push("None. A bounded sweep on this brand has no sourced band to stay inside.", "");
  } else {
    push("| From | To | Confidence | Note |", "|---|---|---|---|");
    for (const band of bands) push(`| ${cell(band.from)} | ${cell(band.to)} | ${cell(band.confidence)} | ${cell(band.note)} |`);
    push("");
  }

  push("### Known DIDs", "");
  const dids = [...(brand.known_dids ?? [])].sort(byDid);
  const decoded = dids.filter((did) => (did.decodes ?? []).length > 0);
  const unbound = dids.filter((did) => did.binding === "unknown");
  push(`${dids.length} known DID(s), ${decoded.length} with at least one decode, ${unbound.length} not bound to a module.`, "");
  if (dids.length) {
    push(`Identifiers already held: ${[...new Set(dids.map((did) => did.did.toUpperCase()))].sort().join(", ")}.`, "");
  }

  push("### ECU families touching this brand", "");
  const families: EcuFamily[] = (map.ecu_families ?? []).filter((family) => family.modules_seen_on.some((seen) => seen.brand === brand.id)).sort((a, b) => a.id.localeCompare(b.id));
  if (!families.length) {
    push("None.", "");
  } else {
    push("| Family | Supplier | Service | Hardware refs | Software refs | Decodes |", "|---|---|---|---|---|---:|");
    for (const family of families) {
      push(`| ${cell(family.id)} | ${cell(family.supplier)} | ${cell(family.diagnostic_service)} | ${cell(list(family.hardware_refs))} | ${cell(list(family.software_refs))} | ${family.decodes.length} |`);
    }
    push("");
  }

  push("### Research packs already covering this brand", "");
  const packs = loadResearchPacks();
  const stats = researchStats(packs);
  const rows = packs
    .filter((pack) => pack.profiles.some((profile) => profile.brand_id === brand.id))
    .map((pack) => {
      const profile = pack.profiles.find((candidate) => candidate.brand_id === brand.id)!;
      const routes = profile.routes ?? [];
      const candidateDids = routes.reduce((total, route) => total + (route.candidate_dids ?? []).length, 0);
      const negative = routes.reduce(
        (total, route) => total + (route.candidate_dids ?? []).filter((did) => typeof did !== "string" && (did.automatic_execution_authorized === false || did.support_status === "unsupported" || did.support_status === "explicitly_unsupported_on_test_vehicle")).length,
        0,
      );
      return { pack_id: pack.pack_id, version: pack.version, routes: routes.filter((route) => !route.exploration_only).length, candidateDids, negative };
    })
    .sort((a, b) => a.pack_id.localeCompare(b.pack_id));
  if (!rows.length) {
    push("None. This brand has no research candidates yet.", "");
  } else {
    push("| Pack | Version | Executable routes | Candidate DIDs | Negative evidence |", "|---|---:|---:|---:|---:|");
    for (const row of rows) push(`| ${cell(row.pack_id)} | ${row.version} | ${row.routes} | ${row.candidateDids} | ${row.negative} |`);
    const brandStat = stats.get(brand.id);
    if (brandStat) push(`| **total** | ${brandStat.packs.length} pack(s) | ${brandStat.routes - brandStat.explorationRoutes} | ${brandStat.candidateDids} | ${brandStat.negativeEvidence} |`);
    push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const brandId = process.argv[2];
  if (!brandId || brandId.startsWith("--")) {
    process.stderr.write("usage: research:snapshot <brand_id>\n");
    process.exit(2);
  }
  try {
    process.stdout.write(renderSnapshot(brandId));
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exit(1);
  }
}
