# Research: loading, state and performance

## 1. Data-fetching inventory

Fact (code): every view hand-rolls `useState` + `useEffect` + `invoke`, no
shared cache. Confirmed in `src/App.tsx`: views are mounted with
`{view === "x" && <X />}`, plain conditional rendering, not a keep-alive or
display:none swap. React unmounts a view the moment it stops matching, so
every tab switch away and back re-runs every effect from scratch.

| View | Fetches | When | Loading state | Error state | Refetch on switch |
|---|---|---|---|---|---|
| Overview | `report_cars`, `car_report` | mount, `refreshKey`/`vin` change | none distinct from empty | swallowed | yes, full remount |
| Live | `all_sensors` (button) | click | spinner + label | inline string | gauges rebuild from App-level `live` prop; sensor table lost |
| History | `reading_keys`, `history`, `report_cars`+`car_report` | mount, `key`/`hours` change | text `"loading…"` only | swallowed | yes, chart refetches |
| Diagnose | `dtc_history` (mount); `scan_dtcs`+`readiness`, `clear_dtcs`+rescan (buttons) | mount + actions | spinner + label | inline string | yes, history and last scan lost |
| Lab | `uds_modules` + 4 child cards, each own invoke | mount, per-card | mixed, not audited card-by-card | mixed | yes, all cards remount |
| Vehicle (lazy) | `car_info`, `db_path` (mount); 3 action invokes | mount + actions | none | swallowed on load | yes, full remount |
| DiscoveryFlow (lazy, one-shot) | `read_ecu_info`, `all_sensors`, `scan_dtcs` via `Promise.all` | mount, once per new VIN | dedicated flow UI | per-call `.catch(() => null)` | n/a, unmounts after done |

Assessment: the mutation-then-refetch pattern is already explicit and
consistent (Diagnose's `doClear` runs `clear_dtcs` then `scan_dtcs` then
`loadHistory`; Vehicle's `readEcu` reloads `car_info` after writing). That
maps directly onto a query library's mutate-then-invalidate flow.

## 2. Loading-state inventory

| Surface | Today | Gap |
|---|---|---|
| Vehicle tab / VehicleScene chunk | `Suspense` + `animate-pulse` skeleton | consistent, the one real skeleton in the app |
| DiscoveryFlow chunk | `Suspense` + full-screen cover div | consistent, documented anti-flash choice |
| Overview before `report` resolves | full "No data yet" empty-state card | misleading: a car WITH history shows the same "connect and drive" copy for the ~1 fetch round trip, indistinguishable from a truly empty DB |
| History TrendChart | text `"loading…"` next to sample count | blank chart area, will jump size once data lands |
| Diagnose scan result, Live sensor table | button spinner only | blank until first fetch, no skeleton, but also no jump |
| Vehicle Identity card | "Nothing read yet" text | correct as an empty state, but visually identical to "still loading" |

Assessment: the app's one skeleton pattern (`animate-pulse`, sized to
eventual content) is good and reusable, it just is not applied outside the
two `Suspense` boundaries. The sharper problem is not missing skeletons,
it is "no data" and "loading" rendering identically in several places.

## 3. Bundle and asset reality

Fact (`npx vite build`, this pass, gzip):

| Chunk | Gzip | Contents |
|---|---|---|
| `index` (main, eager) | 204 KB | React, recharts, lucide-react, Overview/Live/History/Diagnose/Lab + Lab's 4 sub-cards, `ui.tsx`, `ai.ts`, `dtc.ts`, `meta.ts`, `mock.ts` |
| `VehicleScene` (lazy) | 264 KB | three.js, @react-three/fiber, drei, all 3 loader classes, plus the geometry actually used |
| `Vehicle` + `DiscoveryFlow` (lazy) | ~1.5 KB each | tiny |

Concrete findings:

- **Recharts ships eagerly.** `History.tsx` and `Overview.tsx` both import
  it directly, and Overview is the default view, so the full charting
  library is in the main chunk before the user does anything.
