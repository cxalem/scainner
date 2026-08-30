// Generates the desktop app's WMI → brand badge table from the pack
// (multi-brand plan, Phase 4, P4.3): every `brands[].wmi[]` entry becomes a
// row, refined by an optional marque overlay for marques that live inside a
// group brand (a group brand routes diagnostics; the badge still wants the
// marque's own name and emblem key).
//
//   pnpm wmi-table            # rewrite apps/desktop/src/data/wmi.json
//   pnpm wmi-table --check    # exit 1 when the committed table is stale (CI)
//
// Inputs:
//   data/uds-map.json                          brands[].{id,name,wmi,confidence}
//   apps/desktop/src/data/wmi-marques.json     { "<WMI>": { key, name, confidence?, source? } }
//
// Overlay rows whose WMI the pack does not route are still emitted with
// `brand: null` — badge only, no diagnostic profile. No brand is named
// here: every row comes from data.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadMap, PKG_DIR } from "./pack.ts";

export type WmiRow = {
  key: string;
  name: string;
  /** Pack brand id that routes this WMI, or null for a badge-only marque. */
  brand: string | null;
  confidence: string;
  source: string;
};

type Overlay = Record<string, { key: string; name: string; confidence?: string; source?: string }>;

const DESKTOP_DATA = join(PKG_DIR, "..", "..", "apps", "desktop", "src", "data");
export const WMI_TABLE_PATH = join(DESKTOP_DATA, "wmi.json");
export const WMI_MARQUES_PATH = join(DESKTOP_DATA, "wmi-marques.json");

function loadOverlay(): Overlay {
  try {
    return JSON.parse(readFileSync(WMI_MARQUES_PATH, "utf-8")) as Overlay;
  } catch {
    return {};
  }
}

/** The badge name for a group brand: the first segment of the pack name
 * before a " /" or " (" qualifier, upper-cased like the overlay names. */
function badgeName(name: string): string {
  return name.split(/\s+[/(]/)[0].trim().toUpperCase();
}

/** Pack confidence uses `confirmed`; the badge table's scale tops out at
 * `high` (brand.ts `Confidence`). */
function badgeConfidence(c: string | undefined): string {
  if (!c) return "medium";
  return c === "confirmed" ? "high" : c;
}

export function buildWmiTable(): Record<string, WmiRow> {
  const map = loadMap();
  const overlay = loadOverlay();
  const rows = new Map<string, WmiRow>();
  for (const b of map.brands) {
    for (const wmi of b.wmi) {
      const code = wmi.toUpperCase();
      // First brand in pack order routes a shared WMI. This is a deliberate,
      // evidence-based tie-break, not an arbitrary default: e.g. VSS is
      // claimed by both `seat` (well-established, listed first) and `cupra`
      // (an unverified analogy pending a real VIN — see that brand's own
      // `sources[]` note in uds-map.json, and RESEARCH.md §4/§8).
      if (rows.has(code)) continue;
      const o = overlay[code];
      rows.set(code, {
        key: o?.key ?? b.id,
        name: o?.name ?? badgeName(b.name),
        brand: b.id,
        confidence: badgeConfidence(o?.confidence ?? b.confidence),
        source: o?.source ?? `packages/uds-map/data/uds-map.json brands[${b.id}].wmi`,
      });
    }
  }
  for (const [wmi, o] of Object.entries(overlay)) {
    const code = wmi.toUpperCase();
    if (rows.has(code)) continue;
    rows.set(code, {
      key: o.key,
      name: o.name,
      brand: null,
      confidence: badgeConfidence(o.confidence),
      source: o.source ?? `apps/desktop/src/data/wmi-marques.json ${code}`,
    });
  }
  const out: Record<string, WmiRow> = {};
  for (const code of [...rows.keys()].sort()) out[code] = rows.get(code)!;
  return out;
}

export function renderWmiTable(): string {
  return JSON.stringify(buildWmiTable(), null, 2) + "\n";
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const rendered = renderWmiTable();
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(WMI_TABLE_PATH, "utf-8");
    } catch {
      current = "";
    }
    if (current !== rendered) {
      console.error("apps/desktop/src/data/wmi.json is out of date: run `pnpm wmi-table` in packages/uds-map and commit the result.");
      process.exit(1);
    }
    console.log("wmi.json is up to date");
  } else {
    writeFileSync(WMI_TABLE_PATH, rendered);
    console.log(`wrote ${WMI_TABLE_PATH} (${Object.keys(buildWmiTable()).length} WMIs)`);
  }
}

function fileURLToPath(url: string): string {
  return decodeURIComponent(new URL(url).pathname);
}
