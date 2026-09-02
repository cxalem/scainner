# Codex cross-exam: Windows release specification

Date: 2026-08-31. Scope: `research.md`, `plan.md`, `review-report.md`, current
`origin/main@c612e1b` at review time and existing implementation evidence `473a5b5`.

## Reconciliation status (2026-09-02)

José relayed Alejandro's acceptance of the four human-gate decisions. Residual
implementation gates remain: `ws/windows-rust-ci` must land, the workflow must be
rebuilt from current main, and the protected draft, manifest, installer-hash and
authorized Windows launch checks must pass. No workflow implementation exists here.

## Result

The specification is ready for Alejandro's human gate after four corrections made in
this pass. It does not approve or rehabilitate the existing implementation commit.

## Corrections required by this cross-exam

1. **Executable manifest gate.** The plan originally said to inspect every platform
   entry without naming entries or a verifier. It now requires a final Ubuntu job,
   draft lookup by exact tag, manifest keys `darwin-aarch64`, `darwin-x86_64` and
   `windows-x86_64` subject to confirmation from the pinned action, top-level version,
   per-platform URL/signature fields, installer classes and generated updater assets.
2. **Secret-free version preflight.** The plan now defines normalization of exactly
   one leading `v`, parses all three application version sources, runs before native
   secret-bearing jobs, and proves a passing and mismatch-failing case.
3. **Pipeline artifact.** This file preserves the required Codex cross-exam separately
   from the reviewer-role report on Claude's implementation.
4. **Canonical route.** The KB handoff must mark its old input-less manual-dispatch
   instruction superseded. Only a validated version tag is permitted by this spec.

## Residual gates

- Exact updater keys and asset names must be confirmed against the action SHA selected
  during implementation; the workflow then encodes them as fail-closed assertions.
- No local evidence proves Windows compilation, action manifest merge behavior,
  installer launch, SmartScreen behavior or updater installation.
- The first protected test tag remains a deployment-config and human-release gate.
- Scanner and vehicle behavior are explicitly outside SCAINNER-03.

## Verdict

**Spec: pass to implementation under the accepted gate. Existing build `473a5b5`:
request changes.** The historical verdict does not approve any workflow implementation.
