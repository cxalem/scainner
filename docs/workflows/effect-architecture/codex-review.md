# Codex cross-review: effect-architecture

Reviewer: Codex, 2026-08-21.

Scope reviewed: `main...HEAD` in `/Users/cxalem/projects/scainner-effect-architecture`.
I read the required workflow docs first, then checked the actual diff, commit range,
service boundary, schemas, mocks, file sizes, typecheck, Rust check, and production
bundle output.

## Verdict: OBJECTIONS-NONBLOCKING

This is shippable as an architecture foundation, provided the bundle cost is accepted
explicitly and the follow-up objections below are recorded. I do not see a correctness
bug that requires blocking the merge.

My bundle recommendation: accept the 58.17 KB gzip eager-payload increase as the real
cost of adopting Effect plus Effect Schema, not as a surprise defect. I would not block
merge for tree-shaking/import-narrowing investigation first. The number is material, but
167.26 KB gzip for the eager app chunk is still reasonable for the current desktop app,
and most of the cost appears to be the runtime/schema capability this stream intentionally
adopts. Record it in the performance backlog or stream notes so the future mobile/web
work prices it in.

## Verification Evidence

Commands run:

- `git log --oneline main..HEAD`
- `git diff --stat main...HEAD`
- `git diff --name-status main...HEAD`
- `grep -RIn "invoke[[:space:]]*(" src docs/workflows/effect-architecture --exclude-dir=node_modules --exclude-dir=core/services --exclude=mock.ts --exclude=tauri.ts`
- `npx tsc --noEmit`
- `cargo check` in `src-tauri`
- `pnpm build` on this branch
- `git archive main` to `/tmp/scainner-effect-main-archive.JMF2Qp`, shared `node_modules` symlink, then `pnpm build`
- Node probes against the actual `Schema.Class` definitions
- Mechanical command-list comparison between `src-tauri/src/lib.rs` and `src/core/services/device-service.ts`
- Mechanical mock-case comparison against `src/lib/mock.ts`
- `wc -l` over files touched by the diff

Results:

- TypeScript: clean.
- Rust: `cargo check` clean.
- Command coverage: Rust `invoke_handler!` has 31 commands. `DeviceServiceLive` has the same 31 command strings, exact match, no missing or extra command.
- Raw invoke coverage: no app call sites remain outside `src/core/services`, `src/lib/tauri.ts`, and `src/lib/mock.ts`. The only remaining references outside those areas are comments/docs.
- Mock parity: `mock.ts` has 31 command cases, matching the service command set.
- Single switch point: service methods call `@/lib/tauri`'s `invoke`, and `tauri.ts` is the only mock/live switch point.
- Schema validation: malformed structured `DtcResult` and `CarReport` payloads reject; valid `DtcResult` with excess fields passes; `WriteLogRow.before/after` and the freeze-frame map are the only genuine freeform `Schema.Unknown` uses I found.
- Bundle: branch eager `index-DQbFMsj6.js` is 540.64 KB raw, 167.26 KB gzip. Archived `main` eager `index-DDjE6Gd4.js` is 361.19 KB raw, 109.09 KB gzip. Delta: +58.17 KB gzip, +53%.
- File sizes: every source file touched by this stream is under 300 lines except `src/lib/mock.ts` at 461 lines. That file was touched for imports only and is pre-existing out-of-scope size debt. `VehicleScene.tsx` and `emblems.tsx` do not appear in `git diff --name-only main...HEAD`.
- Live browser verification: I attempted a Playwright smoke test with the repo's webapp-testing helper, but the sandbox refused local server binding with `listen EPERM: operation not permitted 127.0.0.1:1427`. I am not claiming a fresh live browser pass from this review.

## Findings And Calls

1. Bundle regression is real and should be accepted consciously.
   The first reviewer’s 109.09 KB to 167.26 KB gzip measurement is reproducible. I do not recommend blocking the merge over this. Effect is now in the eager data path by design, and import narrowing is unlikely to erase the full cost while keeping Schema and Layer. The right action is to record the number and treat 167 KB gzip as the new baseline for future web/mobile performance work.

2. Tuple-shaped command responses should get schemas soon, but this is not a blocker.
   `report_cars` and `car_info` still use `call<[string, number][]>` and `call<[string, string][]>`, so they are typed casts rather than decoded boundaries. This is defensible for primitives, but tuple arrays are consumed by destructuring and `Object.fromEntries`, so schema validation would catch shape drift cheaply. Recommendation: add schemas for these two in a follow-up, or document the rule that primitive and tuple responses skip decode.

3. `InvokeError` is a small naming leak.
   The `DeviceService` interface itself is clean and has no Tauri types. The error name is still transport-flavored. A future HTTP/Supabase/device bridge layer returning `InvokeError` would read oddly, even if it still works. Recommendation: rename to `DeviceError` or `TransportError` before code starts matching on `_tag`. Nonblocking because it is not visible to users and there is no tag matching today.

4. `confirmed: true` inside `DeviceServiceLive` weakens write-gate visibility.
   Runtime behavior is unchanged: any caller could always pass `confirmed: true` before. But the migration moved the confirmation flag away from the UI call site and into the live service layer. That makes the write-caps safety rule less greppable. Recommendation: change `clearDtcs` and `udsClear` signatures to take an explicit confirmation argument in a follow-up, so the ConfirmWrite path remains visible at the caller.

5. `gauges.ts` comment is mostly accurate, but its moved-verbatim status should be clearer.
   The file-level comment says it is cross-feature sensor/gauge metadata and not a Tauri response type. That is true. The first report’s related concern is more about the polish commit's wording than this comment. I would not change this for correctness.

6. ParseError user copy is too technical if it reaches UI.
   Decode failures currently flow through existing `error.message` rendering, which means users could see raw Effect ParseError output. That violates the repo's plain-English UI principle if the backend shape ever drifts. Recommendation: map `ParseError` to a plain sentence at the boundary and log the detailed parse output to console. Nonblocking because this is an internal mismatch path, not a normal user flow, and prior code had no validation at all.

7. Effect style should be documented before the next stream copies it.
   The code now uses direct `Effect.flatMap(DeviceService, ...)`, `Effect.gen`, and local `.pipe(...)` chaining. All are valid, and the current count is small. The risk is that this becomes a grab bag as future streams add more Effect code. Recommendation: add a short house-style note: use per-feature `run` helpers for query hooks, use `Effect.gen` for multi-step workflows, use `.pipe` only for local error handling or schema decode chains.

## Claim Audit

The first reviewer’s major claims hold up:

- 31/31 backend Tauri commands are behind `DeviceService`.
- No raw app `invoke()` remains outside the service/adapter/mock areas.
- Mock parity is structurally 31/31 with one mock switch point in `tauri.ts`.
- Schema validation is real for structured payloads and is not decorative.
- `DeviceService` carries plain arguments and schema/domain types, not Tauri API types.
- `VehicleScene.tsx` and `emblems.tsx` were not touched.
- `npx tsc --noEmit` and `cargo check` are clean.
- The bundle regression is exactly reproducible.

The only first-review claim I could not independently reproduce was the live Playwright
session, because this sandbox disallows binding the local dev server. I treat that as a
verification limitation, not contrary evidence.

## Gut Check

This is a sound foundation for the next several months of multi-platform work. The key
architectural property is real: views and hooks now depend on a capability interface,
not on Tauri. A future desktop/mobile/web transport can implement the same service
shape without rewriting every view.

The structural doubts are manageable rather than fatal. The team is now paying an Effect
literacy tax, and the code needs a house style before it spreads. The bundle cost is also
real. Those are adoption costs, not signs that the migration is unsound.
