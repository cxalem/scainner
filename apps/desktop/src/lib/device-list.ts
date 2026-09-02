// The connect gate's two derivations, kept pure so they can be read and
// tested without a renderer: which of the gate's screens is showing, and
// what the device list looks like.
//
// The naming and the serial-node ↔ paired-radio matching happen in Rust
// (elm/transport/enumerate.rs) so every client gets the same rows. What is
// left here is the fallback for a payload from an older backend that has
// none of the enriched fields yet.
import { PIN_REQUIRED, type AdapterCandidate, type DeviceKind, type NearbyDevice } from "@scainner/core";

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

/** A scan result, ready to render: one row per radio the scan found that is
 *  not already in the list. */
export type NearbyRow = {
  /** Dashed MAC — the id, and the label when the radio has no name. */
  addr: string;
  /** The vendor's friendly name, null when the radio answered without one. */
  name: string | null;
  /** What to show: the name wherever there is one, else the address. */
  label: string;
};

/** The Nearby group's rows. The backend already drops what it knows to be
 *  paired, but the device list is enumerated separately and can be newer —
 *  so anything with a row here is dropped again rather than offered a
 *  second Pair button. Addresses are compared case-insensitively; the first
 *  sighting of a repeated address wins. */
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

/** What the PIN field opens on, on the rare occasion a radio asks for one.
 *  Almost every OBD dongle that still wants a code ships with 1234, so that
 *  is the default — unless the profile already remembers one that worked,
 *  which is the better guess for a second dongle from the same box. */
export const DEFAULT_PIN = "1234";

export function defaultPin(saved?: string | null): string {
  return saved?.trim() || DEFAULT_PIN;
}

/** Where a scan has got to, as the card needs to read it. */
export type ScanState = {
  scanning: boolean;
  /** A scan has finished at least once since the list was last refreshed. */
  scanned: boolean;
  error: string | null;
  /** How many nearby radios the last scan left on screen. */
  found: number;
};

/** The one line the scan owns, in the same place throughout: the spinner
 *  while the inquiry is out, then whatever it came back with. `none` before
 *  the user has ever asked for a scan. */
export type ScanRow = "scanning" | "error" | "empty" | "none";

export function scanRow(scan: ScanState): ScanRow {
  if (scan.scanning) return "scanning";
  if (scan.error) return "error";
  if (!scan.scanned) return "none";
  return scan.found === 0 ? "empty" : "none";
}

/** The card's groups, top to bottom. Nearby goes above the paired rows for
 *  as long as the scan is the thing the user just asked for — the results
 *  have to be where the eye already is, not under a list that may be taller
 *  than the card. Before any scan, the screen is exactly what it was. */
export type ListSection = "nearby" | "paired";

export function listSections(scan: ScanState): ListSection[] {
  const showNearby = scan.scanning || scan.scanned || scan.found > 0;
  return showNearby ? ["nearby", "paired"] : ["paired"];
}

/** Did the radio ask for a PIN? The backend answers a pairing attempt that
 *  carried no PIN with the `pin_required` marker (409 over HTTP, an error
 *  string over Tauri) when — and only when — the device itself asked for a
 *  code. That is the one failure the card can act on: reveal the field and
 *  retry. Everything else is the user's to fix. */
export function isPinRequired(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return new RegExp(`\\b${PIN_REQUIRED}\\b`).test(message);
}

/** The row the gate starts on: the one the profile points at, else the
 *  first device that can actually be opened. Null when none can. */
export function preselectedDevice(rows: readonly DeviceRow[]): string | null {
  const remembered = rows.find((row) => row.lastUsed && row.selectable);
  return (remembered ?? rows.find((row) => row.selectable))?.id ?? null;
}

export type GateScreen = "choose_device" | "connecting" | "connected";

/** Which screen the gate shows. `starting` covers the gap between the
 *  Connect click and the backend's first "connecting" status.
 *
 *  There is no `failed` screen (Brief M, 2026-09-02): a failed attempt puts
 *  the user straight back on the device list with the device they tried
 *  still selected, and says what went wrong in a toast over the top, so the
 *  layout does not move under the pointer at the moment they reach for the
 *  next button. */
export function gateScreen(input: { state: string; starting: boolean }): GateScreen {
  if (input.state === "connected") return "connected";
  if (input.state === "connecting" || input.starting) return "connecting";
  return "choose_device";
}

/** What a failed attempt says to the person holding the dongle. The
 *  backend's `reason` is a transport error ("open /dev/cu.X: Resource busy
 *  (os error 16)") — true, in the log, and useless on screen — so the stage
 *  picks the sentence and the reason only decides whether there is a second
 *  line worth acting on.
 *
 *  Keys, not copy: the strings live in i18n. */
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
      // The two open failures a user can do something about: the port is
      // held by something else, or the radio never woke up. Anything else
      // gets the headline alone rather than a guess.
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
