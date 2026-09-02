import { decodeDtc } from "@/lib/dtc";

export type DtcGroup = {
  system: string;
  codes: string[];
};

const OTHER_SYSTEM = "Other";

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

const LOW_VOLTAGE_THRESHOLD = 11.8;

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
