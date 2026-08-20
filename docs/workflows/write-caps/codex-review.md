# Codex cross-exam review: write-caps increment 1

Reviewer: Codex, 2026-08-20.

Verdict: **OBJECTIONS-NONBLOCKING**.

I read the requested workflow docs in order, then ran the requested diff:
`git diff main...HEAD -- src src-tauri docs/workflows/write-caps` (1,846
lines across 24 files). I also ran `npx tsc --noEmit`, `cargo check`, and
`cargo test`; all passed, with 18 Rust tests passing.

## Hard-rule check

There are still exactly two write actions in this branch: engine DTC clear
(`04`) and per-module UDS clear (`14FFFFFF`). I found no added `2E`, `31`,
`2F`, or `27` write/routine/security-access service in the tracked
`src-tauri/src` code.

1. Explicit confirmation: met for the current app paths. `clear_dtcs` and
   `uds_clear` both call `require_confirmed` before constructing the
   supervisor request (`src-tauri/src/lib.rs:113`, `src-tauri/src/lib.rs:125`,
   `src-tauri/src/lib.rs:187`). The only frontend call sites that pass
   `confirmed: true` are the confirm handlers in Diagnose and ModuleFaults
   (`src/views/Diagnose.tsx:383`, `src/views/lab/ModuleFaults.tsx:41`), both
   reached through `ConfirmWrite`.
2. Logged before/after state: met for completed/attempted current writes.
   Engine clear reads before, sends `04`, reads after, and logs success or
   post-send failure (`src-tauri/src/elm/supervisor.rs:377` through
   `src-tauri/src/elm/supervisor.rs:412`). Module clear reads before, sends
   `14FFFFFF`, reads after, and logs success/refusal/post-send failure
   (`src-tauri/src/elm/uds.rs:247` through `src-tauri/src/elm/uds.rs:286`).
   A failed before-read aborts without sending the write, which is correct.
3. Reversal path: met. `ConfirmWrite` requires and always renders reversal
   text (`src/components/ConfirmWrite.tsx:23` through
   `src/components/ConfirmWrite.tsx:55`). Both current writes honestly state
   that DTC clears are not reversible and why they are still safe.

## Answers to the open questions

1. **Audit-trail crash window:** I agree with deferring the intent-row design
   for this increment, but it should be a hard prerequisite for increment 2.
   Today the row is inserted after the write/verify path, so a process crash
   between `drv.cmd("04")` or `drv.cmd("14FFFFFF")` and `db.log_write` can
   leave no row. For DTC clears this is acceptable: the operation is
   idempotent, low consequence, non-reversible by nature, and the UI preserves
   the last scan/write context when the normal path completes. For actuator
   tests, the crash window becomes safety-relevant because the risky moment is
   the in-flight actuation. Increment 2 should insert an intent row before
   sending the command, then update it to success/error/unknown after verify or
   timeout.
2. **Runtime `confirmed: true` guard:** adequate now. In the actual diff,
   there is no frontend route around the modal and no Tauri command route
   around `require_confirmed`. A malicious or devtools caller can pass
   `confirmed: true`, but that is outside the stated accidental-bypass threat
   model. The realistic future bypass is internal: `uds::clear_module` and the
   lower-level clear functions are public within the crate, so a future command
   could call them without using `require_confirmed`. That is not present in
   this diff. Before adding higher-consequence writes, introduce a small
   write-dispatch wrapper or confirmation-token type so future commands cannot
   accidentally bypass the rail by construction.
3. **Unverifiable task-brief quote:** on its own merits, yes, the build matches
   the substance of the phrase. It did not ship a fake no-op rail. It wired the
   rail to two real but bounded existing writes: verified engine clear and
   verified module clear, with confirmation, persistence, and reversal copy.
   The quote should not be treated as source-verifiable repo evidence, but the
   resulting implementation is consistent with the claimed scope cut.
4. **File-boundary/scope deviation:** `src/views/Lab.tsx` is a real deviation
   from the plan file boundary and was not logged in `decisions-build.md`.
   The edit is justified: ModuleFaults now needs a module label, and the old
   Lab text saying nothing could change the car would be false after this
   branch (`src/views/Lab.tsx:55` through `src/views/Lab.tsx:66`). This is log
   hygiene, not a code objection.
5. **Missed correctness defect:** one nonblocking UI issue. Engine clear
   summaries count only stored+pending codes, while `DtcResult` and the audit
   JSON also include `permanent`. `WriteHistory` omits permanent codes from
   its count (`src/components/WriteHistory.tsx:21` through
   `src/components/WriteHistory.tsx:40`), and Diagnose's clear banner can say
   "none remaining" when a permanent code remains in `outcome.after`
   (`src/views/Diagnose.tsx:385` through `src/views/Diagnose.tsx:387`,
   `src/views/Diagnose.tsx:439` through `src/views/Diagnose.tsx:443`). The raw
   persisted before/after is still correct, and the confirmation copy explains
   permanent codes, so this does not violate the hard rule. Fix by making the
   visible summary say "stored/pending" or by showing permanent as a separate
   count.

## Nonblocking objections

- Intent rows are not needed for DTC clears, but they must be required before
  actuator tests or any higher-consequence write.
- The confirmation guard is a runtime/convention guard today. Fine for the two
  current Tauri commands, but future write APIs should make bypass harder at
  the Rust boundary.
- `src/views/Lab.tsx` should be mentioned in the build decision log or PR notes.
- The write-history and Diagnose success summaries should not hide permanent
  codes behind a generic "codes before/after" count.

## Final verdict

**OBJECTIONS-NONBLOCKING.** Ship increment 1 with the objections above carried
forward. Nothing I found blocks the current DTC-clear safety rail from
shipping.
