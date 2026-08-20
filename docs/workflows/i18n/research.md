# Research: i18n (English + Spanish)

Scope: BACKLOG stream F. Spanish is a launch requirement (first testers are
Spanish speakers in Spain), not polish. Structural stream — touches every
view — must not build concurrently with stream H (app-perf), per BACKLOG's
own sequencing note. This doc is research only; no code changed.

## 1. String inventory shape (facts, from reading the repo)

- No i18n library, no state-management library, no locale-detection plugin
  in `package.json` or `Cargo.toml` today. Lean dependency list.
- JSX copy is spread thin: rough text-node counts (grep, an undercount —
  misses template literals and attribute strings) put Diagnose.tsx,
  Overview.tsx, History.tsx around 13-15 each; the rest (Live, Vehicle,
  Lab, `lab/*`, ConnectGate, DiscoveryFlow, Shell) at 0-6. ~2,875 lines
  scanned total. A real key count needs an extraction pass at build time.
- Manual English-only pluralization already exists: `code{n === 1 ? "" :
  "s"}` (Diagnose.tsx, 3 sites). Whatever ships must handle this at least
  as well.
- **DTC library** (`src/lib/dtc.ts`, 92 lines): the heaviest burden. 30
  curated entries (`title`, `meaning`, ranked `causes[]`, `symptoms[]`) —
  dense, medical-report-style prose in one object literal, plus a
  structural decoder building system/origin strings from data. This is
  content, not UI copy — a string-key i18n library does not "solve" it.
- **AI layer** (`src/lib/ai.ts`, 160 lines): two long hardcoded English
  system prompts sent to the Anthropic API. Reports come back in English
  regardless of app locale today. Fix is a prompt instruction ("write the
  report in {locale}"), not translating the prompt itself.
- **Backend-originated strings** (`src-tauri`): real user-facing text
  originates in Rust too:
  - Sensor **PID labels are duplicated**: `elm/parser.rs` (30+ `PidDef
    .label` entries) vs `src/lib/meta.ts` `GAUGES` (12) — two hand-kept
    lists already, i18n should not add a third.
  - `elm/uds.rs` hardcodes UDS module labels ("Instrument cluster",
    "Engine ECU") consumed by the Lab UI.
  - `elm/supervisor.rs`'s `notify()` composes OS notification title/body
    in Rust ("Coolant overheating", …) — bypasses the frontend entirely,
    so a JS-only library can't translate it without passing locale into
    Tauri or moving text composition to TS.
  - 12 commands return `Result<_, String>`; the raw string reaches the
    user directly (`setError(String(e))` in several views; `{conn.detail}`
    rendered raw in Shell.tsx). Example: `"timed out waiting for dongle"`
    (`lib.rs`). Unlocalizable today without a Rust-side change.
- **Numbers**: already monospace-technical by convention — 47 `.toFixed()`
  sites, effectively zero `Intl`/`toLocaleString` (one exception). Matches
  engineering pattern #6 ("plain language, no decorative formatting").
- **Dates**: almost all raw ISO-string slicing, one `toLocaleTimeString()`
  call (Live.tsx).
- **Locale-toggle real estate**: no Settings view yet (BACKLOG stream B
  TODO). Only persistent chrome today is Shell.tsx's sidebar status card.
  `localStorage` is the established pattern for machine-local UI state
  (the Anthropic API key) — precedent for a locale preference too.

## 2. Library options (assessment, general knowledge — not web-verified
this session, see decision log)

| Option | Pluralization | TS key-safety | Enforcement | Fit for 2 locales |
|---|---|---|---|---|
| **react-i18next** | Built-in plural rules | Possible via module augmentation, not automatic | `i18next-parser` + a custom script to diff en/es keys | Overkill machinery, but the option every AI agent already knows cold |
| **@lingui** | ICU MessageFormat | Good, with macros | `lingui extract` + `compile --strict` fails build on missing keys | Strong, but needs a Vite/babel macro setup |
| **react-intl (FormatJS)** | ICU MessageFormat | Good | `formatjs extract`/`compile` CLI | Mature, similar ceremony to i18next |
| **paraglide-js** | Compile-time, per-message fns | Best-in-class — missing key is a TS error | Generated types are the enforcement | Best theoretical fit for 2 locales; younger, mostly proven in SvelteKit not Tauri+Vite+React |
| **Typed dictionary (no lib)** | Hand-rolled per string (matches ternary already in code) | 100% — `satisfies Record<Key,string>` on both `en.ts`/`es.ts` makes a missing key a `tsc` error, already a mandated gate | Free — the compiler | Honest fit for exactly two locales and a lean codebase; weakest if a 3rd locale or ICU plurals appear |

