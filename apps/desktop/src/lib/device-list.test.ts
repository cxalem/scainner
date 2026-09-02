import { describe, expect, it } from "vitest";
import type { AdapterCandidate, NearbyDevice } from "@scainner/core";
import {
  DEFAULT_PIN,
  defaultPin,
  deviceRows,
  deviceScrollColumnClass,
  gateScreen,
  isPinRequired,
  listSections,
  nearbyRows,
  preselectedDevice,
  scanRow,
  stageMessage,
  type ScanState,
} from "./device-list";

const candidate = (fields: Partial<AdapterCandidate> & { id: string; name: string }) =>
  ({
    kind: "serial",
    likely_obd: true,
    connected: null,
    ...fields,
  }) as AdapterCandidate;

describe("deviceRows", () => {
  it("uses the enriched fields the backend sends", () => {
    const [row] = deviceRows([
      candidate({
        id: "/dev/cu.OBDLinkMX49489",
        name: "cu.OBDLinkMX49489",
        display_name: "OBDLink MX+ 49489",
        device_kind: "bluetooth_serial",
        path: "/dev/cu.OBDLinkMX49489",
        bt_addr: "aa-bb-cc-dd-ee-01",
        last_used: true,
      }),
    ]);
    expect(row).toMatchObject({
      name: "OBDLink MX+ 49489",
      kind: "bluetooth_serial",
      path: "/dev/cu.OBDLinkMX49489",
      btAddr: "aa-bb-cc-dd-ee-01",
      lastUsed: true,
      selectable: true,
    });
  });

  it("leaves a paired device with no port unselectable", () => {
    const [row] = deviceRows([
      candidate({
        kind: "bluetooth",
        id: "aa-bb-cc-dd-ee-02",
        name: "Dongle",
        display_name: "Dongle",
        device_kind: "paired_only",
        path: null,
        bt_addr: "aa-bb-cc-dd-ee-02",
      }),
    ]);
    expect(row).toMatchObject({ kind: "paired_only", path: null, selectable: false });
  });

  it("falls back to the old payload shape when the enriched fields are absent", () => {
    const rows = deviceRows([
      candidate({ id: "/dev/cu.usbserial-1410", name: "cu.usbserial-1410" }),
      candidate({ kind: "bluetooth", id: "aa-bb-cc-dd-ee-03", name: "Paired thing", connected: false }),
    ]);
    expect(rows[0]).toMatchObject({
      name: "usbserial-1410",
      kind: "usb_serial",
      path: "/dev/cu.usbserial-1410",
      btAddr: null,
      lastUsed: false,
      selectable: true,
    });
    expect(rows[1]).toMatchObject({
      kind: "paired_only",
      path: null,
      btAddr: "aa-bb-cc-dd-ee-03",
      selectable: false,
    });
  });
});

describe("preselectedDevice", () => {
  const rows = deviceRows([
    candidate({ id: "/dev/cu.first", name: "cu.first", path: "/dev/cu.first", device_kind: "usb_serial" }),
    candidate({
      id: "/dev/cu.second",
      name: "cu.second",
      path: "/dev/cu.second",
      device_kind: "usb_serial",
      last_used: true,
    }),
  ]);

  it("prefers the remembered device", () => {
    expect(preselectedDevice(rows)).toBe("/dev/cu.second");
  });

  it("falls back to the first device that can be opened", () => {
    expect(preselectedDevice(rows.slice(0, 1))).toBe("/dev/cu.first");
  });

  it("selects nothing when no row has a port", () => {
    const pairedOnly = deviceRows([
      candidate({ kind: "bluetooth", id: "aa-bb", name: "Radio", device_kind: "paired_only", path: null }),
    ]);
    expect(preselectedDevice(pairedOnly)).toBeNull();
  });
});

