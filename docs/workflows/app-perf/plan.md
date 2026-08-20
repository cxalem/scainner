# Plan: app-perf (loading, state and performance)

## Goal

Wrap every Tauri `invoke` read in TanStack Query v5 so tab switches render
instantly from cache, give every view one consistent card-level
loading/error/empty pattern with skeletons, and take the cheap bundle wins
the research confirmed. Follows research option A (research.md section 8).

## Non-goals

- No i18n work. That is a separate stream that builds AFTER this one.
- No view redesigns beyond loading/error/empty states. Layout and copy stay.
- No removal of the dormant 3D pipelines in `VehicleScene.tsx` and no
  `public/models*` cleanup. That file belongs to stream C. The dead-loader
  bundle fix WAITS for stream C too, decided explicitly: see decisions-plan.md.
- No refactor of `conn`/`live` prop drilling in App.tsx (research section 7:
  works fine, stays as is). No Rust changes. No dark mode.

## Dependency

Branch from `main` only AFTER `ws/3d-logos` merges. Do not start the
worktree before that merge lands; this plan assumes its final `main`.

## Architecture decisions (builder must not improvise)

1. **Query client**: new file `src/lib/query.ts` exports a singleton
   `QueryClient` with defaults `staleTime: 15_000`, `gcTime: 10 * 60_000`,
   `refetchOnWindowFocus: false`, `retry: 1`. `QueryClientProvider` wraps
   the app in `main.tsx`. Add `@tanstack/react-query` only; DevTools stay
   out of the dependency list (browser demo is the debugging surface).
2. **Query keys**: first element is the Tauri command name verbatim, then
   its args in call order: `["car_report", vin]`, `["history", key, hours]`,
   `["report_cars"]`, `["dtc_history"]`, `["reading_keys"]`,
   `["uds_modules"]`, `["car_info"]`, `["db_path"]`, `["all_sensors"]`.
   All keys and hooks live in one file, `src/lib/queries.ts` (typed
   `useCarReport(vin)` style wrappers). Views never handwrite a key.
3. **Event bus**: listeners stay in App.tsx where they already are.
   `live-update` keeps feeding the `live` prop only, it never invalidates
   (it fires continuously). On `conn-status` flipping to `connected`,
   App.tsx calls `queryClient.invalidateQueries()` (everything: a new
   session can add data anywhere). DiscoveryFlow's `onDone` replaces the
   `refreshKey` counter with `invalidateQueries` on `["report_cars"]` and
   `["car_report"]`; the `refreshKey` prop is then deleted.
4. **Mutations**: `useMutation` wrappers in `queries.ts`. `clear_dtcs`
   invalidates `["dtc_history"]` and `["car_report"]` (prefix match, all
   VINs) and Diagnose keeps its rescan-after-clear behavior via the scan
   query's invalidation. `set_fuel_price` invalidates `["car_report"]`.
   Vehicle's `read_ecu_info` action invalidates `["car_info"]`.
5. **Skeletons**: a `Skeleton` primitive plus `CardSkeleton` live in
   `src/components/ui.tsx` next to Card, reusing the existing
   `animate-pulse` + `bg-muted` language, sized to the eventual content
   (no layout shift, engineering.md rule 5).
6. **Standard card pattern**, applied identically in every view, using
   plain `useQuery` status flags (not per-card Suspense; the two existing
   lazy-chunk Suspense boundaries stay as they are):
   - `isPending` -> skeleton sized like the loaded card.
   - `isError` -> inline muted error line inside the card plus a small
     "Retry" button calling `refetch()`.
   - success with empty data -> the existing "No data yet" copy. This state
     renders ONLY after a successful fetch, so "no data yet" is always
     visually distinct from "loading" (fixes Overview and Vehicle Identity,
     research section 2).

## Steps (riskiest first, each verified in the running browser demo)

Connect flow for every check: localhost:1420, Connect, wait ~15s, finish
discovery, "Go to dashboard". Mock latency (90-900ms) makes states visible.

1. **Foundation + Overview + App wiring** (riskiest: default view, touches
   discovery refresh). Install dep, add `query.ts`, provider, first hooks;
   migrate Overview's two fetches and the fuel-price mutation; replace
   `refreshKey` with invalidation. Look at: skeletons where the report and
   stat cards will be, then real cards; after discovery finishes, Overview
   shows the new car without a manual reload; switching Overview -> Live ->
   Overview renders the report instantly (no skeleton flash) while the mock
   delay proves a background revalidate happens. Fallback if the
   invalidation-on-done wiring misbehaves: keep `refreshKey` one more
   commit and only swap it out once Overview queries are proven.
2. **Diagnose** (mutation chain). Look at: DTC history renders instantly on
   revisit; clear codes -> history and Overview's "Scans clean" stat both
   update without a reload; scan button shows its spinner, result area
   shows a skeleton only on first ever load.
3. **History** (dependent queries: `reading_keys` gates `history`). Look
   at: chart area shows a fixed-size skeleton instead of `"loading…"` text,
   no size jump; changing key/hours refetches; revisit is instant.
4. **Vehicle**. Look at: Identity card skeleton on first load, "Nothing
   read yet" only after a confirmed empty read; revisit instant.
5. **Lab** (5 cards, each its own query). Look at: every card follows the
   standard pattern; no card blocks another.
6. **Live**: `all_sensors` becomes `useQuery` with `enabled: false` plus
   `refetch()` on the button. Look at: sensor table survives tab switches
   (today it is lost).
7. **Bundle trims**: (a) `tauri.ts` loads `mock.ts` via dynamic import only
   when `MOCK_MODE` is on, so real builds drop it; (b) move both recharts
   charts behind one lazy `src/components/charts.tsx` boundary with
   skeleton fallbacks, pulling recharts out of the eager main chunk. Run
   `npx vite build` before step 1 and after step 7, record gzip sizes.
   Fallback: if (b) fights Vite chunking or flashes, ship (a) alone and log it.

## Acceptance criteria

- `npx tsc --noEmit` clean; every view works in the browser demo.
- Tab switches no longer refetch-from-blank: revisiting a tab renders
  instantly from cache while revalidating (visible against mock latency).
- Every previously blank or jumping area has a sized skeleton; "no data
  yet" never shows while a fetch is pending. No layout shifts anywhere.
- Mock parity intact (engineering.md rule 3). No new console errors.
- Before/after `vite build` gzip table recorded in decisions-build.md.

## Delivery

Worktree `git worktree add ../scainner-app-perf -b ws/app-perf` (post
3d-logos merge). One small commit per step. PR: plain-language summary,
manual test walkthrough (the per-step "look at" lists above), before/after
bundle table, screenshots of skeleton and loaded states, links to
review-report.md and codex-review.md. Builder appends to decisions-build.md.
