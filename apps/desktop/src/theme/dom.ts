// DOM-layer tokens — documents, does not redefine, the CSS custom
// properties declared in ./tokens.css.
//
// tokens.css + Tailwind v4's `@theme inline` mapping (index.css) IS the
// source of truth for every DOM-rendered value: `bg-surface`,
// `text-accent-300`, `rounded-md`, `shadow-sm` all resolve to these
// `--*` variables. This file deliberately does NOT copy any value into
// JS — a second copy is exactly the drift problem the token file exists to
// prevent. It gives the app a typed map of token *names* (one place to see
// what exists) and a helper for the rare case JS genuinely needs a live
// value (a chart library, a canvas — see rendering.ts for the 3D layer,
// which has its own constants because Three.js cannot read CSS variables).
export const DOM_TOKENS = {
  // surfaces and text
  bg: "--bg",
  surface: "--surface",
  text: "--text",
  divider: "--divider",
  section: "--section",
  sectionText: "--section-text",
  sectionHeadline: "--section-headline",
  sectionGlow: "--section-glow",
  sectionChipText: "--section-chip-text",
  sectionChipBorder: "--section-chip-border",
  sectionChipBg: "--section-chip-bg",
  // accent + ramp (100 darkest … 900 palest)
  accent: "--accent",
  accent100: "--accent-100",
  accent200: "--accent-200",
  accent300: "--accent-300",
  accent400: "--accent-400",
  accent500: "--accent-500",
  accent600: "--accent-600",
  accent700: "--accent-700",
  accent800: "--accent-800",
  accent900: "--accent-900",
  accent2_400: "--accent-2-400",
  accent2_600: "--accent-2-600",
  // neutral ramp
  neutral100: "--neutral-100",
  neutral200: "--neutral-200",
  neutral300: "--neutral-300",
  neutral400: "--neutral-400",
  neutral500: "--neutral-500",
  neutral600: "--neutral-600",
  neutral700: "--neutral-700",
  neutral800: "--neutral-800",
  neutral900: "--neutral-900",
  // semantic
  ok: "--ok",
  okBg: "--ok-bg",
  okLine: "--ok-line",
  warn: "--warn",
  warnBg: "--warn-bg",
  warnLine: "--warn-line",
  stop: "--stop",
  stopBg: "--stop-bg",
  stopLine: "--stop-line",
  // elevation
  shadowSm: "--shadow-sm",
  shadowMd: "--shadow-md",
  shadowLg: "--shadow-lg",
  // shape
  radiusSm: "--radius-sm",
  radiusMd: "--radius-md",
  radiusLg: "--radius-lg",
  radiusFull: "--radius-full",
  // type
  fontBody: "--font-body",
  fontHeading: "--font-heading",
  fontHeadingWeight: "--font-heading-weight",
  fontMono: "--font-mono",
  // layout
  sidebarWidth: "--sidebar-width",
  contentMaxWidth: "--content-max-width",
  // motion
  easeOut: "--ease-out",
  durFast: "--dur-fast",
  durBase: "--dur-base",
  durSlow: "--dur-slow",
  durPage: "--dur-page",
} as const;

export type DomTokenName = keyof typeof DOM_TOKENS;

/** The live value of a token — for JS consumers that cannot take a CSS
 *  variable (chart strokes, canvas fills). Reading it, not copying it,
 *  keeps a token change a one-file edit. */
export function readDomToken(name: DomTokenName, root: Element = document.documentElement): string {
  return getComputedStyle(root).getPropertyValue(DOM_TOKENS[name]).trim();
}
