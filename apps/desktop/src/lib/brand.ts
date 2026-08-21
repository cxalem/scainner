// VIN → manufacturer, from the WMI (World Manufacturer Identifier — the
// VIN's first three characters, ISO 3780). This is a deliberately small,
// curated table of common European/global passenger-car WMIs, not an
// attempt at completeness: the UI needs a brand identity for the connected
// car, and an unknown WMI simply falls back to a generic badge. Add rows
// as unrecognized cars show up — `brandFromVin` logs nothing and never
// throws.
//
// The table itself lives in `../data/wmi.json`, not inline here — this
// file is a thin, validated lookup over that data (see docs/workflows/
// car-data/plan.md). Each entry carries a `confidence` and `source` field
// produced by the full-table audit (docs/workflows/3d-logos/wmi-audit.md):
// "high" = NHTSA-confirmed directly (or an obvious sibling of one), "medium
// -high"/"medium" = corroborated by two or more independent secondary
// sources but not in NHTSA's registry (typical for non-US-market brands
// and export-only plant codes), "low" = single-sourced or genuinely
// unconfirmed. Nothing below medium confidence is currently in the table —
// entries the audit flagged as wrong or unresolved (JSA, JMZ, VXK) were
// already removed or swapped for a confirmed alternative.
//
// `key` doubles as the 3D-emblem selector in VehicleScene (a brand with
// modeled emblem geometry renders it; anything else renders a nameplate
// badge with `name`).

import rawWmi from "../data/wmi.json";

export type Confidence = "high" | "medium-high" | "medium" | "low";

export type BrandInfo = {
  key: string;
  name: string;
  confidence: Confidence;
  source: string;
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
    CONFIDENCE_VALUES.has(v.confidence)
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
