import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MODELED_BRANDS, brandFromVin, parseWmiTable, type BrandInfo } from "./brand";

const HERE = dirname(fileURLToPath(import.meta.url));

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

  it("carries the routing brand id for map-routed WMIs and null for badge-only marques", () => {
    expect(typeof brandFromVin("VF3AAAAA000000000")?.brand).toBe("string");
    expect(brandFromVin("WP0AAAAA000000000")).toEqual(
      expect.objectContaining({ key: "porsche", brand: null }),
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

  it("accepts a string or null `brand` and drops anything else", () => {
    const table = parseWmiTable({
      ROUTED: { key: "ok", name: "OK", confidence: "high", source: "fixture", brand: "ok_group" },
      BADGE: { key: "ok", name: "OK", confidence: "high", source: "fixture", brand: null },
      BAD: { key: "ok", name: "OK", confidence: "high", source: "fixture", brand: 7 },
    });
    expect(Object.keys(table).sort()).toEqual(["BADGE", "ROUTED"]);
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

describe("wmi.json is generated from the knowledge map", () => {
  it("routes every WMI of every map brand", async () => {
    const raw = (await import("../data/wmi.json")).default as Record<string, BrandInfo>;
    const map = JSON.parse(
      readFileSync(join(HERE, "../../../../packages/uds-map/data/uds-map.json"), "utf-8"),
    ) as { brands: { id: string; wmi: string[] }[] };
    for (const b of map.brands) {
      for (const wmi of b.wmi) {
        expect(raw[wmi], wmi).toBeDefined();
        expect(typeof raw[wmi].brand, wmi).toBe("string");
      }
    }
  });

  it("keeps every marque-overlay row (key/name refinements survive regeneration)", async () => {
    const raw = (await import("../data/wmi.json")).default as Record<string, BrandInfo>;
    const overlay = (await import("../data/wmi-marques.json")).default as Record<string, { key: string; name: string }>;
    for (const [wmi, o] of Object.entries(overlay)) {
      expect(raw[wmi], wmi).toEqual(expect.objectContaining({ key: o.key, name: o.name }));
    }
  });
});

describe("emblem keys are reachable", () => {
  it("every EMBLEMS key is a wmi.json key or an explicit preview-only emblem", async () => {
    const src = readFileSync(join(HERE, "../components/emblems.tsx"), "utf-8");
    const record = src.slice(src.indexOf("export const EMBLEMS"));
    const keys = [...record.matchAll(/^  "?([a-z][a-z0-9_-]*)"?: (?:glb|stl)Emblem\(/gm)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(10);
    const previewMatch = src.match(/export const PREVIEW_ONLY_EMBLEMS = \[([^\]]*)\]/);
    expect(previewMatch).not.toBeNull();
    const previewOnly = new Set([...previewMatch![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
    const raw = (await import("../data/wmi.json")).default as Record<string, BrandInfo>;
    const badgeKeys = new Set(Object.values(raw).map((e) => e.key));
    for (const k of keys) {
      expect(badgeKeys.has(k) || previewOnly.has(k), `emblem "${k}" is unreachable`).toBe(true);
    }
  });

  it("MODELED_BRANDS names exactly the EMBLEMS registry keys, no drift", async () => {
    const src = readFileSync(join(HERE, "../components/emblems.tsx"), "utf-8");
    const record = src.slice(src.indexOf("export const EMBLEMS"));
    const registryKeys = new Set(
      [...record.matchAll(/^  "?([a-z][a-z0-9_-]*)"?: (?:glb|stl)Emblem\(/gm)].map((m) => m[1]),
    );
    const modeledKeys = new Set(MODELED_BRANDS.map((b) => b.key));
    expect(modeledKeys).toEqual(registryKeys);
    for (const b of MODELED_BRANDS) {
      expect(typeof b.name).toBe("string");
      expect(b.name.length).toBeGreaterThan(0);
    }
  });
});
