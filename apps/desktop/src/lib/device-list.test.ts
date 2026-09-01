import { describe, expect, it } from "vitest";
import type { AdapterCandidate } from "@scainner/core";
import { deviceRows, gateScreen, preselectedDevice } from "./device-list";

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
