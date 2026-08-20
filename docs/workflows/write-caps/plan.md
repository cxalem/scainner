# Plan: write-caps increment 1 (the write safety rail, on real writes)

## Problem statement

The product vision is read AND write. Research (research.md) confirmed the
dongle can technically send routine/adaptation commands, but every genuinely
NEW write candidate needs facts we do not have yet: research section 7
explicitly cut "enumerate actual RoutineControl/IOControl identifiers for
the C4's engine/ABS modules (needs a hunt session against the real car, a
build-stage task, not armchair research)". Without verified routine IDs we
cannot document a truthful reversal path, so no new-to-the-car write can
meet the hard rule in this increment (full reasoning: decisions-plan.md).

What we CAN ship now is the safety rail itself, wired to the two REAL
writes the app already performs (engine DTC clear, per-module UDS clear).
Today those have confirmation UIs but their before/after exists only
transiently in component state, nothing is persisted, and the confirmation
pattern is ad hoc (Diagnose has a modal; ModuleFaults still uses an inline
banner that shifts layout, a known design-principle violation). This
increment makes the existing writes fully compliant with the hard rule and
builds the generic pattern every future write (actuator tests next) reuses.

## Goal

1. A persisted write audit trail: new SQLite table `writes_log`; every
   write, success or failure, inserts a row (before state, after state,
   outcome). Shown in the UI as a Write history card.
2. A shared `ConfirmWrite` modal used by every write action, always stating
   what will change, on which module, and whether it can be undone.
3. Enforcement at the Tauri command boundary: write commands take
   `confirmed: bool` and refuse when false, so no stray call skips the modal.
4. Engine DTC clear becomes backend-verified (read before, clear, read
   after, one atomic supervisor request) like `uds::clear_module` already is.

## Non-goals (explicitly out of scope)

- NO new write commands to the car. No 0x31 RoutineControl, no 0x2F
  IOControl, no 0x2E writes, no 0x27 SecurityAccess, nothing touching BSI.
- No actuator tests. That is increment 2, gated on a routine-ID hunt
  session with the real car, behind this same rail (hard timeout + revert).
- No "write freeze data" or anything not grounded in research.md.
- No i18n, no TanStack Query migration (app-perf stream owns Diagnose's
  data layer later; this change keeps the current invoke/useState style so
  the app-perf builder migrates one consistent pattern).

## File boundary

`src-tauri/src/db.rs`, `src-tauri/src/elm/{obd.rs,uds.rs,supervisor.rs}`,
`src-tauri/src/lib.rs`, `src/lib/{meta.ts,mock.ts}`,
`src/components/{ConfirmWrite.tsx,WriteHistory.tsx}` (new),
`src/views/Diagnose.tsx`, `src/views/lab/ModuleFaults.tsx`,
`docs/workflows/write-caps/*`, `docs/BACKLOG.md`.

## Steps (riskiest first)

1. **Backend verified engine clear + writes_log** (riskiest: changes a
   supervisor request's shape end to end). `writes_log` table in db.rs
   (`id, ts, module, action, params_json, before_json, after_json,
   outcome, error`) with insert + list helpers and a unit test.
   `Request::ClearDtcs` returns `ObdClearOutcome { before: DtcResult,
   after: DtcResult }`: scan, send `04`, re-scan (after-scan still lands in
   `dtc_scans` history, matching today's UI behavior), log the write.
   `uds::clear_module` logs its existing ClearOutcome the same way.
   Outcome values: `cleared`, `faults_remain`, `refused`, `error`.
   Verify: `cargo test` + `cargo check` in src-tauri.
2. **Command boundary**: `clear_dtcs` and `uds_clear` take
   `confirmed: bool`, refuse with a plain-language error when false; new
   `writes_log(limit)` command. Verify: cargo check; a false call refuses.
3. **ConfirmWrite component**: generic modal (overlay + centered card, the
   Diagnose clear-codes modal is the template) with required props: title,
   what will change and on which module, and a reversal block that is
   always rendered ("Can this be undone?"). Wire into Diagnose (replacing
   its bespoke modal) and ModuleFaults (replacing the inline banner, which
   removes the layout shift). Both pass `confirmed: true` only from the
   modal's confirm button. Verify: tsc + both flows in the browser demo.
4. **Write history card** in Diagnose (below Scan history): lists
   writes_log rows (time, action, module, before/after counts, outcome
   badge), refreshes after each write, honest-absence empty state. Rewrite
   the outcome banner strings touched in Diagnose/ModuleFaults to plain
   language without em dashes. Verify: tsc + browser demo.
5. **Mock parity** (engineering.md rule 3): mock `clear_dtcs`/`uds_clear`
   honor `confirmed`, return the new shapes (fixing the existing mock bug
   where `uds_clear` returns `{ cleared: 0 }` instead of a ClearOutcome),
   and maintain an in-memory writes log served by `writes_log`. Verify:
   full flow in the browser demo, screenshots at confirm / outcome /
   history states.
6. **Docs**: decisions-build.md, status.json to built, BACKLOG stream G
   progress note.

## Acceptance criteria

- HARD RULE (non-negotiable, from BACKLOG stream G): every write action
  ships with all three, no exceptions: (1) an explicit confirmation step
  before it executes, (2) a logged before/after state persisted in
  `writes_log` (what was read before the write, what changed after),
  (3) a documented reversal path shown in the confirmation step. For DTC
  clears that documentation is an explicit statement that the clear is NOT
  reversible, and why that is still safe to ship: it only erases stored
  fault records, the erased codes are preserved in scan history and the
  write log, and a still-present fault re-reports on its own. No write
  ships without all three. Both existing writes meet all three afterward.
- Every user-facing string this increment adds or rewrites is plain
  English with no em dashes.
- A write command invoked with `confirmed: false` (or omitted) refuses and
  the car is never touched.
- Failed writes are logged too (outcome `error`, error text preserved).
- No layout shifts: ModuleFaults' inline confirmation banner is gone,
  confirmations overlay.
- `npx tsc --noEmit` clean; `cargo check` and `cargo test` clean
  (existing tests plus the new writes_log test).
- Mock parity for every changed/new command; full flow works in the
  browser demo.

## Demonstration

PR description (end of pipeline): before/after of the ModuleFaults
confirmation (banner vs modal), screenshots of ConfirmWrite with the
reversal block, Write history card populated and empty, and the refusal
error from an unconfirmed call. Links to research.md and both decision logs.
