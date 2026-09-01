import { describe, expect, it } from "vitest";
import type { AdapterCandidate, NearbyDevice } from "@scainner/core";
import {
  DEFAULT_PIN,
  defaultPin,
  deviceRows,
  gateScreen,
  nearbyRows,
  preselectedDevice,
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

describe("gateScreen", () => {
  const base = { state: "disconnected", failed: false, starting: false, choosing: false };

  it("starts on the device list", () => {
    expect(gateScreen(base)).toBe("choose_device");
  });

  it("shows the stages while an attempt runs, including before the backend answers", () => {
    expect(gateScreen({ ...base, state: "connecting" })).toBe("connecting");
    expect(gateScreen({ ...base, starting: true })).toBe("connecting");
  });

  it("shows the failure until the user asks for the list again", () => {
    expect(gateScreen({ ...base, failed: true })).toBe("failed");
    expect(gateScreen({ ...base, failed: true, choosing: true })).toBe("choose_device");
  });

  it("a running attempt outranks a previous failure", () => {
    expect(gateScreen({ ...base, failed: true, starting: true })).toBe("connecting");
  });

  it("connected wins over everything", () => {
    expect(gateScreen({ ...base, state: "connected", failed: true, starting: true })).toBe("connected");
  });
});
