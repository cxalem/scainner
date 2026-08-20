# Decision log: reviewer, write-caps increment 1

Each block: what, options considered, why, risk. What I checked and why I
am confident, per roles/reviewer.md.

## What I checked, and how

- Full diff `main...ws/write-caps` (17 files), read line by line, against
  plan.md's promises and the stream's hard rule. Every claim in
  decisions-build.md traced into the diff.
- Route-around hunt on the confirmation guard: grepped every occurrence of
  `"04"`, `14FFFFFF`, `Request::ClearDtcs`, `Request::UdsClear`,
  `clear_module`, `clear_and_verify`, `log_write`, and both Tauri command
  names across src and src-tauri. Both raw write commands are reachable
  only through the two guarded Tauri commands. The disconnected branch
  answers with an error and touches nothing.
- Partial-failure paths read individually (before-read fail, clear fail,
  verify fail, module refusal) to confirm what gets logged, what gets
  aborted, and what the user is told, in each case.
- Re-ran verification myself instead of trusting the builder: cargo test
  (18 pass), cargo check, tsc, all clean, then again after my fixes. Own
  Playwright walkthrough of both clear flows in the browser demo on port
  4622, screenshots committed under review-screenshots/, zero console
  errors, honest-absence empty state confirmed.
- The builder's port-1420 story: confirmed via lsof that the 1420 listener
  is another session's Vite server rooted in the main scainner repo, left
  running; nothing on 4611; no stray files (`git status`, `git clean -nd`)
  and no "4611" committed anywhere.
- Quote audit of both decision logs against research.md, plan.md, and
  app-perf/plan.md, because the 3d-logos review caught a fabricated quote
  last round. All quotes verified verbatim except one from the task brief,
  which is not in the repo (escalated to Codex, not assumed).

## Fixing three small defects myself instead of bouncing to the builder

What: applied three fixes in this review: (1) Diagnose's clear button no
longer unmounts while the ConfirmWrite modal is open (disabled instead),
(2) `log_write` insert failures are now loud (`log::error!`, return -1)
instead of silently swallowed, (3) BACKLOG's stale "banner still violates
this" note updated.
Options: (a) report only and send back to the builder; (b) fix the small
unambiguous ones and report the rest.
Why: (b), the review brief explicitly allows it and all three are small,
mechanical, and unambiguous: the first is the same fix the builder already
made in ModuleFaults, just not mirrored in Diagnose; the second changes
visibility only, not behavior; the third is a one-line doc truth update.
Each is noted in the report. Re-ran tests, tsc, and the browser flow after.
Risk: low. None changes a contract; the -1 return of `log_write` is used
by nothing but the unit test, which asserts the success path only.

## Not retrofitting an intent-row (pending) design for the audit trail

What: identified the crash window (write sent, app dies before the row is
inserted) as a real gap, but reported it as a design question for Codex
and increment 2 instead of changing the schema now.
Options: (a) add a pending row inserted before the write and updated
after; (b) leave the shipped post-hoc insert and escalate.
Why: (b). The hard rule as written is satisfied for these two writes
(before/after is captured and persisted on every completed path, and a
crash mid-DTC-clear loses only a record of an erasure that scan history
still evidences). An intent-row is the right design for actuator tests,
where mid-write death is the dangerous case, and that is increment 2's
plan to make, not a review-stage rewrite of a schema that just shipped.
Ambiguous plus consequential equals escalate, per my brief.
Risk: if increment 2 skips the question, the gap ships against a riskier
write. Mitigated by putting it in the report's findings AND the Codex
question list.

## Trusting the browser demo plus unit tests as sufficient for this stage

What: signed off without a real-car test.
Options: (a) block the review on hardware; (b) verify everything
verifiable here and keep the real-car test as the explicit user-gate step.
Why: (b). No dongle exists in this environment; the builder said the same
honestly. The Rust path is compile-checked, unit-tested at the db layer,
and structurally reviewed; the full UI flow is exercised against the mock,
which now mirrors the backend's shapes and guard. The pipeline's final
gate is the user's manual test with the car, and status.json plus the
report both say exactly what to test (clear a code, check the writes_log
row). This matches how 3d-logos shipped (browser-verified, user-gated).
Risk: a real-ELM quirk (timing, partial responses) could still surface;
contained by the fact that both writes existed before this branch and the
new code changes their bookkeeping, not their bus traffic, except the
added read-before path reusing the existing scan/read functions.

## Confidence

High on: the guard being unbypassable from the frontend today, the logging
paths, mock parity, no stray artifacts from the port incident, quote
integrity (minus the one task-brief quote), copy rules on touched strings.
Medium on: real-hardware behavior (untestable here, explicitly gated).
The verdict is ship with the review fixes; nothing found rises to rework.
