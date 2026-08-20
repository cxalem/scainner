# Review report: app-perf, stage 4

Reviewer: Claude (Fable 5), 2026-08-20. Branch `ws/app-perf` at cd60416
plus this review's fix commit, reviewed in the worktree
`/Users/cxalem/projects/scainner-app-perf` against `main...ws/app-perf`.

## Verdict: ship, with the five small fixes made in this review

The core claims hold up under independent verification: the tab-switch
refetch bug is genuinely gone (traced end to end on Live and Overview in
a live browser session), the bundle numbers are real (I rebuilt both
sides myself and got the builder's figures to the decimal), tsc is clean,
and the wrong-server incident was handled exactly as the builder's log
says. I found five small defects, all fixed in this review's commit:
two real edge-case bugs in the new loading gates (History and Overview),
one em dash in new UI copy, one missed press state, and one call site
that skipped the shared transient-label helper the plan required. Nothing
found rises to rework. The remaining items are log hygiene and questions
for the Codex cross-exam.

## Scope check

Diff touches: the query layer (`src/lib/query.ts`, `src/lib/queries.ts`,
both new), app wiring (`src/main.tsx`, `src/App.tsx`, `src/lib/tauri.ts`,
`src/lib/mock.ts`), shared UI (`src/components/ui.tsx`,
`src/components/charts.tsx` new, `Shell.tsx`, `ConnectGate.tsx`), all six
views plus Lab's three touched children, phrase constants in
`src/lib/meta.ts` and `src/lib/ai.ts`, plus `package.json`/lockfile (one
dependency, `@tanstack/react-query`, as planned) and the builder's log.

Boundary respected: no Rust, no `VehicleScene.tsx`, no `public/models*`,
no i18n, no dark mode, no DevTools, no toast system, `ErrorBoundary.tsx`
untouched as the builder's log claims. Commit order (foundation+Overview,
Diagnose, History, Vehicle, Lab, Live, polish) matches the plan's
riskiest-first sequence.

Deviations from the plan's letter, all logged in decisions-build.md:
`list_probes` gets a key the plan never named; `dtc_history`'s key drops
the constant `limit` arg; History's two queries are independent rather
than gated; `scan_dtcs` became a mutation; step 7's two bundle trims
landed inside steps 1 and 3; the press-state pass went beyond rule 11's
three named class families. I checked each against the code and each is
real, reasonable, and honestly described. See the decision log audit
below for the one citation defect.

## Independent verification (mine, not the builder's)

**Typecheck.** `npx tsc --noEmit` clean at cd60416, and clean again after
my fixes.

**Bundle claim, rebuilt from scratch.** `npx vite build` on this branch:
eager `index` chunk 107.95 KB gzip, `charts` 104.89 KB lazy, `mock`
2.99 KB lazy, `VehicleScene` 275.01 KB, exactly the builder's table. For
the baseline I exported `main`'s tree with `git archive` into a scratch
directory (no other worktree touched) and built it with the same
node_modules: eager `index` 204.98 KB gzip, again exactly the claimed
number. The headline claim (204.98 to 107.95, recharts and mock.ts off
the startup path) is verified, not just plausible.

