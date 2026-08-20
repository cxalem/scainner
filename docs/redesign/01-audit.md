# Scainner — full-app audit for the visual redesign

_Written 2026-08-19, ahead of a full visual redesign (light theme, real per-vehicle 3D model). Covers the whole frontend, the Tauri command/event contract, dependencies, and repo hygiene. Point-in-time — re-verify file:line references if the code has moved on._

## TL;DR

- The app is **small** (~3,300 lines TS/TSX across 18 files, ~1,000 lines Rust). This is not a sprawling codebase — a redesign here is a focused job, not an overhaul.
- **The "dark background" isn't a design choice, it's a default.** `main.tsx` sets the `.dark` class purely from `window.matchMedia("(prefers-color-scheme: dark)")` — there is no manual toggle and no persisted preference. `index.css` already defines a complete light-mode token set (`:root`) alongside `.dark`. If your OS is in dark mode, the app is dark; that's the entire mechanism.
- **The 3D car is a deliberate, explicitly-labeled placeholder**, not a bug. `VehicleScene.tsx`'s own top comment: "an abstracted wireframe silhouette... not a literal car profile... the placeholder for the product plan's real per-VIN 3D model (CarImages API, needs an API key we don't have yet)." Rendering your actual Citroën was never wired up — the product plan (`~/projects/personal-hub/1-Projects/Scainner/product-plan.md`) already scopes this as a future workstream, gated on verifying CarImages covers your car.
- **The design-system foundation is in good shape.** Almost the entire view/component layer is token-driven (`bg-primary`, `text-destructive`, etc.) — a redesign is mostly "change the tokens in `index.css` + `brand.md`," not "rewrite every view." The one component that must be rebuilt outright for the redesign's stated goals is `VehicleScene.tsx`.
- **One real bug found** (not a design issue): `ModuleFaults.tsx`'s "clear module faults" flow will throw in mock/browser-preview mode — see Bugs section.
- **The working tree has substantial uncommitted work** — see Repo hygiene. Worth a decision before branching for the redesign.

---

## 1. Architecture map

```
main.tsx          → sets .dark from OS preference, mounts <App> inside <ErrorBoundary>
App.tsx           → owns conn/live state, Tauri event subscriptions, view routing
  Shell.tsx        → sidebar nav (6 views) + persistent connection card
  views/
    Overview.tsx   → stat tiles, rules-based health verdicts, fuel gauge, voltage trend chart
    Live.tsx        → gauge grid (live-update event) + on-demand "read all sensors"
    History.tsx     → per-key trend chart + sensor-range table + recent sessions
    Diagnose.tsx     → DTC scan/clear, readiness monitors, freeze frame, scan history
    Lab.tsx          → UDS module picker, wraps 5 sub-views:
      lab/ModuleManager.tsx   → list/add/remove custom UDS modules
      lab/DidReader.tsx        → single-DID read
      lab/RangeScanner.tsx     → chunked DID range scan + live progress (uds-scan-progress event)
      lab/ProbeManager.tsx     → turn a scan hit into a persisted polled "probe"
      lab/ModuleFaults.tsx     → module-level fault read/clear (verified clear)
    Vehicle.tsx      → identity card, VehicleScene, export/AI-briefing actions
  components/
    DiscoveryFlow.tsx → first-time-VIN full-screen onboarding overlay (identity → sweep → results)
    VehicleScene.tsx   → the 3D placeholder (react-three-fiber)
    ui.tsx              → hand-rolled shadcn-style primitives (Card, Button, Segmented, Badge, Tabs)
lib/
  meta.ts   → shared types + static metadata (GAUGES, labels, ranges)
  mock.ts   → full in-browser backend simulator (MOCK_MODE)
  tauri.ts  → invoke()/listen() wrapper, routes to mock.ts or real Tauri
  utils.ts  → cn() helper
```

Backend (`src-tauri/src/`): `lib.rs` (30 `#[tauri::command]`s + 3 events), `db.rs` (SQLite schema/queries), `elm/{driver,obd,parser,supervisor,uds}.rs` (dongle transport + protocol layers).

## 2. Design system — current state

`brand.md` is the existing, current, deliberate design contract — verified against `index.css` and it matches exactly (same oklch values, same token names). Summary:

- **Identity**: "calm instrument" — clean, data-forward, explicitly *not* the black-cockpit/gauge-cluster OBD-app cliché.
- **Palette**: CSS vars in `index.css`, both `:root` (light) and `.dark`, exposed via Tailwind v4 `@theme inline`. Single accent `--primary` (green), `--destructive` (red, errors only), `--warn` (amber, cautions only) — semantic, never decorative. Tailwind v4 config is **entirely inline in `index.css`** — there is no separate `tailwind.config.*` file.
- **Typography**: system sans for UI; **numbers are always monospace + `tabular-nums`** — called out as the app's strongest visual signature.
- **Icons**: lucide-react only, explicitly zero emoji (your decision).
- **Layout**: 240px left sidebar, grouped nav, connection card pinned at the bottom.

A redesign should treat this file as the thing to consciously extend or supersede — not silently drift from. If you're going full light-theme, the cleanest move is editing `brand.md` and `index.css` together so they never disagree again.

## 3. Component reuse — what's shared vs. reinvented

**Actually shared and load-bearing** (safe to keep the API, just re-skin): `Card`/`CardHeader`/`CardTitle`/`CardContent` (used everywhere), `Button` (used in most, not all, places).

**Patterns reinvented by hand, 3-6 times each, with no shared primitive** — this is the biggest lever for making the redesign fast instead of repetitive:

| Missing primitive | Currently hand-copied in |
|---|---|
| `Input` | `DidReader.tsx`, `ModuleManager.tsx`, `ProbeManager.tsx`, `RangeScanner.tsx` — identical `inputCls` string, copy-pasted 4x |
| `Select` | `Overview.tsx` (car picker), `History.tsx` (sensor picker), `Lab.tsx` (module picker) — 3 independent hand-styled `<select>`s |
| `Table` | `Live.tsx`, `DiscoveryFlow.tsx`, `History.tsx` (x2), `Diagnose.tsx`, `RangeScanner.tsx`, `ProbeManager.tsx` — 6+ independent row/header implementations of the same pattern |
| `Alert`/error banner | `DiscoveryFlow.tsx`, `Live.tsx`, `Diagnose.tsx` — same `border-destructive/30 bg-destructive/10` banner, copy-pasted |
| `ClearConfirmBanner`/`ClearResultBanner` | `Diagnose.tsx` and `ModuleFaults.tsx` — near line-for-line duplicate confirm→clear→before/after-result flow |

Also: `History.tsx`'s range picker reinvents `Segmented` instead of calling the `Segmented` component already imported two lines away; Shell's "Demo data" pill reinvents `Badge`'s warn variant; `ErrorBoundary.tsx`'s recovery button hand-copies `Button`'s default styling.

**Dead code**: `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` in `ui.tsx` — zero usages anywhere in the app.

**Recommendation**: build `Input`, `Select`, `Table`, `Alert` into `ui.tsx` *before* restyling views one by one — otherwise every visual change has to be made 3-6 times by hand, and the redesign will drift between views as they're touched at different times.

## 4. Every hardcoded / non-token style found

The good news: there are only two real offenders, and they're both in the file that's getting rebuilt anyway.

| Location | What | Impact |
|---|---|---|
| `VehicleScene.tsx:21-22` | `INK = "#2b2f36"`, `PAPER = "#f7f7f5"` — plus a raw hex `hemisphereLight` and `text-black/40` caption | The whole 3D scene is hardcoded to always render light-mode-only, by explicit design comment, completely disconnected from `index.css` tokens. **This is the component you're rebuilding anyway** — no token work needed here, just a fresh design decision (see §6). |
| `ui.tsx` `Button` destructive variant | `text-white` literal | There's no `--destructive-foreground` token defined in `index.css` to point it at instead — worth adding one so this stops being a literal. |
| `Overview.tsx:373-375`, `History.tsx:93` | `stroke="var(--primary)"` / `var(--destructive)"` on Recharts `<Line>` | Actually token-driven (re-themes correctly), just invisible to a Tailwind-class search — flagging so it's not missed. |

Everything else in the view/component layer is Tailwind token classes. This is the main reason the redesign should be tractable: the token system is already the single source of truth almost everywhere.

## 5. Backend contract (Tauri commands/events)

- **30 commands, all called from the frontend, none orphaned.** Full command→caller map lives in the agent transcript if you need it later; nothing here needs cleanup before a redesign.
- **3 events** (`conn-status`, `live-update`, `uds-scan-progress`), each with exactly one emitter and one listener — no mismatches.
- **Contract is stable enough to design new UI against as-is.** Minor rough edges only: `report_cars`/`car_info` return positional tuples (`[vin, count][]`) rather than named objects — fine to leave, but a small adapter in a new data layer would make new UI code cleaner than destructuring tuples inline. Commands are snake_case, events are kebab-case — cosmetic.
- **Mock coverage is complete** (every command has a mock case) but several Lab-view commands mock to inert stubs (`uds_read`→null, `list_probes`/`uds_scan`/`uds_module_dtcs`→`[]`, module add/delete → no-ops). Practically: **the Lab views' "found something" / "list has content" states can't be visually reviewed in browser-preview mode** without either a real dongle or richer mock fixtures. Worth beefing up `mock.ts`'s Lab-related fixtures if you want to iterate on those views' visuals without your car connected.
- Diagnose's fault-found states (MIL-on, stored codes, freeze frame) are also never exercised by mock data — same issue, one level up from Lab.

## 6. Bugs found (not design issues, but will get in your way)

1. **`ModuleFaults.tsx` "clear module faults" throws in mock mode.** Real backend returns `ClearOutcome { before, accepted, after }`; `mock.ts`'s `uds_clear` case returns `{ cleared: 0 }` — a different shape entirely. The component reads `outcome.before.length`/`outcome.after.length`, which will be `undefined.length` in mock mode. Fix: make the mock case return a shape matching `ClearOutcome`.
2. **`mock.ts`'s date anchor is hardcoded**, not relative: `buildCarReport()`/`buildDailyVoltage()` anchor "today" to a literal `new Date("2026-08-19T00:00:00Z")`. It happens to match today, but it will silently go stale as a fixed date rather than tracking real time — worth switching to a relative anchor if the mock data needs to keep looking "current" going forward.

## 7. Dependency & asset cleanup

| Item | Status | Action |
|---|---|---|
| `class-variance-authority` (dependency) | Zero usages anywhere in `src/` | Drop, unless the redesign wants variant-heavy component APIs (in which case, adopt it properly) |
| `@tauri-apps/plugin-opener` (npm package) | The Rust crate is used; the JS bindings package has zero import sites | Drop unless the redesign needs to open external links from the frontend |
| `src/assets/react.svg` | Unreferenced Vite scaffold leftover | Delete |
| `public/tauri.svg` | Unreferenced Tauri scaffold leftover | Delete |
| `public/vite.svg` | **Actually wired up** as the app favicon (`index.html`) | This is user-visible (browser tab / window icon) and is still the default Vite logo — clashes with the "calm instrument" brand. Real favicon is a good redesign-launch item. |
| `Tabs` family in `ui.tsx` | Dead code, zero usages | Delete, or keep if the redesign has a concrete tabbed-UI plan |

Build/config is clean and current — no stale devDependencies, Tailwind v4 configured correctly inline, path alias `@` → `src/` consistent between `vite.config.ts` and `tsconfig.json`.

## 8. Repo hygiene — read before branching

`git status` on `main` right now:

```
 M package.json, pnpm-lock.yaml, src-tauri/src/db.rs, src-tauri/src/elm/parser.rs
 M src/App.tsx, Shell.tsx, lib/meta.ts
 M src/views/{Diagnose,History,Lab,Live,Overview,Vehicle}.tsx + all of views/lab/*
?? src/components/DiscoveryFlow.tsx
?? src/components/VehicleScene.tsx
?? src/lib/mock.ts
?? src/lib/tauri.ts
```

This is the **previous "sidebar redesign + mock mode + discovery flow" work** — real, substantial, and still sitting uncommitted on `main`. Before starting the visual redesign, worth deciding: commit this as its own checkpoint first (clean baseline to branch a visual redesign from), or fold it into the same effort. Not doing this silently — flagging it so it's a decision, not a surprise later.

## 9. Keep / rebuild / delete — the shortlist

**Keep as-is structurally** (redesign = retoken + reclass, not rewrite): `Card`/`Button` in `ui.tsx`; all of `Overview.tsx`, `Live.tsx`, `History.tsx`, `Diagnose.tsx`, `Vehicle.tsx`'s non-3D content, all of `views/lab/*`; `lib/meta.ts`, `lib/mock.ts`, `lib/utils.ts`; `ErrorBoundary.tsx` (just swap its one hand-copied button for `Button`).

**Rebuild / extract before or during the redesign:**
- `VehicleScene.tsx` — outright rebuild, per your stated goal (real per-vehicle model). See §6 of the kickoff plan for the options.
- Add `Input`, `Select`, `Table`, `Alert` primitives to `ui.tsx`; migrate the 15+ hand-copied instances above to use them.

**Delete:**
- `Tabs` family (dead code), `react.svg`, `tauri.svg`, `class-variance-authority`, `@tauri-apps/plugin-opener` (JS package) — unless you have a concrete use in mind.

**Fix (bug, not design):**
- `ModuleFaults.tsx` / `mock.ts` `uds_clear` shape mismatch.

---
See `02-kickoff-plan.md` for what to actually do with this.
