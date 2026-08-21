import { describe, expect, it } from "vitest";
import { brandFromVin, parseWmiTable, type BrandInfo } from "./brand";

describe("brandFromVin", () => {
  it("resolves high-confidence WMI codes to the correct brand", () => {
    expect(brandFromVin("WBAAA1234567890")).toEqual(
      expect.objectContaining({ key: "bmw", name: "BMW", confidence: "high" }),
    );
    expect(brandFromVin("VF1AAAAA000000000")).toEqual(
      expect.objectContaining({ key: "renault", name: "RENAULT", confidence: "high" }),
    );
    expect(brandFromVin("5YJSA1E2XNF000000")).toEqual(
      expect.objectContaining({ key: "tesla", name: "TESLA", confidence: "high" }),
    );
  });

  it("resolves medium-confidence WMI codes to the correct brand", () => {
    expect(brandFromVin("VR7AAAAA000000000")).toEqual(
      expect.objectContaining({ key: "citroen", name: "CITROËN", confidence: "medium" }),
    );
    expect(brandFromVin("XP7AAAAA000000000")).toEqual(
      expect.objectContaining({ key: "tesla", name: "TESLA", confidence: "medium" }),
    );
    expect(brandFromVin("SJNAAAAA000000000")).toEqual(
      expect.objectContaining({ key: "nissan", name: "NISSAN", confidence: "medium" }),
    );
  });

  it("resolves the audit's newly-added WMI codes (SJK, SHS, LVY, 7G2, 7SA, WA1)", () => {
    expect(brandFromVin("SJKAAAAA000000000")).toEqual(
      expect.objectContaining({ key: "nissan", name: "NISSAN" }),
    );
    expect(brandFromVin("SHSAAAAA000000000")).toEqual(
      expect.objectContaining({ key: "honda", name: "HONDA", confidence: "high" }),
    );
    expect(brandFromVin("LVYAAAAA000000000")).toEqual(
      expect.objectContaining({ key: "volvo", name: "VOLVO", confidence: "high" }),
    );
    expect(brandFromVin("7G2AAAAA000000000")).toEqual(
      expect.objectContaining({ key: "tesla", name: "TESLA", confidence: "high" }),
    );
    expect(brandFromVin("7SAAAAAA000000000")).toEqual(
      expect.objectContaining({ key: "tesla", name: "TESLA", confidence: "high" }),
    );
    expect(brandFromVin("WA1AAAAA000000000")).toEqual(
      expect.objectContaining({ key: "audi", name: "AUDI", confidence: "high" }),
    );
  });

  it("is case-insensitive on the WMI prefix", () => {
    expect(brandFromVin("wbaaa1234567890")).toEqual(expect.objectContaining({ key: "bmw" }));
  });

  it("returns null, not a throw, for an unrecognized WMI", () => {
    expect(() => brandFromVin("ZZZAAAAA000000000")).not.toThrow();
    expect(brandFromVin("ZZZAAAAA000000000")).toBeNull();
  });

  it("returns null, not a throw, for null/undefined/short/empty input", () => {
    expect(brandFromVin(null)).toBeNull();
    expect(brandFromVin(undefined)).toBeNull();
    expect(brandFromVin("")).toBeNull();
    expect(brandFromVin("WB")).toBeNull();
    expect(() => brandFromVin(null)).not.toThrow();
  });
});

describe("parseWmiTable", () => {
  it("keeps well-formed entries", () => {
    const table = parseWmiTable({
      ABC: { key: "test-brand", name: "TEST BRAND", confidence: "high", source: "unit test fixture" },
    });
    expect(table.ABC).toEqual({
      key: "test-brand",
      name: "TEST BRAND",
      confidence: "high",
      source: "unit test fixture",
    });
  });

  it("uppercases WMI keys from the raw data", () => {
    const table = parseWmiTable({
      abc: { key: "test-brand", name: "TEST BRAND", confidence: "high", source: "fixture" },
    });
    expect(table.ABC).toBeDefined();
    expect(table.abc).toBeUndefined();
  });

  it("drops entries missing required fields instead of throwing", () => {
    const table = parseWmiTable({
      GOOD: { key: "ok", name: "OK BRAND", confidence: "high", source: "fixture" },
      MISSING_NAME: { key: "no-name", confidence: "high", source: "fixture" },
      MISSING_SOURCE: { key: "no-source", name: "NO SOURCE", confidence: "medium" },
      MISSING_CONFIDENCE: { key: "no-confidence", name: "NO CONFIDENCE", source: "fixture" },
    });
    expect(Object.keys(table)).toEqual(["GOOD"]);
  });

  it("drops entries with the wrong field types instead of throwing", () => {
    const table = parseWmiTable({
      GOOD: { key: "ok", name: "OK BRAND", confidence: "high", source: "fixture" },
      BAD_KEY_TYPE: { key: 123, name: "BAD", confidence: "high", source: "fixture" },
      BAD_NAME_TYPE: { key: "bad", name: null, confidence: "high", source: "fixture" },
      NOT_AN_OBJECT: "just a string",
      NULL_ENTRY: null,
      ARRAY_ENTRY: ["key", "name"],
    });
    expect(Object.keys(table)).toEqual(["GOOD"]);
  });

  it("drops entries with an unrecognized confidence value", () => {
    const table = parseWmiTable({
      GOOD: { key: "ok", name: "OK BRAND", confidence: "high", source: "fixture" },
      BAD_CONFIDENCE: { key: "bad", name: "BAD", confidence: "very-sure", source: "fixture" },
    });
    expect(Object.keys(table)).toEqual(["GOOD"]);
  });

  it("returns an empty table instead of throwing for malformed top-level input", () => {
    expect(() => parseWmiTable(null)).not.toThrow();
    expect(parseWmiTable(null)).toEqual({});
    expect(() => parseWmiTable(undefined)).not.toThrow();
    expect(parseWmiTable(undefined)).toEqual({});
    expect(() => parseWmiTable("not an object")).not.toThrow();
    expect(parseWmiTable("not an object")).toEqual({});
    expect(() => parseWmiTable(42)).not.toThrow();
    expect(parseWmiTable([])).toEqual({});
  });

  it("every real wmi.json entry parses as a valid BrandInfo (no silent drops)", async () => {
    const raw = (await import("../data/wmi.json")).default;
    const parsed = parseWmiTable(raw);
    const rawKeys = Object.keys(raw).map((k) => k.toUpperCase());
    const parsedKeys = Object.keys(parsed);
    expect(parsedKeys.sort()).toEqual([...new Set(rawKeys)].sort());
    // Every key must be a real, reachable WMI prefix: exactly 3 uppercase
    // alphanumerics. parseWmiTable is deliberately tolerant of value-shape
    // problems, but a malformed KEY (trailing space, wrong length,
    // lowercase) would pass validation and then never match any VIN,
    // silently killing that brand's badge - this assertion catches that
    // typo class in the real data at test time. (Added in review
    // 2026-08-21: a probe showed "VR7 ", "AB", "ABCD", and "" all pass
    // parseWmiTable and become unreachable entries.)
    for (const k of Object.keys(raw)) {
      expect(k).toMatch(/^[A-Z0-9]{3}$/);
    }
    for (const entry of Object.values(parsed) as BrandInfo[]) {
      expect(typeof entry.key).toBe("string");
      expect(typeof entry.name).toBe("string");
      expect(typeof entry.source).toBe("string");
      expect(["high", "medium-high", "medium", "low"]).toContain(entry.confidence);
    }
  });
});
