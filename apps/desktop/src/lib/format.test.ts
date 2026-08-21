import { describe, expect, it } from "vitest";
import { formatVoltage } from "@/lib/format";

describe("formatVoltage", () => {
  it("uses a period decimal in English", () => {
    expect(formatVoltage(13.4, "en")).toBe("13.4 V");
  });

  it("uses a comma decimal in Spanish", () => {
    expect(formatVoltage(13.4, "es")).toBe("13,4 V");
  });

  it("always rounds to exactly one decimal place", () => {
    expect(formatVoltage(13, "en")).toBe("13.0 V");
    expect(formatVoltage(13, "es")).toBe("13,0 V");
    expect(formatVoltage(13.456, "en")).toBe("13.5 V");
  });
});
