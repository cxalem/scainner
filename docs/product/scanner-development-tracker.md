# Scanner development tracker

This is the durable execution record for the workshop-scanner roadmap. Update
it in every implementation PR so completed work, the active slice, dependencies,
and acceptance criteria do not depend on chat history.

Status values: `done`, `in_review`, `active`, `ready`, `queued`, `blocked`.

## Current position

| Order | Development slice | Status | Evidence |
|---:|---|---|---|
| 0 | Full-repository CI | done | [PR #36](https://github.com/cxalem/scainner/pull/36) |
| 1 | Deterministic ELM session replay | done | [PR #37](https://github.com/cxalem/scainner/pull/37), 63 Rust tests |
| 2 | Verified clear outcomes | done | [PR #38](https://github.com/cxalem/scainner/pull/38), 73 Rust tests plus full JS CI passed |
| 3 | Shared typed diagnostic outcomes | active | Branch `feat/typed-diagnostic-outcomes` |
| 4 | Central scanner safety and cleanup guard | queued | Depends on typed outcomes |
| 5 | Discovery strategy and coverage accounting | queued | Depends on safety guard |
| 6 | Safe 11-bit and 29-bit module enumeration | queued | Depends on discovery strategy |
| 7 | Partial ECU fingerprints | queued | Depends on trustworthy module inventory |
| 8 | Fingerprint matching experiment, 30–50 vehicles | queued | Depends on fingerprints |
| 9 | Workshop module taxonomy and vehicle map | queued | Can begin after fingerprint schema stabilizes |
| 10 | Unified standard and module DTC scan | queued | Depends on typed outcomes and inventory |
| 11 | Complaint-to-evidence diagnostic cases | queued | Depends on unified observations |
| 12 | Evidence-linked technical/customer reports | queued | Depends on diagnostic cases |
| 13 | Signed knowledge distribution and review loop | queued | Depends on stable knowledge schema |
| 14 | Five-workshop alpha | queued | Depends on slices 0–12 |

## Completed slice: verified clear outcomes

Deliverables:

- Replay fixtures for Mode 04 and UDS `0x14` success, refusal, pending,
  silence, malformed responses, and verification behavior.
- Positive acknowledgements must be parsed explicitly; an ELM prompt, echo,
  `NO DATA`, or unrelated response can never mean success.
- Decode UDS negative response codes and preserve the refusal reason.
- Maintain the session while a UDS clear is pending.
- Wait for ECU settling, then perform bounded verification reads.
- Preserve before-state and audit every clear that was actually attempted.
- Restore protocol, headers, filters, flow control, and session on every exit.

Acceptance criteria:

- Single-byte UDS `54` is accepted.
- `7F 14 78` followed by `54` is accepted.
- `7F 14 22`, `NO DATA`, silence, and malformed replies are not accepted.
- Mode 04 requires a real `44` positive response.
- Verification distinguishes refusal from acknowledgement followed by faults
  remaining.
- All behavior is reproducible without connected hardware.
- Full repository CI passes.

## Active slice: shared typed diagnostic outcomes

Deliverables:

- One serialized diagnostic status vocabulary shared by Rust and TypeScript.
- Structured service, negative-response-code, and evidence fields without
  embedding UI prose in scanner results.
- Mode 04, UDS clear, and discovery results use the shared envelope.
- The Lab consumes typed cancellation and safety-stop states while legacy
  discovery fields remain temporarily compatible.
- Replay and schema tests lock the wire contract before later scanner paths
  adopt it.

Acceptance criteria:

- The wire vocabulary distinguishes answered, unsupported, refused, timed out,
  transport failed, cancelled, skipped for safety, and malformed outcomes.
- A UDS refusal preserves its numeric NRC and decoded name.
- Discovery cancellation and engine-start protection are machine-readable and
  do not depend on parsing display strings.
- Existing clear and discovery behavior sends no new vehicle traffic.
- Full repository CI passes.

## Product gates

The implementation remains on course only if it eventually demonstrates:

- zero dashboard warnings caused by normal discovery;
- useful inventory in under two minutes;
- at least 80% reach of documented modules on reference vehicles;
- more than 95% of write operations ending in verified success or a decoded
  refusal;
- provenance on every trusted finding;
- repeatable ECU fingerprints that improve later scans;
- repeated weekly use by five independent workshops.
