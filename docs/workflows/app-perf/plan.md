# Plan: app-perf (loading, state and performance)

## Goal

Wrap every Tauri `invoke` read in TanStack Query v5 so tab switches render
instantly from cache; one consistent card-level loading/error/empty pattern
with skeletons; press, pending and error feedback on every interactive
element; the cheap bundle wins the research confirmed. Follows research
option A (research.md section 8) plus interaction-audit.md.

## Non-goals

- No i18n work. That is a separate stream that builds AFTER this one.
- No view redesigns beyond loading/error/empty/pending states.
- No removal of the dormant 3D pipelines in `VehicleScene.tsx`, no
  `public/models*` cleanup: stream C owns that file. The dead-loader
  bundle fix WAITS for stream C too, decided in decisions-plan.md.
- No `conn`/`live` prop-drilling refactor (research section 7). No Rust
  changes (backend progress events are follow-up). No dark mode. No toasts.

## Dependency

Branch from `main` only AFTER `ws/3d-logos` merges; the plan assumes the
post-merge `main`. Do not start the worktree before that lands.

## Architecture decisions (builder must not improvise)

1. **Query client**: new file `src/lib/query.ts` exports a singleton
   `QueryClient` with defaults `staleTime: 15_000`, `gcTime: 10 * 60_000`,
   `refetchOnWindowFocus: false`, `retry: 1`. `QueryClientProvider` wraps
   the app in `main.tsx`. Add `@tanstack/react-query` only, no DevTools.
2. **Query keys**: first element is the Tauri command name verbatim, then
   its args in call order: `["car_report", vin]`, `["history", key, hours]`,
   `["report_cars"]`, `["dtc_history"]`, `["reading_keys"]`,
   `["uds_modules"]`, `["car_info"]`, `["db_path"]`, `["all_sensors"]`.
   All keys and hooks live in one file, `src/lib/queries.ts` (typed
   `useCarReport(vin)` style wrappers). Views never handwrite a key.
3. **Event bus**: listeners stay in App.tsx. `live-update` keeps feeding
   the `live` prop only, never invalidates (it fires continuously). When
   `conn-status` flips to `connected`, App.tsx invalidates everything (a
   new session can add data anywhere). DiscoveryFlow's `onDone` replaces
   the `refreshKey` counter with invalidation of `["report_cars"]` and
   `["car_report"]`; the `refreshKey` prop is deleted.
4. **Mutations**: `useMutation` wrappers in `queries.ts`. `clear_dtcs`
   invalidates `["dtc_history"]` and `["car_report"]` (prefix match) and
   Diagnose keeps its rescan-after-clear behavior. `set_fuel_price`
   invalidates `["car_report"]`. `read_ecu_info` invalidates `["car_info"]`.
5. **Skeletons**: `Skeleton` plus `CardSkeleton` in `src/components/ui.tsx`
   next to Card, reusing the existing `animate-pulse` + `bg-muted` language,
   sized to eventual content (no layout shift, engineering.md rule 5).
6. **Standard card pattern**, identical in every view, using plain
   `useQuery` status flags (not per-card Suspense; the two existing
   lazy-chunk Suspense boundaries stay):
   - `isPending` -> skeleton sized like the loaded card.
   - `isError` -> inline muted error line plus a small "Retry" button.
   - success with empty data -> the existing "No data yet" copy, rendered
     ONLY after a successful fetch, so "no data yet" is always visually
     distinct from "loading" (research section 2).

## Interaction feedback (rules adopted from interaction-audit.md)

7. Every button that triggers an `invoke` disables and shows a distinct
   pending label or icon while in flight, no exceptions. Mutations wire
   `useMutation`'s `isPending` to the button visually.
8. Every user-triggered `invoke` gets a visible catch rendered near its
   trigger, reusing the existing `border-destructive/30 bg-destructive/10`
   box. The Lab handlers with none today (RemoveModuleButton, ProbeManager
   save/toggle/delete) are in scope. Swallowed catches stay acceptable
   only for mount fetches covered by the card pattern's `isError` branch.
9. Pending UI scales by latency class: instant = disable plus a slight
   opacity dip. Slow hardware = spinner plus a changing status label,
   narrated via DiscoveryFlow's sequential-await shape where real phases
   exist; with Rust out of scope, `connect`/`all_sensors` use timed
   phrases. Network AI calls (10-60s, plain `fetch` in `ai.ts`, outside
   the query layer but inside these rules) cycle 2-3 timed phrases so a
   40s wait never reads frozen.
