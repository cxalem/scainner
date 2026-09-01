// The connect gate's two derivations, kept pure so they can be read and
// tested without a renderer: which of the gate's screens is showing, and
// what the device list looks like.
//
// The naming and the serial-node ↔ paired-radio matching happen in Rust
// (elm/transport/enumerate.rs) so every client gets the same rows. What is
// left here is the fallback for a payload from an older backend that has
// none of the enriched fields yet.
import type { AdapterCandidate, DeviceKind } from "@scainner/core";

export type DeviceRow = {
  /** The candidate's id: a `/dev` path, or a MAC for a paired-only row. */
  id: string;
  /** The readable name — a vendor's friendly name wherever there is one. */
  name: string;
  kind: DeviceKind;
  /** The serial node to open; null while the OS has not exposed one. */
  path: string | null;
  /** The radio to bring up before opening `path`, when it is known. */
  btAddr: string | null;
  /** This is the device the saved profile points at. */
  lastUsed: boolean;
  /** A row with no port cannot be connected to — only paired by hand. */
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

/** The row the gate starts on: the one the profile points at, else the
 *  first device that can actually be opened. Null when none can. */
export function preselectedDevice(rows: readonly DeviceRow[]): string | null {
  const remembered = rows.find((row) => row.lastUsed && row.selectable);
  return (remembered ?? rows.find((row) => row.selectable))?.id ?? null;
}

export type GateScreen = "choose_device" | "connecting" | "failed" | "connected";

/** Which screen the gate shows. `starting` covers the gap between the
 *  Connect click and the backend's first "connecting" status; `choosing`
 *  is the user stepping back from a failure to the device list. */
export function gateScreen(input: {
  state: string;
  failed: boolean;
  starting: boolean;
  choosing: boolean;
}): GateScreen {
  if (input.state === "connected") return "connected";
  if (input.state === "connecting" || input.starting) return "connecting";
  if (input.failed && !input.choosing) return "failed";
  return "choose_device";
}
