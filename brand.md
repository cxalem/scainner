# Brand — Scainner

_Status: active (documented from decisions made 2026-08-14 with the owner)_

Personal OBD2 diagnostic app for macOS. The brand identity is **"calm instrument"**:
a clean, data-forward health/analytics tool — deliberately NOT the black-cockpit,
skeuomorphic-gauge, racing-font cliché of the OBD app category.

## Palette

Defined as CSS custom properties in `src/index.css` (light + `.dark` variants),
exposed through Tailwind v4 `@theme inline` tokens. Use tokens only — never raw hex.

- `--primary`: green (oklch 0.55/0.18/155 light · 0.7/0.16/155 dark) — the single
  accent. Used for: healthy states, live data, primary actions.
- `--destructive`: red — errors, faults, dangerous actions only.
- `--warn`: amber — watch-state, cautions.
- Neutrals: warm-tinted background/card/muted/border ramp; dark mode elevates
  surfaces lighter, text is soft white (not pure).
- Semantic colors carry meaning (green = good, amber = watch, red = attention);
  never decorative.

## Typography

- UI: system sans (-apple-system / Inter fallback).
- **Numbers: monospace + `tabular-nums`, always** — every sensor value, voltage,
  code, VIN, hex byte. This is the app's strongest visual signature.
- Body sizes: `text-sm` default, `text-xs` secondary. No text below 12px.

## Iconography

- **lucide-react only. No emojis anywhere in the UI** (explicit owner decision).
- One stroke width throughout; 16px icons beside `text-sm`, 20px beside `text-base`.
- Status communicated by icon + token color (dot/tint), not emoji.

## Voice

- Two registers, on purpose:
  - **Owner-facing surfaces** (Overview verdicts, alerts): plain language, no
    jargon, complete sentences. "Reaches proper operating temperature and never
    overheats." Numbers included but explained.
  - **Lab surfaces** (UDS, raw sensors): terse, technical, hex-friendly.
- Empty states teach the next action; errors state what happened and how to recover.
- **Docs (README, code comments) are documentation, not marketing.** State what
  something does and why it exists — no comparisons to other tools, no
  "why choose us," no rhetorical setup-then-reveal framing. Corrected 2026-08-15
  after the README first draft read like a pitch (owner feedback: "that read me
  sounds like you're selling something... people wouldn't care that this is open
  source... just talk about what this does").

## Layout system

- Left sidebar (240px) with grouped nav: Overview / Live / History / Diagnose ·
  divider · Lab / Vehicle. Connection card pinned at the sidebar bottom —
  connection state is the app's most important global state.
- Cards: `rounded-lg`, 1px `border-border`, flat (border-separated, minimal shadow).
- Content max width `max-w-4xl` inside the content pane; 4px spacing grid.
