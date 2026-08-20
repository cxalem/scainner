# Research: Effect architecture adoption

Scope: TypeScript frontend (`src/`) only. Effect is a TS library; Rust
already has `Result<T,E>` and its own types, so `src-tauri/` is out of
scope for this whole stream (Alejandro's framing, confirmed sound — there
is no "Effect for Rust").

## 1. Honest inventory of the async/data surface

**Tauri commands**: 29 total, the full `invoke()` surface
(`src-tauri/src/lib.rs`'s `invoke_handler!` list) — connection lifecycle
(`connect`/`disconnect`/`conn_status`), DTC ops (`scan_dtcs`/
`clear_dtcs`/`dtc_history`/`readiness`), UDS ops (`uds_modules`/
`add_uds_module`/`delete_uds_module`/`uds_read`/`uds_scan`/
`uds_cancel_scan`/`uds_clear`/`uds_module_dtcs`/`list_probes`/
`add_probe`/`delete_probe`/`toggle_probe`), and car data (`car_info`/
`read_ecu_info`/`history`/`reading_keys`/`report_cars`/`car_report`/
`set_fuel_price`/`all_sensors`/`export_json`/`db_path`/`ai_context`).

**Fact**: `ws/app-perf` (PR #3) merged to `main` (`2a5ccf0`) *during this
research session* — ahead of where this worktree branched. I fast-forward
pulled `ws/effect-architecture` to current `origin/main` before reading
code, so this reflects the real current state, not the stale "PR #3
unmerged" assumption in this stream's brief.

Two invoke layers exist side by side:
- **`src/lib/queries.ts`** (198 lines): TanStack Query wrappers, 9 reads +
  9 mutations, the cacheable server state. Query keys are `[command,
  ...args]` by convention, enforced only by review.
- **Raw `invoke()` outside `queries.ts`**, 8 files: `App.tsx`
  (`conn_status`, `report_cars`, `car_info`, `connect`, `disconnect`),
  `DiscoveryFlow.tsx` (`read_ecu_info`, `all_sensors`, `scan_dtcs` via
  `Promise.all`), `Vehicle.tsx`/`ai.ts` (`export_json`, `ai_context` —
  one-shot exports, deliberately outside the query layer), and 3 Lab
  cards — `DidReader.tsx` (`uds_read`), `RangeScanner.tsx` (`uds_scan`
  chunked in a loop + `uds_cancel_scan`), `ModuleFaults.tsx`
  (`uds_module_dtcs`, `uds_clear`) — one-shot manual actions with
  hand-rolled busy/error state, not cacheable reads; app-perf's plan
  scoped only Lab's query-shaped cards (`uds_modules`, `list_probes`).

**`src/lib/ai.ts`** (169 lines): the app's one direct `fetch()` —
`api.anthropic.com/v1/messages`, from `Diagnose.tsx`'s two report flows.
Outside `invoke`, no IPC progress possible; compensated with
`useCyclingLabel` phrase narration. Key + reports live in `localStorage`,
never SQLite (SQLite exports wholesale into AI briefings).

**`src/lib/mock.ts`** (377 lines): one `mockInvoke` switch mirroring all
29 commands + a hand-rolled `listen`/`emit` bus (`conn-status`,
`live-update`, `uds-scan-progress`), loaded only when `MOCK_MODE`. Any
Effect service wrapping `invoke` must still resolve through this same
path in browser preview — a real constraint (engineering.md rule 3, mock
parity), not cosmetic.

Assessment: "everywhere" in the task framing is these three surfaces —
query layer, raw-invoke sites, `ai.ts`'s fetch — not one uniform pattern
already. Effect's job is unifying them under one error model and one
validation boundary, not replacing TanStack Query.

## 2. Effect core patterns for this app

**Fact, not found**: no public prior art for "Effect + Tauri" (checked
directly). The pattern below is sound by construction — `Effect.tryPromise`
wraps any promise-returning function, and `invoke()` already is one — but
not battle-tested by anyone else. This is the one genuine judgment call in
this research, not a citation; flag it to the planner as such.

**Fact, found**: Effect + TanStack Query bridging is established.
TanStack's own docs allow any promise-returning `queryFn`, so
`Effect.runPromise(effect)` slots in directly. A dedicated package,
[`effect-query`](https://github.com/voidhashcom/effect-query), wraps
further: `createEffectQuery(layer).queryOptions({ queryKey, queryFn: () =>
Effect.gen(...) })`, resolving Layers and surfacing typed errors via
`.match()`. For a one-person team, raw `Effect.runPromise` in `queryFn`
gets most of the benefit for one line; revisit `effect-query` once enough
shared Layers exist for its wiring to earn its keep.

**Sketch — one command, Effect + Schema wrapped, composed with Query**
(`queryFn` runs the Effect and provides the Layer; everything else in
`queries.ts` — keys, `enabled`, invalidation — is unchanged):

```ts
export class CarReport extends Schema.Class<CarReport>("CarReport")({
  vin: Schema.String,
  sessionCount: Schema.Int,
  /* ... */
}) {}

export class DeviceService extends Context.Tag("DeviceService")<
  DeviceService,
  { readonly carReport: (vin: string) => Effect.Effect<CarReport, InvokeError | ParseError> }
>() {}

export const DeviceServiceLive = Layer.succeed(DeviceService, {
  carReport: (vin) =>
    Effect.tryPromise({
      try: () => invoke<unknown>("car_report", { vin }),
      catch: (cause) => new InvokeError({ command: "car_report", cause }),
    }).pipe(Effect.flatMap(Schema.decodeUnknown(CarReport))),
});

// queries.ts — unchanged hook shape, only the queryFn body is new
export function useCarReport(vin: string | null) {
  return useQuery({
    queryKey: ["car_report", vin],
    queryFn: () =>
      Effect.runPromise(Effect.provide(Effect.flatMap(DeviceService, (s) => s.carReport(vin!)), DeviceServiceLive)),
    enabled: vin != null,
  });
}
```

**Why the Layer shape helps, concretely** (not "it's the Effect way"):
today `String(e instanceof Error ? e.message : e)` appears verbatim in at
least 6 files, each hand-writing its own try/catch. A `DeviceService`/
`AiService` behind a `Context.Tag` means: (a) tests can `Layer.succeed` a
fake service instead of mocking `invoke` at the module level, (b)
`mock.ts`'s browser-preview path could become a second Layer
(`DeviceServiceMock`), unifying two parallel mock strategies (`MOCK_MODE`
branching in `tauri.ts` and this) into one, (c) a future transport swap
(Tauri invoke → mobile BLE bridge, or → an HTTP/Supabase API) is a new
Layer, not a rewrite of every call site.

## 3. Folder/module architecture

**Option A — layer-based** (`src/domain/`, `src/services/`,
`src/queries/`...): groups by kind of code. Clean separation, but one
feature (DTCs) spreads across 4 folders.

**Option B — feature-based** (`src/features/diagnose/{schema,service,
queries}.ts`, `src/shared/` for cross-feature primitives): groups by what
the code is for. Matches this app's existing seams — Diagnose, Vehicle,
Lab, Live, History are already the view boundaries app-perf migrated
per-view, commit by commit.

**Recommendation: feature-based.** One-person team building toward
mobile/web later — the unit that eventually gets extracted into a shared
package (section 5) is "one feature's device-communication + validation +
logic," not an undifferentiated services/ or schemas/ blob. A feature
folder is the natural extraction boundary; layer-based would need
re-cutting at extraction time. Tradeoff: cross-feature shared types (e.g.
`GAUGES`, used by Overview/Live/History/Diagnose) need a clear home in
`src/shared/domain/` or the feature boundary leaks.

```
src/core/{runtime.ts, errors.ts, services/{device-service.ts, ai-service.ts}}   # candidate for later extraction — §5
src/features/{diagnose,vehicle,...}/{schema.ts, queries.ts}
src/views/, src/components/    # unchanged locations, import from features/*
```

`meta.ts`'s plain types become `Schema.Class` definitions living beside
the feature that owns them, not one giant shared schema file.

## 4. File-size and naming conventions

**What actually balloons files here** (from files read, not a platitude):
never "the async logic got long" — always one of two things. (1)
**Sibling components with no shared state, stacked in one file**:
`Diagnose.tsx` (590 lines) holds `CodeBadge`, `CodeList`, `FreezeFrame`,
`DtcDetailModal`, `AiReportCard`, plus the view — five components, only
the last two sharing state; `Overview.tsx` (529 lines) is the same shape
(`buildVerdicts`, `FuelLevelGauge`, `FuelCard`, `Overview`). (2)
**Rendering variants stacked in one file**: `VehicleScene.tsx` (1298
lines, confirmed zero `invoke`/`fetch` — grepped) holds `StlCarModel`,
`GlbCarModel`, `CarModel`, `CarModelFallback`, `BrandEmblemModel`,
`VehicleScene` — already flagged in `BACKLOG.md` stream C as having
dormant pipelines to delete. **This stream should not touch it**: zero
async surface, pre-existing cleanup owned elsewhere.

**Splitting strategy matching both causes**: one exported component (plus
tightly-scoped private helpers) per file, named for what it renders —
`diagnose/DtcDetailModal.tsx`, `diagnose/AiReportCard.tsx`. This is
exactly what `views/lab/*.tsx` already does successfully
(`RangeScanner.tsx` 152 lines, `ModuleFaults.tsx` 139, `ProbeManager.tsx`
187 — Lab is the one view already near target). Target under 150 lines
per file as the real aim, 300 as the hard ceiling — Lab proves 150-190 is
realistic for a full CRUD card with query wiring.

**Naming**: no single-letter variables (`e` for caught errors is the one
existing repo-wide exception; Effect's tagged errors may remove even that
need). Name services for the capability, not the technology —
`DeviceService`, not `TauriService`: the mobile/web door this stream keeps
open (section 5) is exactly why a `TauriService` name would go stale.

## 5. Supabase-forward-compatibility

**Fact, from the vault** (`personal-hub/1-Projects/Scainner/
product-plan.md`, not inferred): the product plan already commits to
"local-first now, Postgres-shaped for a clean Supabase migration later" —
a target schema (`vehicles`, `connections`, `health_verdicts`,
`org_id`/`owner_user_id` reserved but unpopulated), with auth/org tables
explicitly deferred to "the Supabase/auth migration." This repo's
`db.rs` has no Postgres-shaping yet — that work is a Rust/schema concern,
out of this stream's scope.

**What the Layer pattern genuinely buys**: a `DeviceService` behind
`Context.Tag` means frontend call sites never call `invoke()` directly —
they call the service. Swapping `DeviceServiceLive` (Tauri) for a future
`DeviceServiceSupabase` changes one file, not every hook or view. Real and
sound — it's the same benefit any interface-based DI gives in any
language; Effect just makes it idiomatic here. Not a big claim beyond
that.

**What NOT to do now**: don't design `DeviceService` signatures around a
future multi-tenant shape — the vault plan itself defers `org_id`
population to the auth migration, so designing against it now is
speculative. "Keeping the door open" concretely means: (1) the service
boundary exists, views never call `invoke` directly, (2) Schema types
live apart from the service so a future `DeviceServiceSupabase` can
return the same shape from a different source, (3) nothing more — no
auth context or tenant param threaded through preemptively.

## 6. Migration strategy and phasing

**Sequencing risk, stated plainly**: `ws/write-caps` (PR #2) is open,
unmerged, and touches `Diagnose.tsx`, `Lab.tsx`, `ModuleFaults.tsx`,
`meta.ts`, `mock.ts` — files this stream's own invoke-migration phase
would also touch, plus a new `ConfirmWrite.tsx` and a `writes_log` Rust
table. Starting Effect work on those files before write-caps merges risks
a three-way conflict. `ws/app-perf` (PR #3) is the opposite case: already
merged, so no longer a risk — the brief's framing of it as still-open was
accurate at assignment but is stale now, confirmed via `git fetch` + `gh
pr list --state all`.

**Phase-1-safe today, given that**: anything adding new files without
touching `Diagnose.tsx`, `Lab.tsx`, `ModuleFaults.tsx`, `meta.ts`, or
`mock.ts`. Concretely: `core/runtime.ts`, `core/errors.ts`, one proof
`DeviceService` Layer against 2-3 uncontested read-only commands
(`car_report`/`report_cars`/`db_path` — none appear in write-caps' file
list), one migrated `useCarReport` hook beside the untouched rest of
`queries.ts`.

**Phases**: (1) **Foundation**, safe now — deps + `core/runtime.ts` +
`core/errors.ts` + one `DeviceService` Layer + one migrated hook, small
and mock-parity-checked. (2) **Invoke-layer migration, view by view** —
**gate: wait for `ws/write-caps` to merge** before touching
`Diagnose.tsx`/`Lab.tsx`/`ModuleFaults.tsx`; `Live.tsx`, `History.tsx`,
`Vehicle.tsx` have no overlap and can migrate independently, any order.
(3) **AI layer** — `ai.ts`'s fetch becomes an `AiService` Layer, same
wrap-and-validate shape, independent of 1-2's Tauri work. (4) **Folder
restructure** (§3) — split `meta.ts`/`queries.ts` by feature, *after* 1-3
land so restructuring doesn't precede the code that justifies it. (5)
**Component-size cleanup** (§4) — split `Diagnose.tsx`/`Overview.tsx`'s
siblings out; a pure React refactor, natural to bundle with that view's
phase-2 commit since the file is already open.

## 7. Real cost, stated plainly

**Learning curve**: `Effect.gen`, `pipe`, `Layer`, `Context.Tag`, tagged
errors are a genuinely different model from the async/await + try/catch
every file read in this research uses today. One-person team — no second
engineer to split the cost with or catch misuse in review.

**What gets harder, not just better**: debugging (Effect's generator
control flow and its own stack traces read less directly in devtools than
a flat async/await stack — a known, general tradeoff, not specific to
this app); onboarding (a future second engineer on mobile/web hires from
a smaller Effect-literate pool than plain TS/React); mock parity gains a
second dimension (`mock.ts`'s switch must keep matching every command,
*and* now whatever `DeviceServiceMock` shape exists — build that Layer to
wrap `mock.ts` internally, not duplicate its data); and two error idioms
coexist mid-migration (tagged errors for migrated code, try/catch for the
rest) — unavoidable given the small-increments requirement, but real: a
contributor reading unmigrated `Vehicle.tsx` right after migrated
`Overview.tsx` sees two different failure shapes for the same kind of
thing.

**Rework risk in shipped work**: `queries.ts`'s hooks (app-perf, merged)
keep their exact external shape — only the `queryFn` body changes, so
app-perf's skeleton/error/empty branches in every view need no rework.
Write-caps' `useMutation` wrappers (once merged) need the same
"swap-the-body" treatment in phase 2 — real work its author didn't plan
for, but not a rewrite.

## 8. What I did not investigate, and why

- **Effect's `Stream` module** for `uds-scan-progress` live events —
  plausible fit later, but out of scope: this stream is the
  request/response surface + Query composition, not the event-listener
  surface, and RangeScanner's progress bar isn't flagged broken anywhere.
- **Bundle-size cost of adding `effect`.** No Effect code exists yet to
  measure; app-perf's `decisions-build.md` set the before/after gzip
  precedent to reuse once phase 1 lands.
- **RN/web target specifics.** §5 answers "keep the door open" at the
  DI-boundary level only; no mobile/web codebase exists to ground React
  Native's async quirks or a specific web framework beyond speculation.
- **Full line-by-line `VehicleScene.tsx` read.** Confirmed zero
  invoke/fetch (grep) and its component boundaries — enough to place it in
  stream C's territory without reading all 1298 lines.
- **write-caps'/app-perf's review/codex reports in full.** Read PR bodies,
  plan.md, status.json for the file-overlap/sequencing facts needed here;
  their review reports are process records for those streams, not inputs
  to this one.
