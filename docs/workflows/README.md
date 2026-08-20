# Scainner development workflows

Multi-agent pipeline for feature workstreams. Defined 2026-08-20 with the
user; first applied to the 3D brand-logo workstream.

## The pipeline

Every substantial workstream runs five stages. Small fixes (one file, clear
scope) skip straight to a builder — the pipeline is for features, not typos.

| # | Stage | Who | Model | Output (all under docs/workflows/<stream>/) |
|---|-------|-----|-------|---------------------------------------------|
| 1 | Research | researcher agent | Sonnet | `research.md` + `decisions-research.md` |
| 2 | Plan | planner agent | Fable | `plan.md` + `decisions-plan.md` + a short plan summary posted to the user (informational, NOT a blocking gate) |
| 3 | Build | builder agent(s) | Sonnet | code on branch `ws/<stream>` + `decisions-build.md` |
| 4 | Review | reviewer agent | Fable | `review-report.md` |
| 5 | Cross-exam | OpenAI Codex (`codex exec`) | GPT | `codex-review.md`: questions/objections against the decision logs |
| — | **GATE: user reviews at the end** | human | PR with a plain-language change summary; user reads it after both reviewers and manually tests the running app; merge or request changes |

The pipeline does not stop for plan approval. The user can veto or
redirect any stream at any moment, and the redirect is recorded in that
stream's decision log. The PR description must contain: what changed in
plain language, how to test it manually, and links to the review report
and the Codex cross-exam.

Stage 5 exists because a different model has different blind spots: Codex
reads the review report, the decision logs, and the diff, and interrogates
the *decisions* ("why X and not Y"). Objections go back to the
builder/reviewer; only answered objections move on.

## Rules

- **Decision logs are mandatory.** Every agent appends to its
  `decisions-<stage>.md`: what was decided, options considered, why, known
  risks. Cheap to write, and they are what stage 5 cross-examines.
- **Role files are the skills.** Each agent's first instruction is to read
  its role file (`roles/<role>.md`) and the relevant pattern files
  (`patterns/*.md`). Lessons learned get written INTO the pattern files so
  the next run inherits them — that's how the workflow improves.
- **Isolation:** builders work in explicit git worktrees
  (`git worktree add ../scainner-<stream> -b ws/<stream>`), never the main
  checkout. One stream = one file boundary; overlapping streams don't run
  concurrently. (Automatic agent isolation follows the orchestrating
  session's repo — do not rely on it here.)
- **Verification is non-negotiable:** `npx tsc --noEmit` clean, `cargo
  check` clean when Rust changed, and UI changes verified with real
  screenshots in the running app before review.
- **Models:** builder is deliberately Sonnet, NOT the cheapest tier — this
  repo's history shows building (3D pipeline, race conditions) is where the
  hard failures live. Research breadth can drop to Haiku when it's a
  fan-out of many small lookups.

## Seeing results (human gates)

- Every stream lands as a branch + PR on `cxalem/scainner`.
- To see a stream live: `git checkout ws/<stream>` — the running dev server
  (`pnpm dev` / browser at :1420) hot-reloads to that branch. `git checkout
  main` switches back. The orchestrator can do this on request.
- Interrupt any time: tell the orchestrator; the stream's agents are
  stopped or redirected, and the decision logs record the redirect.

## Streams

- `3d-logos/` — 3D brand emblem database, resolved from VIN WMI. (First
  pipeline run.)
