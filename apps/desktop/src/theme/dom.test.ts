import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DOM_TOKENS } from "./dom";

const __dirname = dirname(fileURLToPath(import.meta.url));
const tokensCss = () => readFileSync(join(__dirname, "./tokens.css"), "utf8");

function declaredTokens(css: string): Set<string> {
  const rootBlocks = [...css.matchAll(/^:root\s*\{([^}]*)\}/gm)].map((m) => m[1]).join("\n");
  return new Set([...rootBlocks.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
}

describe("DOM_TOKENS", () => {
  it("names every custom property tokens.css declares", () => {
    const declared = declaredTokens(tokensCss());
    expect(declared.size).toBeGreaterThan(0);
    const documented = new Set<string>(Object.values(DOM_TOKENS));
    for (const name of declared) expect(documented.has(name), name).toBe(true);
  });

  it("documents no name that tokens.css doesn't declare", () => {
    const declared = declaredTokens(tokensCss());
    for (const name of Object.values(DOM_TOKENS)) expect(declared.has(name), name).toBe(true);
  });

  it("index.css maps tokens, it does not declare them", () => {
    const css = readFileSync(join(__dirname, "../index.css"), "utf8");
    const declared = declaredTokens(css);
    expect([...declared]).toEqual([]);
  });

  it("no component carries a raw hex color", () => {
    const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
    const root = join(__dirname, "..");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) {
          if (entry === "brand" || entry === "data") continue;
          walk(p);
          continue;
        }
        if (!/\.(tsx?|css)$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
        if (p.endsWith("rendering.ts") || p.endsWith("tokens.css")) continue;
        const src = readFileSync(p, "utf8");
        const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
        if (/#[0-9a-fA-F]{6}\b/.test(code)) offenders.push(p.slice(root.length + 1));
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
