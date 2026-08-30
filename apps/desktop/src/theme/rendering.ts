// 3D-layer rendering constants — the single source for every color/material
// value the Canvas layer (VehicleScene.tsx, emblems.tsx, EmblemStarfield.tsx)
// needs at JS runtime.
//
// Why this exists as a separate module from dom.ts, not folded into it:
// Three.js materials and Canvas 2D contexts need raw hex/rgb values at JS
// runtime — they cannot consume a CSS custom property directly the way a
// `<div className="bg-primary">` can. So "just point them at var(--primary)"
// is not mechanically possible here, and this module is not a duplicate of
// dom.ts's job, it's the thing dom.ts's approach genuinely cannot cover.
//
// IMPORTANT — brand identity vs. rendering constants are deliberately kept
// as separate, documented categories below, per the plan's explicit
// warning: conflating them would be a real design mistake, not a
// simplification. `--primary` (the brand accent, currently a placeholder —
// "not the identity of the project... those colors will change") has
// nothing to do with a chrome material being "the right shade of chrome,"
// a studio softbox panel being tinted like reflected sky, or a starfield
// particle reading as warm ambient dust. None of the groups below should
// automatically follow a future rebrand of `--primary` — they are
// independent physical/aesthetic choices about how the 3D scene renders,
// not expressions of brand identity. See dom.ts for the one value that IS
// brand identity.

// --- Chrome / material -------------------------------------------------
// The shared physically-based material every modeled emblem (NameplateEmblem,
// StlEmblem, GlbEmblem, in emblems.tsx) renders in. One consistent chrome
// look across all 20+ badges, defined once.
export const CHROME_MATERIAL = {
  color: "#f4f6f8",
  metalness: 0.9,
  // Tightened from 0.22 on real evidence, not a guess: the source GLB
  // files' own "Polished_Metal" material specifies roughnessFactor 0.14
  // (checked directly in each file's JSON), and this shared material was
  // duller than what those files were actually designed for. Still not
  // razor-sharp — patterns/3d.md rule 2 still applies, a true mirror in a
  // soft studio rig goes flat/dark, this is the floor before that starts.
  roughness: 0.13,
  clearcoat: 0.85,
  clearcoatRoughness: 0.06,
  envMapIntensity: 2.0,
} as const;

// The nameplate badge's face texture (drawn to a canvas, not a Three.js
// material) — the fallback for any brand with no modeled emblem. Base fill
// stays white so it multiplies to the chrome base color untouched; only
// the text ink is a real color.
export const NAMEPLATE_TEXTURE = {
  baseFill: "#ffffff",
  textColor: "#181a1e",
} as const;

// --- Studio lighting -----------------------------------------------------
// The procedural "studio softbox" rig (VehicleScene.tsx's
// buildStudioEnvScene): a bright overhead panel, a cool- and warm-tinted
// panel on either side (reads as reflected sky vs. reflected room light —
// a standard product-render trick), a dark floor panel, and a mid-gray
// backdrop so mirror-like chrome always has something plausible to
// reflect. Panel colors intentionally go above [1,1,1] — a plain white
// plane reads as "a medium gray card" once baked into a PBR material's
// reflections, not "a light source" (real HDRIs' bright regions are many
// times over 1.0 for the same reason).
export const STUDIO_LIGHTING = {
  backdrop: [0.32, 0.34, 0.37] as [number, number, number],
  overheadPanel: [2.4, 2.4, 2.4] as [number, number, number],
  coolPanel: [1.3, 1.5, 1.8] as [number, number, number],
  warmPanel: [1.8, 1.5, 1.2] as [number, number, number],
  floorPanel: "#3a3a3a",
  // Rim light on the Canvas's own <directionalLight> (not part of the
  // baked env scene) — the product-photography trick that catches the
  // silhouette edge as a bright thin highlight.
  rimLight: "#dfe8ff",
} as const;

// --- Particle palette ------------------------------------------------------
// EmblemStarfield's ambient-dust particles and the canvas background
// gradient it drifts across.
export const PARTICLE_PALETTE = {
  dust: ["#fff6e6", "#f0e6d2", "#c9b995"] as [string, string, string],
  backgroundGradient: ["#181614", "#221f1b"] as [string, string],
} as const;

// Light-ground variant of the same dust effect — for the emblem's
// appearances on recurring dashboard surfaces (Overview, Vehicle) sitting
// in an otherwise paper-white layout, where the dark PARTICLE_PALETTE
// ground reads as a jarring hole rather than a moment (2026-08-30). The
// warm cream dust above is tuned for a dark ground and disappears against
// white, so this recolors the same three-tone weighting into the accent
// ramp instead: two faint neutral/violet tints plus an occasional bolder
// accent fleck, matching the app's own token values (index.css) so the
// card reads as one surface with the paper background around it, not a
// separately-designed insert.
export const PARTICLE_PALETTE_LIGHT = {
  dust: ["#d9d6e6", "#b5abfc", "#4634a8"] as [string, string, string],
  backgroundGradient: ["#f7f6fb", "#f4f1fd"] as [string, string],
} as const;

// --- Vehicle body materials ------------------------------------------------
// Colors for the per-car body models (StlCarModel, GlbCarModel, CarModel in
// VehicleScene.tsx). All three are dormant (BrandEmblemModel is the active
// model per VehicleScene's own comments) but kept in place, not deleted —
// migrated here for the same single-source-of-truth reason as the active
// path, so a future revival doesn't reintroduce scattered literals.
export const VEHICLE_MATERIALS = {
  // Near-white default paint tint — shows the body texture close to its
  // native grayscale until a real color is picked.
  defaultTint: "#e3e5e8",
  // Discovery-pulse marker color (CarModel's hotspot animation).
  pulseColor: "#2b2f36",
  // StlCarModel: averaged from the hood-panel closeup and side-view door
  // panel reference photos (~#8f939c and ~#a0a0a2) — a real silver-gray
  // metallic, not a guess.
  stlBodyPaint: "#989ba1",
  // StlCarModel: sampled from the side-view's actual installed, tinted,
  // in-shadow window — not the isolated windshield closeup, which reads
  // lighter due to backlight through the panel.
  stlGlass: "#17191c",
  // GlbCarModel (tuneGlbMaterial), per-material RGB tuples:
  glbPaint: [0.68, 0.7, 0.72] as [number, number, number], // neutral silver, from the generator's own untextured "neutral clean" variant
  glbGlass: [0.25, 0.28, 0.32] as [number, number, number],
  glbPlastic: [0.08, 0.08, 0.09] as [number, number, number],
  glbTire: [0.85, 0.85, 0.85] as [number, number, number], // near-white multiply base — the real tread photo (atlas map) supplies the actual near-black look
  glbAlloyChrome: [1, 1, 1] as [number, number, number], // pure white multiply — the atlas photo supplies the real alloy-spoke color
  glbLampLens: [1, 1, 1] as [number, number, number], // pure white multiply + emissive base — the atlas photo supplies the real lamp color/glow
  // CarModel (the OBJ pipeline): real glass, deliberately opaque, not
  // transmission-based (see the file's own comment on why).
  carModelGlass: "#0d1116",
  // CarModel rim/tire/tail/head materials are left white so the chosen
  // paint color never tints them — they show their real photographed
  // texture untinted.
  carModelNeutral: "#ffffff",
  tailEmissive: "#ff2a2a", // never tinted by the chosen paint color, same as glass/wheels
  headEmissive: "#eaf1ff",
} as const;
