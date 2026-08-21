import { describe, expect, it } from "vitest";
import { detectVoltageCluster, groupBySystem } from "@/lib/dtc-grouping";

describe("groupBySystem", () => {
  it("groups a mixed-system code set by decodeDtc's system", () => {
    const groups = groupBySystem(["P0300", "C0035", "B0001", "U0100"]);
    // P0300 and U0100 are both "high" severity — a tie, broken by which
    // system appeared first in the input (stable sort), so Powertrain
    // (from P0300, first in the list) leads Network (from U0100, last).
    // C0035/B0001 aren't in DTC_LIBRARY, so Chassis/Body rank "unknown" last.
    expect(groups.map((g) => g.system)).toEqual([
      "Powertrain (engine, transmission, emissions)",
      "Network (module communication)",
      "Chassis (brakes, steering, suspension)",
      "Body (airbags, lighting, comfort)",
    ]);
  });

  it("sorts codes within a group by severity, worst first", () => {
    // P0128 low, P0335 high, P0505 medium — same Powertrain system
    const groups = groupBySystem(["P0128", "P0335", "P0505"]);
    expect(groups).toHaveLength(1);
    expect(groups[0].codes).toEqual(["P0335", "P0505", "P0128"]);
    expect(groups[0].worstSeverity).toBe("high");
  });

  it("puts a malformed code in its own Other group instead of dropping it", () => {
    const groups = groupBySystem(["P0300", "NOTACODE"]);
    const other = groups.find((g) => g.system === "Other");
    expect(other).toBeDefined();
    expect(other?.codes).toEqual(["NOTACODE"]);
  });

  it("always sorts Other last, regardless of severity ordering", () => {
    const groups = groupBySystem(["NOTACODE", "P0128"]); // P0128 is only "low"
    expect(groups[groups.length - 1]?.system).toBe("Other");
  });

  it("returns an empty array for no codes", () => {
    expect(groupBySystem([])).toEqual([]);
  });

  it("handles a large (86-code) mixed scan without special-casing", () => {
    const powertrain = ["P0300", "P0301", "P0302", "P0303", "P0171", "P0172", "P0420", "P0430"];
    const network = ["U0100", "U0121"];
    const synthetic = Array.from({ length: 86 }, (_, i) => {
      const pool = i % 5 === 0 ? network : powertrain;
      return pool[i % pool.length];
    });
    const groups = groupBySystem(synthetic);
    const total = groups.reduce((sum, g) => sum + g.codes.length, 0);
    expect(total).toBe(86);
    expect(groups.every((g) => g.codes.length > 0)).toBe(true);
  });
});

describe("detectVoltageCluster", () => {
  it("returns null when nothing qualifies", () => {
    expect(
      detectVoltageCluster({ stored: ["P0300"], pending: [], permanent: [], voltage: 14.0 })
    ).toBeNull();
  });

  it("triggers on voltage below the 11.8V threshold when a voltage-linked code is present", () => {
    const result = detectVoltageCluster({ stored: ["P0562", "P0300"], pending: [], permanent: [], voltage: 11.5 });
    expect(result).not.toBeNull();
    expect(result?.affected).toEqual(["P0562"]);
  });

  it("triggers on P0562 alone, regardless of voltage reading", () => {
    const result = detectVoltageCluster({ stored: ["P0562"], pending: [], permanent: [], voltage: 14.0 });
    expect(result).not.toBeNull();
    expect(result?.affected).toEqual(["P0562"]);
  });

  it("triggers on 2+ U-codes alongside other-system codes", () => {
    const result = detectVoltageCluster({
      stored: ["U0100", "U0121", "P0300"],
      pending: [],
      permanent: [],
      voltage: 14.0,
    });
    expect(result).not.toBeNull();
    expect(result?.affected.sort()).toEqual(["U0100", "U0121"]);
    expect(result?.note).toContain("2 of these 3 codes");
  });

  it("does not trigger on a single U-code alone", () => {
    expect(
      detectVoltageCluster({ stored: ["U0100", "P0300"], pending: [], permanent: [], voltage: 14.0 })
    ).toBeNull();
  });

  it("does not trigger on low voltage alone with no voltage-linked codes present", () => {
    expect(
      detectVoltageCluster({ stored: ["P0300"], pending: [], permanent: [], voltage: 11.0 })
    ).toBeNull();
  });

  it("treats a missing voltage reading as not-low, not as a trigger", () => {
    expect(
      detectVoltageCluster({ stored: ["P0300"], pending: [], permanent: [], voltage: null })
    ).toBeNull();
  });

  it("handles the synthetic 86-code low-voltage scan end to end", () => {
    const stored = ["P0562", "U0100", "U0121", ...Array.from({ length: 83 }, () => "P0300")];
    const result = detectVoltageCluster({ stored, pending: [], permanent: [], voltage: 11.2 });
    expect(result).not.toBeNull();
    expect(result?.affected.sort()).toEqual(["P0562", "U0100", "U0121"]);
    expect(result?.note).toContain("3 of these 86 codes");
  });
});
