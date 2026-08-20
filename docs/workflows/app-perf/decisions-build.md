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
