# Decision log: builder, write-caps increment 1

Each block: what, options, why, risk. Where I cite the plan or research I
quote it; everything else is my own reasoning.

## ClearError enum instead of a string sentinel for the engine clear

What: `obd::clear_and_verify` returns a three-variant error
(`BeforeScanFailed` / `ClearFailed` / `VerifyFailed`), the last two
carrying the captured before-scan.
Options: (a) `Result<_, String>` with a prefix sentinel the supervisor
parses; (b) a typed error carrying the before state.
Why: (b). The audit log must distinguish "nothing was sent to the car"
(before-scan failed: not logged as a write) from "a write was attempted or
done" (logged, with whatever state exists). I first wrote (a) with a
`VERIFY_FAILED:` string prefix, and replaced it in the same session: it
lost the before-scan for logging and parsing error strings is exactly how
subtle bugs start. This structure is my own design; the plan only
specifies the behavior ("Failed writes are logged too").
Risk: low, the enum is private to the elm module.

## Failed before-read aborts the write, in both clear paths

What: engine clear and module clear now refuse to clear when the read
before the write fails, returning "Could not read ... so nothing was
cleared". Previously `clear_module` used `read_dtcs(drv).unwrap_or_default()`,
so a failed before-read silently became "no faults before".
Options: (a) keep the forgiving default and log a possibly-false empty
before-state; (b) abort the write when the before state cannot be captured.
Why: (b). The hard rule's part 2 is "a logged before/after state (what was
read before the write, what changed after)" (task brief wording; plan.md
carries the same requirement). Logging an empty list that actually means
"read failed" would make the audit trail quietly lie, which is worse than
having no row. This tightens existing behavior slightly: a flaky link now
produces a visible error instead of a clear with a made-up before-state.
Risk: low. A user with a genuinely flaky link retries; that is the honest
outcome.

## Where the logging lives: uds.rs logs itself, engine clear logs in supervisor

What: `uds::clear_module` inserts its own writes_log rows (it already
takes `&Db`); the engine clear's rows are inserted by
`supervisor::handle_request`, keeping obd.rs DB-free.
Options: (a) symmetric: give obd.rs a Db dependency; (b) follow each
file's existing seam.
Why: (b). obd.rs is deliberately "standard, any-car" logic with no DB
dependency, and handle_request already does obd's DB work (it inserts scan
rows for `ScanDtcs`). uds.rs already talks to the DB throughout. Making
obd.rs depend on Db just for symmetry would trade a real boundary for a
cosmetic one.
Risk: low. Asymmetry is documented here so the increment-2 builder knows
both patterns exist and why.

## Module label, not key, in the writes_log `module` column

What: rows store "ABS / ESP" / "Engine (OBD)" style labels.
Why: the audit trail should read on its own (in the UI, in a DB export, in
an AI briefing) without a join against a modules table whose custom
entries can be deleted. My own call; the research schema sketch just says
"module".
Risk: renaming a custom module changes the label future rows get; old rows
keep the label that was true at write time, which for an audit log is
arguably correct behavior anyway.

## Unconfirmed calls refuse without logging a row

What: `require_confirmed` rejects before reaching the supervisor; nothing
is inserted into writes_log.
Why: the table records interactions with the car, and a refused call never
touched it. Logging UI bugs would dilute the trail the user reads to know
what changed on their vehicle. (Decided in decisions-plan.md; confirmed
during build with no surprises.)

## Refused module clears now render honestly

What: ModuleFaults previously ignored `ClearOutcome.accepted` and would
show "Cleared and verified" even if the module had sent a negative
response. Added an explicit "The module refused the clear command.
Nothing was changed." branch.
Why: found while rewiring the component; showing a success banner over a
7F response would violate the honest-absence principle. Not in the plan
text; it falls under the acceptance criterion that both writes meet the
hard rule (a refused write's after-state claim must not be a lie).
Risk: none observed; refused is also a distinct outcome badge in Write
history.

## No pending-state work on the clear buttons

What: the clear flow still lacks a disabled/"Clearing…" state on
Diagnose's button (ModuleFaults already had one and keeps it).
Why: app-perf's plan step 2 explicitly claims it: "'Yes, clear' becomes a
`useMutation` whose `isPending` disables the button and shows 'Clearing…'"
(docs/workflows/app-perf/plan.md). Duplicating that here would create the
second data-handling pattern decisions-plan.md ruled out.
Risk: a slow real-car clear gives no feedback for a few seconds, same as
before this stream; accepted because the fix is already planned elsewhere.

## Mock parity bug found and fixed

What: `mock.ts`'s `uds_clear` returned `{ cleared: 0 }`, which was never
the `ClearOutcome` shape ModuleFaults destructures; the demo's module
clear has been silently broken (engineering.md rule 3 violation predating
this stream). Also `uds_module_dtcs` always returned `[]`, so the clear
button could never appear in the demo.
Fix: stateful per-module demo faults, real ClearOutcome, confirmed guard,
in-memory write log. Verified end to end in the browser demo.

## Verification notes (honesty)

- `cargo test`: 18 pass (15 existing + 3 new writes_log tests).
  `cargo check` and `npx tsc --noEmit` clean.
- Browser-demo walkthrough verified with Playwright screenshots: connect,
  discovery, scan, engine clear (modal, verified banner, write history
  row), Lab module clear on BSI (modal with module label, verified
  outcome, second write history row). Zero console errors. First run
  accidentally hit a dev server another session had running from the main
  scainner worktree on port 1420 (old code, em-dash banner); re-ran this
  worktree on its own port 4611 and verified against the right build. That
  other server was left untouched.
- NOT verified against the real car: the Rust write path (verified engine
  clear, uds clear logging) compiles and is unit-tested at the db layer,
  but no dongle was attached in this environment. The reviewer's manual
  test should clear a code on the real C4 and check the writes_log row.
