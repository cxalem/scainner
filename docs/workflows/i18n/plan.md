# Plan: internationalization (English + Spanish)

Builds on `research.md` (2026-08-20, re-verified 2026-08-21 — all its
file-path and count claims still hold after the Effect/monorepo
restructuring; only `lib/meta.ts` renamed, to `shared/domain/gauges.ts`).
Per BACKLOG.md stream F's own rule, this plan needs a real go-ahead
before any code — unlike every other stream this session.

## Decisions

**Library: the typed dictionary** (`en.ts`/`es.ts` + a `useT()` hook,
no new dependency), per research.md's own recommendation. Exactly two
locales, no ICU plural-grammar need beyond the one existing hand-written
ternary, and `tsc --noEmit` — already a mandated pipeline gate — makes a
key missing from either file a build failure for free, same enforcement
model as everything else this session (Effect's Schema decode boundary,
the design-tokens tests). A full framework (react-i18next et al.) is
real, proven machinery this app doesn't need yet; add it later if a
third locale or real plural complexity shows up.

**Locale toggle: a small control in `Shell.tsx`'s sidebar now**, not
waiting on the still-unbuilt Settings view (BACKLOG item B). Persisted
to `localStorage` under `scainner.locale`, same idiom as the Anthropic
API key. Detection order: stored preference → `navigator.language` →
English default. Cheap to move into a real Settings view later; not
worth blocking Spanish on a view that doesn't exist yet.

**Backend/Rust strings: out of scope for this stream's first phases.**
research.md found three real cases (duplicated/partial PID label lists,
UDS module labels hardcoded in Rust, OS notification title/body composed
in `supervisor.rs::notify()`, plus 5+ sites where a raw `String(e)`
Rust error reaches the UI unlocalized). All real, none blocking "the app
should be in Spanish" for its actual UI chrome and diagnostic content —
the highest-value, most user-visible 90% of this ask. Deferred to Phase
5, using research's own recommendation when it happens: stable error
codes mapped to translated copy on the frontend, not translating inside
Rust (keeps Rust owning data, frontend owning presentation, and avoids
plumbing a locale parameter through every Tauri command).

## Phases

**Phase 1 — infrastructure + Diagnose (this stream's first PR)**
- `src/i18n/en.ts`, `src/i18n/es.ts`, a `useT()` hook, locale
  detection/persistence, the sidebar toggle in `Shell.tsx`.
- `src/lib/format.ts`: wraps the ~5 real formatting shapes this app
  uses (`formatVoltage`, `formatPercent`, `formatScanTimestamp`, etc.)
  over `Intl.NumberFormat`/`Intl.DateTimeFormat`, reading the current
  locale — replaces raw `.toFixed()`/ISO-string-slicing at call sites
  as they're touched, not a mass find-replace across all 47+16 sites in
  one pass (that happens naturally as Phase 2 sweeps each view).
- Translate `Shell.tsx` (the one piece of chrome present on every
  screen) and `Diagnose.tsx` + its `views/diagnose/*` components fully,
  as the proof the pattern holds for a real, recently-built, non-trivial
  view — not a toy example.
- Tests: `useT()`'s fallback behavior (missing key → visible fallback,
  not a crash) and `format.ts`'s pure formatting functions are real
  pure-logic candidates per engineering.md rule 11 — colocated
  `*.test.ts`. UI-string-swap itself isn't independently testable
  beyond "does it render," which is what tsc's key-safety already
  guards structurally.

**Phase 2 — sweep the remaining five views**
Overview, Live, History, Lab, Vehicle, plus shared components
(`ConfirmWrite`, `WriteHistory`, `DiscoveryFlow`, `ConnectGate`) not
already covered by Phase 1. Same pattern, no new infrastructure
decisions — the mechanical bulk of this stream.

**Phase 3 — DTC library + gauges content**
`lib/dtc.ts`'s 30 curated entries and `shared/domain/gauges.ts`'s
labels get their own translation files (`dtc-codes.es.ts`,
`gauges.es.ts`), not folded into the Phase 1/2 string-key sweep —
research.md's own point: this is automotive technical content where a
wrong translation is bad real-world advice, not a cosmetic miss. AI-
assisted first draft, but a human review pass on the automotive
terminology before this ships, not an autonomous translate-and-merge.

**Phase 4 — AI report language**
Thread a `language` parameter into `ai.ts`'s two system prompts
(append "Write your response in Spanish." when the UI locale is
Spanish). Add `lang` to `SavedReport`; a cached report only counts as
valid if its `lang` matches the current UI locale, otherwise the UI
shows "not generated yet" and offers to regenerate — prevents silently
showing a stale-language report under a Spanish-language app.

**Phase 5 — backend/Rust strings** (deferred, see Decisions above)

## What this does NOT do

- Does not add a third locale or a general i18n framework — two
  locales, typed dictionary, matches the actual current need.
- Does not localize OS notifications, UDS/PID label sourcing, or raw
  Rust error strings in Phases 1-4 — real gaps, explicitly deferred to
  Phase 5, not silently dropped.
- Does not run concurrently with any other view-touching stream, per
  BACKLOG's own sequencing note — check before starting a second stream
  mid-way through this one.
