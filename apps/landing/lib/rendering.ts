// 3D/Canvas rendering constants — copied verbatim from the desktop app's
// theme/rendering.ts (apps/desktop/src/theme/rendering.ts) so the emblem
// scene on this marketing page matches the real product exactly, not a
// close approximation. Keep in sync by hand; there's no shared package
// between these two apps' build systems.

export const CHROME_MATERIAL = {
  color: "#f4f6f8",
  metalness: 0.9,
  roughness: 0.13,
  clearcoat: 0.85,
  clearcoatRoughness: 0.06,
  envMapIntensity: 2.0,
} as const;

export const STUDIO_LIGHTING = {
  backdrop: [0.32, 0.34, 0.37] as [number, number, number],
  overheadPanel: [2.4, 2.4, 2.4] as [number, number, number],
  coolPanel: [1.3, 1.5, 1.8] as [number, number, number],
  warmPanel: [1.8, 1.5, 1.2] as [number, number, number],
  floorPanel: "#3a3a3a",
  rimLight: "#dfe8ff",
} as const;

// "Bare" tone dust — matches emblem-scene.js's TONES.bare (the header's
// own dark-purple gradient shows through; the canvas paints dots only).
export const PARTICLE_PALETTE_BARE = {
  dust: ["#d8d0f8", "#efedfa", "#a49add"] as [string, string, string],
};

// One shared pace for the hero's brand-recognition moment: the emblem's
// rotation (EmblemScene, rad/s) and the dust drift behind it (EmblemDust,
// derived from this same number rather than its own independent constant)
// move at proportionally the same speed, so a future retune of one retunes
// both together instead of drifting out of sync by hand.
export const EMBLEM_ROTATE_SPEED = 0.16;
