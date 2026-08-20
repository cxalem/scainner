# Decision log: planner, write-caps

Each block: what, options considered, why, risk.

## No new-to-the-car write in increment 1

What: scoped the first increment to the safety rail wired onto the two
writes that already exist (engine DTC clear, per-module UDS clear), and
explicitly rejected every genuinely new write candidate from research.md's
section 4 table for this increment.
Options: (a) ship research's recommended feature #2, an engine/ABS
actuator test via 0x31/0x2F; (b) ship a smaller new write such as clearing
readiness monitors; (c) build the rail and wire it to the existing real
writes only, defer new writes to increment 2.
Why: (c), for three reasons.
First, (a) fails the hard rule today. Research section 4 marks the
actuator test "Likely yes, unverified per-routine on this car" and section
7 cut the prerequisite: "enumerate actual RoutineControl/IOControl
identifiers for the C4's engine/ABS modules (needs a hunt session against
the real car, a build-stage task, not armchair research)". This build
stage has no car attached, so the routine IDs cannot be discovered or
verified here. A write whose routine ID is guessed cannot carry a truthful
documented reversal path, and its worst failure mode per research is "
Actuator stuck on if session drops mid-test". That is not a first
increment, it is the second one, after a hunt session with the car.
Second, (b) is empty. Readiness monitors reset as a side effect of the
mode 04 clear the app already ships (the Diagnose banner already tells the
user exactly this), and no other "clear/reset something read-only today"
candidate exists in research.md that mode 04 / UDS 14 does not already
cover.
Third, (c) is not a consolation no-op. The task brief allows "build the
safety-rail UI pattern and wire it to a no-op test write" as the minimum
slice; wiring the rail to two real, shipping, consequential writes proves
strictly more than a no-op would, and it closes a real compliance gap: the
existing writes have confirmation but no persisted before/after log, so
they do not currently meet the stream's own hard rule. After this
increment they do, and increment 2's actuator test drops into a proven
pattern.
Risk: medium. The user may have hoped for a visible new capability this
cycle. Mitigation: the plan names the actuator test as increment 2 with
its concrete prerequisite (routine-ID hunt session with the car), so the
path is explicit, not vague.

## Backend-verified engine clear (request shape change) instead of leaving the frontend re-scan

What: `Request::ClearDtcs` changes from returning `()` to performing
read-clear-read in the supervisor and returning both DtcResults.
Options: (a) keep the current shape, log before/after from the frontend's
own state; (b) verify and log in the backend, one atomic supervisor
request.
Why: (b). The before/after log is an audit trail; research section 5b says
"Every write handler reads state before and after" (the pattern
`clear_module` already implements). Frontend-supplied "before" state can be
stale or absent (the user can clear from a scan done minutes ago), and a
log the UI writes is skippable by any future caller. In the backend the
log happens on the only path that touches the car. It also mirrors the
existing `uds::clear_module` shape, so both writes end up symmetric.
Risk: low. One request enum variant and one command signature change, all
call sites in this repo, mock updated in the same increment.

## `confirmed: bool` at the command boundary

What: write commands refuse unless the frontend passes `confirmed: true`.
Options: (a) trust the UI modal alone; (b) enforce in the command.
Why: (b), and this is research's own design, adopted unchanged: section 5a
says "Enforce at the Tauri command boundary too: each write command takes a
`confirmed: bool` the frontend must set, so a stray automated call can't
skip the modal." Unconfirmed calls refuse without logging a row, since
nothing was sent to the car (the log records car interactions, not UI
mistakes). That last point is my own reasoning, not from the research doc.
Risk: low. A bool is not cryptographic protection against a malicious
caller, but the threat model here is accidental bypass, not malice: the
whole app runs as the user on their own machine.

## Write history lives in Diagnose, one card, no new view

What: the writes_log UI is a card at the bottom of Diagnose.
Options: (a) new top-level view; (b) card in Diagnose; (c) card in Lab.
Why: (b). Both current writes are reachable from Diagnose's mental space
(engine codes) or are variations of it (module faults in Lab), and
Diagnose already hosts Scan history, so "what the app changed" sits next
to "what the app saw". A dedicated view for what is initially a short list
would be ceremony. When actuator tests land, revisit.
Risk: low. Lab's ModuleFaults writes also log there; a user might look for
them in Lab first. The card labels each row with its module, which should
make the single location legible.

## Em-dash cleanup limited to strings this increment touches

What: rewrite the outcome/confirmation strings in Diagnose and
ModuleFaults (which currently use em dashes) but do not sweep the whole
app's copy.
Options: (a) repo-wide copy sweep; (b) only strings this stream produces
or rewrites.
Why: (b). The non-negotiable is scoped to "every user-facing string this
plan produces or describes"; a repo-wide sweep belongs to the i18n stream
which will restructure all strings anyway (BACKLOG stream F), and touching
every view here would break the one-stream-one-file-boundary rule while
app-perf has plans over the same views.
Risk: low. Logged so the i18n stream knows the remaining em dashes are
theirs.

## Keep the current invoke/useState data style, no query library

What: the new WriteHistory card and changed handlers use the same
hand-rolled invoke + useState pattern as the rest of Diagnose today.
Options: (a) adopt TanStack Query early for the new code; (b) match the
existing style.
Why: (b). app-perf's plan (docs/workflows/app-perf/plan.md) migrates every
view to TanStack Query wholesale and its builder expects one consistent
before-state; introducing a second pattern in Diagnose now would make that
migration messier. Streams stay out of each other's refactors.
Risk: low, but real merge coordination: both streams touch Diagnose.tsx.
app-perf's build is blocked on the 3d-logos merge and this branch is
first; whichever merges second rebases. Noted here so the conflict is
expected, not surprising.
