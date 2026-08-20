# Plan: shared design tokens (CSS + 3D layer)

Written directly, same gating as animation-system/plan.md: after
ws/effect-architecture and the monorepo migration land.

## What's actually true today, checked directly, not assumed

Alejandro's instinct ("brand colors should never be hardcoded, should
live in one place") is already correctly implemented for the DOM/CSS
layer, and that's worth saying plainly rather than treating this as a
from-scratch problem:

- `src/index.css` is the single source of truth: CSS custom properties
  (`--primary`, `--background`, etc, in oklch) plus Tailwind v4's
  `@theme inline` mapping.
- Every component consumes colors via Tailwind utility classes
  (`bg-primary`, `text-primary`, `border-border`) that resolve to those
  variables. Grepped the whole `src/` tree: zero hardcoded hex or rgb
  color anywhere in a component's className or inline style.
- Changing the brand green today is a one-line edit to `--primary` in
  `index.css`, full stop — this part of the ask is already done, not a
  gap to fix.

**The real, narrower gap**: 25 hardcoded hex values exist in the
codebase, and every single one is in the 3D/Canvas layer
(`VehicleScene.tsx`, `emblems.tsx`, `EmblemStarfield.tsx`) — chrome
material colors, studio-environment lighting panels, starfield particle
palette. These are not violations of the same kind as a hardcoded brand
color would be: Three.js materials and Canvas 2D contexts need raw
hex/rgb values at JS runtime, they cannot consume a CSS custom property
directly. So "just point them at `var(--primary)`" is not mechanically
possible the way it is for a `<div className="bg-primary">`.

What actually is a real gap: these 25 values are scattered across three
files with no shared source, so there is no single place to see or
change "the chrome look" or "the starfield palette" as a concept, and
nothing keeps them conceptually organized the way `index.css` organizes
the DOM palette.

## Scope for this pass

1. **A `src/theme/` (or similar) module as the actual single source**,
   containing:
   - Re-exports or documents the existing CSS custom properties as the
     DOM-layer source of truth (no change to how these work, just making
     the module the documented entry point).
   - A typed JS object for the 3D-layer constants currently scattered
     across three files (`EMBLEM_CHROME`'s color, the studio panel
     colors, the starfield palette) — grouped by what they represent
     (material, lighting, particles), not just dumped as one flat list.
2. **Migrate the three 3D files to import from this module** instead of
   their own local hex literals. This is a real, mechanical, low-risk
   change (three files, verifiable by screenshot before/after — the
   visual result must be pixel-identical, this is a source-of-truth
   move, not a redesign).
3. **A documented distinction, in the module itself**, between "brand
   identity" (the primary green, currently a placeholder per
   Alejandro's own framing — "not the identity of the project... those
   colors will change") and "rendering constants" (chrome material
   physics, studio lighting) — the second category should NOT
   automatically follow the first category's future rebrand, since a
   chrome material being "the right shade of chrome" has nothing to do
   with what the brand's primary accent color is. Conflating these two
   categories into one token file without this distinction would be a
   real design mistake, not a simplification.

## What this does NOT do in this pass

- Does not pick a new brand color or do any actual rebrand — Alejandro
  named that as a future decision, this plan only prepares the
  structure so that future decision is a one-place edit when it happens.
- Does not touch `index.css`'s actual token values or the Tailwind
  `@theme inline` mechanism — that layer is already correct, this plan
  extends the same discipline to the 3D layer, not replaces the CSS
  layer's approach.
- Does not build a full design-token pipeline (design tool sync, a
  token-transform build step) — that is real over-engineering for a
  one-person team with 25 scattered constants, not a real requirement
  yet.

## Sequencing

Gated on ws/effect-architecture and the monorepo migration for the same
reason as every other plan this session: both touch broad swaths of
`src/`, and this plan's file moves (three 3D files' color constants)
would conflict with either. Once both land, this is a small, mechanical,
fast-to-verify change — likely the quickest of the currently-planned
backlog items to actually execute, since the DOM-layer half of the work
is already done.
