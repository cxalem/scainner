import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brandStats, decodeShape, loadMap, loadPacks, loadResearchPacks, PKG_DIR, researchStats } from "./pack.ts";

export function renderCoverage(): string {
  const map = loadMap();
  const packs = loadPacks();
  const rows = map.brands.map((b) => brandStats(map, b));
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((n, r) => n + f(r), 0);

  const lines: string[] = [];
  lines.push("# uds-map coverage");
  lines.push("");
  lines.push(
    `Generated from \`data/uds-map.json\` v${map.version} (${map.generated}) by \`pnpm coverage\` — do not edit by hand; CI fails when this file is stale.`,
  );
  lines.push("");
  lines.push("Columns: **WMIs** VIN prefixes routed to the brand · **Modules** documented address pairs (29-bit in brackets) · **DIDs** known DIDs · **Decodable** DIDs with at least one decode · **Bound** DIDs bound to an exact module (unknown-binding entries in brackets) · **Families** ECU families seen on the brand · **Decodes** decode values (DIDs with an evidence note) · **On vehicle** DIDs decoded from this project's own captures · **Read svc** read services represented in data · **Identity** identity block · **Platforms** platform entries (with a VIN-selectable pattern in brackets) · **Level** `profiled_level` · **Gateway** silence semantics · **Conf** brand confidence.");
  lines.push("");
  lines.push("| Brand | WMIs | Modules | DIDs | Decodable | Bound | Families | Decodes | On vehicle | Read svc | Identity | Platforms | Level | Gateway | Conf |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---:|---|---|---|");
  for (const r of rows) {
    lines.push(
      `| ${r.id} | ${r.wmi} | ${r.modules}${r.modules29bit ? ` (${r.modules29bit})` : ""} | ${r.knownDids} | ${r.decodable} | ${r.moduleBound}${r.bindingUnknown ? ` (${r.bindingUnknown} unknown)` : ""} | ${r.families} | ${r.decodes}${r.decodesWithEvidence ? ` (${r.decodesWithEvidence} ev.)` : ""} | ${r.onVehicle} | ${r.readServices.join(", ") || "—"} | ${r.identityBlock} | ${r.platforms}${r.platformsWithVds ? ` (${r.platformsWithVds} vds)` : ""} | ${r.profiledLevel} | ${r.gateway} | ${r.confidence} |`,
    );
  }
  lines.push(
    `| **total** | ${sum((r) => r.wmi)} | ${sum((r) => r.modules)} (${sum((r) => r.modules29bit)}) | ${sum((r) => r.knownDids)} | ${sum((r) => r.decodable)} | ${sum((r) => r.moduleBound)} (${sum((r) => r.bindingUnknown)} unknown) | ${map.ecu_families?.length ?? 0} | ${sum((r) => r.decodes)} (${sum((r) => r.decodesWithEvidence)} ev.) | ${sum((r) => r.onVehicle)} | ${rows.filter((r) => r.readServices.length > 0).length} brands | ${rows.filter((r) => r.identityBlock !== "none").length} brands | ${sum((r) => r.platforms)} (${sum((r) => r.platformsWithVds)} vds) | ${rows.filter((r) => r.profiledLevel === "decodes_verified").length} decodes_verified / ${rows.filter((r) => r.profiledLevel === "routes_verified").length} routes_verified / ${rows.filter((r) => r.profiledLevel === "routes_sourced").length} routes_sourced / ${rows.filter((r) => r.profiledLevel === "standard_only").length} standard_only | ${rows.filter((r) => r.gateway !== "unknown").length} brands | |`,
  );
  lines.push("");

  lines.push("## Profiled levels");
  lines.push("");
  lines.push("`standard_only`: no manufacturer routes in data · `routes_sourced`: routes from open implementations or community tables · `routes_verified`: at least one route confirmed by a recorded request/response capture (a project capture or an open corpus test fixture with raw bytes) · `decodes_verified`: decodes confirmed on a vehicle by this project. Levels are data (`brands[].profiled_level`) with `brands[].sources[]` behind them; `pnpm lint:pack` fails a level the sources cannot support.");
  lines.push("");
  for (const level of ["decodes_verified", "routes_verified", "routes_sourced", "standard_only"]) {
    const ids = rows.filter((r) => r.profiledLevel === level).map((r) => r.id);
    lines.push(`- **${level}** (${ids.length}): ${ids.join(", ") || "—"}`);
  }
  lines.push("");

  lines.push("## Decode shapes");
  lines.push("");
  const shapes = new Map<string, number>();
  for (const b of map.brands) for (const k of b.known_dids ?? []) for (const d of k.decodes ?? []) shapes.set(decodeShape(d), (shapes.get(decodeShape(d)) ?? 0) + 1);
  for (const [shape, n] of [...shapes.entries()].sort((a, b) => b[1] - a[1])) lines.push(`- \`${shape}\`: ${n}`);
  lines.push("");

  lines.push("## Read services and routes");
  lines.push("");
  const services = new Map<string, string[]>();
  for (const b of map.brands) {
    for (const m of b.modules ?? []) {
      if (m.read_service) services.set(m.read_service, [...(services.get(m.read_service) ?? []), `${b.id} ${m.req}/${m.resp}`]);
    }
  }
  for (const [svc, mods] of [...services.entries()].sort()) lines.push(`- service \`${svc}\` on ${mods.length} module(s): ${mods.join(", ")}`);
  const protocols = new Map<string, number>();
  for (const b of map.brands) for (const m of b.modules ?? []) protocols.set(m.route?.protocol ?? "can11_500", (protocols.get(m.route?.protocol ?? "can11_500") ?? 0) + 1);
  for (const [p, n] of [...protocols.entries()].sort()) lines.push(`- route protocol \`${p}\`: ${n} module(s)`);
  lines.push("");

  lines.push("## Unknown bindings");
  lines.push("");
  lines.push("Known DIDs whose module the research does not name (`modules: []`, `binding: \"unknown\"`). They are browsable but never label a module's answer; binding one needs a source that says which module carries it.");
  lines.push("");
  for (const b of map.brands) {
    const unknown = (b.known_dids ?? []).filter((k) => k.binding === "unknown").map((k) => k.did);
    if (unknown.length) lines.push(`- ${b.id}: ${unknown.join(", ")}`);
  }
  lines.push("");

  lines.push("## Overlay packs");
  lines.push("");
  for (const p of packs) {
    const dids = p.brands.reduce((n, b) => n + (b.known_dids ?? []).length, 0);
    const decodes = p.brands.reduce((n, b) => n + (b.known_dids ?? []).reduce((m, k) => m + (k.decodes ?? []).length, 0), 0);
    lines.push(`- \`${p.id}\` v${p.version} (${p.license}): ${p.brands.map((b) => b.id).join(", ")} — ${p.brands.reduce((n, b) => n + (b.modules ?? []).length, 0)} module(s), ${dids} DID(s), ${decodes} decode(s)`);
  }
  lines.push("");

  lines.push("## Research");
  lines.push("");
  lines.push(
    "Research candidates are evidence about *where to look*, never trusted knowledge: no row here decodes a value or labels a module. Counted from the runtime packs listed in `data/research-packs.json`. Columns: **Packs** research packs carrying a profile for the brand · **Routes** candidate routes (platform-scoped in brackets) · **Exploration** routes offered only to explicit parked exploration · **Candidate DIDs** identifiers a reached route may ask for · **Negative** candidates the research itself marks never-to-request (unsupported, or disproven on a test vehicle).",
  );
  lines.push("");
  const research = researchStats(loadResearchPacks());
  lines.push("| Brand | Packs | Routes | Exploration | Candidate DIDs | Negative |");
  lines.push("|---|---|---:|---:|---:|---:|");
  for (const r of [...research.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    lines.push(`| ${r.id} | ${r.packs.length} | ${r.routes}${r.platformScopedRoutes ? ` (${r.platformScopedRoutes} platform-scoped)` : ""} | ${r.explorationRoutes} | ${r.candidateDids} | ${r.negativeEvidence} |`);
  }
  const totals = [...research.values()];
  lines.push(
    `| **total** | ${new Set(totals.flatMap((r) => r.packs)).size} packs | ${totals.reduce((n, r) => n + r.routes, 0)} (${totals.reduce((n, r) => n + r.platformScopedRoutes, 0)} platform-scoped) | ${totals.reduce((n, r) => n + r.explorationRoutes, 0)} | ${totals.reduce((n, r) => n + r.candidateDids, 0)} | ${totals.reduce((n, r) => n + r.negativeEvidence, 0)} |`,
  );
  lines.push("");
  for (const pack of loadResearchPacks()) {
    lines.push(`- \`${pack.pack_id}\` v${pack.version} (${pack.research_date}): ${pack.profiles.map((p) => p.brand_id).sort().join(", ")}`);
  }
  lines.push("");

  lines.push("## Sources");
  lines.push("");
  const sources = new Map<string, { type: string; licence: string; brands: Set<string> }>();
  for (const b of map.brands) {
    for (const s of b.sources ?? []) {
      const entry = sources.get(s.url) ?? { type: s.type, licence: s.licence, brands: new Set<string>() };
      entry.brands.add(b.id);
      sources.set(s.url, entry);
    }
  }
  lines.push("| Source | Type | Licence | Brands |");
  lines.push("|---|---|---|---|");
  for (const [url, s] of [...sources.entries()].sort()) lines.push(`| ${url} | ${s.type} | ${s.licence} | ${[...s.brands].sort().join(", ")} |`);
  lines.push("");
  return lines.join("\n");
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const out = join(PKG_DIR, "COVERAGE.md");
  const rendered = renderCoverage();
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(out, "utf-8");
    } catch {
      current = "";
    }
    if (current !== rendered) {
      console.error("COVERAGE.md is out of date: run `pnpm coverage` in packages/uds-map and commit the result.");
      process.exit(1);
    }
    console.log("COVERAGE.md is up to date");
  } else {
    writeFileSync(out, rendered);
    console.log(`wrote ${out}`);
  }
}

function fileURLToPath(url: string): string {
  return decodeURIComponent(new URL(url).pathname);
}
