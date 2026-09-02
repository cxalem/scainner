import { PIN_REQUIRED, type AdapterCandidate, type DeviceKind, type NearbyDevice } from "@scainner/core";

export type DeviceRow = {
  id: string;
  name: string;
  kind: DeviceKind;
  path: string | null;
  btAddr: string | null;
  lastUsed: boolean;
  selectable: boolean;
};

const stripNodePrefix = (name: string) => name.replace(/^(cu|tty)\./, "");

export function deviceRows(candidates: readonly AdapterCandidate[]): DeviceRow[] {
  return candidates.map((candidate) => {
    const path = candidate.path ?? (candidate.kind === "serial" ? candidate.id : null);
    const kind: DeviceKind =
      candidate.device_kind ?? (candidate.kind === "bluetooth" ? "paired_only" : "usb_serial");
    return {
      id: candidate.id,
      name: candidate.display_name ?? stripNodePrefix(candidate.name),
      kind,
      path,
      btAddr: candidate.bt_addr ?? (candidate.kind === "bluetooth" ? candidate.id : null),
      lastUsed: candidate.last_used ?? false,
      selectable: kind !== "paired_only" && path != null,
    };
  });
}

export type NearbyRow = {
  addr: string;
  name: string | null;
  label: string;
};

export function nearbyRows(
  found: readonly NearbyDevice[],
  rows: readonly DeviceRow[],
): NearbyRow[] {
  const known = new Set(
    rows.map((row) => row.btAddr?.toLowerCase()).filter((addr): addr is string => addr != null),
  );
  const seen = new Set<string>();
  const out: NearbyRow[] = [];
  for (const device of found) {
    const addr = device.addr.toLowerCase();
    if (device.paired || known.has(addr) || seen.has(addr)) continue;
    seen.add(addr);
    const name = device.name?.trim() || null;
    out.push({ addr, name, label: name ?? addr });
  }
  return out;
}

export const DEFAULT_PIN = "1234";

export function defaultPin(saved?: string | null): string {
  return saved?.trim() || DEFAULT_PIN;
}

export type ScanState = {
  scanning: boolean;
  scanned: boolean;
  error: string | null;
  found: number;
};

export type ScanRow = "scanning" | "error" | "empty" | "none";

export function scanRow(scan: ScanState): ScanRow {
  if (scan.scanning) return "scanning";
  if (scan.error) return "error";
  if (!scan.scanned) return "none";
  return scan.found === 0 ? "empty" : "none";
}

export type ListSection = "nearby" | "paired";

export function listSections(scan: ScanState): ListSection[] {
  const showNearby = scan.scanning || scan.scanned || scan.found > 0;
  return showNearby ? ["nearby", "paired"] : ["paired"];
}

export const deviceScrollColumnClass =
  "flex flex-1 flex-col overflow-y-auto p-3 [overflow-anchor:none]";

export function isPinRequired(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return new RegExp(`\\b${PIN_REQUIRED}\\b`).test(message);
}

export function preselectedDevice(rows: readonly DeviceRow[]): string | null {
  const remembered = rows.find((row) => row.lastUsed && row.selectable);
  return (remembered ?? rows.find((row) => row.selectable))?.id ?? null;
}

export type GateScreen = "choose_device" | "connecting" | "connected";

export function gateScreen(input: { state: string; starting: boolean }): GateScreen {
  if (input.state === "connected") return "connected";
  if (input.state === "connecting" || input.starting) return "connecting";
  return "choose_device";
}

export type FailureMessage = "link" | "open" | "handshake" | "bus" | "unknown";
export type FailureHint = "link" | "openBusy" | "openTimeout" | "handshake" | "bus";

export function stageMessage(
  stage: string,
  reason: string,
): { message: FailureMessage; hint: FailureHint | null } {
  const said = reason.toLowerCase();
  switch (stage) {
    case "link":
      return { message: "link", hint: "link" };
    case "open":
      return {
        message: "open",
        hint: /busy|os error 16/.test(said)
          ? "openBusy"
          : /timed out|timeout/.test(said)
            ? "openTimeout"
            : null,
      };
    case "handshake":
      return { message: "handshake", hint: "handshake" };
    case "bus":
      return { message: "bus", hint: "bus" };
    default:
      return { message: "unknown", hint: null };
  }
}
