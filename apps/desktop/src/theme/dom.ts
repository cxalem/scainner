// DOM-layer tokens — documents, does not redefine, the CSS custom
// properties already living in ../index.css.
//
// index.css + Tailwind v4's `@theme inline` mapping IS the source of truth
// for every DOM-rendered color (`bg-primary`, `text-primary`, etc. resolve
// to these `--*` variables in oklch). That is already correct: grepped the
// whole `src/` tree, zero hardcoded hex/rgb in a component's className or
// inline style. This file does not change that, and deliberately does NOT
// copy the oklch values into a JS object — a second copy of the same value
// is exactly the "no single source of truth" problem this pass exists to
// fix on the 3D-layer side, and duplicating it here would just move that
// same mistake into the DOM layer instead.
//
// What this file gives the rest of the app: a documented, typed map of
// token *names* (so "what tokens exist" has one place to look, same as
// rendering.ts gives for the 3D layer), plus a small helper for the rare
// case JS genuinely needs a token's live value (e.g. handing a color to a
// non-DOM API that can't consume a CSS variable directly — see
// rendering.ts's header comment for why Three.js materials are exactly
// that case and therefore live in their own file, not here).
export const DOM_TOKENS = {
  background: "--background",
  foreground: "--foreground",
  card: "--card",
  cardForeground: "--card-foreground",
  muted: "--muted",
  mutedForeground: "--muted-foreground",
  border: "--border",
  primary: "--primary",
  primaryForeground: "--primary-foreground",
  destructive: "--destructive",
  warn: "--warn",
} as const;

export type DomTokenName = keyof typeof DOM_TOKENS;

// `--primary` is explicitly a placeholder today (Alejandro: "not the
// identity of the project... those colors will change" — see plan.md).
// Reading it here rather than hardcoding a copy means that future rebrand
// stays a one-line edit to index.css, same as it is today, with nothing
// else in the app needing to change.
export function readDomToken(name: DomTokenName, root: Element = document.documentElement): string {
  return getComputedStyle(root).getPropertyValue(DOM_TOKENS[name]).trim();
}