**The wrong-server incident.** I checked the environment: port 1420 is
still held right now by a vite process whose cwd is
`/Users/cxalem/projects/scainner` (the main worktree), so the collision
the builder describes is a standing fact of this machine, not a story.
I ran this worktree's own server on port 5219, confirmed via `lsof` that
the listening process's cwd is this worktree, and did all browser checks
there. I also checked the builder's claims for leakage: every browser
claim in decisions-build.md is stated against localhost:5183, and no
claimed observation depends on anything only the other worktree's code
could produce (the giveaways they caught, a `?brand=saic` param and a
connect-gate reset, belong to the other stream's app). The catch and the
fix are genuine.

**Browser session** (mock mode, port 5219, full connect flow, zero
console errors across the entire session):

- Connect narration: caught "Waking the dongle…" on the gate button
  mid-connect. Discovery flow ran to completion, unaffected.
- **Refetch-on-tab-switch, view 1 (Live):** pressed Read all sensors,
  caught the disabled button with spinner and "Interrogating ECU…", got
  17 rows stamped "read at 10:53:48 PM". Switched to Overview and back:
  the table was intact with the same timestamp and row set, no blank
  state, no re-read. Before this stream the table was wiped on every
  switch.
- **Refetch-on-tab-switch, view 2 (Overview):** switching Live to
  Overview rendered the full stats row instantly from cache, no skeleton
  flash, no stat flicker. First mount earlier in the session had shown
  the skeleton layout, so both states were observed and are visually
  distinct.
- **History:** first visit showed the fixed-size chart skeleton in the
  exact chart footprint, then the chart landed with no size jump; stats
  and sessions cards showed sized skeleton rows first.
- **Diagnose:** Scan shows "Scanning…" disabled. The clear-codes modal
  stays open through the mutation with "Clearing…" on the disabled
  destructive button and Cancel disabled, then closes on settle with the
  banner "Cleared and verified, 2 codes before, none remaining", and the
  scan history list gained both new rows live with no manual reload.
  That is the audit's worst offender #1, observed fixed.
- **Mutation to cache invalidation, end to end:** fuel price 1.62 to
  1.80, caught the "saving…" pending label on the save link, then Cost
  per 100 km went 8.75 to 9.72 and Fuel used EUR 17.01 to 18.90 from the
  invalidated `car_report` refetch. The same value later appeared on
  Vehicle's identity card (`fuel_price 1.8`), confirming cross-view
  cache consistency through `read_ecu_info`/`car_info`.
- **Vehicle:** caught the identity card's three skeleton rows and the
  db-path skeleton on first mount, then real data.
- **Lab:** all cards render independently with data or honest empty
  states. The write mutations (add module, probes) cannot be observed
  succeeding in the browser demo because mock.ts implements them as
  no-ops returning static lists; I verified that in mock.ts directly,
  which matches the builder's stated limitation.

**Interaction rules against the audit's full inventory table.** I walked
the diff against every row, not just the builder's highlights. All the
flagged offenders now have pending, disable, and visible-error handling:
Disconnect ("Disconnecting…"), Diagnose clear, Vehicle read-ECU and the
three export buttons, Lab's add/remove module and probe save/toggle/
delete (per-row disable via `mutation.variables`, per-row error lines),
Overview's fuel save. Press states cover the shared Button, Segmented,
nav items, History's range buttons, ConnectGate/Shell connect, the DTC
modal close button, and the small text links from the polish pass. The
one interactive element missed was Diagnose's CodeBadge (finding 4,
fixed). Rule 12's stale-data guard is in the code (`useCarReport` takes
no `placeholderData`); it is not exercisable in the demo because mock
mode has one car, so this one is verified by code reading only.

## Findings, ranked (1 to 5 fixed in this review's commit)

1. **History showed skeletons forever on an empty database (low
   likelihood, wrong-by-inspection; fixed).** `useCarReport(null)` is a
   disabled query, and disabled queries report `isPending: true`
   indefinitely in TanStack Query v5. `reportLoading` OR'd that in, so
   with zero cars the stats and sessions cards would show skeleton rows
   forever instead of the empty-state copy, violating the plan's own
   "no data yet must be distinct from loading" rule in the opposite
   direction. Fix: gate on `firstVin !== null` before counting
   `reportQuery.isPending`. Hard to reach in practice (the connect gate
   plus discovery normally guarantees a car), but it is exactly the
   claims-vs-code gap this pattern invites; see Codex question 2.
2. **Overview rendered "No data yet" when the cars fetch failed
   (fixed).** Plan rule 6 says the empty-state copy renders only after a
   successful fetch, and the builder's own log claims a "confirmed
   empty" gate, but the code checked `!effectiveVin` without checking
   `carsQuery.isError`, so a failed `report_cars` (after retry) showed
   the misleading "Connect and drive" card. Fix: an error branch with
   Retry, same shape as the report-level error card, before the empty
   check.
3. **Em dash in new UI copy (fixed).** The new fuel-save error read
   "Could not save — try again." The repo's plain-language rule (and
   BACKLOG design principles) bans em dashes in UI copy. Now "Could not
   save. Try again." Pre-existing em dashes elsewhere in view copy were
   left alone: copy rewrites are an explicit non-goal of this stream and
   belong to the i18n/copy pass.
4. **CodeBadge had no press state (fixed).** Diagnose's code badges are
   buttons (they open the detail modal) and had hover-scale only, which
   fails the acceptance criterion "no interactive element anywhere ships
   without press feedback". Added the same `active:scale-95` +
   motion-reduce guard used on the neighboring controls.
5. **AiReportCard's Copy button kept its private useState+setTimeout
   (fixed).** Plan rule 10 requires the transient success label
   "extracted once into a small helper in ui.tsx", and ui.tsx's own
   comment claims the hand-rolled pattern is replaced, but this call
   site still hand-rolled it. Switched it to `useTransientLabel(1500)`;
   behavior identical.
