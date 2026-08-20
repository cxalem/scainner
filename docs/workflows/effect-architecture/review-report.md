# Review report: effect-architecture, stage 4

Reviewer: Claude (Fable 5), 2026-08-21. Branch `ws/effect-architecture` at
7b14f5a plus this review's fix commit, reviewed in the worktree
`/Users/cxalem/projects/scainner-effect-architecture` against
`main...ws/effect-architecture` (49 files, +1938/-1127).

## Verdict: ship, with the fixes made in this review — and one open cost
## question (bundle size) that Codex and the human should rule on

The architecture claims hold up under independent verification: every
backend command really is behind DeviceService (zero raw `invoke()` call
sites left outside `core/services`, confirmed by grep, and the service's
command list matches the Rust `invoke_handler!` list exactly, 31 for 31),
mock parity genuinely holds (31/31 mock cases, full app exercised live by
me with zero console errors), Schema validation is real not decorative
(probed with malformed payloads, rejected; valid accepted), tsc and cargo
check are clean, and the phase-5 splits are faithful extractions. I found
one class of small defect — the final commit's "naming cleanup finished"
claim does not hold across the stream's own files — and fixed it. The one
finding I could not fix by editing code is a measurement the stream owed
and never took: **the eager bundle grew 58 KB gzip (+53%) from adding
Effect**, silently giving back more than half of app-perf's headline win.
That is a judgment call, not a defect, but it must be made consciously.

## Scope check

Diff touches: `docs/workflows/effect-architecture/{research,plan}.md`, the
new Effect core (`src/core/{errors,runtime}.ts`,
`src/core/services/{device-service,ai-service}.ts`), the new feature layout
(`src/features/{vehicle,diagnose,lab,live,history}/{schema,queries}.ts`,
`src/shared/domain/{connection,gauges}.ts`), deletion of `lib/meta.ts` and
`lib/queries.ts`, the phase-5 component splits
(`views/diagnose/*`, `views/overview/*`), every view/component that called
`invoke()` or imported from the deleted files, `lib/ai.ts`, import-only
edits to `mock.ts`, and `package.json`/lockfile (one dependency, `effect`
3.22.1, as planned).

Boundary respected: zero `src-tauri` diff (confirmed; `cargo check` run
anyway, clean). `VehicleScene.tsx` (1298 lines) and `emblems.tsx` (350)
genuinely untouched, not touched-and-still-oversized. `mock.ts` was
touched, but only its import block (6 insertions, 15 deletions, forced by
the `meta.ts` deletion) — its 461 lines and its `mockInvoke` switch are
otherwise as main left them. `listen()`/`emit` event surface stays raw
Tauri per the stated non-goal. No scope creep found.

Deviation from plan, properly explained: plan.md phase 1 step 3 called for
declaring the full ~29-command interface upfront with `Effect.die`
placeholders; the builder skipped that (commit 5a0bfba explains why:
25+ dead methods that could be called and crash confusingly, for no
benefit since extending a Context.Tag interface later is trivial). The
rationale is sound and lives where the 2026-08-20 policy says it should
(commit message). No decisions-*.md files exist for this stream — expected
under that policy, not a gap.

## Independent verification (mine, not the builder's)

**Typecheck / Rust.** `npx tsc --noEmit` clean at 7b14f5a, and clean again
after my fixes. `cargo check` clean.

**Command coverage, checked mechanically.** I extracted the command list
from `src-tauri/src/lib.rs`'s `invoke_handler!` (31 commands — research
counted 29; write-caps' `writes_log` and the merged state account for the
difference) and diffed it against the command strings in
`device-service.ts`: exact match, 31 for 31. Grep for `invoke(` outside
`core/services`, `lib/tauri.ts`, and `lib/mock.ts` finds only a
doc-comment in `errors.ts`. The one-shot exports research flagged
(`export_json`, `ai_context`) went through the service too — deliberate
per plan phase 2.5, they just bypass the query cache, not the service.

