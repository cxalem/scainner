// Pure logic for the Diagnose view's code list: grouping a status's codes by
// system, and detecting the one clustering hint this app makes (low-voltage
// side effects). No React, no Tauri, no state — see docs/workflows/diagnose-ux
// for why this shape (plan.md) and what it replaces (research.md).
import { decodeDtc, dtcInfo, type DtcInfo } from "@/lib/dtc";

export type DtcGroup = {
  system: string;
  codes: string[];
  worstSeverity: DtcInfo["severity"] | "unknown";
};

const SEVERITY_RANK: Record<DtcInfo["severity"] | "unknown", number> = {
  high: 0,
  medium: 1,
  low: 2,
  unknown: 3,
};

// Malformed codes (fail decodeDtc) get their own "Other" group rather than
// being dropped — a code this app can't classify is still a code the user
// asked about (plan.md's "honest absence" rule).
const OTHER_SYSTEM = "Other";

function severityOf(code: string): DtcInfo["severity"] | "unknown" {
  return dtcInfo(code)?.severity ?? "unknown";
}

/** Groups a status's codes (stored/pending/permanent, one call per status)
 * by decodeDtc's system field, sorted by severity (worst first) within each
 * group. Group order: worst-present-severity first, "Other" always last. */
export function groupBySystem(codes: string[]): DtcGroup[] {
  const bySystem = new Map<string, string[]>();
  for (const code of codes) {
    const system = decodeDtc(code)?.system ?? OTHER_SYSTEM;
    const list = bySystem.get(system);
    if (list) list.push(code);
    else bySystem.set(system, [code]);
  }

  const groups: DtcGroup[] = [];
  for (const [system, groupCodes] of bySystem) {
    const sorted = [...groupCodes].sort((a, b) => SEVERITY_RANK[severityOf(a)] - SEVERITY_RANK[severityOf(b)]);
    const worstSeverity = sorted.reduce<DtcInfo["severity"] | "unknown">(
      (worst, code) => (SEVERITY_RANK[severityOf(code)] < SEVERITY_RANK[worst] ? severityOf(code) : worst),
      "unknown"
    );
    groups.push({ system, codes: sorted, worstSeverity });
  }

  return groups.sort((a, b) => {
    if (a.system === OTHER_SYSTEM) return 1;
    if (b.system === OTHER_SYSTEM) return -1;
    return SEVERITY_RANK[a.worstSeverity] - SEVERITY_RANK[b.worstSeverity];
  });
}

export type VoltageCluster = {
  affected: string[];
  note: string;
};

// Matches the existing Wave 2 "voltage low while running" alert threshold
// used elsewhere in this app — not a new number invented for this feature.
const LOW_VOLTAGE_THRESHOLD = 11.8;

/** Deliberately simple v1 heuristic (plan.md): flags codes that have a real,
 * direct mechanism connecting them to low system voltage — network (U-)
 * codes and P0562/P0563 — rather than guessing at every code that might be
 * affected. Returns null when nothing qualifies, so the caller renders
 * nothing rather than an empty banner. */
export function detectVoltageCluster(scan: {
  stored: readonly string[];
  pending: readonly string[];
  permanent: readonly string[];
  voltage?: number | null;
}): VoltageCluster | null {
  const allCodes = [...scan.stored, ...scan.pending, ...scan.permanent];
  const uCodes = allCodes.filter((code) => code.toUpperCase().startsWith("U"));
  const voltageCodes = allCodes.filter((code) => code.toUpperCase() === "P0562" || code.toUpperCase() === "P0563");

  const voltageLow = scan.voltage != null && scan.voltage < LOW_VOLTAGE_THRESHOLD;
  const hasVoltageCode = voltageCodes.length > 0;
  const multipleUCodesWithOthers = uCodes.length >= 2 && allCodes.length > uCodes.length;

  if (!voltageLow && !hasVoltageCode && !multipleUCodesWithOthers) return null;

  const affected = [...new Set([...uCodes, ...voltageCodes])];
  if (affected.length === 0) return null;

  return {
    affected,
    note: `${affected.length} of these ${allCodes.length} codes are commonly a side effect of low battery voltage or a weak charging system, not independent faults.`,
  };
}
