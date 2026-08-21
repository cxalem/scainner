// Single entry point for the app's design tokens.
//
// Two deliberately separate layers, not one flat pile — see each file's own
// header for the full reasoning:
//
// - dom.ts: documents the DOM/CSS-custom-property tokens already living in
//   ../index.css (Tailwind v4's `@theme inline` mechanism). That layer was
//   already correct before this module existed — this file does not change
//   how it works, it makes it a documented, importable entry point.
// - rendering.ts: the 3D/Canvas-layer constants (chrome material, studio
//   lighting, particle palette, vehicle body materials) that Three.js and
//   Canvas 2D need as raw JS values, grouped by what they represent.
//
// Brand identity (`--primary`, in dom.ts) and rendering constants (chrome
// physics, studio lighting, particle palette, in rendering.ts) are kept
// apart on purpose: a chrome material being "the right shade of chrome" has
// nothing to do with what the brand's accent color is, and conflating the
// two would mean a future rebrand of `--primary` accidentally dragging the
// studio lighting rig along with it.
export * from "./dom";
export * from "./rendering";
