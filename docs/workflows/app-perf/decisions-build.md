# Decision log: builder, app-perf

Each block: what, options considered, why, risk. Same honesty standard as
every other stage in this repo: a plan/research quote here is either exact
or explicitly marked as my own reasoning.

## Worktree port collision (process note, not a plan decision)

What: `pnpm dev` in this worktree failed silently against the intended
port — `vite.config.ts` pins `strictPort: 1420`, and another worktree's dev
server (`/Users/cxalem/projects/scainner`, PID discovered via `lsof
-iTCP:1420`) already held that port. My first `pnpm dev` background command
exited with "Port 1420 is already in use" (visible in its log), but I did
not notice immediately and ran an early browser check against
`localhost:1420` anyway — which was actually serving the OTHER worktree's
app, not this one. Caught it when a tab-switch test showed a stale
`?brand=saic` query param and an unexplained reset to the connect gate,
neither of which this codebase's App.tsx can produce.
Options: (a) kill whatever holds port 1420 and reclaim it, (b) run this
worktree's own dev server on a different port via `pnpm exec vite --port
5183 --strictPort` (leaving the port config file untouched).
Why: (b). engineering.md rule 7 and BACKLOG.md's own process notes are
explicit: this pipeline's automatic isolation follows the wrong repo, and
another worktree's running dev server is not mine to touch — the task
boundary says not to touch `/Users/cxalem/projects/scainner` or any other
worktree, and a live process backing that worktree's own verification loop
counts. All subsequent browser verification in this log used
`localhost:5183`, confirmed via `lsof` to be this worktree's own process
before trusting any screenshot.
Risk: none to the deliverable; this is a testing-environment note, not a
source change. Flagged here so the reviewer doesn't waste time wondering
why a random port shows up in the verification steps.

## Step 1 — Foundation + shared primitives + Overview + App wiring

### `list_probes` gets a query key not in plan.md's named list

What: added `useListProbes()` with key `["list_probes"]`, extending the
naming convention (Tauri command name verbatim) to a key plan.md's
architecture section never enumerated.
Options: (a) leave `list_probes` on hand-rolled `useState`+`useEffect`
since it wasn't named, (b) extend the same naming rule to it.
Why: (b). research.md explicitly flagged this gap itself: "Lab's 4 child
cards not audited individually for loading/error state... flagged for the
planner to size." The plan's step 5 ("Standard card pattern per card")
still requires it to get the same treatment as every other list-backed
card, and the only way to do that inside the query layer is a key — I
picked the one the plan's own rule 2 (command name verbatim) already
implies.
Risk: none — same shape as every other key, purely additive.

### `dtc_history`'s key drops the `limit` argument

What: query key is `["dtc_history"]`, not `["dtc_history", 20]`, even
though plan.md rule 2 says "then its args in call order."
Options: (a) follow rule 2 literally and include the hardcoded `limit: 20`
in the key, (b) match the plan's own explicit key list, which names it
`["dtc_history"]` with no second element.
Why: (b) — plan.md's architecture section lists the exact key
`["dtc_history"]` alongside keys that DO carry args (`["car_report",
vin]`, `["history", key, hours]`), so the omission reads as deliberate:
`limit` never varies in the UI (always 20), so it isn't really a call
argument the cache needs to distinguish on. Matching the plan's literal
list over its general rule when the two disagree on one entry.
Risk: none — if `limit` ever becomes user-configurable, the key needs
updating to include it, but nothing in this stream introduces that.

### `reading_keys` and `history` stay independent queries, not `enabled`-gated

What: plan.md step 3 describes History as "dependent queries: reading_keys
gates history." I implemented them as two independent `useQuery` calls
with no `enabled` relationship between them.
Options: (a) gate `history`'s `enabled` on `reading_keys` having resolved,
matching the plan's literal wording, (b) keep them independent, matching
the actual data dependency in the code.
Why: (b), and I want to be explicit that this is my own reading, not a
plan quote I'm stretching: `reading_keys` only extends the sensor
`<select>` with extra options beyond the hardcoded `GAUGES` list; the
selected `key` state defaults to `"voltage"`, a value that is always valid
regardless of what `reading_keys` returns. There is no code path where
`history` needs `reading_keys` to resolve first to know what to fetch.
Gating `history` behind `reading_keys` would only add latency (an extra
round trip before the chart can even show its skeleton) with no
correctness benefit. I read plan.md's sentence as flagging a coordination
point to watch during migration, not a literal `enabled` gate to build.
Risk: if this reading is wrong and the plan intended a real gate, the only
symptom would be the sensor `<select>` briefly missing extra keys on a
very first paint — cosmetic, not a data-correctness issue, and it self-
heals within `reading_keys`' own load.

### `scan_dtcs` promoted to a mutation, though plan.md's mutation list doesn't name it

What: `useScanDtcs()` wraps `scan_dtcs` (+ best-effort `readiness`) as a
`useMutation`, invalidating `dtc_history` and `car_report` on success —
the same treatment plan.md rule 4 gives `clear_dtcs`, `set_fuel_price`, and
`read_ecu_info`, even though rule 4's list does not mention `scan_dtcs`.
Options: (a) leave `doScan` as a bare `invoke` call outside the query
layer, manually calling `queryClient.invalidateQueries` inline, (b) give it
the same `useMutation` wrapper as every other write.
Why: (b), my own reasoning: once `dtc_history` becomes a `useQuery` (which
plan.md's key list does require), the old `loadHistory()` local
invoke+setState call that `doScan` used to run after scanning has nowhere
left to write — the query cache is now the source of truth for that data.
`useMutation` is the tool plan.md rule 4 already established for exactly
this "write, then tell the cache" shape, so extending it here keeps one
data-layer idiom in the file instead of two (a raw invalidate call sitting
next to three `useMutation` calls).
Risk: none functionally — output is identical to before (scan result
displayed, history refreshed, car_report's scan stats refreshed). Noting
it because it's real code the plan didn't explicitly ask for.

### Diagnose's clear-codes modal stays open and disables through the mutation, instead of closing immediately

What: the original `doClear` called `setConfirmClear(false)` as its first
line, closing the modal instantly and leaving the two chained slow-hardware
calls to run with no visible owner (audit's worst offender #1). The
migrated version keeps `confirmClear` true until the mutation settles
(`onSettled`), so the modal stays on screen with "Yes, clear" showing
"Clearing…" and both buttons disabled during the wait.
Options: (a) keep the original close-then-wait timing and just add a
disabled state to a button that's no longer visible, (b) keep the modal
open through the pending window.
Why: (b). Plan.md step 2 says the button "becomes a `useMutation` whose
`isPending` disables the button and shows 'Clearing…'" — that instruction
only makes sense if the button showing it is still on screen. Closing the
modal on click, as the original code did, would make rule 1's fix
invisible (a disabled button nobody can see is not feedback). This directly
targets audit's #1 worst offender: "nothing changes on screen until the
banner appears."
Risk: none — Cancel is also disabled while pending (no cancel command
exists for `clear_dtcs` mid-flight), so there's no way to get the UI into
an inconsistent state.

### Overview's loading gate is three-way, not the plan's two-way `isPending`/`isError`/empty shape

What: plan.md rule 6 describes the standard card pattern as
`isPending`→skeleton, `isError`→retry, empty→"No data yet" after success.
Overview needed a level above that: it doesn't know if a car exists at all
until `report_cars` resolves, and only THEN does `car_report` even become
enabled. I implemented it as `carsQuery.isPending` → skeleton, confirmed
empty (`carsQuery` succeeded, zero cars) → "No data yet", then
`reportQuery.isPending`/`isError`/success as a second layer.
Options: (a) apply rule 6 only to `car_report`, leaving the old `!vin`
check (which conflates "still discovering cars" with "confirmed no cars")
in place, (b) apply the same isPending/isError/empty discipline one level
up too.
Why: (b). research.md section 2 names this exact bug directly: "a car WITH
history shows the same 'connect and drive' copy for the ~1 fetch round
trip, indistinguishable from a truly empty DB." Fixing only the inner
layer and leaving the outer `!vin` check as-is would have left that
specific, named research finding unfixed.
Risk: none — more branches, but each one is a direct, literal reading of
rule 6 applied at both levels this view actually has.

### Recharts lazy split (step 7b) done per-view as each view migrates, not as one final step

What: plan.md lists the recharts lazy-boundary split as step 7, after all
views. I created `src/components/charts.tsx` and switched Overview's
battery chart to it during step 1, rather than waiting.
Options: (a) leave Overview's chart inline (as `recharts` direct import)
until step 7, migrate both charts at once at the end, (b) create the shared
`charts.tsx` now and point Overview at it immediately, then point
History's chart at the same file when History is migrated.
Why: (b). Since `charts.tsx` is a new file both views will share, writing
it once now and having each view's own migration step point its chart at
it avoids touching Overview's chart code twice (once to extract, once
later to double check it still matches History's copy). Functionally
identical either way.
Risk: **the bundle-size win from this split does not show up until History
also stops importing `recharts` directly** (confirmed by a build after this
step: main chunk went UP slightly, 204.98 KB → 214.09 KB gzip, because
`recharts` is still eagerly bundled via History.tsx's own direct import).
The real before/after gzip table only gets recorded once, at the end of
step 7, after both charts point at the shared lazy file — logged in the
final entry of this document, not here.

## Step 5 — Lab's per-row mutation pending state uses `.variables`, not per-row mutation instances

What: `ProbeManager`'s toggle/delete buttons share ONE `useToggleProbe()`/
`useDeleteProbe()` mutation instance across the whole probe list, and
disable only the row actually in flight by comparing `mutation.variables?.id`
to that row's id, rather than creating a separate mutation hook per row.
Options: (a) one shared mutation instance per action, disabling the whole
list while any row is in flight, (b) one shared instance, per-row disable
via `.variables`, (c) a mutation instance per row (not how TanStack Query
hooks are meant to be used — they're not indexed by data).
Why: (b). This is the standard React Query idiom for a list of identical
mutations and gives genuinely per-row feedback (rule 1) without the
blanket-disable compromise I did take elsewhere (see Vehicle's export
buttons below) — worth the small extra type complexity here because the
probe list can be long and disabling the whole list for one row's write
would read as broken.
Risk: none — `.variables` is only populated while `isPending` is true, so
it can't stick to a stale row after a mutation settles.

## Step 4 — Vehicle's three export buttons share one `copyingWhich` flag instead of independent per-button pending state

What: "Copy AI briefing," "Raw JSON, 24h," and "Raw JSON, 30d" all disable
together while any one of them is copying, rather than each tracking its
own independent pending flag.
Options: (a) three independent `useState`/pending flags, one per button,
(b) one shared `copyingWhich: string | null` flag, disabling all three
during any single copy.
Why: (b), a deliberate simplification. These are plain `invoke`+clipboard
calls outside the query layer (not mutations, so no `.variables` idiom to
lean on like Lab's probes), and export mock latency is well under a
second — the audit's rule 1 bar is "at least disable + slight opacity dip"
for instant actions, which a shared flag satisfies for all three. Three
separate `useState` calls for a same-card, mutually-exclusive-in-practice
action (nobody clicks two export buttons at once) would be more code for
no observable difference.
Risk: a user who deliberately double-clicks a second export button while
the first is still copying finds it briefly disabled instead of also
starting. Acceptable — it self-clears within the copy's own latency.

## Step 7 — bundle trims: both already landed inside steps 1 and 3

What: plan.md step 7 lists both bundle-trim actions ((a) `mock.ts` dynamic
import, (b) recharts lazy split) as a discrete final step. (a) shipped in
step 1's commit (alongside the `tauri.ts` rewrite the query migration
already required touching); (b) shipped in two halves, `charts.tsx` +
Overview's chart in step 1, History's chart in step 3, since History was
the second and last recharts consumer.
Options: (a) hold both trims until every view was migrated, as a literal
final step, (b) land each trim in the step that was already touching the
relevant file.
Why: (b) — same reasoning as the early `charts.tsx` decision already
logged above: `tauri.ts` was already being rewritten for the query
migration in step 1, and each view's own migration step was already the
commit rewriting that view's chart usage. No separate "step 7 commit"
exists; this entry stands in for it and points at where each half
actually landed, so the plan's step numbering maps onto real commits
without a reader assuming step 7 was skipped.
Risk: none — the fallback plan.md offered ("ship (a) alone, log it" if (b)
fights Vite chunking) was never needed; both landed cleanly, confirmed by
the gzip table below.

## Final bundle table (plan.md step 7 requirement)

`npx vite build`, gzip sizes, same machine, same mock data:

| Chunk | Before (main, baseline) | After | Change |
|---|---|---|---|
| `index` (main, eager) | 204.98 KB | 107.95 KB | **-97.03 KB (-47%)** |
| `charts` (lazy, new) | — (was inside `index`) | 104.89 KB | new lazy chunk |
| `mock` (lazy, new) | — (was inside `index`) | 2.99 KB | new lazy chunk, MOCK_MODE only |
| `VehicleScene` (lazy) | 274.99 KB | 275.01 KB | unchanged (stream C's file, out of scope) |
| `Vehicle` (lazy) | ~1.2 KB | 1.50 KB | unchanged shape, +TanStack Query hooks |
| `DiscoveryFlow` (lazy) | ~1.6 KB | 1.65 KB | unchanged |
| `with-selector` (lazy, new) | — | 0.85 KB | TanStack Query's external-store shim |

The number that matters for startup: the eager main chunk a fresh page
load has to parse before anything else runs dropped from 204.98 KB to
107.95 KB gzip — recharts and the mock event bus both left the startup
path entirely, moving to lazy chunks loaded only when actually needed
(a chart renders, or MOCK_MODE is true). `@tanstack/react-query` itself
lives inside that smaller `index` chunk now (it's used by every view) and
the net number still dropped sharply, confirming research.md section 8's
sizing call: the ~13-16 KB the library costs is small next to what
recharts and mock.ts were costing by riding along unconditionally.
`VehicleScene` is untouched, as scoped (decisions-plan.md: deferred to
stream C, which owns that file).

## Interactive-element press-state final pass

What: after finishing the six migration steps, did one more pass adding
`active:scale` press feedback to the small text-link buttons that were
still hover/underline-only: Overview's fuel-price "save" link, Lab's
`RemoveModuleButton`, `ProbeManager`'s enable/disable/delete links,
`RangeScanner`'s "→ probe" link, and the DTC detail modal's close (X)
button.
Options: (a) stop at plan.md rule 11's literal wording ("the shared
Button, Segmented, and nav classes"), leaving small inline text-links as
hover/focus-only, (b) extend the same treatment to every remaining
clickable control, per the acceptance criteria's broader "no interactive
element anywhere ships without press feedback."
Why: (b). Rule 11 names three specific shared class families as the
minimum; the acceptance criteria (and the audit's own rule 6: "including
instant, sync-only controls like nav where a fix costs nothing") ask for
full coverage. `ErrorBoundary.tsx`'s reload button was the one exception
left untouched — that file is outside every step's file list and outside
this stream's view/component boundary entirely, so touching it would be
scope creep into a file the plan never named.
Risk: none — purely additive className changes, verified with a full
fresh-connect regression pass afterward (see final verification note).

## Verification for step 1

Browser (localhost:5183, mock mode): connect flow narrates "Waking the
dongle…"; discovery flow unaffected; Overview renders real data after
connect; switching Live → Overview re-renders instantly from cache (no
skeleton, no stat flicker) confirming the core bug fix; fuel price save
shows "saving…" then updates Cost per 100km/Fuel used figures live (proof
`set_fuel_price` → invalidate → `car_report` refetch works end to end);
battery chart renders inside its lazy Suspense boundary with no visible
pop-in at this data size. No console errors at any point.
`npx tsc --noEmit`: clean.

## Verification for steps 2-6, and final full-app regression pass

Each step was checked in the browser (localhost:5183, mock mode)
immediately after its own commit, screenshots at each pending/loaded/error
state where reachable:
- Diagnose: Scanning… disables the scan button; the clear-codes modal
  stays open showing "Clearing…" with both buttons disabled, closes only
  on settle with the correct before/after banner; scan history updates
  live.
- History: chart skeleton is exactly `h-72`, swaps to the real chart with
  no jump; stats/sessions tables show sized skeleton rows before data.
- Vehicle: Identity card skeleton then real rows; Read from ECU wired to
  `isPending`/`isError` (mock resolves fast enough that the pending frame
  is hard to catch in a screenshot, but the same wiring pattern was
  screenshotted successfully on the slower Diagnose/Overview mutations);
  Copy AI briefing round-trips through clipboard with the richer "Copied —
  paste it to any AI" label preserved.
- Lab: Modules and Recorded probes show sized skeletons then data; Add
  module shows "Saving…", disables, closes on success (mock.ts's
  `add_uds_module` is a no-op returning a static list — a pre-existing
  mock-mode limitation, not something this migration introduced or could
  fix from the frontend).
- Live: enabled:false confirmed (table stays empty until Read is pressed);
  "Interrogating ECU…" pending narration shown; the sensor table survives
  a Live → Overview → Live round trip instead of being wiped — the
  specific bug this step targeted.

After the final press-state polish pass, ran one more full regression from
a hard page reload: connect → discovery flow (VIN/protocol/sensors/fault
codes rows resolve correctly) → dashboard → Diagnose scan/clear working
end to end. Zero console errors across the entire session, every step
included. `npx tsc --noEmit` clean at every commit boundary, and after
this final pass.

Not independently re-screenshotted in this final pass: Overview's
tab-switch cache instancy and the battery chart, already confirmed in
step 1's verification above and unaffected by later commits (no further
edits touched Overview after step 1 except the fuel-price link's
className in the final polish pass).
