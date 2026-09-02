
export const CHROME_MATERIAL = {
  color: "#f4f6f8",
  metalness: 0.9,
  roughness: 0.13,
  clearcoat: 0.85,
  clearcoatRoughness: 0.06,
  envMapIntensity: 2.0,
} as const;

export const NAMEPLATE_TEXTURE = {
  baseFill: "#ffffff",
  textColor: "#181a1e",
} as const;

export const STUDIO_LIGHTING = {
  backdrop: [0.32, 0.34, 0.37] as [number, number, number],
  overheadPanel: [2.4, 2.4, 2.4] as [number, number, number],
  coolPanel: [1.3, 1.5, 1.8] as [number, number, number],
  warmPanel: [1.8, 1.5, 1.2] as [number, number, number],
  floorPanel: "#3a3a3a",
  rimLight: "#dfe8ff",
} as const;

export const PARTICLE_PALETTE = {
  dust: ["#fff6e6", "#f0e6d2", "#c9b995"] as [string, string, string],
  backgroundGradient: ["#181614", "#221f1b"] as [string, string],
} as const;

export const PARTICLE_PALETTE_LIGHT = {
  dust: ["#d9d6e6", "#b5abfc", "#4634a8"] as [string, string, string],
  backgroundGradient: ["#f7f6fb", "#f4f1fd"] as [string, string],
} as const;

export const VEHICLE_MATERIALS = {
  defaultTint: "#e3e5e8",
  pulseColor: "#2b2f36",
  stlBodyPaint: "#989ba1",
  stlGlass: "#17191c",
  glbPaint: [0.68, 0.7, 0.72] as [number, number, number],
  glbGlass: [0.25, 0.28, 0.32] as [number, number, number],
  glbPlastic: [0.08, 0.08, 0.09] as [number, number, number],
  glbTire: [0.85, 0.85, 0.85] as [number, number, number],
  glbAlloyChrome: [1, 1, 1] as [number, number, number],
  glbLampLens: [1, 1, 1] as [number, number, number],
  carModelGlass: "#0d1116",
  carModelNeutral: "#ffffff",
  tailEmissive: "#ff2a2a",
  headEmissive: "#eaf1ff",
} as const;
