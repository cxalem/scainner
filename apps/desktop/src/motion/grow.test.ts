import { describe, expect, it } from "vitest";
import { growBoxStyle } from "./index";

describe("growBoxStyle", () => {
  it("clips its content, so an animated height reveals instead of squashing", () => {
    expect(growBoxStyle.overflow).toBe("hidden");
  });

  it("refuses to be shrunk, because clipping zeroes a flex item's minimum size", () => {
    expect(growBoxStyle.flexShrink).toBe(0);
  });
});
