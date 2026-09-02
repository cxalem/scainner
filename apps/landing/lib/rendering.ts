
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

export const PARTICLE_PALETTE_BARE = {
  dust: ["#d8d0f8", "#efedfa", "#a49add"] as [string, string, string],
};

export const EMBLEM_ROTATE_SPEED = 0.16;