- **VehicleScene carries dead code.** Active path traced:
  `VehicleScene` -> `BrandEmblemModel` -> `CitroenEmblem` or
  `NameplateEmblem`, pure `THREE.Shape` geometry, no file loads.
  `StlCarModel`/`GlbCarModel`/`CarModel` (the OBJ/GLB/STL pipelines, most
  of the file) are exported but never imported elsewhere (grep-confirmed).
  The module is reached via dynamic `import()` accessed as
  `m.VehicleScene`, so Rollup keeps the whole namespace alive and does not
  tree-shake those exports; their loader imports ride along in the 264 KB
  chunk. Belongs to BACKLOG stream C (owns this file), noted here as a
  real contributor.
- **`public/models/` + `public/models-preview/`** (~40 MB) are never
  fetched at runtime today, same trace: nothing active references
  `MODEL_URL`/`STL_URL`/`GLB_URL`/`ATLAS_URL`/decal URLs. Inflates the
  installer, not network transfer. Also stream C's call.
- **`mock.ts` is bundled unconditionally.** `tauri.ts` imports it at
  module scope regardless of `MOCK_MODE`, so demo data and the mock event
  bus ship inside real Tauri builds too. Small, easy, low-risk trim.

## 4. The event system

Fact (code): `src/lib/tauri.ts` routes `invoke`/`listen` to either
`@tauri-apps/api` or `mock.ts`'s hand-rolled event bus. Only `conn-status`
and `live-update` exist, both consumed once in `App.tsx` and passed down
as props; no view listens directly. `live-update` self-clears after 10s.

Assessment: clean seam for cache invalidation. A future write action
(stream G) or DTC-cleared event could call `setQueryData`/
`invalidateQueries` from where `App.tsx` already owns the listener, no
view needs to know an event bus exists. Favors a library with an
imperative cache API over a hooks-only one.

## 5. Server-state library options

