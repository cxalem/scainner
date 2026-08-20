# Review report: write-caps increment 1, stage 4

Reviewer: Claude (Fable 5), 2026-08-20. Branch `ws/write-caps` at 107c60c,
reviewed in the worktree against `main...ws/write-caps`. Three small fixes
applied during review (findings 1 to 3 below); everything else verified as
claimed.

## Verdict: ship, with the small fixes made in this review

The safety rail is real, not decorative. Both existing writes (engine DTC
clear, per-module UDS clear) now meet all three parts of the hard rule, the
confirmation flag is enforced at the only boundary that reaches the car,
the before/after audit is captured on every path that actually sends a
clear, and a failed before-read aborts without writing. The mock demo has
full parity, including a pre-existing parity bug the builder found and
fixed. Three low-severity defects were found and fixed in this review; one
design question (the crash window in the audit trail) is left open for the
Codex cross-exam because it is a real trade-off, not a bug.

## The hard rule, checked explicitly (user's non-negotiable bar)

Every write action must ship with all three. There are exactly two write
actions in this branch, and no new ones.

**(1) Explicit confirmation before execution: met, twice over.**

- UI: both writes go through the shared `ConfirmWrite` overlay modal
  (`src/components/ConfirmWrite.tsx`); its confirm button is the only
  place the frontend sets `confirmed: true` (verified by grep: the only
  two `confirmed: true` call sites are `Diagnose.tsx` `doClear` and
  `ModuleFaults.tsx` `clear`, both reachable only from the modal).
- Backend: `require_confirmed` in `src-tauri/src/lib.rs` rejects
  `confirmed: false` before the request ever reaches the supervisor, so
  the car is untouched, and per design no audit row is written (nothing
  happened to the car).
- Route-around check: I grepped every path to the two raw write commands.
  Mode `04` is sent only inside `obd::clear_and_verify`, reached only from
  `Request::ClearDtcs`, constructed only in the `clear_dtcs` command,
  which calls `require_confirmed` first. `14FFFFFF` is sent only inside
  `uds::clear_dtcs`, called only from `uds::clear_module`, reached only
  from `Request::UdsClear`, constructed only in the guarded `uds_clear`
  command. The disconnected path (`answer_disconnected`) errors without
  touching anything. No other code path reaches a write. One caveat for
  the future: `uds::clear_dtcs` is a `pub` crate function, so the guard is
  a convention for future callers, not a type-level guarantee; acceptable
  today (threat model is accidental bypass, per decisions-plan.md), worth
  restating when increment 2 adds routines.

**(2) Logged before/after state: met, on every path that writes.**

Read-before happens before the write and read-after happens after it, in
that order, in both paths (`obd::clear_and_verify`; `uds::clear_module`).
Partial-failure handling is correct and honest:

- Before-read fails: the write is ABORTED, the car is never touched, no
  audit row (correct: the table records car interactions). This is a
  behavior tightening the builder logged: `clear_module` previously used
  `unwrap_or_default()`, which would have recorded a false empty
  before-state. Good catch, correctly fixed.
- Clear command fails after a good before-read: row logged with outcome
  `error`, the captured before-state, and the error text. The typed
  `ClearError` enum carries the before-state out of the failure, so
  nothing is lost (the builder's log describes rejecting a string-sentinel
  version of this; the shipped design is the right one).
- Clear sent but verify-read fails: row logged with before-state, outcome
  `error`, and an error message that says the clear was sent. The UI tells
  the user to re-scan. Honest.
- Success: row with before and after, outcome `cleared` or
  `faults_remain`, and for the UDS path `refused` when the module answered
  7F (with the UI no longer showing a false success banner over a refusal,
  another real pre-existing defect the builder fixed and logged).

Persistence verified: `writes_log` table in `db.rs`, three unit tests
(round trip, failure row, ordering and limit), all passing here.

**(3) Documented reversal path: met.**

`ConfirmWrite` makes the `reversal` prop required and always renders the
"Can this be undone?" block. Both writes state honestly that a DTC clear
is NOT reversible, and why it is still safe: the erased codes are
preserved in scan history and the write log, and a still-present fault
reports itself again. This matches the plan's acceptance criterion word
for word. No write in this branch claims false reversibility.

**Plain language, no em dashes, in touched copy: met.** I grepped the diff:
every added or rewritten user-facing string is em-dash free and plain
(modal copy, refusal line, outcome banners, Lab intro, info footnotes).
Em dashes remaining in `Diagnose.tsx` are in strings this stream did not
touch; decisions-plan.md scopes those to the i18n stream explicitly, which
matches the bar ("all touched user-facing copy").

## Scope check

Diff boundary matches the plan with one deviation:

- All planned files touched as promised; no query library added, no new
  write commands (grep confirms no `31`/`2F`/`2E`/`27` service anywhere),
  no i18n, no dark mode.
- **Deviation: `src/views/Lab.tsx` is not in the plan's file boundary but
  was modified**, and the change is not mentioned in decisions-build.md.
  The edit itself is justified and correct: ModuleFaults' new `label` prop
  has to come from somewhere, and the Lab intro copy said "Read-only,
  nothing here can change the car", which the fault clear made false (an
  honest-absence violation had it stayed). Finding 5 below; log hygiene,
  not a code problem.

## My verification (independent, not the builder's)

- `cargo test` in src-tauri: 18 passed (15 existing plus 3 writes_log).
  `cargo check`: clean. `npx tsc --noEmit`: clean. Re-run again after my
  fixes: still clean.