Bundle size is a minor factor for all five: this ships bundled, not fetched
per visit over a network.

## 3. Locale strategy

- Detection: `navigator.language` in the Tauri webview reflects OS locale
  on macOS/Windows without an extra plugin (assessment, untested here).
  Both are the known target platforms (BACKLOG stream D installers);
  Linux/webkit2gtk is the one platform where this is less reliable, and
  there is no evidence of a Linux target. `@tauri-apps/plugin-os`
  (`locale()`) is a first-party plugin, same trust tier as
  `tauri-plugin-notification` already in use — optional, not required.
- Toggle placement: (a) a small toggle in Shell.tsx's sidebar now, or (b)
  wait for the Settings view (BACKLOG item B). (b) avoids a throwaway
  element but blocks Spanish on another stream shipping first — a real
  trade-off for the planner, not decided here.
- Persistence: `localStorage`, one key (`scainner.locale`), same pattern
  as `scainner.anthropic_api_key`. Fallback: stored → OS/browser → English.

## 4. Translation workflow

BACKLOG stream F already states the rule in principle: Spanish copy
follows the same plain-language rule, added alongside English. Enforcement
differs by choice: the typed dictionary gets it free from `npx tsc
--noEmit` (already a mandated pipeline gate) — a missing key in either
`en.ts`/`es.ts` fails the build with zero extra config. Any of the four
libraries needs one more line in the verification step (the library's own
CLI, or a script diffing key sets). Either way, review (reviewer role, then
Codex cross-exam) should treat "string added in one locale only" as a
defect, same as an unlogged decision already counts as one (pattern #8).

## Constraints

- Licensing: all five options are MIT or MIT/Apache-2.0 — no blocker.
- Technical: Vite + Tauri webview, no SSR, so SSR-specific i18n concerns
  (hydration mismatches, server-vs-client locale) do not apply.
- The two content cases (DTC library, AI prompts) sit outside whatever
  string-key system is chosen and need their own design regardless.

## Recommendation

Two viable approaches, both defensible:

1. **Typed dictionary + `useT()` hook** (no new dependency). Best fit for
   the actual constraints: exactly two locales, a solo developer plus
   AI-agent builders, a lean-dependency codebase, no ICU plural grammar
   need. Enforcement is free. Weakness: no easy path to a 3rd locale or
   complex plurals.
2. **react-i18next**. Best if the plan wants a battle-tested library every
   agent already knows, or expects locale/plural complexity to grow. Costs
   one dependency and an extra enforcement script.

Recommendation: **the typed dictionary** — a full i18n framework is not
justified for exactly two locales in a desktop tool with no SSR and no
current plural-grammar complexity beyond a hand-written ternary. This is a
judgment call for the planner, not a foregone conclusion.

Regardless of which option wins: the DTC library and AI prompts need their
own content-level solution, not just string keys; Rust error strings need
a decision (translate in Rust, needing locale plumbed into Tauri commands,
vs. stable error codes mapped to translated copy on the frontend — the
second is cheaper and keeps Rust owning data, frontend owning
presentation); and future Spanish (and English) UI copy follows the same
plain-language rule already in force: clear plain language, no em dashes,
no decorative formatting.

## Scope check — not investigated

- `src/components/VehicleScene.tsx` / three.js: skipped, visual not
  textual, low string count expected.
- No web search run to verify current bundle sizes or Tauri+Vite plugin
  maturity — library table above is general knowledge, flagged assessment.
- No exhaustive string count — that's an extraction-tool job for the build
  stage.
- Did not prototype `navigator.language` inside the actual Tauri webview.
