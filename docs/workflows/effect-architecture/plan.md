# Plan: Effect architecture adoption

Translates research.md's 5 phases into file-by-file steps. No plan-approval
gate (docs/workflows/README.md) — building starts right after this.

## Non-goals
`src-tauri/` (Rust, out of scope). Live-event `listen()`/`emit` (App.tsx
conn-status/live-update, RangeScanner's uds-scan-progress) stay raw Tauri
calls — research.md section 8 scopes `Stream` out. `VehicleScene.tsx` —
zero invoke surface, owned by BACKLOG stream C. `effect-query` package —
raw `Effect.runPromise` via one shared runtime covers this app's size
(research.md section 2).

## Verified before writing code
Confirmed empirically (throwaway scripts, deleted): a plain object literal
cast `as SomeSchemaClass` type-checks cleanly against a `Schema.Class` type
— so `mock.ts`'s existing `return {...} as T` idiom needs zero rewrites
when `meta.ts`'s types become `Schema.Class`. Also confirmed `Effect.runPromise`
rejects with a `FiberFailure` (an `Error` subclass) whose `.message` is
whatever `get message()` the failing tagged error/ParseError defines —
so the app's existing `error instanceof Error ? error.message : error`
display idiom keeps working unchanged.

## Phase 1 — Foundation
1. `pnpm add effect` (done, 3.22.1).
2. `src/core/errors.ts` — `InvokeError` (`Data.TaggedError`, wraps any
   `invoke()` rejection, carries `command` + `cause`, clean `get message()`).
3. `src/core/services/device-service.ts` — `DeviceService` `Context.Tag`
   with the FULL command surface as its interface (all ~29 commands,
   typed, most bodies are one-liners), but the `Live` `Layer` starts with
   only 3 real implementations (`carReport`, `reportCars`, `dbPath` —
   research's phase-1-safe picks); the rest throw `Effect.die("not wired
   yet")` as placeholders replaced phase by phase in Phase 2. Declaring the
   full interface now avoids redesigning the Tag type each phase.
4. `meta.ts`: convert `Insights`, `SessionRow`, `KeyStat`, `CarReport` (the
   nested graph `carReport` needs) to `Schema.Class`. Rest of `meta.ts`
   stays plain types until Phase 2 touches those commands.
5. `src/core/runtime.ts` — `ManagedRuntime.make(Layer.mergeAll(DeviceServiceLive))`,
   exports `runPromise`. One long-lived runtime, not a fresh `Layer` per call.
6. `queries.ts`: migrate `useCarReport` only — `queryFn` becomes
   `runPromise(Effect.flatMap(DeviceService, s => s.carReport(vin!)))`.
   Hook signature unchanged.
7. Verify: `npx tsc --noEmit`, then `pnpm dev`, browser demo — Overview
   card must render identically (mock parity: `carReport` resolves through
   `mock.ts`'s switch via the same `invoke()` `tauri.ts` already routes).

## Phase 2 — Invoke-layer migration, view by view
Extend `DeviceServiceLive` command-by-command (replacing the Phase 1
placeholders), converting each command's `meta.ts` type to `Schema.Class`
as it's touched, then swap the call site. Order (each independently
verifiable, commit per group):
1. **queries.ts reads**: `dtc_history`→`DtcScanRow`/`DtcResult`, `reading_keys`,
   `history`→`HistoryPoint`, `uds_modules`→`UdsModule`, `car_info`, `db_path`
   (done), `all_sensors`→`SensorReading`, `list_probes`→`UdsProbe`.
2. **queries.ts mutations**: `set_fuel_price`, `scan_dtcs`+`readiness`,
   `clear_dtcs`→`ObdClearOutcome`, `writes_log`→`WriteLogRow`, `read_ecu_info`
   →`EcuInfo`, `add_uds_module`, `delete_uds_module`, `add_probe`,
   `toggle_probe`, `delete_probe`. Query keys/invalidation untouched.
3. **App.tsx**: `conn_status`→`ConnStatus`, `report_cars`, `car_info`,
   `connect`, `disconnect` invoke calls → `DeviceService` methods run
   through `runPromise`. `listen()` calls untouched (non-goal).
4. **DiscoveryFlow.tsx**: `read_ecu_info`, `all_sensors`, `scan_dtcs` (was
   `Promise.all`, becomes `Effect.all` for the same parallelism).
5. **Vehicle.tsx**: `export_json`, `ai_context` one-shot invokes →
   `DeviceService.exportJson`/`aiContext`, run through `runPromise`. Query
   hooks (`useCarInfo`/`useDbPath`/`useReadEcuInfo`) already covered by #1/#2.
6. **Lab cards**: `DidReader.tsx` (`uds_read`→`UdsHit`), `RangeScanner.tsx`
   (`uds_scan`, `uds_cancel_scan` — chunking loop logic unchanged, only the
   per-chunk call becomes an Effect run), `ModuleFaults.tsx`
   (`uds_module_dtcs`, `uds_clear`→`ClearOutcome`).
7. Verify after each group: `tsc --noEmit`; full mock-mode click-through
   (connect → discovery → each tab) once all groups land.

## Phase 3 — AI layer
1. `src/core/errors.ts`: add `ApiError` (`Data.TaggedError`, carries
   `status`/`detail`, matches `ai.ts`'s existing thrown-Error shape).
2. `src/core/services/ai-service.ts` — `AiService` `Context.Tag`:
   `generateReport(briefing, system)` and the per-code variant, wrapping
   today's `fetch()` in `Effect.tryPromise` + response-shape validation via
   a small `Schema.Class` for the Anthropic response body. Key handling
   (`localStorage`, never SQLite) unchanged — same header comment carried
   over verbatim, this is call-mechanics only per the task brief.
3. `ai.ts`: `generateDiagnosisReport`/`generateCodeReport` call
   `runPromise(Effect.flatMap(AiService, ...))` internally; exported
   function signatures unchanged (Diagnose.tsx's two call sites need no edits).
4. `runtime.ts`: `Layer.mergeAll(DeviceServiceLive, AiServiceLive)`.
5. Verify: `tsc --noEmit`; real report generation in a running app if an
   API key is available, otherwise confirm the "no key" path renders.

## Phase 4 — Folder restructure
Only after 1-3 land. Move (git mv, preserve history):
- `src/core/{runtime.ts,errors.ts,services/}` stays (already the right home).
- `meta.ts` splits by feature: `src/features/vehicle/schema.ts` (CarReport,
  Insights, SessionRow, KeyStat, EcuInfo), `src/features/diagnose/schema.ts`
  (DtcResult, DtcScanRow, ObdClearOutcome, WriteLogRow), `src/features/lab/schema.ts`
  (UdsModule, UdsHit, UdsProbe, ClearOutcome). `GAUGES`, `MONITOR_LABELS`,
  `STAT_LABELS`, `RANGES`, `hex4`, phrase arrays → `src/shared/domain/gauges.ts`
  (cross-feature, per research.md section 3).
- `queries.ts` splits the same way: `src/features/<name>/queries.ts`.
- Update imports across views/components (mechanical, `tsc` catches misses).
- Verify: `tsc --noEmit` clean, full mock-mode click-through again (a pure
  move must not change runtime behavior).

## Phase 5 — Component-size cleanup
Split, matching `views/lab/*.tsx`'s existing one-component-per-file pattern:
- `Diagnose.tsx` → `diagnose/CodeBadge.tsx`, `CodeList.tsx`, `FreezeFrame.tsx`,
  `DtcDetailModal.tsx`, `AiReportCard.tsx`, `Diagnose.tsx` (view, imports the rest).
- `Overview.tsx` → `overview/buildVerdicts.ts` (pure function, own file),
  `overview/FuelLevelGauge.tsx`, `overview/FuelCard.tsx`, `Overview.tsx`.
- Target under 150 lines/file, 300 hard ceiling. Verify: `tsc --noEmit`,
  screenshot each affected view in the running app (no visual/behavior change).

## Acceptance
`tsc --noEmit` clean at every phase boundary. `cargo check` untouched (no
Rust edited). Mock-mode parity verified in a running `pnpm dev` session at
phases 1, 2, 4, 5. Small commits per phase group, standard trailers.
