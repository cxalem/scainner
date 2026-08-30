# Brand — Sonda

_Status: active. Redesigned 2026-08-30 from the Hi-Fi v2 handoff; the identity
(name, mark) landed the same day._

Personal OBD2 diagnostic app for macOS. The identity is **"calm instrument"**:
a clean, data-forward tool on paper-white — deliberately NOT the black-cockpit,
skeuomorphic-gauge, racing-font cliché of the OBD app category. One accent
voice (blurple), a warm-neutral ink ramp, and the 3D chrome emblem of the
connected car as the one flourish.

## Where things live (the rules)

- **Name and logo: `apps/desktop/src/brand/`** — `BRAND.name` / `BRAND.wordmark`,
  `<BrandMark tone="mono|color">`, `<Wordmark>`. Source SVGs in
  `apps/desktop/public/brand/`. Nothing else in `src/` spells the product name
  or draws the logo; i18n strings that mention the name take it as a parameter.
- **Design tokens: `apps/desktop/src/theme/tokens.css`** — every color, ramp,
  radius, shadow, type family and motion timing as a CSS custom property.
  `index.css` maps them to Tailwind names (`bg-surface`, `text-accent-300`,
  `border-divider`, `rounded-md`, `shadow-md`). Components use tokens only —
  never raw hex, never an ad-hoc easing.
- **3D/Canvas constants: `apps/desktop/src/theme/rendering.ts`** — chrome
  material, studio lighting, dust palette. Kept apart from brand identity on
  purpose: the right shade of chrome has nothing to do with the accent.
- **Motion vocabulary: `apps/desktop/src/motion/`** — variants (`index.ts`) and
  the `Page / Block / Reveal / Swap / List / Item / Stagger / Row` components
  (`components.tsx`). Views compose these; they don't touch framer-motion
  directly.
- **Primitives: `apps/desktop/src/components/ui.tsx`** — Button, Card, Pill,
  Seg, Field/Input, Table, Dialog, PageHeader, EmptyState, ProgressBar…

## The mark

A three-quarter arc closing on a dot (a probe sweeping to a reading).
Wordmark `sonda`, lowercase, Inter 500, tracking −0.025em. Mono version
(`currentColor`) on light surfaces; the two-tone version only on the dark
ground (login panel, favicon).

## Palette (tokens)

- Ground `--bg #f7f6fb`, surface `--surface #fff`, ink `--text #1d1a33`,
  rules `--divider #e4e0f0`. One dark ground: `--section #221d47`.
- Accent `--accent #4634a8` with a 100–900 ramp (**100 is darkest, 900 is
  the palest tint** — same for the neutral ramp). Sidebar sits on accent-900.
- Semantic: `--ok` green, `--warn` amber, `--stop` red, each with `-bg` and
  `-line`. Meaning only, never decoration.
- Secondary accent (`--accent-2-*`) exists for exactly one thing: the
  "candidate, unproven" sensor state.

## Typography

- Inter (bundled, `@fontsource-variable/inter`), body 13px, headings weight
  500 with −0.01em tracking.
- **Numbers: monospace + tabular-nums, always** (`num` utility / `<Mono>`) —
  every value, voltage, code, VIN, hex byte, path, timestamp.
- Scale: page title 22 · card head 19 · body 13.5/13 · secondary 12.5/12/11.5
  · kicker 10.5 uppercase +0.1em · pill 10.5 · stat number 23.

## Iconography

- **lucide-react only. No emojis anywhere.** One stroke width; 16px beside
  13px text, 15px inside buttons.
- Status is icon + token color (dot / pill), never emoji.

## Motion

- One easing (`--ease-out` = cubic-bezier(.2,.8,.2,1)), four durations
  (150 / 220 / 320 / 360 ms). Everything that appears rises 10px and fades in;
  a screen's blocks stagger 40 ms apart; siblings slide (`layout="position"`)
  when something above them opens — **nothing ever jumps.**
- Ambient loops (spin, glow, sweep, dust) are CSS; discrete appear/leave and
  layout motion are framer-motion. `prefers-reduced-motion` is honoured from
  one place (`MotionConfig reducedMotion="user"` + the CSS media rule).

## Voice

- Owner-facing surfaces: plain language, complete sentences, numbers explained.
- Lab surfaces: terse, technical, hex-friendly.
- Empty states teach the next action; errors say what happened and how to recover.
- Never "supported"; never a count without its scope; never a guess shown as a fact.
- Docs are documentation, not marketing.

## Layout

- Sidebar 232px on accent-900: lockup, vehicle switcher, grouped nav
  (Primary / Advanced), connection card pinned at the bottom, locale, sign-out.
- Content max-width 1000px, 24/26px padding, 18px between page head and body,
  16px between blocks. Page head: kicker / title / lede, live chip on the right.
- Cards: white, `rounded-md`, `shadow-sm`, no border; `flush` cards hold
  their own divided head and table rows.
