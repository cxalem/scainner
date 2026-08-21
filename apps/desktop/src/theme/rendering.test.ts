// Proves the theme module's own shape: every 3D-layer constant that used to
// be a hardcoded literal inside VehicleScene.tsx / emblems.tsx /
// EmblemStarfield.tsx is present here, correctly typed, and byte-identical
// to the value it replaced. This is what patterns/engineering.md rule 1's
// exception clause still asks be tested even when the migration's *visual*
// result needs a live check instead (see the commit history / builder
// report for that check) — the "did every value actually move over intact"
// claim is exactly the kind of thing a type-level/value-level test can
// verify completely, so it does not fall back to a screenshot.
import { describe, expect, it } from "vitest";
import {
  CHROME_MATERIAL,
  NAMEPLATE_TEXTURE,
  PARTICLE_PALETTE,
  STUDIO_LIGHTING,
  VEHICLE_MATERIALS,
} from "./rendering";

// Every value below is transcribed directly from the pre-migration source
// (git history: VehicleScene.tsx, emblems.tsx, EmblemStarfield.tsx before
// this stream's migration commit), not re-derived — a test that re-derives
// the "expected" value from the same place the constant now lives would
// prove nothing.
describe("CHROME_MATERIAL (emblems.tsx's former EMBLEM_CHROME)", () => {
  it("matches the original chrome material physics byte-for-byte", () => {
    expect(CHROME_MATERIAL).toEqual({
      color: "#f4f6f8",
      metalness: 0.9,
      roughness: 0.13,
      clearcoat: 0.85,
      clearcoatRoughness: 0.06,
      envMapIntensity: 2.0,
    });
  });

  it("is readonly at the type level", () => {
    // @ts-expect-error CHROME_MATERIAL is declared `as const`
    CHROME_MATERIAL.color = "#000000";
  });
});

describe("NAMEPLATE_TEXTURE (emblems.tsx's NameplateEmblem canvas fills)", () => {
  it("matches the original canvas fillStyle values", () => {
    expect(NAMEPLATE_TEXTURE).toEqual({
      baseFill: "#ffffff",
      textColor: "#181a1e",
    });
  });
});

describe("STUDIO_LIGHTING (VehicleScene.tsx's buildStudioEnvScene + rim light)", () => {
  it("matches the original panel/backdrop/rim-light colors", () => {
    expect(STUDIO_LIGHTING.backdrop).toEqual([0.32, 0.34, 0.37]);
    expect(STUDIO_LIGHTING.overheadPanel).toEqual([2.4, 2.4, 2.4]);
    expect(STUDIO_LIGHTING.coolPanel).toEqual([1.3, 1.5, 1.8]);
    expect(STUDIO_LIGHTING.warmPanel).toEqual([1.8, 1.5, 1.2]);
    expect(STUDIO_LIGHTING.floorPanel).toBe("#3a3a3a");
    expect(STUDIO_LIGHTING.rimLight).toBe("#dfe8ff");
  });
});

describe("PARTICLE_PALETTE (EmblemStarfield.tsx)", () => {
  it("matches the original dust palette and background gradient", () => {
    expect(PARTICLE_PALETTE.dust).toEqual(["#fff6e6", "#f0e6d2", "#c9b995"]);
    expect(PARTICLE_PALETTE.backgroundGradient).toEqual(["#181614", "#221f1b"]);
  });
});

describe("VEHICLE_MATERIALS (VehicleScene.tsx's StlCarModel/GlbCarModel/CarModel)", () => {
  it("matches every original vehicle-body material value", () => {
    expect(VEHICLE_MATERIALS).toEqual({
      defaultTint: "#e3e5e8",
      pulseColor: "#2b2f36",
      stlBodyPaint: "#989ba1",
      stlGlass: "#17191c",
      glbPaint: [0.68, 0.7, 0.72],
      glbGlass: [0.25, 0.28, 0.32],
      glbPlastic: [0.08, 0.08, 0.09],
      glbTire: [0.85, 0.85, 0.85],
      glbAlloyChrome: [1, 1, 1],
      glbLampLens: [1, 1, 1],
      carModelGlass: "#0d1116",
      carModelNeutral: "#ffffff",
      tailEmissive: "#ff2a2a",
      headEmissive: "#eaf1ff",
    });
  });
});
