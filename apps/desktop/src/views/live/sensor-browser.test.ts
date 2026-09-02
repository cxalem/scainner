import { describe, expect, it } from "vitest";
import type { ReadingKey } from "@scainner/core";
import { buildSensorGroups, flattenKeys, isInRange, stepKey, type GroupOptions } from "@/views/live/sensor-browser";

const NOW = Date.parse("2026-08-19T08:00:00Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString().replace("T", " ").slice(0, 19);

function key(over: Partial<ReadingKey> & { key: string }): ReadingKey {
  return {
    label: null,
    unit: null,
    module_key: null,
    module_name: null,
    source: "standard",
    probe_id: null,
    last_ts: minutesAgo(5),
    ...over,
  } as ReadingKey;
}

const options = (over: Partial<GroupOptions> = {}): GroupOptions => ({
  query: "",
  rangeHours: 24,
  now: NOW,
  showAll: false,
  labelOf: (entry) => entry.label ?? entry.key,
  unitOf: (entry) => entry.unit ?? "",
  standardGroupName: "Standard",
  ...over,
});

const KEYS: ReadingKey[] = [
  key({ key: "voltage" }),
  key({ key: "coolant", last_ts: minutesAgo(60 * 24 * 9) }),
  key({ key: "uds_wheel_speed_fl", label: "Wheel speed FL", unit: "km/h", module_key: "6a8_688", module_name: "ABS / ESP", source: "probe", probe_id: 1 }),
  key({ key: "uds_brake_vacuum", label: "Brake vacuum", unit: "mbar", module_key: "6a8_688", module_name: "ABS / ESP", source: "probe", probe_id: 2, last_ts: minutesAgo(60 * 24 * 30) }),
  key({ key: "uds_steering_angle", label: "Steering angle", unit: "°", module_key: "6ad_68d", module_name: "EPS", source: "probe", probe_id: 3 }),
];

describe("isInRange", () => {
  it("counts a key whose newest reading falls inside the window", () => {
    expect(isInRange(minutesAgo(30), 1, NOW)).toBe(true);
    expect(isInRange(minutesAgo(90), 1, NOW)).toBe(false);
  });

  it("treats a missing or unparseable timestamp as no data", () => {
    expect(isInRange(null, 24, NOW)).toBe(false);
    expect(isInRange("not a timestamp", 24, NOW)).toBe(false);
  });
});

describe("buildSensorGroups", () => {
  it("puts the standard group first, then modules alphabetically", () => {
    const { groups } = buildSensorGroups(KEYS, options({ showAll: true }));
    expect(groups.map((g) => g.name)).toEqual(["Standard", "ABS / ESP", "EPS"]);
  });

  it("sorts keys with data in the range first, then by label", () => {
    const { groups } = buildSensorGroups(KEYS, options({ showAll: true }));
    const abs = groups.find((g) => g.name === "ABS / ESP")!;
    expect(abs.rows.map((r) => r.key)).toEqual(["uds_wheel_speed_fl", "uds_brake_vacuum"]);
    expect(abs.rows[0].inRange).toBe(true);
    expect(abs.rows[1].inRange).toBe(false);
  });

  it("hides keys with no data in the range and counts them", () => {
    const { groups, hiddenCount } = buildSensorGroups(KEYS, options());
    expect(hiddenCount).toBe(2);
    expect(groups.flatMap((g) => g.rows.map((r) => r.key))).toEqual(["voltage", "uds_wheel_speed_fl", "uds_steering_angle"]);
    expect(groups.find((g) => g.name === "ABS / ESP")!.total).toBe(2);
  });

  it("keeps the selected key visible even with no data in the range", () => {
    const { groups } = buildSensorGroups(KEYS, options({ keepKey: "coolant" }));
    expect(groups[0].rows.map((r) => r.key)).toEqual(["voltage", "coolant"]);
  });

  it("searches label, key and module name, case-insensitively", () => {
    const byLabel = buildSensorGroups(KEYS, options({ showAll: true, query: "WHEEL" }));
    expect(byLabel.groups.flatMap((g) => g.rows.map((r) => r.key))).toEqual(["uds_wheel_speed_fl"]);

    const byModule = buildSensorGroups(KEYS, options({ showAll: true, query: "esp" }));
    expect(byModule.groups.map((g) => g.name)).toEqual(["ABS / ESP"]);
    expect(byModule.groups[0].rows).toHaveLength(2);

    const byKey = buildSensorGroups(KEYS, options({ showAll: true, query: "uds_steering" }));
    expect(byKey.groups.flatMap((g) => g.rows.map((r) => r.key))).toEqual(["uds_steering_angle"]);

    expect(buildSensorGroups(KEYS, options({ showAll: true, query: "nothing here" })).groups).toEqual([]);
  });

  it("falls back to the module key when the module has no name", () => {
    const unnamed = [key({ key: "uds_x", label: "X", module_key: "7e0_7e8", source: "probe", probe_id: 9 })];
    const { groups } = buildSensorGroups(unnamed, options({ showAll: true }));
    expect(groups.map((g) => g.name)).toEqual(["7e0_7e8"]);
  });
});

describe("keyboard walking", () => {
  it("skips the rows of a collapsed group", () => {
    const { groups } = buildSensorGroups(KEYS, options({ showAll: true }));
    expect(flattenKeys(groups, new Set(["ABS / ESP"]))).toEqual(["voltage", "coolant", "uds_steering_angle"]);
  });

  it("moves one row at a time and stops at both ends", () => {
    const keys = ["a", "b", "c"];
    expect(stepKey(keys, "a", 1)).toBe("b");
    expect(stepKey(keys, "b", -1)).toBe("a");
    expect(stepKey(keys, "a", -1)).toBeNull();
    expect(stepKey(keys, "c", 1)).toBeNull();
    expect(stepKey(keys, "missing", 1)).toBe("a");
    expect(stepKey([], "a", 1)).toBeNull();
  });
});