10. Success feedback reuses the existing transient label pattern ("Saved"
    / "Copied" for ~2s), extracted once into a small helper in `ui.tsx`.
11. Real `:active` press state (`active:scale-[0.98]` or similar) on the
    shared Button, Segmented and nav classes, so every click responds
    instantly, including sync-only controls.
12. Stale-data guard: `["car_report", vin]` uses no `placeholderData` or
    `keepPreviousData`; a VIN switch drops to the skeleton and never shows
    the previous car's report during the new fetch.

## Steps (riskiest first, each verified in the running browser demo)

Connect flow for every check: localhost:1420, Connect, wait ~15s, finish
discovery, "Go to dashboard". Mock latency (90-900ms) makes states visible.

1. **Foundation + shared primitives + Overview + App wiring** (riskiest:
   default view, touches discovery refresh). Install dep, add `query.ts`,
   provider, first hooks; add Skeleton/CardSkeleton, the `:active` press
   states (rule 11) and the transient success helper (rule 10) to
   `ui.tsx`; migrate Overview's fetches and the fuel-price mutation
   (gains its missing catch plus a "Saved" flash); replace `refreshKey`
   with invalidation; give ConnectGate/Shell connect timed phrase
   narration and Disconnect a pending state. Look at: skeletons then real
   cards; VIN switch drops to skeleton, never the old car's report;
   connect narrates; nav and buttons depress on click; Overview -> Live ->
   Overview renders instantly with a background revalidate. Fallback: keep
   `refreshKey` one extra commit if the invalidation wiring misbehaves.
2. **Diagnose** (mutation chain, audit's worst offender). "Yes, clear"
   becomes a `useMutation` whose `isPending` disables the button and shows
   "Clearing…" (today it stays clickable); both AI actions cycle timed
   phrases. Look at: clear disables and narrates; DTC history and
   Overview's "Scans clean" stat update without a reload; the AI wait
   shows changing copy, not a frozen label.
3. **History** (dependent queries: `reading_keys` gates `history`). Look
   at: fixed-size chart skeleton instead of `"loading…"` text, no size
   jump; key/hours changes refetch; revisit is instant.
4. **Vehicle** (offender 2). "Read from ECU" becomes a `useMutation` with
   spinner, disable and a visible error (today zero feedback); copy and
   export buttons get disable plus a catch. Look at: Identity card
   skeleton vs "Nothing read yet" only after a confirmed empty read;
   read-ECU shows pending and surfaces failures.
5. **Lab** (5 cards). Standard card pattern per card, and every write
   handler (add/remove module, probe save/toggle/delete) gets
   disable-while-pending and a visible catch (today several are unhandled
   rejections). Look at: no card blocks another; each write button
   disables and errors visibly.
6. **Live**: `all_sensors` becomes `useQuery` with `enabled: false` plus
   `refetch()` on the button; pending copy upgraded to timed phrases.
   Look at: sensor table survives tab switches; the ~15s wait narrates.
7. **Bundle trims**: (a) `tauri.ts` loads `mock.ts` via dynamic import only
   when `MOCK_MODE` is on; (b) move both recharts charts behind one lazy
   `src/components/charts.tsx` boundary with skeleton fallbacks. Run
   `npx vite build` before step 1 and after step 7, record gzip sizes.
   Fallback: if (b) fights Vite chunking or flashes, ship (a) alone, log it.

## Acceptance criteria

- `npx tsc --noEmit` clean; every view works in the browser demo.
- Tab switches no longer refetch-from-blank: revisiting a tab renders
  instantly from cache while revalidating (visible against mock latency).
- Every previously blank or jumping area has a sized skeleton; "no data
  yet" never shows while a fetch is pending. No layout shifts anywhere.
- No interactive element anywhere ships without press feedback, a pending
  state when async, and error surfacing near the trigger. The audit's
  inventory table is the review checklist.
- Mock parity intact (engineering.md rule 3). No new console errors.
- Before/after `vite build` gzip table recorded in decisions-build.md.

## Delivery

Worktree `git worktree add ../scainner-app-perf -b ws/app-perf`, one small
commit per step, builder decisions in decisions-build.md. PR: plain-language
summary, manual test walkthrough (the "look at" lists), before/after bundle
table, skeleton/pending/loaded screenshots, links to both review docs.