- Browser demo, own run: dev server on port 4622 (separate from anything
  else), scripted Playwright walkthrough of the full flow: Connect, ~15s
  discovery, Go to dashboard, Diagnose scan, Clear codes, ConfirmWrite
  modal (reversal block present), verified-clear banner, Write history row
  appears; then Lab, Read faults, clear via modal (module label shown),
  verified outcome; back to Diagnose, Write history shows both rows with
  before/after counts and outcome badges; honest-absence empty state
  confirmed before any write. Zero console errors. Screenshots in
  `docs/workflows/write-caps/review-screenshots/`.
- Builder's port-1420 incident, checked: the process listening on 1420 is
  a Vite server whose working directory is `/Users/cxalem/projects/scainner`
  (the main repo, another session's), exactly as the builder reported. It
  was left untouched. Nothing listens on 4611, no port config or stray
  file was committed (grep for "4611" across src, src-tauri, configs:
  nothing), `git status` clean, `git clean -nd` empty.
- Decision-log quote audit (all quotes traced to their sources):
  - decisions-plan's research quotes (section 7 scope cut, section 4
    "Likely yes, unverified per-routine", "Actuator stuck on if session
    drops mid-test", section 5a confirmed-bool sentence, 5b "Every write
    handler reads state before and after"): all verbatim in research.md.
  - decisions-build's app-perf quote ("'Yes, clear' becomes a `useMutation`
    whose `isPending` disables the button and shows 'Clearing…'"): verbatim
    at docs/workflows/app-perf/plan.md step 2.
  - decisions-build's hard-rule wording and "Failed writes are logged too":
    match plan.md.
  - ONE quote I cannot verify: decisions-plan cites the task brief
    allowing "build the safety-rail UI pattern and wire it to a no-op test
    write" as the minimum slice. The task brief is not in the repo.
    Finding 6, question for Codex.
- NOT verified here, same as the builder: the real car. No dongle in this
  environment. The manual gate test remains: clear a code on the C4 and
  check the writes_log row (status.json already says this).

## Findings, ranked

1. **Diagnose's clear trigger vanished while its own modal was open
   (low, FIXED).** `Clear codes…` rendered only when `!confirmClear`, so
   opening the modal removed the button and shifted the toolbar behind the
   overlay. This is the same hidden-trigger shift the builder fixed in
   ModuleFaults (which keeps its button mounted) but not in Diagnose.
   Fix applied: button stays mounted, `disabled` while the modal is open.
   Re-verified in the browser flow.
2. **`log_write` swallowed insert failures silently (low in likelihood,
   high in principle, FIXED).** The insert used the `.ok()` style the
   other db.rs inserts use, but for the audit table specifically a
   silently dropped row means the app changed the car with no record,
   which is the exact thing the table exists to prevent. Fix applied:
   insert failure now logs a loud `log::error!` naming module, action and
   outcome, and returns -1. Realistic failure odds are near zero (single
   mutex-guarded connection, table created at open), which is why this is
   a visibility fix, not a redesign; a stronger contract is Codex question
   B below.
3. **BACKLOG design-principles note went stale (doc, FIXED).** The "No
   layout shifts" principle still said "the clear-codes confirmation
   banner still violates this"; after this branch both confirmation
   banners are the ConfirmWrite modal. Updated the parenthetical.
4. **Crash window in the audit trail (design question, NOT fixed, for
   Codex and the human).** The audit row is inserted after the write and
   its verify-read complete. If the app dies between sending `04` /
   `14FFFFFF` and the insert, the car was written with no row. For DTC
   clears this is acceptable (worst case: an erased-codes record is
   missing, and scan history still shows the change). For increment 2's
   actuator tests it is not: a crash mid-actuation is precisely the moment
   the trail matters most. The standard fix is an intent row (insert
   `pending` before sending, update to the outcome after), which also
   gives "the app died mid-write" a visible representation. I did not
   retrofit it because it changes the schema contract this increment just
   shipped and the current behavior satisfies the hard rule as written for
   these two writes. Proposed: adopt intent rows in increment 2's plan.
5. **Unlogged file-boundary deviation (log hygiene, low).** `Lab.tsx`
   modified outside the plan's file boundary with no decisions-build
   entry. The change is right (see scope check); the omission is the
   defect. Proposed fix: builder appends one entry, or the PR description
   notes it.
6. **Unverifiable task-brief quote (low, for Codex).** decisions-plan's
   "no-op test write" quote from the task brief cannot be checked against
   the repo. Given every other quote in both logs audited clean, I believe
   it, but the 3d-logos round caught a fabricated quote, so it should be
   confirmed by whoever holds the original brief.
7. **Notes, no action required this increment.**
   - `ConfirmWrite` has no Escape-key close or focus trap. Parity with
     every existing modal in the app (none has them); belongs to an
     accessibility pass, not this stream.
   - The mock's module list labels the engine module "Engine (BSI)"
     (pre-existing demo data, not from this branch); slightly incoherent
     naming against the real built-ins ("Engine ECU"). Demo-only.
   - Diagnose's clear flow still has no pending state; explicitly deferred
     to app-perf with the exact claim quoted and verified. Both streams
     touch Diagnose.tsx; decisions-plan already flags the rebase.

## Questions for the Codex cross-exam

A. The `confirmed: bool` guard is convention, not construction: a future
   command could call `uds::clear_module` without it. Should increment 2
   introduce a type that can only be produced by the confirmation path
   (newtype token) or is that ceremony given the single-user threat model?
B. Finding 4: should the intent-row (pending state) design be a
   prerequisite for increment 2's actuator test, given "actuator stuck on
   if session drops mid-test" is that feature's stated worst case?
C. Finding 6: does the original task brief actually contain the "no-op
   test write" minimum-slice wording decisions-plan quotes?
D. The audit row stores module labels, not keys (builder's own call,
   logged with a sound rationale). Does Codex see a failure mode in
   label-renaming beyond the one the builder already accepted?
