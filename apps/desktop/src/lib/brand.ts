
import rawWmi from "../data/wmi.json";
import modeledEmblems from "../data/modeled-emblems.json";

export type Confidence = "high" | "medium-high" | "medium" | "low";

export type BrandInfo = {
  key: string;
  name: string;
  confidence: Confidence;
  source: string;
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

const MODELED_EMBLEM_KEYS = modeledEmblems.keys;
const UNROUTED_EMBLEM_NAMES: Record<string, string> = modeledEmblems.unroutedNames;

export const MODELED_BRANDS: readonly BrandInfo[] = (() => {
  const byKey = new Map(RECOGNISED_BRANDS.map((b) => [b.key, b] as const));
  return MODELED_EMBLEM_KEYS.map(
    (key) =>
      byKey.get(key) ?? {
        key,
        name: UNROUTED_EMBLEM_NAMES[key] ?? key.toUpperCase(),
        confidence: "high" as const,
        source: "modeled emblem, no WMI routing",
        brand: null,
      },
  );
})();