**Mock parity, structural and live.** All 31 service methods route through
`lib/tauri.ts`'s `invoke`, which is the single switch point to
`mockInvoke` — there is no second mock implementation to drift, which is
the stronger property research.md section 7 worried about. All 31 commands
have cases in `mock.ts`'s switch. Live proof: full Playwright session
against `pnpm dev`-equivalent (`vite --port 1425`, mock mode) — connect
gate → Connect → discovery overlay (DiscoveryFlow's `Effect.gen` +
`Effect.all` parallel sweep) → Go to dashboard → Overview (health verdicts
from decoded `car_report`) → History → Diagnose (Scan for codes → Latest
scan card → Clear codes → ConfirmWrite modal → "Cleared and verified: 2
codes before, none remaining" → Write history visible) → Lab (DidReader
Read → "No answer (DID not supported or refused)", the `Schema.NullOr`
honest-absence path) → DTC detail modal (P0420, anatomy + occurrence
timeline). **Zero console errors, zero page errors**, across two full runs
(before and after my fixes). Screenshots in the review session; the only
console warnings are pre-existing three.js/WebGL noise also present on
main.

**Schema validation is real.** I ran the stream's actual schema classes
under `node --experimental-strip-types`: a malformed `CarReport`
(`session_count` as string, `insights` missing) is rejected; a malformed
`DtcResult` (`stored` as string, `mil_on` missing) is rejected; a valid
minimal `DtcResult` passes; excess unknown fields are tolerated (Effect
Schema's default, the right call for a forward-compatible boundary). The
only `Schema.Unknown` uses are the freeze-frame PID map and
`WriteLogRow.before/after` — both genuinely freeform, not escape hatches.

**Layer swappability.** The `DeviceService` interface contains no Tauri
types: methods take plain args and return schema-typed Effects. The Tauri
coupling lives entirely inside `DeviceServiceLive`'s `call`/`decoded`
helpers (one file). A `DeviceServiceMock` or `DeviceServiceSupabase`
implementing the same Tag would type-check against every call site. Two
mild residues, neither blocking: the error channel is named `InvokeError`
(transport-flavored — see finding 4), and `clearDtcs`/`udsClear` bake
`confirmed: true` into the Live layer (finding 5).

**`runtime.runPromise` unbound export.** `export const runPromise =
runtime.runPromise` looked like a `this`-binding hazard; I read Effect's
`ManagedRuntime` implementation — methods close over `self`, not `this`,
so the unbound export is safe. Not luck, but worth this note so nobody
"fixes" it.

**File sizes** (wc -l, every file the diff touches): largest are
`Overview.tsx` 271 and `Diagnose.tsx` 236, both under the 300 ceiling as
claimed, both over the 150 target with the commit message's honest
explanation (view-plus-wiring shape). All extracted components under 150
except `DtcDetailModal.tsx` at 174, as disclosed. `mock.ts` at 461 was
touched (imports only) — the final commit's "every file this stream
touches is under 300 lines" is technically false for it, though the same
message lists mock.ts as out-of-scope oversized; sloppy phrasing, not
dishonesty.

**Bundle, measured both sides myself** (branch built in place; main
exported via `git archive` to a scratch dir sharing the same
node_modules): eager `index` chunk **109.09 KB gzip on main → 167.26 KB
gzip on this branch (+58.17 KB, +53%)**. Every other chunk is within
0.1 KB of main. This is the cost of `effect` + Schema in the eager path.
See finding 2.

**Phase-5 extraction fidelity.** I diffed the extracted `buildVerdicts`
against the deleted in-file original: logic and strings identical, only
the documented renames (r/i/v/a → report/insights/verdicts/absLtft).
Verdict copy renders identically in the live session.

## Findings, ranked

1. **The "naming cleanup finished" claim did not hold (fixed in this
   review's commit).** Commit 7b14f5a claims the no-single-letter pass was
   completed for "files this stream touched or created", with a specific
   deliberately-left list. Not true: single-letter variables remained in
   `DiscoveryFlow.tsx` (`sensors.map((s)` — a file this stream
   substantially rewrote), `DidReader.tsx` (`const r`), `Diagnose.tsx`
   (`{ scan: r, readiness: rd }` and `([k, ready])` — a file the commit
   explicitly names as cleaned), and three files the stream *created* in
   phase 5: `FreezeFrame.tsx` (k/v/g/x), `DtcDetailModal.tsx` (h/o/c/s),
   `FuelLevelGauge.tsx` (t). None are in the commit's exception list. I
   renamed all of them (sensor, hit, scanResult/readinessResult, monitor,
   entryKey/value/gauge/candidate, row/occ/cause/symptom, tick), kept the
   repo's stated exceptions (`e` for caught errors, loop indices), and
   re-verified: tsc clean, full live session re-run clean, modal
   re-exercised clean. Mechanical, zero behavior change.
2. **Bundle cost never measured; it is 58 KB gzip of eager payload (not
   fixed — needs a human/Codex ruling).** research.md section 8 explicitly
   deferred measuring Effect's bundle cost "once phase 1 lands" and named
   app-perf's before/after gzip precedent to reuse. No commit ever did it.
   Measured by me: eager index 109.09 → 167.26 KB gzip. app-perf's whole
   headline was 204.98 → 107.95; this stream hands back more than half of
   that win as the price of the architecture. For a local desktop app the
   practical startup cost is small (assets load from disk), but the
   browser preview, and any future mobile/web target this architecture
   exists to serve, pay it for real. Options if it matters: accept and
   record it; try deep imports (`effect/Schema` etc. — may not help much,
   the barrel is tree-shakeable and Schema itself is the heavy part); or
   trim Schema usage. My recommendation: accept consciously and write the
   number down where the next perf pass will see it (BACKLOG stream H's
   budget item), rather than pretend it is free.
3. **The validation boundary is partial by design — worth confirming it is
   by design.** Commands returning primitives or tuple arrays skip Schema
   entirely via the `call<T>` cast: `report_cars` (`[string, number][]`),
   `car_info` (`[string, string][]`), `readiness`, `reading_keys`,
   `uds_module_dtcs`, `db_path`, `export_json`, `ai_context`. Structured
   responses all decode. The split is defensible (validating a string as a
   string buys little) but nothing in plan.md or the commits states the
   rule, and the two tuple-shaped ones (`report_cars`, `car_info`) would
   decode cheaply and are eaten by `Object.fromEntries`/destructuring at
   call sites that would fail confusingly on shape drift. Codex question 2.
4. **`InvokeError` is technology-named.** research.md section 4's own rule
   — name for the capability, not the technology, which is exactly why
   `DeviceService` is not `TauriService` — was not applied to the error.
   A future `DeviceServiceSupabase` would fail with `InvokeError`s from
   HTTP calls. Cosmetic today, a one-file rename; cheapest now, before
   tagged-error matches (`_tag === "InvokeError"`) accumulate. Not fixed
   (it is a naming judgment, not a defect); Codex question 3.
5. **`confirmed: true` moved inside the Live layer.** Pre-migration, the
   two write call sites passed `confirmed: true` visibly next to their
   ConfirmWrite modals; now `DeviceServiceLive.clearDtcs()`/`udsClear()`
   bake it in, so nothing at a call site signals "this is a gated write" —
   a future caller could invoke `device.clearDtcs()` with no modal and the
   backend rail would happily accept. Same runtime behavior as before
   (any caller could always write `confirmed: true`), but the write-caps
   design intent ("explicit confirmation" as a visible, greppable step)
   got one notch less visible. The hooks' comments do document it. Option:
   make the interface take `confirmed: boolean` and let the modal path
   pass it. Codex question 4.
6. **Info: per-feature `run` helper is duplicated five times.** Each
   feature's queries.ts re-declares the identical 2-line `run` helper; the
   phase-4 commit calls this deliberate ("a feature folder should be able
   to stand alone"). Fine at 2 lines; if it ever grows behavior (logging,
   spans), five copies will drift. No action; noting so the choice stays
   visible.
7. **Info: dev-mode HMR makes a fresh `ManagedRuntime` per hot edit of
   anything importing runtime.ts.** Old runtimes are never disposed.
   Harmless today (the layers hold no resources — `Layer.succeed` of plain
   objects), invisible in production. Becomes real only if a Layer ever
   acquires resources (sockets, workers); the future self reading this
   should add `import.meta.hot` disposal then, not now.
8. **Info: no `status.json` for this stream.** write-caps and app-perf
   both carry one; this stream's folder has research/plan/this report
   only. If the orchestrator owns that file, ignore this line.

## Claims-vs-evidence audit (the fabricated-quote check)

Checked every strong claim in the commit messages against what I could
independently reproduce:

- "grep confirms zero raw invoke() call sites remain" (e0d1070) — true,
  reproduced.
- "npx tsc --noEmit clean, cargo check clean" (multiple commits) — true,
  reproduced at HEAD.
- "file-size sweep confirms every file this stream touches is under 300
  lines" (7b14f5a) — true except mock.ts (461, import-only edit), which
  the same sentence classifies out of scope; imprecise, not fabricated.
- "renamed the remaining single-letter variables in files this stream
  touched or created" (7b14f5a) — **overstated**; finding 1, fixed. The
  same commit also lists `gauges.ts` under "files this stream doesn't
  touch", but phase 4 created that file (content moved verbatim from
  meta.ts) — misdescription, and its `fmt: (v) =>` callbacks remain
  single-lettered. I left gauges.ts alone since the move-verbatim choice
  was itself documented; Codex question 5.
- Phase-3 commit's live-401 test story (real network, real Anthropic 401,
  error string rendered) — plausible and consistent with the AiService
  error path I read; I did not re-run it with a key, but I verified the
  no-key path and the error-display idiom the claim depends on
  (`FiberFailure` forwarding the `message` getter — also asserted in
  plan.md's "Verified before writing code" and consistent with the
  `Data.TaggedError` implementation).