describe("nearbyRows", () => {
  const nearby = (fields: Partial<NearbyDevice> & { addr: string }) =>
    ({ name: null, paired: false, ...fields }) as NearbyDevice;

  it("labels a named radio by its name and an unnamed one by its address", () => {
    expect(
      nearbyRows([nearby({ addr: "aa-bb-cc-dd-ee-11", name: "OBD Reader 4821" }), nearby({ addr: "aa-bb-cc-dd-ee-12" })], []),
    ).toEqual([
      { addr: "aa-bb-cc-dd-ee-11", name: "OBD Reader 4821", label: "OBD Reader 4821" },
      { addr: "aa-bb-cc-dd-ee-12", name: null, label: "aa-bb-cc-dd-ee-12" },
    ]);
  });

  it("treats a blank name as no name", () => {
    expect(nearbyRows([nearby({ addr: "aa-bb", name: "  " })], [])[0]).toMatchObject({
      name: null,
      label: "aa-bb",
    });
  });

  it("drops a radio that is already a device row, whatever the case", () => {
    const rows = deviceRows([
      candidate({
        kind: "bluetooth",
        id: "AA-BB-CC-DD-EE-01",
        name: "Known",
        device_kind: "paired_only",
        path: null,
        bt_addr: "AA-BB-CC-DD-EE-01",
      }),
    ]);
    expect(nearbyRows([nearby({ addr: "aa-bb-cc-dd-ee-01", name: "Known" })], rows)).toEqual([]);
  });

  it("drops a radio the scan itself reported as paired", () => {
    expect(nearbyRows([nearby({ addr: "aa-bb-cc-dd-ee-13", name: "Headphones", paired: true })], [])).toEqual([]);
  });

  it("keeps the first sighting of a repeated address", () => {
    expect(
      nearbyRows(
        [nearby({ addr: "aa-bb-cc-dd-ee-14", name: "First" }), nearby({ addr: "AA-BB-CC-DD-EE-14", name: "Second" })],
        [],
      ),
    ).toEqual([{ addr: "aa-bb-cc-dd-ee-14", name: "First", label: "First" }]);
  });

  it("lowercases the address it hands to the pair call", () => {
    expect(nearbyRows([nearby({ addr: "AA-BB-CC-DD-EE-15" })], [])[0].addr).toBe("aa-bb-cc-dd-ee-15");
  });
});

describe("defaultPin", () => {
  it("opens on 1234 when the profile remembers nothing", () => {
    expect(defaultPin(undefined)).toBe(DEFAULT_PIN);
    expect(defaultPin(null)).toBe(DEFAULT_PIN);
    expect(defaultPin("   ")).toBe(DEFAULT_PIN);
  });

  it("prefers a PIN the profile already remembers", () => {
    expect(defaultPin("0000")).toBe("0000");
  });
});

describe("scanRow", () => {
  const idle: ScanState = { scanning: false, scanned: false, error: null, found: 0 };

  it("says nothing before the user has asked for a scan", () => {
    expect(scanRow(idle)).toBe("none");
  });

  it("is the spinner for as long as the inquiry is out", () => {
    expect(scanRow({ ...idle, scanning: true })).toBe("scanning");
    expect(scanRow({ ...idle, scanning: true, scanned: true, found: 2 })).toBe("scanning");
  });

  it("replaces the spinner in the same place when nothing was found", () => {
    expect(scanRow({ ...idle, scanned: true })).toBe("empty");
  });

  it("steps aside once there are rows to read instead", () => {
    expect(scanRow({ ...idle, scanned: true, found: 2 })).toBe("none");
  });

  it("reports a scan that could not run at all", () => {
    expect(scanRow({ ...idle, scanned: true, error: "no Bluetooth here" })).toBe("error");
  });
});

