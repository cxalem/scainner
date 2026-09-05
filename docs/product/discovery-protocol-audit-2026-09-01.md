# Universal Discovery Protocol v1.3, implementation audit, 2026-09-01

## 1. Scope and method

Audited `docs/product/universal-discovery-protocol.md` v1.3, together with the
safety and provenance sections of
`docs/product/vehicle-knowledge-acquisition-protocol.md`, against `origin/main`
@ cb0b245.

The audit ran in four slices:

| Slice | Protocol sections | Appendix |
|---|---|---|
| A | §4 S0–S3, §5 brand classes, §7 safety envelope | A |
| B | §2 ladder, §3 knowledge model, §8 coverage report, §10 data model | B |
| C | §4 R/S4/S4x/S5/S6/S7, §6 correlation engine, §9 guided-step tree | C |
| D | §12 what exists vs what to build, §13 acceptance criteria | D |

Status vocabulary, used in every table below:

- **implemented**: the code does what the section says.
- **partial**: part of the behaviour exists, a named part does not.
- **missing**: the behaviour has no implementation.
- **contradicts**: the code does something the section forbids, or the inverse
  of what it requires.

Evidence style: every claim carries a `file:line`. Rust paths are relative to
`apps/desktop/src-tauri/src/`; TypeScript and data paths are relative to the
repository root. Doc line numbers refer to the v1.3 text of the protocol.

The four slice tables are reproduced in appendices A–D with their references
intact. This section-level summary and the backlog are the new material.

---

## 2. Verdict

**Real today.** Automatic S1 census → S2 identity → S3 join → coverage report
runs on connect with no button and inside its budgets (`supervisor.rs:350-395`,
`auto.rs:188`, budgets `auto.rs:41-63` enforced at `:229-234` and `:300-304`).
`ecu_families` matching, the vehicle join and inherited hypotheses are complete
(`family.rs`, `join.rs`, `uds-map.json` v9). The activation guard holds:
nothing becomes `enabled` without `vehicle_fit = matched` (`state.rs:208`,
tested `state.rs:365-376`). Guided-step trees generate from open hypotheses
(`ops.rs:868-905`). The correlation engine is a complete, replay-tested pure
module (`correlation/`, 46 tests). Research packs enter as `research_candidate`
and never as facts (`research.rs:190-249`, tested `research.rs:714`). All four
API routes in §12 exist, plus an undocumented `POST /vehicles/{id}/join`.

**Stale.** §12 was written in #51; #52, #54 and #61–#76 landed after it and were
never folded back, so most of its "to build" column is already done.

**Three risks dominate.** (1) `uds_discover` opens `10 03` on modules the pack
marks `discovery_session: default_then_extended` (`uds.rs:2116-2119`,
`:2337-2340`). (2) Knowledge-state promotion is ungated and projects into the
outbound `knowledge_candidates` table (`db.rs:2288-2336`, `:2334`). (3) The S4
sweep targets the module with the *most* known decodes instead of the ones with
none (`plan.rs:369-374`).

---

## 3. Findings, ranked

| Follow-up | Status | Evidence |
|---|---|---|
| S2 legacy dialect ladder | implemented | A module rejecting every `22` identity DID with NRC `11` receives one `21 00` support probe, followed only when supported by bounded `1A` identity reads; dialect and NRC evidence are persisted per route. |

### F1. The sweep opens an extended session (safety)

`discover_inner` (`uds.rs:2116-2119`) and `fast_refresh` (`uds.rs:2337-2340`)
call `enter_extended_session` whenever the pack sets `discovery_session:
default_then_extended` (`uds-map.json:119,138,157,175`, four modules of one
brand). §7 (L439-441) states that S0–S4/S4x/S5 stay in the default session and
that the automatic run never opens `10 03`. The connect-time run is compliant
and asserted by replay (`auto.rs:547-550`); `uds_discover` is not. It is user
triggered (`supervisor.rs:1006` from `api/mod.rs:630` or MCP) but it is not the
separate, parked, explicit, module-specific operation recorded as its own run
that §7 L442-446 requires, it has no parked, voltage or confirmation gate, and
the extended-session branch has no replay coverage. This is the single hard
safety-envelope violation in the tree, and it is reachable from an ordinary API
call. Slice A #38, #30; slice C. Doc §5, §7.

### F2. Knowledge-state promotion is ungated (knowledge integrity)

`patch_hypothesis` (`db.rs:2288-2336`) validates the vocabulary, calls
`check_activation`, and stops. There is no knowledge-state transition rule, so
any client can PATCH a hypothesis straight to `oem_confirmed` with zero samples,
and `sync_knowledge_candidate` (`db.rs:2334`) then projects that state into
`knowledge_candidates`, the outbound contribution table. §7 (L354-359) requires
discriminating evidence for `locally_confirmed`, a second vehicle for
`community_verified` and a documented source for `oem_confirmed`; none of the
three is modelled. Consequence: shared knowledge is one unauthenticated PATCH
away from poisoned, and the damage survives vehicle deletion (`db.rs:4266`).
Slice C, S7. Doc §4 S7, §3.

### F3. S4 target selection is inverted (sweep)

`plan.rs:369-374` picks `max_by_key(data_evidence)` filtered to `evidence > 0`,
which is the module with the *most* known decodes. §4 (L279) says the bounded
sweep is only for modules with **no** inherited decodes. `plan.rs` never reads
`hypotheses` at all, so S3 gaps cannot drive it. Consequence: the 240 s budget
is spent re-reading the best-understood module, and the modules that motivate
the stage are never swept. Slice C. Doc §4 S4.

### F4. Physical guards are absent from the sweep path (safety)

