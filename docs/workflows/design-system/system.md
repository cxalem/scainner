# The design system — how to use it

_2026-08-30. Landed with the Hi-Fi v2 redesign on `redesign/hi-fi-v2`._

Three layers, each with exactly one home. Change a value in its home and the
whole app follows; nothing downstream carries its own copy.

## 1. Tokens — `apps/desktop/src/theme/tokens.css`

Every visual decision as a CSS custom property: surfaces, ink, the accent
ramp, the neutral ramp, semantic status colors, shadows, radii, type
families, layout widths, motion durations and the one easing.

- `index.css` maps them into Tailwind names in an `@theme inline` block.
  That block **names** tokens, it never **declares** them
  (`theme/dom.test.ts` enforces this).
- `theme/dom.ts` lists every token name (typed) and `readDomToken()` reads
  a live value for the rare JS consumer (a chart stroke). The test fails if
  `dom.ts` and `tokens.css` drift apart.
- `theme/rendering.ts` holds the 3D/Canvas constants (chrome material,
  studio rig, dust palette). Deliberately separate: chrome is chrome
  regardless of the accent.
- **No raw hex anywhere else.** `dom.test.ts` walks `src/` and fails on a
  6-digit hex outside `brand/`, `data/`, `rendering.ts` and `tokens.css`.

Ramps read 100 = darkest → 900 = palest, for both `accent-*` and
`neutral-*`. `bg-accent-900` is the sidebar tint; `text-neutral-100` is
near-ink.

Legacy names (`bg-background`, `text-muted-foreground`, `border-border`,
`bg-primary`, `text-destructive`) still resolve to the new tokens so
nothing broke mid-migration. New code uses the new names.

## 2. Brand — `apps/desktop/src/brand/`

`BRAND.name`, `BRAND.wordmark`, `BRAND.tagline`; `<BrandMark tone>` and
`<Wordmark size tone>`. Source SVGs in `apps/desktop/public/brand/`. The
window title (`main.tsx`), favicon (`index.html`), Tauri bundle
(`tauri.conf.json` productName/window title) and app icons
(`src-tauri/icons`, generated with `tauri icon`) all derive from this.

i18n strings that mention the product take it as a parameter
(`t.pages.overview.lede(t.shell.appName)`), so a rename is one edit.

## 3. Motion — `apps/desktop/src/motion/`

`index.ts` is the vocabulary (variants + transitions); `components.tsx` is
what views actually use:

| Component | Use it for |
|---|---|
| `<Page>` | The screen's stagger container. Shell already wraps each view in one, keyed by view. |
| `<Block>` | Every top-level section of a view. Rises in with the page stagger; slides (never jumps) when siblings change. |
| `<Reveal when>` | A section that exists only in some state — forms that open, results that land, expanders. Rises in, fades out, pushes siblings smoothly. |
| `<Swap k>` | One slot, many states (idle → running → done). Cross-fades. |
| `<Stagger>` / `<Row>` | A fixed list whose rows appear one after another (scan steps). |
| `<List>` / `<Item>` | A list that grows/shrinks at runtime (cases, log lines, results). |

Rules:
- `layout="position"` on the thing that moves; **never bare `layout` on a
  container** (it interpolates size and warps the children).
- Ambient loops (spin, glow, sweep, dust) are CSS utilities in `index.css`;
  discrete appear/leave and layout motion are framer-motion.
- Reduced motion is honoured from one place (`MotionConfig
  reducedMotion="user"` in `main.tsx`, plus the CSS media rule).

## 4. Primitives — `apps/desktop/src/components/ui.tsx`

Built only from tokens. The set: `Card` (`flush` for cards with their own
head/table), `CardHead`, `Kicker`, `SectionLabel`, `PageHeader`, `Note`,
`Mono`, `Button` (`primary` outlined accent / `secondary` / `ghost` /
`destructive`; `size`, `icon`, `busy`, `block`), `IconButton`, `Input`,
`Select`, `Field`, `Seg`, `ChoiceCard`, `Chip`, `Pill` (the four sensor
states `verified · inherited · candidate · standard` plus `ok · warn · stop
· info · accent`), `Dot`, `LiveChip`, `ProgressBar`, `SweepBar`, `Spinner`,
`EmptyState`, `Banner`, `Table/Th/Td/Tr`, `ExpanderButton`, `Dialog`,
`UnderlineTabs`, `Skeleton/CardSkeleton`, and the two feedback hooks
`useTransientLabel` / `useCyclingLabel`.

Type scale (px): page title 22 · card head 19 · body 13.5/13 · secondary
12.5/12/11.5 · kicker 10.5 uppercase +0.1em · pill 10.5 · stat 23 mono.
Numbers always `num` / `<Mono>`.

## Adding something new

1. Need a color/size/timing that isn't a token? Add it to `tokens.css`,
   name it in `index.css` and `dom.ts`. The test will tell you if you forget.
2. Need a component? Add it to `ui.tsx` from tokens; don't style inline in a view.
3. Something appears, changes or leaves? Wrap it in the matching motion
   component; don't reach for `motion.div` in a view.
4. Copy goes through `i18n/` (dictionary type + en + es); the product name
   is a parameter, car brands appear only as data.
