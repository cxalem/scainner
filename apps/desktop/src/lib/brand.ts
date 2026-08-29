// VIN → manufacturer, from the WMI (World Manufacturer Identifier — the
// VIN's first three characters, ISO 3780). The UI needs a brand identity
// for the connected car; an unknown WMI simply falls back to a generic
// badge. `brandFromVin` logs nothing and never throws.
//
// The table itself lives in `../data/wmi.json` and is GENERATED — do not
// edit it by hand. `pnpm wmi-table` in packages/uds-map derives one row per
// `brands[].wmi[]` entry of the knowledge map (packages/uds-map/data/
// uds-map.json), refined by the marque overlay `../data/wmi-marques.json`
// for marques that live inside a group brand (the group brand routes
// diagnostics; the badge still wants the marque's own name and emblem
// key). Overlay rows the map does not route are emitted with `brand: null`
// (badge only). `pnpm wmi-table:check` fails CI when the table is stale.
//
// `confidence` and `source` are per row: overlay rows keep the strings from
// the original full-table audit (docs/workflows/3d-logos/wmi-audit.md —
// "high" = NHTSA-confirmed or strongly convergent across independent
// secondary sources, "medium-high"/"medium" = fewer or weaker sources,
// "low" = single-sourced); generated rows carry the map brand's confidence
// and name the map as their source.
//
// `key` doubles as the 3D-emblem selector in VehicleScene (a brand with
// modeled emblem geometry renders it; anything else renders a nameplate
// badge with `name`). `brand` is the map brand id that routes the WMI, so
// a consumer can tell "has a diagnostic profile" from "has a badge".

import rawWmi from "../data/wmi.json";

export type Confidence = "high" | "medium-high" | "medium" | "low";

export type BrandInfo = {
  key: string;
  name: string;
  confidence: Confidence;
  source: string;
  /** Knowledge-map brand id that routes this WMI; null/absent = badge only. */
  brand?: string | null;
};

const CONFIDENCE_VALUES: ReadonlySet<string> = new Set(["high", "medium-high", "medium", "low"]);

function isBrandInfo(value: unknown): value is BrandInfo {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.key === "string" &&
    v.key.length > 0 &&
    typeof v.name === "string" &&
    v.name.length > 0 &&
    typeof v.source === "string" &&
    typeof v.confidence === "string" &&
    CONFIDENCE_VALUES.has(v.confidence) &&
    (v.brand === undefined || v.brand === null || typeof v.brand === "string")
  );
}

// Parses the raw JSON import into a validated lookup table. Deliberately
// tolerant, not strict: a malformed or missing field on one row (a typo in
// a future hand-edit, a bad merge) drops just that row rather than
// crashing brand lookup for every car. Same fallback-friendly posture as
// an unrecognized WMI below — a wrong or missing badge is recoverable, a
// thrown exception during vehicle connect is not.
export function parseWmiTable(raw: unknown): Record<string, BrandInfo> {
  const out: Record<string, BrandInfo> = {};
  if (typeof raw !== "object" || raw === null) return out;
  for (const [wmiCode, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (isBrandInfo(entry)) {
      out[wmiCode.toUpperCase()] = entry;
    }
  }
  return out;
}

const WMI: Record<string, BrandInfo> = parseWmiTable(rawWmi);

export function brandFromVin(vin: string | null | undefined): BrandInfo | null {
  if (!vin || vin.length < 3) return null;
  return WMI[vin.slice(0, 3).toUpperCase()] ?? null;
}

/** Every distinct marque the WMI table can name — the badge list, in
 *  table order, de-duplicated by emblem key. Used for the "N brands
 *  recognised" line and the login screen's emblem carousel. */
export const RECOGNISED_BRANDS: readonly BrandInfo[] = (() => {
  const seen = new Set<string>();
  const out: BrandInfo[] = [];
  for (const info of Object.values(WMI)) {
    if (seen.has(info.key)) continue;
    seen.add(info.key);
    out.push(info);
  }
  return out;
})();