`execute_plan` / `sweep_identifiers` (`uds.rs:572-730`) performs no voltage
read, no engine-start check and no parked gate; those guards exist only in
`discover()` (`uds.rs:1852,1907,1997,2138`) and `scan_range`
(`uds.rs:1312,1350-1355`) (A#45). §7's "stop when voltage stays below 11.8 V for
30 s" (L451-453) is implemented nowhere: `supervisor.rs:544-555` is a UI alert
raised during polling with the engine running, with no 30 s window and no stage
stop (A#46). There is no per-module backoff after refusals or timeouts (A#47),
no 30–90 s per-module cap (A#48), and `discover_inner` reads at
`timings.sweep_read` = 300 ms (`uds.rs:2170`, `uds-map.json:50`) against §7's
600 ms (A#43). Separately, the automatic census and identity loops issue
`point_at_commands` (`uds.rs:1651`), which never emits a bare `ATCEA`, so an
address extension set for one candidate leaks into every later 11-bit route
until `ScannerOperation::drop` (`operation.rs:120`); `setup_route`
(`uds.rs:384`) does reset it (A#10). Doc §7, §4 S1, §4 S4.

### F5. The correlation engine is built and unreachable (correlation and learning)

`correlation/mod.rs:6` carries `#![allow(dead_code)]` with the note that the
integration call site belongs to Track A and is intentionally absent; `analyze`
(`correlation/mod.rs:24`) has zero callers outside its own tests, and
`discovery::learn` does not exist (`db.rs:155,2387` describe it as a follow-up).
The only live sampler, `uds::correlation_capture` (`uds.rs:826-888`), returns
`CorrelationReading { did, payloads, stable, outcome }` with no timestamps,
while `HypothesisInput` / `Sample` (`contract.rs:17`) require `ts_ms`.
`insert_hypothesis_sample` (`db.rs:2342-2356`) is `#[allow(dead_code)]` and
called only from tests, so `hypothesis_samples` has schema, retention, a reader
and tests but zero production inserts. §6.7's inherited verdict
(`sanity.rs:83-129` → `InheritedFit`, `contract.rs:133`) is never written back
to `hypotheses.vehicle_fit`. Consequence: the post-drive half of acceptance
criteria 1 and 2 is unreachable, and wiring requires a capture-path schema
change first. Slices C and D. Doc §6, §4 S5, §12.

### F6. Dead states and columns (knowledge integrity)

`hypotheses.route_state` exists (`db.rs:925`) and is read back
(`HYPOTHESIS_SELECT`, `db.rs:1917`), but no INSERT or UPDATE ever writes it:
`db.rs:2207-2210` sets only `knowledge_state`/`vehicle_fit`/`activation`, and
neither update site (`db.rs:2184`, `db.rs:2321`) touches it. `coverage.rs`
`classify()` tests `route_state == Some(RouteState::Closed)`, so the
`closed_route` bucket and the §8 "Unreachable" line are structurally always
empty. `closed` itself is never written anywhere (A#13): there is no
two-connection rule and no explanation field, and `coverage.rs:252`
`states_stored` omits it. On the DID side, `discovered_dids.confidence` is a
third vocabulary, `CHECK (confidence IN ('confirmed','ai_guess','unlabeled'))`
(`db.rs:771`), whose only writer (`db.rs:1725-1728`) picks `confirmed` when the
map supplied a label and `unlabeled` otherwise: `ai_guess` is dead, and
`confirmed` means "the shared map had a name for this DID", not "confirmed on
this vehicle", which is exactly the conflation §3 exists to remove, surfaced to
users through the evidence map (`db.rs:2476`). Slice B, discrepancies 1 and 2.
Doc §3, §8, §10.

### F7. Enum drift against §3 (knowledge integrity)

Three of the four state dimensions contradict their normative value lists.
`knowledge_state` has 9 Rust values (`state.rs:24-33`) against the doc's 6:
`reached_on_vehicle`, `verified_on_vehicle` and `inherited` are undocumented,
and `inherited` re-encodes an inheritance event as world knowledge, which is
what `vehicle_fit` is for. A tenth string, `'observed'`, is the schema default
of `knowledge_candidates.knowledge_state` (`db.rs:970`) and is injected by
`db.rs:1768` via `COALESCE(h.knowledge_state, 'observed')`; it fails
`KnowledgeState::parse`, so contributed rows can carry a state the protocol's
own parser rejects. `vehicle_fit`'s fourth value is `insufficient`, not
`not_applicable` (`state.rs:71-96`); these mean different things, and "this
decode does not apply to this car" is now unrepresentable. `route_state`
(`state.rs:104-133`) drops `candidate` and adds `transport_failed`, so an
unattempted route has no state and is inferred by set difference in
`coverage.rs:237-243`. `activation` matches exactly. Slice B, discrepancy 3.
Doc §3.

### F8. The coverage report has no scope (coverage and ladder)

`CoverageReport` (`coverage.rs:156-169`) has no `Scope` field at all, so the
adapter class, pins, protocol, session and profile version required by §8 (L470)
are not reported. `status` (`coverage.rs:167`) is a single
`"complete"`/`"partial"` string derived from `remaining.is_empty()`
(`coverage.rs:416-420`), instead of the scope status plus independent knowledge
status of L471 and L484-489. None of the six scope-status values and neither
knowledge-status value exists anywhere in the repository. This defeats the
section's central rule, "'complete' always modifies a scope, never the vehicle",
because a bare `"complete"` is precisely an unqualified claim about the vehicle.
Supporting gaps: `gateway_behaviour_for_vin` (`uds_map.rs:1107`) has zero
non-test callers, so gateway class is inert (A#33); `adapter_limited` appears
nowhere (A#35); `ProfiledLevel` (`uds_map.rs:418-429`) is consumed only at
`auto.rs:119` and a test helper and gates no path (A#36); `VehicleLine`
(`coverage.rs:13-22`) carries no brand confidence and no platform match. Slice
B, discrepancy 5; slice A #33–#36. Doc §8, §5.

### F9. Identity is unreadable on `21` and `1A` modules (sweep)

`request_for` (`uds.rs:443-459`) returns `None` for DIDs above 0xFF on the `21`
and `1A` read services, so an ISO `F1xx` identity block can never be read on
those modules. `ReadService::EcuIdentification` exists (`uds_map.rs:218`) and
`1A` appears in the pack only as two unbound `known_dids`
(`uds-map.json:11470,11490`); no module or platform selects it. Consequence:
KWP-era modules reach census but never fingerprint, so they never join a family
and never inherit a decode. Slice A #32. Doc §5.

### F10. `ScanPolicy::Auto` is the default and enumerates an unprofiled brand (safety)

`ScanPolicy::Auto` is `#[default]` (`uds_map.rs:468-472`), so a brand marked
`profiled_level: standard_only` that omits a `scan_policy` key falls through to
full conventional 11-bit enumeration of 0x700–0x7F6 (`uds_map.rs:826-844`). One
brand in the pack is in exactly this state; only two carry an explicit
`"none"`. §5 says generic UDS enumeration is not assumed for `standard_only`
brands. Slice A #34. Doc §5.

### F11. Two parallel sensor pipelines (sensor pipeline)

`uds_probes` (`db.rs:733-748`) carries only `enabled INTEGER` and `origin
('manual','discovery')`, a boolean stand-in for `activation`. The supervisor
polls it at `supervisor.rs:571` through `should_poll_probe`, which is
`origin == "manual"` only (`uds.rs:1439-1441`). `hypotheses` (`db.rs:918-941`)
carries all four dimensions including `activation`, and is never polled. Three
consequences follow. Probes created by discovery generate no traffic. Hypotheses
switched to `enabled` generate no traffic either, so the state that §3 defines
as "poll this" does nothing. Users re-key the same identifier by hand and get a
duplicate probe row alongside the discovery-origin one. Independently,
`add_probe` (`db.rs:2760`) accepts module keys that `resolve` (`uds.rs:233-238`)
can never match, and the probe then fails silently forever. Doc §3, §4 S5.

### F12. Guided steps do not discriminate (guided steps)

`ops.rs:960-963` assigns the same `success.expected` signature to every
hypothesis in a group, so §9's "confirm one, refute another" (L515-517) cannot
happen; only four signatures exist (`ops.rs:818-829`) and `steps_to:<value>` and
`unchanged` are absent. `capture.dids` adds every other open hypothesis on the
module and groups by shared test text (`ops.rs:913-925`), so a node's
`hypotheses` are not what its capture can discriminate (L520-521). Completed
nodes record no run ids: `GuidedStepNode` has no `run_id` field and there is no
`guided_steps` table, the tree being computed on the fly (`coverage.rs:119-126`,
`ops.rs:866-892`). Classification of captures lives in the frontend,
`GuidedCorrelation.tsx:30-41`, as raw payload equality, is not persisted, and
ignores `success.expected` (`GuidedCorrelation.tsx:165`). Ordering is
`sort_by_key(moves_car)` (`ops.rs:906`); `estimated_seconds` never enters it, so
"information gain per minute" is not what the tree sorts on. MCP
(`scripts/scainner_mcp.py`) exposes `capture` but no `guided_steps`, `coverage`,
`hypotheses` or `learning_state` tool, so §9's "same contract for Lab, API and
agent" is not met. Slice C, §9. Doc §9, §6.

### F13. Event-fit threshold is half the specified one (correlation and learning)

§6.4 (L402-403) requires at least 3 clean A→B→A transitions. `sanity.rs:299`
gates on `events.transitions >= 3`, which is about 1.5 cycles. `events.rs:68`
already computes `clean_aba = transitions / 2` but only writes it into a note
(`sanity.rs:300-303`). The gate should read `clean_aba >= 3`. Slice C. Doc §6.4.

### F14. Runs are not attributable to a stage or a node (coverage and ladder)

`verification_runs.plan_version` is `{brand}-{platform|unknown}-v{n}` and
`{brand}-{platform}-corr-v{n}` (`plan.rs:64-83`, `ops.rs:742-760`); the only
stage-shaped literal in the tree is `"auto-s1-s3"` (`supervisor.rs:407`). None
of §10's five documented values (`auto-s1`, `auto-s2`, `auto-s4-<module>`,
`learn-<date>`, `guided-<node>`) exists, so no run can be attributed to a stage,
and with no `run_id` on guided nodes (F12) none can be attributed to a node
either. Compounding this, L1 and L2 are never persisted: `vehicles`
(`db.rs:663-676`) has no `wmi`, `vds`, `model_year`, `platform_key` or
`brand_confidence`, and its only ALTER is `cloud_id` (`db.rs:844`).
`platform_for_vin` is recomputed on every plan (`plan.rs:272`) and every guided
tree (`ops.rs:891`), and the only trace a platform leaves on disk is inside the
`plan_version` string. §10's stated purpose, "L1/L2 stored, not recomputed", is
inverted, and there is no way to tell whether a stored run was made under a
platform match that a later map version resolves differently. Slice B,
discrepancy 4. Doc §10, §2.

### Not started at all

These are whole features, not gaps in an implementation:

- **S4x extended discovery** (§4 L298-313, §13.8). Zero hits for epoch,
  extended discovery or carry-over. No API, MCP tool or UI.
- **S5 cohort and occupancy** (§4 L314-344). No cohort selection, no module
  rotation, no retirement, no 20 % link-occupancy measurement, no self-suspend,
  no user-facing cost metric.
- **Research task filing** (§4 R, L256-262). No `research_tasks` table and no
  call site. The nearest thing is `auto.rs:116` `notify_unknown_brand`, a
  de-identified notification.
- **Review queue and contribution export** (§4 S7, L359). No approval state
  machine, no export artifact; `GET /knowledge/candidates` is read-only and
  publication was disabled in #58.
- **Sweep carry-over** (§4 S4, L289-290). `uds.rs:788-792` appends a summary
  string; the next connection re-sweeps from the band start.

---

## 4. Stage status table

Rewrite of §12. "Doc said" is the v1.3 "To build" column.

| Stage | Doc said | Actual | Evidence |
|---|---|---|---|
| S0 | store WMI/VDS/year; expose available references | partial / not started. `year` is stored; WMI and VDS are re-derived from the VIN on every read. Nothing enumerates the reference channels a vehicle can supply. | `db.rs:663-676`; `uds_map.rs:693`, `:1113-1130`; `coverage.rs:18,204`; no `available_references` symbol, `correlation/contract.rs:85` only |
| S1 | run automatically on new VIN; route tuple persisted; `closed` with recorded reason; global budget | 3 of 4 done. Automatic run, route tuple and budgets all landed. `closed` has a variant and a reader but no writer. | `supervisor.rs:350-395`, `auto.rs:188`, `:156`; `db.rs:906-917`, writer `auto.rs:256`, `db.rs:897`; `state.rs:127`, `coverage.rs:192`, no writer (`auto.rs:159-166`); `auto.rs:41-63`, `:229-234`, `:300-304` |
| S2 | per-brand identity blocks + parsers as data; repeat-for-identity; engine ECU fingerprint completed | blocks done, parsers partial, repeat-for-identity done, engine fingerprint not started. One `psa` parser is still Rust. | `uds_map.rs:184,457,1039`, test `:1823`; `family.rs` `supplier_code_from_f0fe`; `identity.rs` `record_identity`, `state.rs` `next_identity_fit`, `auto.rs:361-380`; `join.rs` fixture, engine `6A8/688` skipped |
| S3 | `ecu_families` + compatibility tuple; four-dimension states; inherited hypotheses; coverage report | all four done in #52. `payload_variant` is unpopulated, so the tuple is effectively 5 of 6. | `uds-map.json` v9 (3 families), `family.rs` `CompatibilityKey`/`match_family` (`:13-27`, `:62-95`); `db.rs:918-941`, `state.rs:13-217`, test `state.rs:379`; `join.rs` `join_vehicle`; `coverage.rs:152-169` |
| R | research task filing; corpus index; result import as candidates | import done (#62, #71, #73–#76), corpus partial, filing not started. Most stale row in the table. | `research.rs` `ResearchPack`/`CandidateDidHypothesis`/`routes_for_exploration`; `research-packs.json`, `data/research/*.json`, `compile-research-pack.ts`, `docs/uds/brand-research-pack-specification.md`; no `research_task`/`research_queue` symbol |
| S4 | driven by S3 gaps + sibling bands; global + per-module budgets; carry-over | all three partial or missing. `plan.rs` never reads `hypotheses`; target selection is inverted (F3); global budget only; carry-over is a string. | `plan.rs:1-9`, candidates `:315`, target `:369-374`; `plan.rs:57-61`, `uds.rs:576,680,728-790`; `uds.rs:788-790` |
| S4x | (v1.3, no §12 row) | not started. | no `extended_scope`/`epoch`/`carry_over` symbol |
| S5 | learning state; adaptive cohort; bounded samples with per-sample timestamps; correlation engine as a pure module with replay tests | learning state done; correlation engine done but unreachable at runtime; cohort not started; sample writer missing. | `state.rs:14`, `ops.rs:542,554`, `db.rs:2118`, `coverage.rs:129,400`; `correlation/*`, `analyze` at `mod.rs:24`, 46 tests, fixtures `tests/fixtures/psa/c41/correlation/`; `supervisor.rs:571` polls a fixed probe set; `db.rs:942-951` + retention `:2361-2385`, no production writer |
| S6 | state-tree generation from hypotheses; full-screen guided flow | generation done; presentation partial (a Lab tab, not full screen). | `ops.rs` `GuidedSteps`/`guided_steps()`, `coverage.rs:119-143`; `views/lab/GuidedCorrelation.tsx` via `views/lab/plan.ts:64`, mounted `views/Lab.tsx:71` |
| S7 | state machine; contribution export; review queue | state machine partial (vocabulary and a no-downgrade guard, no transition thresholds, F2); export partial (read endpoint only); review queue not started. | `state.rs` `KnowledgeState`, `check_activation`; `db.rs:1846-1858`, `:2288-2336`; `db.rs:953-979`, `api/mod.rs:333,721` |
| API/MCP | `GET /coverage`, `GET /hypotheses`, `GET /guided-steps`, `POST /learning-state` | all four done. Learning state is GET/PUT, not POST. `POST /vehicles/{id}/join` exists and is not in the doc. MCP lacks the four discovery tools (F12). | `api/mod.rs:328` (+ tests `:1403,1578,1598,1746`), `:331`, `:334`, `:330` (Tauri `lib.rs:187,408`), `:336`, `openapi.rs:106-107`; `:332`; `scripts/scainner_mcp.py` |

---

## 5. Acceptance criteria

### Status against §13

| Criterion | Actual | Evidence | Note |
|---|---|---|---|
| 1. Fresh install, 3 min, no button → provisional identities, inherited untested fits, evidence-linked report; after one learning drive the dynamic signals are `matched` (L602) | partial | `auto.rs:499` `the_verified_brand_reaches_join_and_coverage_with_real_route_states` | Pre-drive half largely done. Post-drive half impossible: no sample writer, no `discovery::learn`, `analyze` uncalled (F5). |
| 2. Second seed vehicle: 3 min → routes and identities; 1 drive → ≥ 1 candidate array; otherwise a research task (L609) | partial | auto path is brand-generic | Blocked by the same missing learn step; research-task filing unimplemented; §11 never exercised. |
| 3. No automatic stage leaves the default session or sends a service outside §7, verified by the replay harness (L613) | partial | `transport/replay.rs:85` records `observed`; `operation.rs:80-109` extended-session cleanup | Per-fixture order pinning gives this incidentally. No assertion over `observed` against the §7 allowlist; `observed()` has no reader outside the transport. |
| 4. Ceiling never exceeded; a 2-minute connection yields a partial report that resumes (L615) | partial | budgets `auto.rs:41-63,229-234,300-304`; `CensusSummary.deferred:74`; `AutoSummary.stopped:97`; `coverage.rs:416` | The only budget assertions (`auto.rs:551,555`) assert the unbudgeted path. Nothing tests truncate-and-resume. |
| 5. Unknown WMI ends S1 within budget and files a research task (L618) | partial | `auto.rs:693`, `:719` | Budget and de-identified notification tested; research task half missing. |
| 6. Every state traceable to a run id and samples; every `closed` names adapter, pins, protocol and evidence (L619) | partial | `coverage.rs:148-152` `EvidenceLine`; `route_outcomes.route_json`/`detail` | Run-id traceability real. Sample traceability vacuous (F5). `closed` never written (F6). |
| 7. Never "complete" without a scope; `protocol_not_profiled` / `adapter_limited` (L621) | partial | `coverage.rs:167-168,416`; `uds_map.rs:422-429` `ProfiledLevel` | No `scope` field; neither literal appears in Rust; `ProfiledLevel` not surfaced (F8). |
| 8. Extended discovery for 30 minutes: carry-over ranges only, epochs with guard checks, ends `extended_scope_complete` (L624) | not started | no `extended_scope`/`epoch`/`carry_over` symbol | Introduced by v1.3 in #51; nothing built. |

### The six criteria automatable today

These need no production code. They are the cheapest way to stop the audit's
findings regressing, and they are DA-4 and DA-27 in the backlog.

| # | Criterion | Test to write |
|---|---|---|
| 1 | §13.3 service allowlist | Assert over `Replay::observed` on the existing `auto.rs:429` fixture that every request is in the §7 allowlist, with `10 03` explicitly denied. Highest value per line in this list. |
| 2 | §13.4 truncate and resume | Run `auto.rs:491` `config()` with `census_and_identity_secs: 120`; assert `deferred > 0`, `stopped.is_some()` and `status == "partial"`; run a second pass and assert it attempts the deferred candidates. |
| 3 | §13.6 evidence traceability | Property test over `join::fixtures::seed_c4`: every state in the coverage report resolves to a run id present in `verification_runs`. |
| 4 | §13.7 scope invariant | Weak invariant test: `status == "complete"` implies `remaining.is_empty() && fingerprinted == total`. Tightens to the real §13.7 once DA-18 lands. |
| 5 | §13.1 pre-drive half | Assemble the existing assertions into one named acceptance test covering identities at `provisional`, inherited untested fits and an evidence-linked report. |
| 6 | §13.5 unknown WMI | Assert the unknown-WMI run terminates inside budget; extend with the research-task assertion once DA-23 lands. |

Not automatable without production code: the post-drive halves of §13.1 and
§13.2 (they need the sample writer and `discovery::learn`), the research task in
§13.2, and all of §13.8.

---

## 6. Backlog

Sizes: S is under a day, M is a few days, L is a week or more. "Depends on"
lists backlog ids only.

### Safety

| Id | What | Evidence | Size | Depends on |
|---|---|---|---|---|
| DA-1 | Gate `default_then_extended`: no `10 03` inside `discover_inner`/`fast_refresh`; move extended-session identity to an explicit parked, confirmed, module-specific operation recorded as its own run; add a replay test on that branch. | F1, `uds.rs:2116-2119`, `:2337-2340` | S/M | none |
| DA-2 | Physical guards on `execute_plan`/`sweep_identifiers`: engine-start check, sustained low voltage (11.8 V for 30 s, configurable), per-module 30–90 s cap; raise `discover_inner` from 300 ms to 600 ms. | F4, `uds.rs:572-730`, `:2170` | M | none |
| DA-3 | Emit an `ATCEA` reset per route in census `point_at_commands`. | F4, `uds.rs:1651` vs `:384` | S | none |
| DA-4 | Replay allowlist test over `Replay::observed` for every stage fixture (acceptance 13.3). | §13.3, `transport/replay.rs:85`, `auto.rs:429` | S | none |
| DA-5 | Make `scan_policy` required, or default to `none` when `profiled_level = standard_only`. | F10, `uds_map.rs:468-472` | S | none |

### Knowledge integrity

| Id | What | Evidence | Size | Depends on |
|---|---|---|---|---|
| DA-6 | Knowledge-state transition rules in `check_knowledge`; `patch_hypothesis` enforces evidence; block projection into `knowledge_candidates` for unevidenced states. | F2, `db.rs:2288-2336`, `:2334` | M | none |
| DA-7 | Reconcile the enums (decision). Recommendation: keep `transport_failed` and `insufficient`, add `not_applicable` and `candidate`, drop `inherited`/`reached_on_vehicle`/`verified_on_vehicle` from `knowledge_state`, replace the `'observed'` default with `unknown`; then bump the protocol to v1.4 to match. | F7, `state.rs:24-133`, `db.rs:970`, `:1768` | S | none |
| DA-8 | `discovered_dids.confidence`: drop `ai_guess`, rename the semantics of `confirmed` to map-labelled, or derive the column from the four dimensions. | F6, `db.rs:771`, `:1725-1728` | S | DA-7 |
| DA-9 | Write or drop `hypotheses.route_state`; implement `closed` with the two-silent-connections rule and structured adapter, pins, protocol and evidence fields. | F6, `db.rs:925`, `coverage.rs:192`, `db.rs:906-917` | M | DA-7 |

### Sweep

| Id | What | Evidence | Size | Depends on |
|---|---|---|---|---|
| DA-10 | **Done 2026-09-02:** rank S4 targets by answered DIDs without decodes, then fewer prior sweeps, then known decodes. | F3, `plan.rs` | S | none |
| DA-11 | Exclude `F4xx` for real, as an exclusion band or a hard filter. | A#49, `plan.rs:197-206`, `uds-map.json:2686-2691,4059-4064` | S | none |
| DA-12 | Persist sweep carry-over; add a global ceiling that spans the whole run. | F4, `uds.rs:788-792`, `auto.rs:44,57` | M | none |
| DA-13 | Identity on `21`/`1A` modules: `request_for` handles DIDs above 0xFF or data-declared local ids. | F9, `uds.rs:443-459` | M | none |

### Correlation and learning

| Id | What | Evidence | Size | Depends on |
|---|---|---|---|---|
| DA-14 | **Done 2026-09-02:** recorded rides write timestamped `hypothesis_samples` with timestamped references, run `discovery::learn` analysis at ride end, and persist shape, correlations, confidence and inherited `vehicle_fit`. | F5, `supervisor.rs`, `discovery/learn.rs`, `correlation/mod.rs` | L | DA-6 |
| DA-15 | Event-fit gate becomes `clean_aba >= 3`. | F13, `sanity.rs:299`, `events.rs:68` | S | none |
| DA-16 | **Partially done 2026-09-02:** bounded cohort, module rotation, sample/constant/refusal retirement, and 60 s occupancy self-suspend are wired; adaptive information-value scoring remains. | §4 S5 L314-344 | L | DA-14, DA-17 |

### Sensor pipeline

| Id | What | Evidence | Size | Depends on |
|---|---|---|---|---|
| DA-17 | One sensor pipeline: decide whether the supervisor polls `uds_probes` or enabled `hypotheses`; migrate; dedupe duplicate probe rows; validate the module key on `add_probe`. | F11, `supervisor.rs:571`, `uds.rs:1439-1441`, `db.rs:2760`, `uds.rs:233-238` | M | none |
| DA-25 | Periodic standard DTC scan during a session: mode 03 on a coarse interval and on disconnect, through `insert_dtc_scan`; per-module `19 02` stays on request. | A#1, `supervisor.rs:844`, `:957` | S | none |
| DA-26 | `/live` snapshot merges per key with timestamps instead of replacing, so UDS values are not visible for one tick in `probe_interval`. | `supervisor.rs:483`, `api/mod.rs:92-94` | S | none |

### Coverage and ladder

| Id | What | Evidence | Size | Depends on |
|---|---|---|---|---|
| DA-18 | Coverage report `scope` field; split scope status from knowledge status; `protocol_not_profiled` from `ProfiledLevel`; `adapter_limited` with its source; wire `gateway_behaviour_for_vin`. | F8, `coverage.rs:156-169`, `:416-420`, `uds_map.rs:1107`, `:418-429` | M | none |
| DA-19 | Persist L1 and L2 on `vehicles`: `wmi`, `vds`, `model_year`, `platform_key`, `brand_confidence`. | F14, `db.rs:663-676`, `plan.rs:272` | S | none |
| DA-20 | `plan_version` encodes stage and node; guided nodes record their run ids. | F14, F12, `plan.rs:64-83`, `ops.rs:742-760` | S | DA-19 |

### Guided steps

| Id | What | Evidence | Size | Depends on |
|---|---|---|---|---|
| DA-21 | Per-hypothesis `success.expected`; add `steps_to` and `unchanged`; make a node's `hypotheses` exactly what its capture discriminates; move changed/stable/noisy classification into Rust and persist it. | F12, `ops.rs:818-829`, `:913-925`, `:960-963`, `GuidedCorrelation.tsx:30-41` | M | DA-20 |
| DA-22 | MCP tools: `coverage`, `hypotheses`, `guided_steps`, `learning_state`. | F12, `scripts/scainner_mcp.py` | S | none |

### Research

| Id | What | Evidence | Size | Depends on |
|---|---|---|---|---|
| DA-23 | Research task filing: a table plus the call sites (no family match, conflicted identity, unknown WMI). | §4 R L256-262, `auto.rs:116`, `join.rs:143`, `state.rs:247-248` | M | none |
| DA-24 | Promotion path to shared knowledge. Two targets: `ecu_families[].decodes[]` (cross-brand) and `data/packs/*.json` overlays (brand-scoped). Preferred shape given the online direction: server-side aggregation across vehicles, which gives the two-vehicles rule for free; `uds_probes.cloud_id` already exists. | §4 S7 L356-359, `db.rs:953-979` | L | DA-6 |

### Docs and tests

| Id | What | Evidence | Size | Depends on |
|---|---|---|---|---|
| DA-27 | Write the remaining acceptance tests from §5 of this document: 13.1 pre-drive, 13.4 truncate-and-resume, 13.5, 13.6, 13.7. | §5 above | S | DA-4 |
| DA-28 | Docs: §12 refreshed in this PR; decide DA-7, then bump the normative §3 to v1.4; retire the stale notes in the 2026-08-28 nightly report. | F7, `docs/product/discovery-nightly-report-2026-08-28.md` | S | DA-7 |

---

## Appendix A. Slice A: §4 S0–S3, §5 brand classes, §7 safety envelope

Reproduced verbatim from the audit slice. `origin/main` @ cb0b245.

| # | Claim (doc line) | Code location | Status | Note |
|---|---|---|---|---|
| 1 | "S0 — Standard … ELM handshake, protocol autodetect, VIN (mode 09 02), supported-PID bitmap, DTC scan, readiness" (L199–203) | `elm/supervisor.rs:218-235` (init, `0100`, `capture_link_state`), `:262` (`0902` ×3), `:325` (`obd::supported_pids`) | partial | Handshake/VIN/PID bitmap run on connect; DTC scan and readiness are request-only (`supervisor.rs:844`, `:957`), never automatic. |
| 2 | S0 output includes "calibration IDs (mode 09 04/0A) for L2" (L202) | `api/openapi.rs:68` → `ecu_info` on request only | missing | No automatic 09 04/0A read; nothing feeds an L2 profile. |
| 3 | "S0 … ≤ 30 s" (L199, L454) | — | missing | No S0 timer or budget anywhere; VIN retry alone allows 3×15 s + sleeps. |
| 4 | "automatic discovery budget ≤ 10 min … covering S0–S4" (L185) | `discovery/auto.rs:44,57` (`global_secs: 600`), checked at `auto.rs:303` | partial | Only checked inside the S2 identity loop; S0 is outside the run and S4 (`uds::discover`) has no ceiling at all. |
| 5 | "S1+S2 ≤ 3 min" (L205, L454) | `auto.rs:56` (180 s), `auto.rs:233` (census break at `s1s2*2/3`), `auto.rs:303` | implemented | Census capped at 120 s to reserve a third for identity; exits recorded in `summary.stopped`. |
| 6 | "S1.1 Functional broadcast (`0100` with headers) → responders on the default path" (L208) | `supervisor.rs:235` sends a bare `0100` wake-up; census is `auto.rs:220` `addresses_to_probe` + `probe_addr` | missing | No functional-broadcast responder enumeration; responders of the connect-time `0100` are never collected. |
| 7 | "probed with the presence DID in the default session" (L209-210) | `elm/uds.rs:1688` `probe_addr` → `22F186`; `uds_map.rs:925` `presence_probe_did` | implemented | Positive `62` and negative `7F 22` both count as presence; no session change. |
| 8 | "29-bit normal-fixed enumeration only where the brand policy allows" (L211) | `uds_map.rs:826` `scan_strategies`, `:883-903` | implemented | Data-driven `scan_policy`; `F1/FE/FF` targets skipped. |
| 9 | "Address-extension / LIN-child routes are separate targets" (L212) | `uds_map.rs:1031` `route_for_module`; pack `address_extension` at `uds-map.json:5386,5411,5436,5461,5486,5528` | implemented | Emitted as `ATCEA xx` (`uds.rs:363`). |
| 10 | "`ATCEA` reset before every route" (L212-213) | `uds.rs:1651` `point_at_commands` (no reset) vs `uds.rs:384` `setup_route` (has `ATCEA`) | **contradicts** | Automatic census/identity uses `point_at`, which never emits a bare `ATCEA`; an extension set on one candidate leaks into every later 11-bit route until `ScannerOperation::drop` (`operation.rs:120`). |
| 11 | "Unknown WMI: the conservative generic census from `uds-map.standard`" (L214) | `uds_map.rs:827-830`, `auto.rs:116` `notify_unknown_brand` | implemented | Unknown VIN degrades to 11-bit range + 29-bit normal-fixed; de-identified notice emitted (`supervisor.rs:351`). |
| 12 | "Silence is `silent`, not 'not fitted'" (L216) | `auto.rs:166-173` `route_state_of`, `db.record_route_outcome` | implemented | reached/refused/transport_failed/silent stored per route per connection. |
| 13 | "a route becomes `closed` only after silence in two independent connections and a recorded explanation" (L217-219) | `state.rs:110,127` (`RouteState::Closed` exists), `coverage.rs:192` reads it | missing | Nothing writes `closed`; no two-connection rule, no explanation field. `coverage.rs:252` `states_stored` omits `closed`. |
| 14 | "S2 … default session only: the ISO block (`F186 F187 F18C F190 F191 F195 F197`)" (L221-222) | `uds-map.json:53-88`; `pack_ext.rs:91` `identity_dids`; `auto.rs:291-340` | partial | Block is `F187 F191 F195 F197 F18C F18A F190` — `F186` is the presence probe, `F18A` added. Default session confirmed. |
| 15 | "if refused, the brand identity block from the profile (…)" (L222-225) | `uds_map.rs:1039` `identity_block_for_vin` | partial / contradicts | No refusal-triggered fallback — one merged block is always read. The doc's per-brand DID examples do not match pack data for three of four brands named. |
| 16 | "decoded by the brand's parser into the fingerprint tuple" (L225) | `identity.rs:161` `fingerprint_with_block`, layouts `iso_ascii`/`bcd_part_refs`/`ascii_part_refs`/`raw` (`:104`) | implemented | Layouts name encodings, not brands. |
| 17 | "Serial and VIN never enter the match key" (L225-226) | `identity.rs:232-235`, `:239-253` | implemented | Also excluded from the persisted hash (`identity.rs:270`). |
| 18 | "provisional = identity read twice within one connection, separated by other traffic, byte-identical" (L232-233) | `auto.rs:296-347`, `state.rs:237` `next_identity_fit`, `db.rs:2077` | partial | Separated by other traffic only when ≥2 modules reached. Comparison is a FNV hash of the *decoded* match key (`identity.rs:270,283`), not raw bytes. |
| 19 | "stable = repeated byte-identical on an independent connection" (L235) | `state.rs:250` | implemented | Connection id persisted on the module row (`db.rs:2110`). |
| 20 | "conflicted → join invalidated, hypotheses frozen, conflict filed for research" (L236-237) | `state.rs:247-248`, `join.rs:126-131` | partial | Join refused and state sticky; no hypotheses frozen, no research task filed. |
| 21 | "identity requires an explicit parked session" report path (L240) | — | missing | No such string or report path in `src-tauri/src`. |
| 22 | "the automatic run never opens `10 03`" (L241, L440-441) | `auto.rs` (no `enter_extended_session`), replay assertion `auto.rs:547-550` | implemented | Verified by replay fixture. |
| 23 | "S3: for each fingerprinted module with `identity_fit ≥ provisional`" (L244) | `join.rs:77`, `:124-131` | implemented | NULL fit with answered fields treated as provisional. |
| 24 | strong match → inherited decodes, `untested`/`disabled` (L247-248) | `family.rs:114-125`, `join.rs:148-152`, `db.rs:2210` | implemented | Strong requires hardware_ref and a listed software_ref. |
| 25 | weak match → disabled hypotheses (L249) | `family.rs:126-131`, `join.rs:150-153` | implemented | Weak downgrades knowledge to `research_candidate`. |
| 26 | no match → nothing inherited; module queued for R and S4 (L251) | `family.rs:143`; `join.rs:134-176` | partial | Nothing inherited (correct); no research queue or S4 queue exists. |
| 27 | Name-only family match tier | `family.rs:133-142` | implemented | Supplier alone never identifies a family. |
| 28 | "Then produce the coverage report (§8)" (L253) | `auto.rs:396-400`, `coverage.rs` | partial | Produced; status vocabulary only `complete`/`partial` (`coverage.rs:414`). |
| 29 | §5 "Sweepable UDS, 11-bit … offset rule derives response ids" | `uds_map.rs:767-776` `response_addr` | implemented | Per-block deltas honoured. |
| 30 | §5 "Identity behind extended session … reported as 'requires an explicit parked session'" | — | missing | `discovery_session: default_then_extended` (pack `uds-map.json:119,138,157,175`) instead *opens* `10 03` in `uds.rs:2116-2119`. |
| 31 | §5 "Mixed services" per-module read service | `uds_map.rs:1066` `read_service_for_module`; pack overrides | implemented | Precedence DID > module > platform > brand > standard (`uds_map.rs:1049`). |
| 32 | §5 "KWP-era: identity via `1A`" | `uds_map.rs:218` `ReadService::EcuIdentification`; pack `1A` only at `uds-map.json:11470,11490` (two unbound known_dids) | **contradicts** | No module or platform uses `1A`. `uds.rs:443-459` `request_for` returns `None` for DIDs > 0xFF on `21`/`1A`, so an ISO `F1xx` identity block can never be read on those modules. |
| 33 | §5 "Gateway-locked: report 'secure gateway…'" | `uds_map.rs:407` `GatewayBehaviour`, `:1107` `gateway_behaviour_for_vin` | missing | `gateway_behaviour_for_vin` has zero non-test callers; gateway data is inert. |
| 34 | §5 "standard_only brands … generic UDS enumeration is not assumed" | `uds_map.rs:468-472` (`ScanPolicy::Auto` is `#[default]`), `:826-844` | **contradicts** | A `profiled_level: standard_only` brand with no `scan_policy` key defaults to `Auto` → full conventional 11-bit enumeration 0x700–0x7F6 (one brand in the pack is in this state). Only two brands carry explicit `"none"`. |
| 35 | §5 "Adapter-path limited: S0 only; report `adapter_limited`; no enumeration" | `uds_map.rs:832`; `auto.rs:124,143` `brand_policy_no_enumeration` | partial | No enumeration correct; `adapter_limited` string appears nowhere; no source surfaced. |
| 36 | §5 "every class assignment is a sourced claim … `profiled_level`" | `uds_map.rs:418-429`, pack `profiled_level` on all 21 brands | partial | `ProfiledLevel` consumed only at `auto.rs:119` and a test helper; never gates a path. |
| 37 | §5 "path per class from data, never code branches" | `uds_map.rs:826`, `:1066`, `:733` | implemented | No brand-name conditionals in the scanner. |
| 38 | §7 "S0–S4/S4x/S5: default session only … No `10 03`, ever" (L439-441) | `uds.rs:2116-2119` and `uds.rs:2337-2340` (`discover_inner`/`fast_refresh` open `10 03`) | **contradicts** | The sweep opens an extended session whenever the pack says `default_then_extended` (four modules of one brand). User-triggered (`supervisor.rs:1006` ← `Request::Discover`), not on connect, but not the separate parked module-specific operation §7 requires. |
| 39 | §7 "Extended-session identity … separate, parked, explicit, module-specific, own run" (L442-446) | `uds.rs:1310-1321` `scan_range` (Lab), `uds.rs:2116` `discover_inner` | partial | `scan_range` is explicit with engine-start guard; `discover_inner` is not module-specific or separately recorded. Cleanup `10 01` + `ATCEA` + headers + filters present and tested (`operation.rs:106-135`, `uds.rs:394`). |
| 40 | §7 "`14` only on explicit, confirmed user action" (L447) | `uds.rs:989` `clear_dtcs`; `Request::UdsClear` (`supervisor.rs:1164`) / `Request::ClearDtcs` (`:860`); confirm gate `api/mod.rs:650,500` | implemented | Both clear routes require `{"confirmed": true}`; test `api/mod.rs:1236`. |
| 41 | §7 "Never `2E 2F 31 11 27`" (L447) | exhaustive grep | implemented | Zero occurrences as SIDs. |
| 42 | §7 "Adapter state restored after every route" (L448) | `operation.rs:118-135` `Drop for ScannerOperation` | partial | Restored after every *operation*, not every route. |
| 43 | §7 "Per-DID timeouts 600 ms (sweep) / 800 ms (learning poll)" (L449) | `uds.rs:749` (600), `uds.rs:1341` (600), `uds.rs:2170` (`timings.sweep_read` = **300 ms**, `uds-map.json:50`), `auto.rs:202-204` (250/500) | partial | `discover_inner` uses 300 ms; no learning-poll site. |
| 44 | §7 "abort on >10 transport errors" (L449-450) | `uds.rs:766-770`, `uds.rs:2232-2236` | partial | Not in S1 census / S2 identity loops (`auto.rs:285` only counts). |
| 45 | §7 "stop on engine start during parked stages" (L450) | `uds.rs:1764` `engine_likely_started`, guards `:1347`, `:1907`, `:1997`, `:2126` | partial | Absent from `execute_plan`/`sweep_identifiers` (`uds.rs:572-730`) and from `auto.rs`. |
| 46 | §7 "stop when voltage stays below 11.8 V for 30 s" (L451-453) | `supervisor.rs:544-555` | **contradicts** | Only 11.8 V logic is a UI alert during polling, engine running only; never stops a stage; no 30 s window. |
| 47 | §7 "back off on modules that refuse or time out" (L453) | — | missing | No per-module backoff. |
| 48 | §7 "S4 4 min global, 30–90 s per module" (L454-455) | `plan.rs:61` `SWEEP_BUDGET_SECS = 240`, `uds.rs:576,680,744` | partial | No per-module cap; `discover_inner` has no sweep budget. |
| 49 | §4 S4 "never `F4xx`" (L285) | `plan.rs:174-193`, `pack_ext.rs:128-163` | partial | `F4xx` is a low-confidence `did_bands` entry in 8 brands; no `hypothesis_exclude_bands` key in the pack. |
| 50 | §7 "verified by replay tests on every stage's transcript" (L437) | `auto.rs:498-595`, `:597-680`, `uds.rs:2556-2557`, `:3231` | partial | S1–S3 and the parked plan have replay coverage; `discover_inner`'s extended-session branch has none. |

### Forbidden-service sweep (all of `apps/desktop/src-tauri/src`)

| Service | Occurrences | Reachable from the automatic run? |
|---|---|---|
| `2E` | none | n/a |
| `2F` | none | n/a |
| `31` | none as SID | n/a |
| `11` | none as SID | n/a |
| `27` | none as SID (`research.rs:407` asserts it is in a pack's `forbidden_services`) | n/a |
| `10 03` | `operation.rs:12`; callers `uds.rs:1089` `clear_module`, `:1321` `scan_range`, `:2119` `discover_inner`, `:2340` `fast_refresh` | No for connect-time run (asserted `auto.rs:547`). **Yes for `uds_discover`** (`supervisor.rs:1006` ← `api/mod.rs:630` / MCP), gated only on pack `discovery_session`, no parked/voltage/confirm gate. |
| `10 01` | `operation.rs:108`, `uds.rs:396` | Cleanup only after we opened `10 03`. Correct. |
| `3E` | `uds.rs:936` (`3E80`); `:1102,1139,1358,2168,2407` | All guarded by `extended_session_open`. Permitted. |
| `14` | `uds.rs:990`; `:1090,1186,1188` | Only via confirm-gated clear requests with a `before` snapshot. Compliant. |
| `19 02` | `uds.rs:944` | `read_dtcs` in clear before/after and `module_dtcs`. Permitted. |

### Most important discrepancies
1. `uds_discover` opens `10 03` during a data-band sweep (`uds.rs:2116-2119`, `:2337-2340`). Single hard safety-envelope violation; user-triggered but not the operation §7 describes; no parked/voltage guard; no replay test on that branch.
2. `route_state = closed` is never written. The two-silent-connections + explanation rule is absent.
3. Identity unreadable on `21`/`1A` modules (`uds.rs:443-459`). Those modules reach census but never fingerprint, join, or inherit.
4. §7 guards are not on the discovery paths: no low-voltage stop anywhere in discovery; no engine-start guard in `execute_plan`; no transport-error abort or per-module cap in census/plan sweep; no backoff; `discover_inner` 300 ms vs 600 ms.
5. Brand-class routing is data-shaped but half-inert: `gateway_behaviour_for_vin` uncalled; `profiled_level` gates nothing; `ScanPolicy::Auto` default enumerates a `standard_only` brand.

## Appendix B. Slice B: §2 ladder, §3 knowledge model, §8 coverage report, §10 data model

Reproduced verbatim from the audit slice. `origin/main` @ cb0b245.

### Claim-by-claim table

#### §2 — The classification ladder

| claim (doc line) | where | status | note |
|---|---|---|---|
| L0 Standard, key = "any vehicle reached through a supported OBD-II transport"; "mode 01/09 supported-PID bitmap" (L92) | `apps/desktop/src-tauri/src/elm/obd.rs:270` (`supported_pids`), `elm/supervisor.rs:324` | implemented | bitmap drives the poll loop; no "L0" identifier stored anywhere, it is implicit |
| L1 Brand group, key = WMI (VIN 1–3), source `uds-map.brands[].wmi` (L93) | `elm/uds_map.rs` `brand_for_vin`; `discovery/coverage.rs:18-21` (`wmi`, `brand_id`) | partial | computed on every read from VIN, never persisted; `vehicles` has no `wmi` column |
| L1 unlocks `did_bands`, read service, resp offsets, identity block, gateway class (L93) | `uds-map.json` brand keys `did_bands`, `read_service`, `resp_offsets`, `identity_block`, `gateway_behaviour`, `scan_policy` | implemented | all present; `scan_policy` at `elm/uds_map.rs:452` |
| L2 Platform/generation, key = VDS pattern + model year, source `platforms[]` (L94) | `elm/uds_map.rs:372-393` (`Platform`), `packages/uds-map/src/types.ts:225-236`, `uds-map.json` (18/21 brands have `platforms`) | partial | matcher exists (`platform_for_vin`), but see next row |
| L2 "the most specific level with evidence wins" → platform is a level of the vehicle | `elm/discovery/plan.rs:272`, `api/ops.rs:891` | **missing** | **no platform is ever persisted per vehicle**; recomputed from VIN on each call, only leaks into `plan_version` string `{brand}-{platform}-v{n}` |
| L2 unlocks "routes[] (extension / gateway)" (L94, L128) | `Platform` struct `elm/uds_map.rs:376-393` | missing | `Platform` has `key`, `vds_pattern`, `years`, `ecu_families_expected`, `read_service`, `notes`, `source` — no `routes[]` |
| L2 key includes "mode 09 calibration IDs, engine ECU identity" (L94) | nowhere | missing | `platform_for_vin` is VDS-regex-only; `research::platform_for_vehicle_facts` (plan.rs:274) is model-string, not calibration ID |
| L3 ECU family, source `ecu_families` cross-brand (L95) | `elm/uds_map.rs:91-113` (`EcuFamily`), `uds-map.json` `ecu_families` (3 entries) | implemented | v9 map; also `packages/uds-map/src/types.ts:289` |
| L3 tuple `(supplier, family, hardware_ref, software_ref, payload_variant, diagnostic_service)` (L99) | `elm/discovery/family.rs:13-27` `CompatibilityKey` | partial | all six fields exist, but `payload_variant` is documented in-code as "not populated by any parser yet" (`family.rs:22-24`) — effectively a 5-tuple |
| strong match → inherit as `vehicle_fit = untested` (L103) | `family.rs:62-95` `FamilyMatch::{Strong,Weak,NameOnly,None}`; `db.rs:2210` inserts `'untested','disabled'` | implemented | matches the doc |
| weak match → "disabled hypotheses only" (L107) | `join.rs:530-547` | implemented | weak inherits `activation=disabled`, `knowledge_state=research_candidate` |
| name-only → `research_candidate` (L110) | `join.rs:553-579` | implemented | |
| no match → identity captured, zero decodes (L112) | `join.rs:214`, `join.rs:616` | implemented | `knowledge_state = unknown` |
| L4 "This vehicle — VIN-scoped evidence, local DB" (L96) | `db.rs` `discovered_modules`/`discovered_dids`/`hypotheses` (all `vehicle_id`-scoped) | implemented | |
| "unknown WMI … filed under `brand: unknown`" (L115) | `plan.rs:74-83` (`plan_version_for` → `"unknown"`) | partial | only as a plan_version string; no `brand: unknown` filing/record |

#### §3 — Knowledge model layers

| claim | where | status | note |
|---|---|---|---|
| `brands[]` with `wmi[] resp_offsets[] read_service scan_policy modules[] did_bands[] identity_block` (L128) | `uds-map.json` brand keys; `elm/uds_map.rs:452` | implemented | all seven present |
| `platforms[]` with `brand, vds_pattern, years, ecu_families_expected[], routes[]` (L129) | `elm/uds_map.rs:376-393` | partial | nested under brand (so `brand` field is implicit); `routes[]` absent |
| `ecu_families[]` with `supplier, family, hardware_refs[], software_refs[], modules_seen_on[], decodes[]` (L130) | `elm/uds_map.rs:91-113` | implemented | all six; plus `diagnostic_service`, `evidence`, `source` |
| `decodes[]` `(family, route, did) → offset/len/scale/bias/unit/signed, knowledge_state, evidence, vehicles_confirmed, discriminating_test` (L132) | `elm/uds_map.rs:126-151` `FamilyDecode`; `types.ts:331-333` | partial | every listed field except `route` — `FamilyDecode` has no route; routes live only on `modules_seen_on` |
| local DB `vehicles, connections, verification_runs, discovered_modules, discovered_dids, hypotheses, hypothesis_samples, uds_probes, readings` (L136-139) | `db.rs:663,677,828,750,764,918,942,733,686` | implemented | all nine tables exist |
| `verification_runs` records "every request + payload + NRC" (L137) | `db.rs:828-835` (`result_json TEXT`) | implemented | opaque JSON blob, no per-request columns |
| research corpus (local index, licence recorded) (L141) | `packages/uds-map/data/research/*.json` + `elm/discovery/research.rs` | partial | static JSON packs with `policy`/`source` fields; no `research_tasks` table or queryable corpus index |
| contribution (opt-in, outbound, keyed by family, no VIN) (L145) | `db.rs:953-978` `knowledge_candidates` (no FK to vehicle) | implemented | shape exists; keys are `family:` / `ecu:` / `observation:` |

#### §3 — The four independent state dimensions

| claim | where | status | note |
|---|---|---|---|
| `knowledge_state` = `research_candidate \| community_reported \| locally_confirmed \| community_verified \| oem_confirmed \| unknown` (L153) | `elm/discovery/state.rs:24-66` | **contradicts** | implemented as **9** values: the 6 doc values plus undocumented `reached_on_vehicle`, `verified_on_vehicle`, `inherited`. A 10th, `'observed'`, is written to `knowledge_candidates` (`db.rs:953-978` default, `db.rs:1768`) and does **not** parse via `KnowledgeState::parse` |
| `vehicle_fit` = `untested \| matched \| conflicted \| not_applicable` (L155) | `state.rs:71-96` | **contradicts** | 4 values but the 4th is `insufficient`, not `not_applicable`; `not_applicable` exists nowhere in the repo |
| `route_state` = `candidate \| reached \| refused \| silent \| closed` (L156) | `state.rs:104-133` | **contradicts** | 5 values but `candidate` is absent and `transport_failed` added → `reached\|refused\|silent\|transport_failed\|closed` |
| `activation` = `disabled \| learning \| enabled` (L157) | `state.rs:139-161` | implemented | exact match |
| the four dimensions persisted on a row | `db.rs:918-941` `hypotheses` (`knowledge_state`, `vehicle_fit`, `route_state`, `activation`) | partial | only the `hypotheses` table carries all four columns; `hypotheses.route_state` is **never written** (see discrepancy 2) |
| four dimensions on `discovered_modules` | `db.rs:879-899` | partial | module carries `route_state` + `identity_fit` only; no `knowledge_state`/`activation` |
| four dimensions on `discovered_dids` | `db.rs:764-777` | **contradicts** | carries a single `confidence TEXT CHECK IN ('confirmed','ai_guess','unlabeled')`; see discrepancy 1 |
| four dimensions on `uds_probes` | `db.rs:733-748` | missing | only `enabled INTEGER` + `origin ('manual','discovery')` — a boolean stand-in for `activation` |
| "`enabled` requires `vehicle_fit = matched`" (L161) | `state.rs:208` `check_activation` | implemented | enforced in one place for both API and UI |
| "`learning` is the only activation an automatic stage may set" (L162) | `state.rs:208-236`, `db.rs:2124` (learning→disabled reset) | implemented | |
| "`closed` requires adapter, pins, protocol and evidence recorded" (L163) | `route_outcomes.detail`/`route_json` `db.rs:906-917` | partial | free-text `detail` column; no structured adapter/pins fields, no enforcement that `closed` carries them |
| "a `community_verified` decode inherited … stays `community_verified`" (L159) | `db.rs:2185-2187`, `db.rs:1855-1859` | implemented | CASE guard preserves the three confirmed states |
| TS-side mirror of the four dimensions | `packages/core/src/schema/*.ts` | **missing** | no `knowledge_state`/`vehicle_fit`/`route_state`/`activation` anywhere in `packages/core/src`; only `packages/uds-map/src/types.ts` has `knowledge_state` (as `string`) |

#### §8 — Coverage report

| claim | where | status | note |
|---|---|---|---|
| `Scope` line: adapter class · pins · protocol · session · profile version (L470) | nowhere | **missing** | `CoverageReport` (`coverage.rs:156-169`) has no scope field at all |
| `Status` = scope status + independent knowledge status (L471, L484-489) | `coverage.rs:167,416-420` | **contradicts** | one `status: &'static str`, values `"complete"` / `"partial"` only |
| scope status values `partial \| automatic_scope_complete \| extended_scope_complete \| adapter_limited \| protocol_not_profiled \| gateway_limited` (L486) | nowhere | missing | only `partial` of the six exists; the other five appear nowhere in the repo |
| knowledge status `knowledge_incomplete \| knowledge_current` (L488) | nowhere | missing | |
| `Remaining` line (L472) | `coverage.rs:168` `remaining: Vec<String>` | implemented | free-text list |
| `Vehicle` line: WMI → brand profile (confidence) · platform match (L473) | `coverage.rs:13-22` `VehicleLine` | partial | has `wmi`, `brand_id`, `brand_name`; **no** brand confidence and **no** platform match |
| `Standard` line: PIDs available, DTCs, readiness (L474) | `coverage.rs:34-38` `StandardLine` | partial | `reading_keys`, `readings`, `latest_dtc_scan`; readiness not reported |
| `Routes` line: candidates → reached / refused / silent (L475) | `coverage.rs:41-56` `RoutesLine` | implemented | plus `transport_failed`, evidence ids, `limitations` |
| `Identified` line: n/n fingerprinted, family matches, new families (L476) | `coverage.rs:59-80` | implemented | adds identity_fit breakdown (stable/provisional/conflicted) |
| `Decodes` line: inherited (untested) / confirmed here / unlabeled → hypotheses (L477) | `coverage.rs:83-101` `DecodesLine` | implemented | buckets carry hypothesis ids |
| `Learning` line: passive would validate n; guided steps queued (L478) | `coverage.rs:128-137` `LearningLine` | implemented | |
| `Unreachable` line: "none closed yet" (L479) | `coverage.rs:100` `closed_route: DecodeBucket` | partial | exists only as a decode bucket, not a report line; and always empty (route_state never written on hypotheses) |
| "Every line links to the evidence (runs, samples, states)" (L491) | `coverage.rs:149-153` `EvidenceLine` | implemented | run/module/hypothesis ids, truncation flagged at 1000 |
| endpoint exposing the report | `api/mod.rs:328,815`, `api/openapi.rs:101` | implemented | `GET /vehicles/{id}/coverage` |
| `evidence_map` endpoint | `api/mod.rs:322,772`, `openapi.rs:95`, `db.rs:2423` | implemented | `VehicleEvidenceMap` at `db.rs:244-249` |

#### §10 — Data model additions

| claim | where | status | note |
|---|---|---|---|
| `vehicles.wmi` (L531) | nowhere | **missing** | `vehicles` (`db.rs:663-676`) + only ALTER is `cloud_id` (`db.rs:844`); WMI is re-sliced from VIN each read |
| `vehicles.vds` (L531) | nowhere | missing | |
| `vehicles.model_year` (L531) | nowhere | missing | `vehicles.year INTEGER` exists but is user/decoder metadata, not the VIN-derived L2 key |
| `vehicles.platform_key` (L531) | nowhere | **missing** | "L1/L2 stored, not recomputed" is exactly what does not happen |
| `vehicles.brand_confidence` (L531) | nowhere | missing | brand-level `confidence` exists in `uds-map.json` (high/medium/low) but is not stored per vehicle |
| `discovered_modules.route_json` full route tuple (L532) | `db.rs:891` | implemented | also on `route_outcomes` (`db.rs:912`) and `knowledge_candidates` |
| `discovered_modules.fingerprint` completed for every module (L533) | `db.rs:864-869` (`spare_part_number`, `hardware_version`, `software_version`, `system_name`, `fingerprint_match_key`, `fingerprint_evidence_json`) | partial | columns exist and are nullable; nothing enforces "completed for every module" |
| `ecu_families` local cache table (L534) | nowhere as a table | **contradicts** | no `ecu_families` SQLite table; families are read live from the bundled `uds-map.json` (`elm/uds_map.rs:985-993`), and `knowledge_candidates` (`db.rs:953`) is a different, outbound-contribution shape |
| `hypotheses(vehicle_id, module_id, did, knowledge_state, vehicle_fit, activation, label, decode_json, shape_json, interpretations_json, confidence, discriminating_test, next_step_id)` (L535) | `db.rs:918-941` | implemented | every listed column present, plus `route_state`, `family_id`, timestamps, `cloud_id` |
| `hypothesis_samples(hypothesis_id, ts, payload_hex, ref_ts, ref_json)` (L536) | `db.rs:942-948` | partial | `ts` → `ts_ms INTEGER`; `ref_json` → `refs_json`; **`ref_ts` missing** |
| hypothesis_samples retention: last 3 drives / 5,000 samples then downsample (L536) | nowhere | missing | no pruning or downsampling code; index only (`db.rs:949`) |
| `guided_steps` table with run ids (L537) | nowhere as a table | **contradicts** | `GuidedStep` is computed on the fly from open hypotheses (`coverage.rs:119-126`, `api/ops.rs:866-892`, `GET /vehicles/{id}/guided-steps`); nothing persists nodes or their run ids |
| `research_tasks` / corpus index (L538) | nowhere | missing | `elm/discovery/research.rs` reads static bundled packs; no task table, no licence-keyed index |
| `verification_runs.plan_version` values `auto-s1`, `auto-s2`, `auto-s4-<module>`, `learn-<date>`, `guided-<node>` (L539) | `plan.rs:74-83`, `supervisor.rs:407`, `api/ops.rs:742-752` | **contradicts** | actual scheme is `{brand}-{platform\|unknown}-v{n}` and `{brand}-{platform}-corr-v{n}`; the only stage-shaped literal is `"auto-s1-s3"` (`supervisor.rs:407`). None of the five documented values exist |
| `uds-map: platforms[]` (L540) | `uds-map.json` (18/21 brands), `elm/uds_map.rs:376`, `types.ts:225` | implemented | |
| `uds-map: ecu_families[]` (L540) | `uds-map.json` (3 families), `elm/uds_map.rs:68,91` | implemented | thin — 3 families total |
| `uds-map: decodes[].knowledge_state / vehicles_confirmed / discriminating_test` (L540) | `elm/uds_map.rs:146-150`, `types.ts:331-333` | implemented | only 2 of 9 knowledge_state values occur in data: `locally_confirmed` (10), `research_candidate` (6) |

### The 5 most important discrepancies

**1. `discovered_dids.confidence` is a third, incompatible vocabulary — and one of its three values is dead.** `db.rs:771` declares `CHECK (confidence IN ('confirmed','ai_guess','unlabeled'))`, but the only writer (`db.rs:1725-1728`) picks `"confirmed"` when the knowledge map supplied a label and `"unlabeled"` otherwise. `'ai_guess'` is never written anywhere in the repo. Worse, `"confirmed"` here means "the shared map had a name for this DID" — i.e. a *knowledge_state* fact — while the doc reserves confirmation for `vehicle_fit = matched` on this car. So the per-DID row that the evidence map surfaces (`db.rs:2476`) reports something as "confirmed" that has never been tested on the vehicle, which is precisely the conflation §3 says to eliminate.

**2. `hypotheses.route_state` is a write-only-never column: the third dimension is not actually persisted.** The column exists (`db.rs:925`) and is read back (`HYPOTHESIS_SELECT`, `db.rs:1917`), but no INSERT or UPDATE ever sets it — `db.rs:2207-2210` inserts only `knowledge_state/vehicle_fit/activation`, and neither `UPDATE hypotheses` site (`db.rs:2184`, `db.rs:2321`) touches it. Consequence: `coverage.rs` `classify()` tests `h.route_state ... == Some(RouteState::Closed)` and the `closed_route` bucket is structurally always empty, so the §8 "Unreachable" concept can never fire. Route state is only real on `discovered_modules.route_state` and `route_outcomes.route_state`, one level up from where the doc puts it.

**3. All three of the non-`activation` enums contradict the doc's value lists.** `knowledge_state` has 9 Rust values (`state.rs:24-33`) against the doc's 6 — `reached_on_vehicle`, `verified_on_vehicle` and `inherited` are undocumented, and `inherited` in particular re-encodes an inheritance event as world-knowledge, which is what `vehicle_fit` is for. A tenth string, `'observed'`, is the schema default of `knowledge_candidates.knowledge_state` (`db.rs:970`) and is injected by `db.rs:1768` (`COALESCE(h.knowledge_state, 'observed')`) — it fails `KnowledgeState::parse`, so contributed rows can carry a state the protocol's own parser rejects. `vehicle_fit`'s fourth value is `insufficient`, not the doc's `not_applicable` (a genuinely different meaning: "not enough samples" vs "this decode does not apply to this car" — the latter is now unrepresentable). `route_state` drops `candidate` and adds `transport_failed`; since `candidate` is gone, an unattempted route has no state and is inferred by set-difference in `coverage.rs:237-243`.

**4. L2 "platform" is never persisted for any vehicle — the whole §10 `vehicles.*` row is missing.** `vehicles` has no `wmi`, `vds`, `model_year`, `platform_key` or `brand_confidence`; the only ALTER on it in the entire schema is `cloud_id` (`db.rs:844`). `platform_for_vin` is re-run on every plan (`plan.rs:272`), every guided-step tree (`api/ops.rs:891`), and the coverage report does not report platform at all (`VehicleLine`, `coverage.rs:13-22`, stops at brand). The only trace a platform ever leaves on disk is embedded in the `verification_runs.plan_version` string. So the doc's stated purpose — "L1/L2 stored, not recomputed" — is inverted, and there is no way to tell whether a stored run was made under a platform match that a later map version would resolve differently.

**5. The §8 coverage report has no scope, and collapses two independent statuses into one boolean-ish string.** `CoverageReport.status` (`coverage.rs:167`) is `"complete"` or `"partial"`, derived solely from `remaining.is_empty()` (`coverage.rs:416-420`). None of the six scope-status values nor either knowledge-status value exists anywhere in the repo, and there is no `Scope` field carrying adapter class, pins, protocol, session or profile version. This defeats the section's central rule — "'complete' always modifies a scope, never the vehicle" — because a bare `"complete"` on this report is exactly an unqualified claim about the vehicle. Secondary casualties: `ecu_families` and `guided_steps` are specified as tables in §10 but exist only as bundled-JSON reads and on-the-fly computation respectively, so guided-step nodes cannot "record their run ids" (§9, L523) at all.

## Appendix C. Slice C: §4 R/S4/S4x/S5/S6/S7, §6 correlation engine, §9 guided-step tree

Reproduced verbatim from the audit slice. `origin/main` @ cb0b245.

| Claim (doc line) | Code location | Status | Note |
|---|---|---|---|
| R — "file a research task carrying the fingerprint tuple, platform, DID list… and the questions" (L256-262) | nowhere | missing | No `research_tasks` table, no filing call site. `research.rs` is a static embedded corpus. Only `auto.rs:116 notify_unknown_brand` fires a de-identified callback. |
| R — "search by exact part reference first, then supplier + family, then platform" (L260-262) | `research.rs:527-606` (`profiles_for_vin`, `routes_for_context`) | partial | Selection by WMI + exact platform only. No part-reference or supplier/family lookup; no web step; no corpus index. |
| R — "Results enter as `research_candidate` decodes with a `discriminating_test`, never as facts" (L273) | `research.rs:190-249`, `plan.rs:26-31`, `join.rs:160-171` | implemented | Candidates never enter trusted decode lookup (tested `research.rs:714`). |
| S4 "≤ 4 min global" (L278, L455) | `plan.rs:61` `SWEEP_BUDGET_SECS = 240`; `uds.rs:680-683, 744` | implemented | `execute_plan` carries `sweep_spent` across targets. |
| S4 "30–90 s per module" (L278) | nowhere | missing | One module can consume all 240 s. |
| S4 "parked or idling only" + engine-start / low-voltage guards (L278, L295-296) | `uds.rs:572-712` (`execute_plan`) | missing | No voltage read, engine-start check or parked gate on this path. Guards exist only in `discover()` (`uds.rs:1852, 1907, 1997, 2138`) and `scan_range` (`uds.rs:1312, 1350-1355`). |
| S4 "stop when voltage below 11.8 V for 30 s" (§7 L450-452) | nowhere | missing | Only `engine_likely_started` (`uds.rs:1764`: >13.2 V and baseline+0.6), an upward detector. |
| S4 "Only for modules with **no** inherited decodes" (L279) | `plan.rs:369-374` | **contradicts** | Target is `max_by_key(data_evidence)` filtered to `evidence > 0` — the module with the *most* known decodes. Inverted. |
| S4 "one or two module/band combinations with highest expected value" (L279-280) | `plan.rs:369-397` | partial | One profile-module target; but every `exploration_only` research route also gets `sweep_bands` (`plan.rs:359-361`), so count is unbounded. |
| S4 "the brand's `did_bands` for that module class" (L281) | `plan.rs:175-195` `sweep_bands` | implemented | Data-class bands, confidence-ranked, minus exclusion bands. |
| S4 "bands where sibling modules already answered" (L282-283) | nowhere | missing | |
| S4 "never identity/config bands already read" (L285) | `plan.rs:181-187` + `pack_ext.rs:134-207` | implemented | `state.rs:269` re-filters at persistence. |
| S4 "never `F4xx`" (L285) | `uds-map.json:2686-2691, 4059-4064`; `plan.rs:197-206` | partial/contradicts | F4xx only demoted to `confidence: "low"`; a long budget sweeps F400–F4FF. |
| S4 per-DID timeout 600 ms (L288) | `uds.rs:749` | implemented | |
| S4 "cap is time, not a DID count" | `uds.rs:734-782` | implemented | No identifier-count cap exists. |
| S4 ">10 transport errors abort" (L296) | `uds.rs:768`, `:866`, `:1371`, `:2235` | implemented | Consistent in all four loops. |
| S4 "answered identifiers → `discovered_dids` (`unlabeled`) → hypotheses only after class filtering" (L290-295) | `join.rs:205-217`, `state.rs:269-325` | implemented | `is_hypothesis_candidate` rejects excluded bands, config-shaped, ≥32-byte, ASCII serials, high-entropy blobs. |
| S4 "Remaining ranges carried to later connections" (L289-290) | `uds.rs:788-792` | partial | Only a summary string. No persisted carry-over; next connection re-sweeps from band start. |
| S4 "Refused/silent counts in summary" (L295-296) | `uds.rs:782-786` | implemented | |
| S4x — entire stage (L298-313, L620-626) | nowhere | missing | Zero hits for epoch / extended discovery / S4x. No API, MCP tool or UI. |
| S4x "automatic ceiling stays at 10 minutes" (L299) | `auto.rs:44, 57` `global_secs: 600`; `auto.rs:303` | partial | Checked only inside the S2 identity pass; S1 checks `s1s2 * 2/3` (`auto.rs:232`); S4 not part of `auto::run`. No single ceiling spans the run. |
| S5 "≤ 20 % of the loop" / self-suspend (L314, L343) | nowhere | missing | |
| S5 "outside the learning state, `activation` never becomes `learning`" (L318-321) | `state.rs:208-231` `check_activation`; `db.rs:2318`; `ops.rs:542-565` | implemented | Turning the flag off cascades via `db.rs:2121`. |
| S5 "Cohort. At most 4–12 hypotheses, by information value" (L323-327) | nowhere | missing | `supervisor.rs:571` polls `uds::poll_probes`, the fixed user-probe set. |
| S5 "one module stays routed for a bounded window, then the next" (L326-327) | nowhere | missing | |
| S5 "Every sample carries its own timestamp" (L328-331) | `db.rs:2342-2356` `insert_hypothesis_sample(ts_ms,…)` — `#[allow(dead_code)]`, no callers | partial | The one live sampler, `uds::correlation_capture` (`uds.rs:826-888`), returns `CorrelationReading { did, payloads, stable, outcome }` with **no timestamps**. |
| S5 references from S0 bitmap + derived events (L332-336) | `correlation/events.rs:34` (braking < −1.0 m/s²), `events.rs:12-56` | partial | Derived events implemented in the pure engine; nothing wires the PID bitmap into a live reference stream. |
| S5 "Reverse is a guided step" (L335-336) | `ops.rs:769-773` `shape_of` | implemented | |
| S5 "Retirement" (L340-342) | nowhere | missing | |
| S5 user-facing cost metrics (L343-344) | nowhere | missing | |
| S5 800 ms learning-poll timeout (§7 L449) | `uds.rs:856` | partial | Used in `correlation_capture`, not a learning poll. |
| S6 "state tree ordered by information gain per minute" (L346-347, L520) | `ops.rs:868-905`; ordering `ops.rs:906` | partial | `sort_by_key(moves_car)` only; `estimated_seconds` never used for ordering. |
| S6 step fields (L347-348) | `ops.rs:698-745` `GuidedStepNode/GuidedCapture/GuidedSuccess` | implemented | Plus `applicable_if`/`operator_confirmation`. |
| S6 "full-screen guided flow" (L349-350) | `src/views/lab/GuidedCorrelation.tsx`, `src/views/lab/plan.ts:27-40` | partial | Lab card, not full-screen. |
| S6 A→B→A from open hypotheses (L350-352) | `ops.rs:869-873`, `ops.rs:1004-1030` | implemented | |
| S7 "`unknown → research_candidate` is automatic" (L354) | `join.rs:153-171` | partial | Only for inherited decodes on weak match. Swept `unknown` DIDs stay `unknown` (`join.rs:214`). |
| S7 "`research_candidate → locally_confirmed` requires discriminating evidence" (L354-356) | `db.rs:2288-2336` `patch_hypothesis` | **contradicts** | Validates vocabulary then `check_activation` only. No knowledge-state transition rule. Any client can PATCH straight to `oem_confirmed` with zero samples. |
| S7 "`locally_confirmed` decodes join the local pack immediately… queued for contribution" (L356-358) | `db.rs:953-979, 1761-1908` `knowledge_candidates` | implemented | De-identified projection keyed by compatibility key; survives vehicle deletion (`db.rs:4266`). |
| S7 "`community_verified` needs a second vehicle" (L358) | nowhere | missing | |
| S7 "`oem_confirmed` a documented source" (L358-359) | nowhere | missing | |
| S7 "A human approves anything entering the shared `uds-map`" (L359) | implicit (repo PR) | partial | No review queue, export endpoint or approval state machine. |
| §6.1 Shape (L392-395) | `correlation/shape.rs:1-288` | implemented | |
| §6.2 Array detection (L396-398) | `correlation/arrays.rs:12-136` | implemented | |
| §6.3 Reference fits with lag, all references reported (L399-401) | `correlation/fit.rs:112-160`, `mod.rs:35` | implemented | |
| §6.4 Event fits "≥ 3 clean A→B→A transitions" (L402-403) | `correlation/sanity.rs:299` | **contradicts** | Gate is `events.transitions >= 3` (~1.5 cycles). `events.rs:68` computes `clean_aba = transitions / 2` but only puts it in a note (`sanity.rs:300-303`). Should be `clean_aba >= 3`. |
| §6.5 Cornering fit (L404-405) | `correlation/arrays.rs:157-216` | implemented | |
| §6.6 Physics sanity (L406-407) | `correlation/sanity.rs:28-129` | implemented | |
| §6.7 Inherited: match → `matched`, mismatch → `conflicted` (L408-411) | `correlation/sanity.rs:83-129` → `InheritedFit` (`contract.rs:133`) | partial | Engine returns the verdict; nothing writes it back to `hypotheses.vehicle_fit`. |
| §6 output tuple (L413-418) | `contract.rs:141-157` `HypothesisReport` | implemented | Confidence per-`Interpretation`. |
| §6 Naming rule (L419-433) | `correlation/sanity.rs:164, 199, 209, 244, 289, 308, 329, 338, 379` | implemented | Only inherited-predicted (0.9) and cornering-discriminated (0.88/0.82) exceed 0.6. |
| §6 "Nothing becomes `enabled` without `matched`" (L433) | `state.rs:222-231`; `db.rs:2318` | implemented | Tested `state.rs:365-376`. |
| Correlation engine wired into the product | nowhere | **missing** | `elm/correlation/mod.rs:6` `#![allow(dead_code)]` "The integration call site belongs to Track A and is intentionally absent". Zero callers of `correlation::analyze` outside the module. |
| §9 contract fields (L497-514) | `ops.rs:698-745` | implemented | Plus `kind`, `applicable_if`, `optional`, `operator_confirmation`. |
| §9 per-hypothesis `success.expected` signatures (L515-517) | `ops.rs:818-829` `expected_signature`; `ops.rs:960-963` | partial/contradicts | 4 signatures (`changed`, `monotonic_increase`, `monotonic_decrease`, `sign_positive`); `steps_to:<value>` and `unchanged` absent. `ops.rs:960-963` assigns the **same** signature to every hypothesis in the group, so "confirm one, refute another" is impossible. |
| §9 baseline before/after every input step (L518-519) | `ops.rs:1004-1030` | implemented | |
| §9 moving nodes optional with precondition (L519-520) | `ops.rs:940-948, 971` | implemented | |
| §9 "a node's `hypotheses` are exactly what its capture can discriminate" (L520-521) | `ops.rs:913-925` | contradicts | `capture.dids` adds every other open hypothesis on the module; grouping is by shared test text. |
| §9 "completed nodes record their run ids" (L521-522) | nowhere | missing | No `run_id` on `GuidedStepNode`; no `guided_steps` table. |
| §9 same contract for Lab, API, agent (L522-524) | `api/mod.rs:337`, `openapi.rs:86`, `src/views/lab/plan.ts:27` | partial | MCP (`scripts/scainner_mcp.py`) exposes `capture` (L205) but no `guided_steps`/`coverage`/`hypotheses`/`learning_state` tool. |
| capture repeats | `ops.rs:754` `GUIDED_REPEATS = 3`; `ops.rs:293-294`; `uds.rs:846` `clamp(1,10)` | implemented | |
| changed/stable/noisy classification | `src/views/lab/GuidedCorrelation.tsx:30-41` `classify()` | partial | TypeScript frontend only, raw payload equality; not persisted; ignores `success.expected` (`GuidedCorrelation.tsx:165`). |
| §7 default session only for S0–S4 (L444-446) | `uds.rs:2117-2120` (`enter_extended_session` in `discover()`); `uds_map.rs:520`; `uds-map.json:119,138,157,175` | contradicts | See slice A #38. |
| §8 scope status vocabulary (L483-485) | `coverage.rs:167, 416-419` | contradicts | `complete`/`partial` only. |
| §10 `plan_version` stage values | `plan.rs:64-72`, `ops.rs:754-760` | contradicts | `{brand}-{platform}-v{n}` and `-corr-v{n}`; no stage or node identity. |

### Most important discrepancies
1. Correlation engine built (2,849 lines, 1,280 test) but `analyze()` has zero production callers; `correlation_capture` emits no timestamps while `HypothesisInput`/`Sample` (`contract.rs:17`) require `ts_ms`. Wiring needs a capture-path schema change first.
2. S4 target selection inverted (`plan.rs:369-374`).
3. S4 (`execute_plan`/`sweep_identifiers`, behind `parked_verification`) has no physical safety guards; 11.8 V / 30 s rule implemented nowhere.
4. Knowledge-state promotion ungated (`db.rs:2288-2336`); fabricated states project into `knowledge_candidates` via `sync_knowledge_candidate` (`db.rs:2334`). Highest consequence: can poison shared data.
5. S4x does not exist; S5 is a flag only (no cohort, rotation, retirement, occupancy, sampler).
Cross-cutting: `plan_version` encodes neither stage nor node, `GuidedStepNode` has no run id, no `guided_steps` table → no run can be attributed to a stage or node (undercuts acceptance criterion 6).

## Appendix D. Slice D: §12 what exists vs what to build, §13 acceptance criteria

Reproduced verbatim from the audit slice. `origin/main` @ cb0b245.

Context: §12 was last written in #51 (53fe4d3). #52 (Track A), #54 (correlation), #61–#76 (multi-brand + research packs) landed after it and were never folded back.

### §12

| Item (doc line) | Doc says | Actual | Evidence | Note |
|---|---|---|---|---|
| S0 "store WMI/VDS/year" (573) | to build | partial | `db.rs:663-676` (`vehicles.year`, no wmi/vds); `elm/uds_map.rs:693` `wmi_prefix`, `:1113-1130` `vds_pattern`; `coverage.rs:18,204` | WMI/VDS derived from VIN on demand, never stored. `year` stored. |
| S0 "expose available references" (573) | to build | not started | no `available_references` symbol; `correlation/contract.rs:85` only | Nothing enumerates reference channels a vehicle can supply. |
| S1 "run automatically on new VIN" (574) | to build | **done** | `supervisor.rs:350-395` → `discovery::auto::run`; `auto.rs:188` | Gated by `app_settings.auto_discovery` (`auto.rs:156`). |
| S1 "route tuple persisted" (574) | to build | **done** | `db.rs:906-917` `route_outcomes`; writer `auto.rs:256`; `discovered_modules.route_json` (`db.rs:897`) | |
| S1 "`closed` with recorded reason" (574) | to build | partial | `state.rs:127` `RouteState::Closed`; `coverage.rs:192` buckets it; **no writer** — `auto.rs:159-166` emits reached/refused/silent/transport_failed only | `closed_route` bucket structurally unreachable. |
| S1 "global budget" (574) | to build | **done** | `auto.rs:41-63` (180 s census+identity, 600 s global), enforced `:229-234`, `:300-304` | |
| S2 "per-brand identity blocks + parsers as data" (575) | to build | done (blocks) / partial (parsers) | `uds_map.rs:184,457,1039` `identity_block_for_vin`; test `:1823` | The `psa` `F080/F0FE` parser is still Rust (`family.rs` `supplier_code_from_f0fe`). |
| S2 "repeat-for-identity" (575) | to build | **done** | `identity.rs` `record_identity`; `state.rs` `next_identity_fit`; `auto.rs:361-380` | Stable requires byte-identical repeat on a different connection. |
| S2 "engine ECU fingerprint completed" (575) | to build | not started | `join.rs` fixture: engine `6A8/688` "skipped, no fingerprint" | Vehicle-side gap. |
| S3 "`ecu_families` + compatibility tuple" (576) | to build | **done** | `uds-map.json` v9, 3 families (12/4/0 decodes); `family.rs` `CompatibilityKey`/`match_family` | PR #52. |
| S3 "four-dimension states" (576) | to build | **done** | `db.rs:918-941` `hypotheses`; `state.rs:13-217`; test `state.rs:379` | |
| S3 "inherited hypotheses" (576) | to build | **done** | `join.rs` `join_vehicle` | |
| S3 "coverage report" (576) | to build | **done** | `coverage.rs:152-169` `CoverageReport` | |
| R "research task filing" (577) | to build | not started | no `research_task`/`research_queue` symbol | Nearest: `auto.rs:116` `notify_unknown_brand` (#67), a notification not a task. |
| R "corpus index" (577) | to build | partial | `research-packs.json`, `data/research/*.json` (4), `docs/product/research/*`, `compile-research-pack.ts`, `docs/uds/brand-research-pack-specification.md` (#72) | Compiled corpus + ingestion exists; no queryable index per module/DID. |
| R "result import as candidates" (577) | to build | **done** | `research.rs` (`ResearchPack`, `CandidateDidHypothesis`, `routes_for_exploration`); PRs #62 #71 #73 #74 #75 #76 | Most stale cell in the table. |
| S4 "driven by S3 gaps + sibling bands" (578) | to build | partial | `plan.rs:1-9`; candidates `:315` | `plan.rs` never reads `hypotheses`; no sibling-band expansion. |
| S4 "global + per-module time budgets" (578) | to build | partial | `plan.rs:57-60` `SWEEP_BUDGET_SECS = 240`; `uds.rs:576,680,728-790` | Global only; no per-module budget. |
| S4 "carry-over" (578) | to build | not started | `uds.rs:788-790` appends a message string only | Nothing persists where the sweep stopped. |
| S5 "learning state" (579) | to build | **done** | `state.rs:14` `LEARNING_STATE_SETTING`; `api/ops.rs:542,554`; `db.rs:2118`; `coverage.rs:129,400` | |
| S5 "adaptive cohort" (579) | to build | not started | only `db.rs:294,2678` `cohort_target_reached` (privacy cohort, unrelated) | Probe polling still a fixed set (#49). |
| S5 "bounded samples with per-sample timestamps" (579) | to build | partial | `db.rs:942-951` `hypothesis_samples`; retention `db.rs:2361-2385`; test `db.rs:4195` | **No production writer**: `insert_hypothesis_sample` only called from tests. |
| S5 "correlation engine as a pure module, replay-tested" (579) | to build | **done, unreachable at runtime** | `elm/correlation/{mod,shape,arrays,fit,events,sanity,contract,tests}.rs`; `analyze` at `correlation/mod.rs:24`; 46 tests; fixtures `tests/fixtures/psa/c41/correlation/`; PR #54 | No caller of `correlation::analyze` outside tests; `discovery::learn` does not exist (`db.rs:155,2387` call it a follow-up). |
| S6 "state-tree generation from hypotheses" (580) | to build | **done** | `api/ops.rs` `GuidedSteps`/`guided_steps()`; `coverage.rs:119-143` | |
| S6 "full-screen guided flow" (580) | to build | partial | `apps/desktop/src/views/lab/GuidedCorrelation.tsx` via `useGuidedSteps` (`views/lab/plan.ts:64`); mounted `views/Lab.tsx:71` | Renders the §9 contract as a Lab tab; no full-screen presentation. |
| S7 "state machine" (581) | to build | partial | `state.rs` `KnowledgeState` (9) + `check_activation`; `db.rs:1846-1858` no-downgrade guard | Promotion thresholds not modelled (nightly report decision #9); `PATCH /hypotheses/{id}` accepts any valid value. |
| S7 "contribution export" (581) | to build | partial | `db.rs:953-979` `knowledge_candidates`; `GET /knowledge/candidates` (`api/mod.rs:333,721`) | Read endpoint only; no export artifact; publication disabled in #58. |
| S7 "review queue" (581) | to build | not started | — | |
| API `GET /vehicles/{id}/coverage` (582) | to build | **done** | `api/mod.rs:328`; tests `:1403,1578,1598,1746` | |
| API `GET /hypotheses` (582) | to build | **done** | `api/mod.rs:331`, `:334` PATCH; also `POST /vehicles/{id}/join` (`:332`) not in doc | |
| API `GET /guided-steps` (582) | to build | **done** | `api/mod.rs:330`; Tauri `lib.rs:187,408` | |
| API `POST /learning-state` (582) | to build | **done** as GET/PUT | `api/mod.rs:336`; `openapi.rs:106-107` | |

### §13 acceptance criteria

| Criterion (line) | Actual | Evidence | Note |
|---|---|---|---|
| 1. Fresh install, 3 min, no button → provisional identities + inherited untested + evidence-linked report; after one learning drive dynamic signals `matched` (602) | partial | `auto.rs:499` `the_verified_brand_reaches_join_and_coverage_with_real_route_states` | Pre-drive half done. Post-drive half impossible: no sample writer, no `discovery::learn`, `analyze` uncalled. |
| 2. Second-brand vehicle: 3 min → routes+identities; 1 drive → ≥1 candidate array; else research task (609) | partial | auto path is brand-generic | Blocked by same missing learn step; "research task exists" unimplemented; §11 never exercised. |
| 3. No automatic stage leaves default session / sends a service outside §7, verified by replay harness (613) | partial | `transport/replay.rs:85` records `observed`; `operation.rs:80-109` extended-session cleanup | Per-fixture order pinning gives this incidentally. **No assertion over `observed` against the §7 allowlist**; `observed()` has no reader outside the transport. |
| 4. Ceiling never exceeded; 2-min connection → partial report that resumes (615) | partial | budgets `auto.rs:41-63,229-234,300-304`; `CensusSummary.deferred:74`, `AutoSummary.stopped:97`; `coverage.rs:416` | Only budget assertions are `auto.rs:551,555` asserting the *unbudgeted* path. Nothing tests truncate-and-resume. |
| 5. Unknown WMI ends S1 within budget and files a research task (618) | partial | `auto.rs:693`, `:719` | Budget + de-identified notification tested; research task half missing. |
| 6. Every state traceable to run id and samples; every `closed` names adapter/pins/protocol/evidence (619) | partial | `coverage.rs:148-152` `EvidenceLine`; `route_outcomes.route_json/detail` | Run-id traceability real. Sample traceability vacuous. `closed` never written. |
| 7. Never "complete" without a scope; `protocol_not_profiled` / `adapter_limited` (621) | partial | `coverage.rs:167-168,416`; `uds_map.rs:422-429` `ProfiledLevel` | **No `scope` field**; literals `protocol_not_profiled`/`adapter_limited` appear nowhere in Rust; `ProfiledLevel` not surfaced in the report. |
| 8. Extended discovery 30 min, carry-over, epochs, `extended_scope_complete` (624) | not started | no `extended_scope`/`epoch`/`carry_over` symbol | Introduced by v1.3 (#51); nothing built. |

### (a) Doc says "to build" but done
- S1 automatic run, route-tuple persistence, global budget (#52/#61/#67).
- S2 identity blocks as data; repeat-for-identity.
- All of S3 (#52).
- R result import as candidates (#62/#71/#73–#76).
- S5 learning state; correlation engine module (#54).
- S6 state-tree generation.
- All four API routes plus `POST /vehicles/{id}/join`; learning-state is GET/PUT.

Implementation-order mapping: 1–4 → #52; 5 → #54; 7 → #61/#67; 9 state-tree half → `ops.rs`. Items 6, 8, 9 full-screen half, 10 have no merged PR.

### (b) Doc says exists but doesn't / stale
- §13.1 baseline "uds-map v7" is stale; map is v9.
- §12 S4 "bounded sweep" is global-only (240 s); per-module budgets and carry-over absent.
- §12 S7 understates: `knowledge_candidates` + `GET /knowledge/candidates` exist.
- Nightly report 2026-08-28 stale claims: coverage `limitations` "refused/silent/closed not persisted per route" (route_outcomes landed; only `closed` unwritten); A7 "not wired into supervisor" (`supervisor.rs:1079` calls `record_identity`).
- `closed_route` bucket and `hypotheses.route_state` are dead (no writer).
- `hypothesis_samples`: schema, retention, reader, tests, zero production inserts.

### (c) Acceptance criteria automatable today without production code
1. §13.3 service allowlist over `Replay::observed` on the existing `auto.rs:429` fixture. Highest value per line.
2. §13.4 truncate-and-resume: `auto.rs:491` `config()` with `census_and_identity_secs: 120`, assert `deferred > 0`, `stopped.is_some()`, `status == "partial"`, then second run attempts deferred candidates.
3. §13.6 evidence traceability property test over `join::fixtures::seed_c4`.
4. §13.7 weak invariant `status == "complete" ⇒ remaining.is_empty() && fingerprinted == total`.
5. §13.1 pre-drive half as one named acceptance test assembled from existing assertions.
6. §13.5 unknown-WMI run terminates within budget.

Not automatable without production code: §13.1/§13.2 post-drive halves (sample writer + `discovery::learn`), §13.2 research task, §13.8.
