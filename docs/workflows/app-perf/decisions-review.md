# Decision log: reviewer, app-perf

Each block: what, options considered, why, risk. Same honesty standard as
the other stages: quotes are exact or marked as my own reading.

## Rebuilt the bundle baseline from `git archive main`, not another worktree

What: to verify the "204.98 KB before" half of the bundle table without
touching `/Users/cxalem/projects/scainner` or any other worktree, I
exported `main`'s tree with `git archive main | tar -x` into the session
scratchpad, symlinked this worktree's node_modules, and ran
`npx vite build` there.
Options: (a) trust the builder's before-number since the after-number
matched, (b) check out main in a new temp worktree, (c) archive-export to
a scratch directory.
Why: (c). The task brief says to rebuild the number myself and not trust
the reported one, and (b) writes worktree state into the shared .git that
the isolation rules say not to touch. The archive build reproduced
204.98 KB gzip exactly; the after-build on this branch reproduced
107.95 KB exactly.
Risk: the symlinked node_modules could theoretically differ from what a
fresh install against main's lockfile would produce; the only delta on
this branch is one added package, which does not change how main's code
resolves, and the byte-exact match confirms it.

## Verified the wrong-server incident environmentally, not just textually

What: before browser testing I ran `lsof` on port 1420 and inspected the
owning process's cwd: it is a vite server running from
`/Users/cxalem/projects/scainner`, exactly the collision the builder's
log describes. I then started this worktree's server on port 5219 (a
fresh port, not even the builder's 5183) and confirmed the listener's
cwd is this worktree before trusting any screenshot.
Options: (a) accept the log's account, (b) re-verify the environment and
grep the builder's claims for anything that could only have come from the
wrong worktree's app.
Why: (b), it is the specific caught-mistake the task told me to check for
real. Every browser claim in decisions-build.md is scoped to 5183, and
the two anomalies the builder caught (a `?brand=saic` query param, a
connect-gate reset) are artifacts of the other stream's code, which is
consistent with their story and absent from every claim about this
codebase.
Risk: none found; I could not identify any claim in the builder's docs
that depends on the wrong-server session.

## Exercised the app in a live browser rather than trusting screenshots-in-words

What: full session on localhost:5219 in mock mode: connect (caught the
"Waking the dongle…" cycle), discovery, then per-view checks. The two
end-to-end refetch-bug traces the task required: Live's sensor table
(read, note timestamp, leave, return, table intact with the same
timestamp) and Overview (instant cache render on return, skeleton only on
first mount). Also observed: History's fixed-size chart skeleton with no
layout jump, Diagnose's scan pending state and the clear modal staying
open with "Clearing…" and both buttons disabled through settle, the scan
history updating live after clear, the fuel-price save narrating
"saving…" then driving Cost per 100 km 8.75 to 9.72 through invalidation,
Vehicle's identity and db-path skeletons, and Lab's per-card independent
states. Zero console errors across the session.
Options: trust the builder's verification notes, or redo it.
Why: reviewer.md obligation 2, and the task brief. Everything I could
reach reproduced; the items unreachable in mock (Lab write successes,
multi-car VIN switch, the Scans clean stat) are called out in the report
with the mock.ts evidence for why they are unreachable.
Risk: I verified against the same mock the builder used, so anything
mock parity hides (e.g. a real-Tauri-only failure in the async
`tauri.ts` rewrite) stays unverified by both of us. Flagged the two
riskiest such spots (async `listen` timing, reconnect invalidation
bursts) as Codex questions instead of claiming them safe.

## Fixed five small defects myself, deferred everything debatable

What: committed fixes for (1) History's forever-skeleton on an empty DB
(disabled queries report isPending), (2) Overview falling through to "No
data yet" on a failed cars fetch, (3) an em dash in the new fuel-save
error copy, (4) CodeBadge's missing press state, (5) AiReportCard's
hand-rolled copy label swapped for the shared useTransientLabel helper.
Options: (a) report-only, (b) fix everything I found including the
debatable items (scan card surviving tab switch, narration interval),
(c) fix only what is small, unambiguous, and plan-mandated.
Why: (c), per the task brief's "fix anything that is a real, small,
unambiguous defect". Items 1 and 2 are wrong-by-inspection against plan
rule 6 and the loading-vs-empty distinction; 3 breaks a hard repo rule;
4 breaks a stated acceptance criterion; 5 contradicts plan rule 10 and
ui.tsx's own comment. The debatable items (Diagnose scan persistence,
connect phrase interval, in-flow error boxes, blanket reconnect
invalidation) change behavior beyond the plan's text, so they went to
the report's Codex questions instead.
Risk: my fixes are themselves unreviewed by a second pair of eyes until
the cross-exam; kept them minimal (a guard clause, one new branch reusing
an existing card shape, a string, a className, a helper swap) and re-ran
tsc plus a browser smoke pass (connect, dashboard, Overview renders)
after making them.

## Left the builder's log misattribution in place, reported instead

What: decisions-build.md's Vehicle entry cites "the audit's rule 1" for a
quote that is actually audit rule 3 (and plan rule 9). I did not edit the
builder's log.
Options: (a) correct the rule number in their log, (b) report it as a
finding and leave the log as written.
Why: (b). A stage's decision log is that stage's testimony; the 3d-logos
review set the precedent of reporting citation defects rather than
silently rewriting them, and the cross-exam should see the log exactly as
the builder left it.
Risk: a future reader of the builder's log alone inherits the wrong rule
number; the report's finding 6 is the correction of record.

## Quote audit method

What: took every quoted phrase in decisions-build.md and grepped it
against plan.md, research.md, interaction-audit.md, and decisions-plan.md
verbatim.
Result: all exact (including elided quotes, whose ellipses do not change
meaning) except the rule-number misattribution above. No fabricated
quotes. Confidence: high; the phrases are distinctive enough that a grep
match is conclusive.

## Confidence summary

High: tsc, both bundle numbers, the refetch fix on Live and Overview, the
Diagnose clear flow, mutation-to-invalidation wiring, scope containment,
quote audit. Medium: full-table interaction coverage (walked in code for
every row, observed in browser for most; Lab write successes and rule
12's VIN-switch guard are code-verified only, blocked by mock parity).
Not verified by anyone yet: real-Tauri behavior of the async tauri.ts
wrapper and reconnect-time invalidation load; both are named in the
report for the cross-exam.
