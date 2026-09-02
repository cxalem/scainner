import { describe, expect, it } from "vitest";
import { loadMap } from "./pack.ts";
import { renderSnapshot } from "./research-snapshot.ts";

const brandId = loadMap()
  .brands.filter((brand) => brand.profiled_level === "decodes_verified")
  .map((brand) => brand.id)
  .sort()[0];

describe("research:snapshot", () => {
  it("prints every section of the coverage block", () => {
    const snapshot = renderSnapshot(brandId);
    for (const heading of ["## Coverage snapshot:", "### Brand", "### Platforms", "### Known modules and routes", "### DID bands", "### Known DIDs", "### ECU families touching this brand", "### Research packs already covering this brand"]) {
      expect(snapshot, `missing ${heading}`).toContain(heading);
    }
    for (const field of ["| name |", "| wmi |", "| profiled_level |", "| confidence |", "| read_service |", "| resp_offsets |", "| gateway_behaviour |", "| identity_block (iso) |"]) {
      expect(snapshot, `missing ${field}`).toContain(field);
    }
    expect(snapshot).toMatch(/\d+ known DID\(s\), \d+ with at least one decode/);
    expect(snapshot.endsWith("\n")).toBe(true);
  });

  it("is deterministic", () => {
    expect(renderSnapshot(brandId)).toBe(renderSnapshot(brandId));
  });

  it("names the known brands when asked for one that is not in the map", () => {
    expect(() => renderSnapshot("not-a-brand")).toThrow(/Known ids:/);
  });
});