describe("listSections", () => {
  const idle: ScanState = { scanning: false, scanned: false, error: null, found: 0 };

  it("shows the paired rows alone until a scan is asked for", () => {
    expect(listSections(idle)).toEqual(["paired"]);
  });

  it("puts Nearby above the paired rows the moment the scan starts", () => {
    expect(listSections({ ...idle, scanning: true })).toEqual(["nearby", "paired"]);
  });

  it("has the group open and the spinner inside it on the click's own frame", () => {
    // Nothing has come back yet — not the scan, not a result. Both halves of
    // what the user must see are decided from this one state.
    const firstFrame: ScanState = { ...idle, scanning: true };
    expect(listSections(firstFrame)[0]).toBe("nearby");
    expect(scanRow(firstFrame)).toBe("scanning");
  });

  it("keeps Nearby on top while its results are on screen", () => {
    expect(listSections({ ...idle, scanned: true, found: 2 })).toEqual(["nearby", "paired"]);
    expect(listSections({ ...idle, scanned: true })).toEqual(["nearby", "paired"]);
  });
});

describe("isPinRequired", () => {
  it("recognises the marker the backend sends when the radio asked for a code", () => {
    expect(isPinRequired(new Error("pair_adapter failed: pin_required: Type pin code for …"))).toBe(true);
    expect(isPinRequired("pin_required")).toBe(true);
  });

  it("leaves every other failure to the user", () => {
    expect(isPinRequired(new Error("pair_adapter failed: pairing aa-bb failed: Page Timeout"))).toBe(false);
    expect(isPinRequired(new Error("manual pairing required: …"))).toBe(false);
    // Nothing here asks for anything: a device whose name happens to
    // contain the word must not open a PIN field.
    expect(isPinRequired(new Error('pairing failed for "pin_required_device"'))).toBe(false);
  });
});

describe("gateScreen", () => {
  const base = { state: "disconnected", starting: false };

  it("starts on the device list", () => {
    expect(gateScreen(base)).toBe("choose_device");
  });

  it("shows the stages while an attempt runs, including before the backend answers", () => {
    expect(gateScreen({ ...base, state: "connecting" })).toBe("connecting");
    expect(gateScreen({ ...base, starting: true })).toBe("connecting");
  });

  it("drops a finished attempt back on the device list — a failure has no screen", () => {
    expect(gateScreen({ state: "disconnected", starting: false })).toBe("choose_device");
  });

  it("connected wins over everything", () => {
    expect(gateScreen({ state: "connected", starting: true })).toBe("connected");
  });
});

describe("stageMessage", () => {
  it("names the stage in words the driver can act on", () => {
    expect(stageMessage("link", "no route to host")).toEqual({ message: "link", hint: "link" });
    expect(stageMessage("handshake", "no ELM banner")).toEqual({
      message: "handshake",
      hint: "handshake",
    });
    expect(stageMessage("bus", "NO DATA")).toEqual({ message: "bus", hint: "bus" });
  });

  it("reads the two open failures that have an answer out of the reason", () => {
    expect(stageMessage("open", "open /dev/cu.X: Resource busy (os error 16)")).toEqual({
      message: "open",
      hint: "openBusy",
    });
    expect(stageMessage("open", "Operation timed out (os error 60)")).toEqual({
      message: "open",
      hint: "openTimeout",
    });
  });

  it("gives the headline alone when the open reason says nothing useful", () => {
    expect(stageMessage("open", "permission denied")).toEqual({ message: "open", hint: null });
  });

  it("falls back to one plain sentence for a stage it does not know", () => {
    expect(stageMessage("teleport", "Resource busy")).toEqual({ message: "unknown", hint: null });
    expect(stageMessage("", "")).toEqual({ message: "unknown", hint: null });
  });

  it("never leaks the transport error into the copy it picks", () => {
    const { message, hint } = stageMessage("open", "open /dev/cu.OBDII: Resource busy (os error 16)");
    expect(message).toBe("open");
    expect(hint).toBe("openBusy");
  });
});

describe("deviceScrollColumnClass", () => {
  it("opts the column out of scroll anchoring, so the Nearby group opens in view", () => {
    expect(deviceScrollColumnClass).toContain("[overflow-anchor:none]");
  });

  it("stays the card's only scroll container", () => {
    expect(deviceScrollColumnClass).toContain("overflow-y-auto");
  });
});