| | TanStack Query v5 | SWR | Hand-rolled |
|---|---|---|---|
| Bundle gzip | ~13-16 KB, sources disagree ([Bundlephobia](https://bundlephobia.com/package/@tanstack/react-query), [Refine 2025](https://refine.dev/blog/react-query-vs-tanstack-query-vs-swr-2025/)) | ~4 KB ([PkgPulse 2026](https://www.pkgpulse.com/guides/tanstack-query-vs-swr-2026)) | 0, but is code to maintain |
| Works with `invoke` | yes, `queryFn` returns a Promise ([DeepWiki](https://deepwiki.com/dannysmith/tauri-template/5.4-tanstack-query-integration)) | yes, same reasoning | trivially |
| No-refetch-on-nav | yes, `staleTime` is the library's core job | yes, dedupe/revalidate config | build the keyed cache by hand |
| Suspense skeletons | yes, `useSuspenseQuery`, first-class in v5 | yes, `suspense: true`, less documented | manual |
| Mutate then invalidate | yes, matches existing `doClear` pattern exactly | possible, less structured | already informal in the code |
| Event-driven update | yes, `setQueryData`/`invalidateQueries` anywhere | yes, global `mutate(key, data)` | manual subscriber registry |
| Ecosystem | large, official DevTools | smaller | none |

Tauri nuance (assessment): IPC round trips are local and fast, so unlike a
real HTTP app the win is not hiding network latency, it is (a) not
re-running every fetch on every tab switch, (b) one consistent
loading/error shape instead of six hand-rolled ones, (c) skeletons that
stay visible long enough to matter. That last point is concrete here:
`mock.ts` adds deliberate delay to every call (90-160ms baseline, up to
900ms for `connect`/`all_sensors`, 600ms for `scan_dtcs`), so the browser
demo used for review will show loading states a real Tauri build might
not, arguing for testing skeletons against the mock path specifically.

## 6. Incremental loading patterns

Assessment, mapped to what exists: shell-first render is already true
structurally (`Shell` renders immediately); the gap is "mounted" vs "has
data" being conflated (section 2). Per-card suspense fits naturally, the
app is already card-based (`ui.tsx`'s `Card`/`CardContent`), same
`Suspense`+`animate-pulse` shape applied per card instead of per lazy
chunk. Deferring the three.js chunk is already done; the remaining win is
trimming what rides inside it (section 3), not a new boundary. There are
no routes, only a tab `Shell`, so route-level splitting is already served
by the existing `lazy()` boundaries; Overview stays eager as the default.

## 7. Client state beyond a server cache

Assessment, answered honestly: no. Every state value is either server data
(fits a query cache), local form/UI state (`price`, `filter`,
`confirmClear`, dropdowns, fine as `useState`), or the three cross-view
values `App.tsx` already owns and passes down (`conn`, `live`, `view`).
None needs Redux/Zustand/Jotai. `conn`/`live` could become query-cache
entries fed by the listeners instead of props, a nice-to-have consistency
move, not a functional gap; leave `App.tsx`'s prop-drilling alone unless
the planner wants that cleanup specifically.

## 8. Approaches and recommendation

**A: TanStack Query v5 around every `invoke` call.** `QueryClientProvider`
at the root, each view's fetch becomes `useQuery`/`useSuspenseQuery`,
mutations become `useMutation` + `invalidateQueries` matching the existing
mutate-then-refetch calls, one skeleton per query key reusing the existing
`animate-pulse` language. Cost: one dependency (~13-16 KB gzip), a
mechanical but real rewrite touching every view. Benefit: solves
no-refetch-on-nav, a consistent loading/error shape, suspense-driven
skeletons, and a documented place for the event bus to update the cache.

**B: small hand-rolled cache** (module-level `Map<key, {data, ts}>` plus a
`useCachedInvoke` hook). Zero new dependency, can replicate "don't refetch
if fresh" and a shared loading/error shape in roughly 100-150 lines.
Cannot cheaply replicate Suspense integration, mutation/invalidation
ergonomics, or DevTools; those get hand-built too, or skipped.

Recommendation (assessment, planner decides): **A**. Section 1 shows 7
views doing near-identical invoke+useState+useEffect, and the
mutate-then-refetch pattern already hand-built in Diagnose/Vehicle is
exactly what `useMutation`+`invalidateQueries` formalizes. 13-16 KB gzip is
small next to the existing 204 KB and 264 KB chunks (section 3). Building
B means re-solving a solved problem for roughly 10 KB of saving, while
losing Suspense/DevTools support the skeleton work in stream H likely
wants anyway.

## 9. Sequencing versus stream F (i18n)

Both streams restructure the same view files (section 1's table).
**app-perf builds first.** A query-cache rewrite changes each view's data
layer (the top-of-file `useState`/`useEffect` block) without touching its
JSX/copy; i18n changes the JSX/copy without touching the data layer.
Building app-perf first means i18n's string-extraction pass touches each
view once, against its final data-fetching shape, instead of once now and
again after a cache rewrite reshuffles the same files. The reverse order
also works but threads the cache rewrite through translation-wrapped JSX
for no compensating benefit. Per `docs/BACKLOG.md` these two streams must
not run concurrently over the views regardless of order; this is input to
the plan stage's sequencing, not a build in progress.

## Scope: not investigated

- No benchmark of real Tauri IPC round-trip latency on this repo's Rust
  commands (assessed near-zero per general Tauri architecture, not
  measured).
- No prototype of TanStack Query or SWR; no code written or modified.
- Lab's 4 child cards not audited individually for loading/error state,
  grouped as one row in section 2, flagged for the planner to size.
- TanStack Query's exact gzip figure not chased further; sources gave
  13 KB and 16 KB, both small enough not to change the recommendation.
- Zustand/Jotai/Redux not researched in depth, ruled out in section 7 on
  the grounds that no client-state gap exists to justify them.
