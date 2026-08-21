// dom.ts documents index.css's custom properties rather than redefining
// them (see dom.ts's own header for why a second copy of the same value
// would be a mistake). What's actually testable about that is drift: this
// asserts DOM_TOKENS names every custom property index.css declares, by
// reading index.css directly rather than hand-copying an expected list a
// second time — a hand-copied list could drift right alongside dom.ts
// without ever being caught.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DOM_TOKENS } from "./dom";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("DOM_TOKENS", () => {
  it("names every custom property index.css actually declares", () => {
    const css = readFileSync(join(__dirname, "../index.css"), "utf8");
    const declared = new Set(
      [...css.matchAll(/^\s*(--[a-z-]+):\s*(?:oklch|[\d.]+rem)/gm)].map((m) => m[1]),
    );
    expect(declared.size).toBeGreaterThan(0); // sanity: the regex actually found index.css's tokens

    const documented = new Set<string>(Object.values(DOM_TOKENS));
    for (const name of declared) {
      // --radius is a layout token (rem), not a color — deliberately left
      // out of DOM_TOKENS, which only documents the color palette.
      if (name === "--radius") continue;
      expect(documented.has(name)).toBe(true);
    }
  });

  it("documents no name that index.css doesn't actually declare", () => {
    const css = readFileSync(join(__dirname, "../index.css"), "utf8");
    for (const name of Object.values(DOM_TOKENS)) {
      expect(css.includes(`${name}:`)).toBe(true);
    }
  });
});
