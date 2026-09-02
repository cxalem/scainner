import { describe, expect, it } from "vitest";
import { rideSummaryCopyKey } from "./ride-copy";

describe("rideSummaryCopyKey", () => {
  it.each([[-1, "none"], [0, "none"], [1, "one"], [2, "many"]] as const)("maps %s to %s", (count, key) => {
    expect(rideSummaryCopyKey(count)).toBe(key);
  });
});
