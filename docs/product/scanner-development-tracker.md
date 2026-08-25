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
| 3 | Shared typed diagnostic outcomes | done | [PR #39](https://github.com/cxalem/scainner/pull/39) |
| 4 | Central scanner safety and cleanup guard | done | [PR #40](https://github.com/cxalem/scainner/pull/40), 78 Rust tests |
| 5 | Discovery strategy and coverage accounting | done | [PR #41](https://github.com/cxalem/scainner/pull/41), 80 Rust tests |
| 6 | Safe 11-bit and 29-bit module enumeration | active | Branch `feat/safe-module-enumeration` |
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

## Completed slice: shared typed diagnostic outcomes

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

## Completed slice: central scanner safety and cleanup guard

Deliverables:

- One ownership-based scope controls access to the ELM during bounded UDS
  operations.
- Track extended-session state on the driver only after a positive `50 03`
  response.
- Close a confirmed extended session before restoring adapter state.
- Restore automatic protocol selection, functional request headers, receive
  filtering, and flow-control mode on success and every early exit.
- Migrate module fault reads, DID reads, manual range scans, probe polling,
  clears, and discovery behind the guard.
- Replay tests prove cleanup after transport failure and confirmed session
  entry without connected hardware.

Acceptance criteria:

- A `?`, cancellation, safety stop, setup failure, or ordinary return cannot
  bypass cleanup.
- `10 01` is sent only when this connection received a positive `50 03`.
- An operation cannot leave protocol 6/7, a physical header/filter, or manual
  flow control active for standard OBD polling.
- Cleanup failure never overwrites the diagnostic operation's original result.
- Existing diagnostic requests and their ordering remain unchanged.
- Full repository CI passes.

## Completed slice: discovery strategy and coverage accounting

Deliverables:

- Preserve one typed outcome for every module-address candidate attempted.
- Keep profile candidates distinct from generic conventional-address sweep
  candidates even when a profile entry has no display name.
- Treat positive and negative UDS responses as proof that a module was reached.
- Distinguish ECU refusal, no response, transport failure, malformed response,
  cancellation, and safety stop.
- Derive summary counts from candidate evidence rather than incrementing
  optimistic counters.
- Apply the same accounting to a fast refresh without adding diagnostic
  requests.
- Show a concise, translated coverage summary in the Lab.

Acceptance criteria:

- `modules_found` never increments merely because adapter addressing setup
  succeeded.
- A negative `7F 22 <NRC>` response counts as reached and preserves its NRC.
- Unattempted candidates after cancellation or a safety stop are counted as
  skipped, not timed out.
- A fast refresh distinguishes modules that answered from saved addresses that
  merely existed in the database.
- The report exposes candidate-level evidence for future scan persistence and
  advanced inspection.
- No extra vehicle request is introduced by coverage accounting.
- Full repository CI passes.

## Active slice: safe 11-bit and 29-bit module enumeration

Deliverables:

- Represent documented, conventional 11-bit, and standard normal-fixed 29-bit
  candidates as distinct scan-plan sources.
- Enumerate physical `18DA<target>F1` requests with matching
  `18DAF1<target>` responses while excluding tester and broadcast targets.
- Preserve documented non-standard 29-bit pairs such as GM Ultium as exact
  profile candidates instead of forcing them into the standard formula.
- Use data-driven brand scan policies for transports that must not receive a
  generic UDS sweep.
- Fall back to both standard read-only strategies when VIN is unavailable or
  unknown.
- Keep Rust and the published `@scainner/uds-map` package behavior aligned.
- Surface the candidate source in discovery evidence.

Acceptance criteria:

- Every generated request/response pair uses one CAN width and is unique.
- The 29-bit plan contains all physical target bytes except `F1`, `FE`, and
  `FF`, with the response target byte matching the request.
- Profile candidates are always attempted before generic candidates.
- A known Tesla or Mitsubishi VIN produces no generic UDS sweep.
- A modern Volvo/Polestar profile uses its documented/standard 29-bit path and
  does not receive a conventional 11-bit sweep.
- An unknown VIN degrades to conventional 11-bit plus standard normal-fixed
  29-bit enumeration rather than silently omitting either class.
- Enumeration remains read-only and uses the existing presence DID.
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