6. **Log citation defect (low, not fixed, builder's log).** The Vehicle
   export entry in decisions-build.md attributes the quote "at least
   disable + slight opacity dip" to "the audit's rule 1". The words are
   real but they are audit rule 3 (and plan rule 9); audit rule 1 is the
   pending-label rule. Same class of defect the 3d-logos review found
   (invented/misplaced citation), milder because the text exists
   verbatim elsewhere. I left the builder's log untouched, per this
   repo's convention that a stage's log belongs to its author; noting it
   here instead.
7. **Info: the "Scans clean stat updates without a reload" check from
   plan step 2 is not observable in the demo.** mock.ts's `car_report`
   returns a hardcoded `scans_clean: 4`, so the stat can never change in
   mock mode no matter how correct the invalidation is. The builder's
   verification notes honestly claim only "scan history updates live"
   and never claim the stat check; the invalidation wiring itself is
   proven by the fuel-price path (same mutation-to-`car_report`-refetch
   chain). Worth knowing before anyone re-runs the plan's look-at list
   against mock and thinks the cache is broken.
8. **Info: Diagnose's latest-scan card is still lost on tab switch.**
   The scan result and readiness live in local component state (the scan
   is a mutation, correctly not auto-rerun on mount, so there is nothing
   to refetch it from). The plan's key list never includes `scan_dtcs`,
   so this conforms to plan; but the research table's "history and last
   scan lost" row is only half-fixed, and the acceptance phrase "tab
   switches no longer refetch-from-blank" is true of queries, not of
   this one-shot card. Flagged for Codex (question 3), not a defect
   against the plan as written.
9. **Info: error surfaces are in-flow, per plan, in mild tension with
   the no-layout-shift principle.** Plan rule 8 explicitly reuses the
   existing inline `border-destructive/10` box, and those boxes (and
   Vehicle's new copy-error box) appear in document flow, pushing
   content below them when an error lands. This is the codebase's
   pre-existing idiom and the plan endorsed it, so it is not a build
   defect; noting the tension for the record (Codex question 5).

Minor code notes, no action required: `tauri.ts`'s `listen` is now
async, so mock event subscription lands a microtask later than before;
harmless today because mock events all fire after deliberate delays and
the real Tauri path already returned a promise. Live's "read at" caption
now hides when a read returns zero sensors (previously it showed with a
zero count); a trivial unlogged behavior change that happens to be more
honest, not less.

## Decision log and quote audit

I checked every quoted phrase in decisions-build.md against plan.md,
research.md, interaction-audit.md, and decisions-plan.md. All quotes are
exact (including the research "flagged for the planner to size" ellipsis,
plan rule 2's "then its args in call order", step 2's "becomes a
useMutation whose isPending disables the button", research section 2's
"a car WITH history shows the same 'connect and drive' copy", and the
decisions-plan headings cited from code comments). The one defect is the
rule-number misattribution in finding 6. No fabricated quotes found.

Surprising things in the diff all have log entries: the extra query key,
the dropped limit arg, the ungated History queries, the scan_dtcs
mutation, the modal-stays-open timing change, Overview's three-way gate,
the early charts.tsx extraction, the per-row `.variables` idiom, the
shared `copyingWhich` flag, the folded step 7, and the extended press
pass. The builder's honesty standard here is high; the port-collision
entry in particular is a model incident writeup.

## Questions for the Codex cross-exam

1. History's `reading_keys`/`history` independence contradicts plan step
   3's "dependent queries" wording. The builder's argument (the selected
   key defaults to "voltage", which is always valid, so no gate is
   needed) checks out against the code as far as I can see. Confirm
   there is no intended dependency, e.g. a future where the default key
   is not guaranteed to exist.
2. The disabled-query `isPending` trap (finding 1) was present in one of
   the two `useCarReport(vin)` consumers. Sweep for other places where a
   conditional/`enabled: false` query's `isPending`/`isFetching` feeds a
   loading branch; `useAllSensors` uses `isFetching` (correct) and
   Overview branches before touching `reportQuery` (correct after fix 2).
3. Should Diagnose's latest scan survive tab switches (e.g. the mutation
   writing its result into the cache with `setQueryData` under a
   `["scan_dtcs","latest"]`-style key), or is losing a one-shot hardware
   scan on navigation acceptable UX? Plan is silent; research listed it
   as part of the original complaint.
4. `conn-status: connected` triggers a blanket
   `queryClient.invalidateQueries()`. On real hardware with a flaky
   dongle reconnecting repeatedly this refetches every cached query per
   reconnect. decisions-plan.md accepted this ("harmless locally");
   sanity-check that against the adaptive Bluetooth ladder's reconnect
   behavior.
5. The connect narration cycles two phrases every 700 ms. Against the
   mock's ~900 ms connect that reads as one clean transition; on real
   hardware a 20 s connect flips the label about 28 times. Should the
   interval scale up (e.g. 2 to 3 s) now, or wait for the backend
   progress-event follow-up the plan already records?
6. In-flow error boxes (finding 9): fine as the endorsed idiom, or worth
   a follow-up rule that error boxes reserve their space or overlay?
