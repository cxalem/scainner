import { describe, expect, it } from "vitest";
import { detectLocale } from "@/i18n";

describe("detectLocale", () => {
  it("prefers a stored preference over anything else", () => {
    expect(detectLocale("es", "en-US")).toBe("es");
    expect(detectLocale("en", "es-ES")).toBe("en");
  });

  it("falls back to the browser/OS language when nothing is stored", () => {
    expect(detectLocale(null, "es-ES")).toBe("es");
    expect(detectLocale(null, "es")).toBe("es");
    expect(detectLocale(null, "en-GB")).toBe("en");
  });

  it("defaults to English when nothing matches", () => {
    expect(detectLocale(null, "fr-FR")).toBe("en");
    expect(detectLocale(null, null)).toBe("en");
    expect(detectLocale(null, undefined)).toBe("en");
  });

  it("ignores a stored value that isn't a real locale", () => {
    expect(detectLocale("de", "es-ES")).toBe("es");
    expect(detectLocale("", "es-ES")).toBe("es");
  });
});