- Quoted doc references resolve: lab/queries.ts's "not audited
  individually... flagged for the planner to size" exists verbatim in
  app-perf's decisions-build.md; vehicle/queries.ts's "plan.md rule 12"
  means app-perf's plan.md rule 12 (which exists) — ambiguous now that
  this stream also has a plan.md, but the quote is real.
- research.md's own factual anchors spot-checked: the 29-command inventory
  matched `lib.rs` at its branch point; the "app-perf merged during
  research" claim matches the merge commit b6ba3d9's ancestry.

## Fixes made in this review (committed on this branch)

One commit: the finding-1 renames across 6 files
(`DiscoveryFlow.tsx`, `views/lab/DidReader.tsx`, `views/Diagnose.tsx`,
`views/diagnose/FreezeFrame.tsx`, `views/diagnose/DtcDetailModal.tsx`,
`views/overview/FuelLevelGauge.tsx`), plus this report. Verified after:
tsc clean, full mock-mode Playwright walkthrough (connect → discovery →
Overview → History → Diagnose scan/clear write path → Lab → DTC modal)
with zero console errors.

## Questions for the Codex cross-exam

1. **The 58 KB gzip eager-bundle cost (finding 2).** Accept and record, or
   require a mitigation attempt before merge? If accepted, where does the
   number get written down so stream H's performance-budget work prices it
   in instead of rediscovering it?
