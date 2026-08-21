// Pure logic for the Diagnose view's code list: grouping a status's codes by
// system, and detecting the one clustering hint this app makes (low-voltage
// side effects). No React, no Tauri, no state — see docs/workflows/diagnose-ux
// for why this shape (plan.md) and what it replaces (research.md).
//
// Severity is deliberately GONE from this module (2026-08-21, owner call):
// the old worst-first ordering ranked codes by a hand-authored severity
// guess in the curated library — an editorial judgment the app cannot
// confirm (the OBD standard defines what codes MEAN, not how serious they
// are; seriousness depends on context a static table can't see — the live
// counter-example was an injector-circuit code labeled "grave" on a car
// running fine). The facts the car itself reports (stored/pending/
// permanent, MIL state) remain the only severity signals shown anywhere.
// Ordering is now neutral: code order within a group, alphabetical system
// order, "Other" last.
import { decodeDtc } from "@/lib/dtc";

export type DtcGroup = {
  system: string;
  codes: string[];
};

// Malformed codes (fail decodeDtc) get their own "Other" group rather than
// being dropped — a code this app can't classify is still a code the user
// asked about (plan.md's "honest absence" rule).
const OTHER_SYSTEM = "Other";

/** Groups a status's codes (stored/pending/permanent, one call per status)
 * by decodeDtc's system field. Codes sort neutrally (by code) within each
 * group; groups sort alphabetically, "Other" always last. */
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
    groups.push({ system, codes: [...groupCodes].sort() });
  }

  return groups.sort((a, b) => {
    if (a.system === OTHER_SYSTEM) return 1;
    if (b.system === OTHER_SYSTEM) return -1;
    return a.system.localeCompare(b.system);
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