2. **Partial validation boundary (finding 3).** Should `report_cars` and
   `car_info` (tuple arrays consumed by destructuring) get schemas, or is
   "primitives and tuples skip decode" the stated rule? Either answer is
   fine; it should be written somewhere.
3. **`InvokeError` naming (finding 4).** Rename to something
   transport-neutral (`DeviceError`?) now while zero code matches on the
   tag string, or keep?
4. **Should `DeviceService.clearDtcs`/`udsClear` take `confirmed:
   boolean` in their signatures (finding 5)** so the write gate stays
   visible at call sites, or is the hook-comment documentation enough?
5. **gauges.ts's single-letter `fmt` callbacks**: finish the rename (the
   polish commit's out-of-scope claim for this file is factually wrong —
   the stream created it), or formally except moved-verbatim code?
6. **Error copy at the Schema boundary.** If the Rust side's shape drifts,
   users see a raw ParseError message (technical multi-line output)
   through the existing `error.message` display path. Against the "honest
   absence"/plain-language principles, should decode failures map to a
   plain sentence ("The app and the backend disagree about the shape of
   this data — this is a bug, please report it") with the ParseError in
   the console instead? Cheap to add in `decoded()` later; nothing does it
   today, and nothing did it before either.
7. **Effect idiom drift risk.** The codebase now has three run idioms:
   point-free `Effect.flatMap` one-liners, one `Effect.gen` in
   useScanDtcs/DiscoveryFlow, and the per-feature `run` helpers. All
   correct; is this the intended house style, or should the docs pick one
   shape for future contributors (the research's own "one-person team, no
   second engineer to catch misuse" cost cuts both ways here)?

## Gut check for the human

Asked directly whether this is a foundation for the next several months:
yes, with one caveat and one cost. The service boundary is genuinely
clean — I checked the swap question hostilely and could not find Tauri
leakage through the interface; the mock story actually got *simpler* than
research feared (one switch point, no parallel mock layer to maintain);
validation is real; and the live app is indistinguishable from
pre-migration across every flow I exercised. The caveat: this codebase now
carries a real Effect literacy tax — research.md said this honestly, and
it is true; every future contributor (including future AI sessions)
must know `Context.Tag`/`Layer`/`Effect.gen` to touch the data layer,
and the three-idiom drift in question 7 is the first symptom. The cost:
the 58 KB bundle regression is the one number this stream should not be
allowed to merge without someone saying "yes, we pay that" out loud.
