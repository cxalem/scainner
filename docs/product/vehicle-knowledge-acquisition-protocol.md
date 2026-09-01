# Vehicle Knowledge Acquisition Protocol

Version 1.0 · 2026-08-27 · derived from the Citroën C4 III (C41) evidence runs #1–#3

This document specifies how Scainner learns what a car can tell us — which
modules exist, how to reach them, what identifies them, and what their data
means — in a way that is repeatable on any brand. It generalises the process
that was run on the Citroën C4 between 2026-08-14 and 2026-08-27 and turns it
into a protocol with fixed phases, fixed evidence formats, and fixed promotion
rules.

It complements, and does not replace:

- `apps/desktop/docs/research/ecu-generation-routing-playbook.md` — the
  research method for one platform (the "four questions", source triangulation).
- `apps/desktop/docs/workflows/parked-vehicle-verification.md` — the operator
  checklist and per-version plan history for the C4.
- `packages/uds-map/RESEARCH.md` — cross-brand structural findings (address
  offset rules, which service each brand uses, decode convention).
- `docs/product/diagnostic-intelligence.md` — the product context and the
  provenance states this protocol feeds.

---

## 1. Purpose and scope

**Goal.** For a given vehicle, produce a *vehicle-verified* map of reachable
modules, their identities, and their decodable sensors, with every claim
attached to the raw evidence that produced it — so the same map can be reused
for every other car with the same ECU fingerprint, and so the app never shows
an owner a number it cannot back.

**In scope.** ELM327/STN-class adapters on the OBD-II port; ISO 15765 CAN
(11-bit and 29-bit); UDS `0x22` ReadDataByIdentifier, plus `0x21`/`0x1A` where
the brand requires it; default diagnostic session; ISO 14229 and brand-specific
identity identifiers; bounded identifier sweeps; one-variable physical
correlation.

**Out of scope.** Anything that changes the car (see §3), security access,
DoIP/CAN-FD transports, modules behind pins the adapter cannot reach, and
decoding by guesswork.

---

## 2. Principles

1. **Four questions, never one "supported" flag.** Which ECU *family* can this
   platform carry; which ECU *is fitted*; what *complete route* reaches it;
   how is each value *decoded*. Evidence for one does not prove the others.
2. **Evidence before interpretation.** Every request stores its exact adapter
   response, including `NO DATA`, negative responses, and framing. A parser
   change must be replayable against past runs.
3. **Negative results are results.** A refusal with an NRC proves an ECU is
   there and says why the read failed. Silence proves nothing about presence.
   Both are stored, neither is converted to "not supported".
4. **Every claim has a source class and a state.** Research candidates,
   community reports, and vehicle-verified facts are stored with different
   labels and never merge silently.
5. **Bounded and reproducible.** Every automated pass is a versioned plan.
   Plans are immutable once run; the next version is written from the
   previous version's evidence, and says what it dropped and why.
6. **Nothing discovered becomes background traffic by itself.** A found DID is
   an unlabeled fact until a human promotes it to a probe.

---

## 3. Safety boundary

Applies to every phase, every brand, no exceptions.

| Allowed | Never |
|---|---|
| `22` ReadDataByIdentifier | `2E` WriteDataByIdentifier |
| `21` / `1A` read services where the brand uses them | `2F` InputOutputControl |
| `3E` TesterPresent | `31` RoutineControl |
| `10 01` default session; `10 03` extended only in explicit Lab operations | `11` ECUReset |
| `19 02` ReadDTCInformation | `27` SecurityAccess |
| `14` ClearDiagnosticInformation **only** on explicit user action, with before/after verification | Any flashing, coding, or configuration |

Adapter state (protocol, headers, filters, `ATCEA`) is restored after every
target even when a route fails. Automated sweeps abort when the link degrades
(>10 transport errors) or an engine start is detected during a parked plan.

---

## 4. Provenance states

Each fact — route, identity, DID meaning — carries exactly one state.

| State | Meaning | How it is reached |
|---|---|---|
| `research_candidate` | Found in documentation, a parts catalog, or an open implementation; not yet tried on a car | Phase 1 |
| `community_reported` | Reported in forum/community captures; explicitly anecdotal | Phase 1 |
| `reached_on_vehicle` | The route answered or refused with an NRC on this car | Phase 2 |
| `verified_on_vehicle` | Identity payloads support the claimed ECU family, or the family is explicitly unknown but the route and identity are captured | Phase 3 |
| `locally_confirmed` | A live value's byte shape and conversion were validated by repeated one-variable correlation on this car | Phase 5 |
| `community_verified` | The same fingerprint + route + DID reproduced on ≥2 vehicles | Phase 6 |
| `oem_confirmed` | Matches applicable OEM information for the exact ECU | Phase 6 |
| `unknown` | Response preserved without interpretation | Any |

Promotion is monotonic within a vehicle and requires the evidence named in the
phase that produces the state. Demotion happens only by a human.

**Refinement (2026-08-28, from the Universal Discovery Protocol review):** the
list above mixes four independent dimensions. Going forward both documents
use: `knowledge_state` (`research_candidate` · `community_reported` ·
`locally_confirmed` · `community_verified` · `oem_confirmed` · `unknown`),
`vehicle_fit` (`untested` · `matched` · `conflicted` · `not_applicable`),
`route_state` (`candidate` · `reached` · `refused` · `silent` · `closed`) and
`activation` (`disabled` · `learning` · `enabled`). `reached_on_vehicle` and
`verified_on_vehicle` above map to `route_state = reached` plus an identity
capture; a decode shown as a sensor requires `vehicle_fit = matched`.

**Current schema (2026-09-01).** All four dimensions are persisted together on
one table only. `hypotheses` carries `knowledge_state`, `vehicle_fit`,
`route_state` and `activation` (`apps/desktop/src-tauri/src/db.rs:918-941`; all
`db.rs` references below are that file). Of those, `hypotheses.route_state`
(`db.rs:925`) is read back but never written by any insert or update, so a
closed route can never be expressed on a hypothesis. Route state is real one
level up, on `discovered_modules.route_state` (`db.rs:893`, written at
`db.rs:2006-2010`) and on `route_outcomes.route_state` (`db.rs:911`).
`discovered_modules` also carries a 3-value `identity_fit`
(`conflicted` / `provisional` / `stable`, `db.rs:74`, `db.rs:883`) plus
`route_json`, `family_id` and `family_match` (`db.rs:887-889`), and no
`knowledge_state` or `activation` at all. `discovered_dids` reduces the whole
model to one column: `confidence TEXT CHECK (confidence IN ('confirmed',
'ai_guess','unlabeled'))` (`db.rs:771`). `ai_guess` is never written anywhere,
and the sole writer (`db.rs:1725-1728`) picks `confirmed` whenever the shared
map supplied a label, so `confirmed` there means "labelled by the map", not
confirmed on this vehicle. `uds_probes` has neither dimension: only `enabled`
and `origin` (`manual` / `discovery`) (`db.rs:733-746`), and the supervisor
polls only rows whose origin is `manual` (`should_poll_probe`,
`apps/desktop/src-tauri/src/elm/uds.rs:1439-1441`), so discovery-origin probes
and enabled hypotheses produce no traffic. Reconciling these three parallel
vocabularies is DA-7, DA-8 and DA-17 in
`docs/product/discovery-protocol-audit-2026-09-01.md`.

---

## 5. The evidence record

Every vehicle-facing request produces one observation with these fields. This
is the unit of evidence for the whole protocol; every table in §9 is a view
over it.

```text
vehicle_id           private local id (never VIN in shared data)
connection_id        the adapter session that produced it
plan_version         e.g. citroen-c41-v3, or "manual"
timestamp
route                (protocol, bit width, request id, response id,
                      address extension, gateway/LIN child, session)
service              22 | 21 | 1A | 19 | ...
identifier           DID / local id / group
purpose              why this identifier was tried (from the plan)
outcome.status       answered | refused | timed_out | transport_failed | malformed
outcome.nrc          when refused
payload_hex          complete application payload after the echoed identifier
printable            ASCII rendering when the payload is printable
raw_response         exact adapter text, including headers and NO DATA
```

Rules:

- **Complete payloads.** Multi-frame responses are stored whole. Identity
  truncation (the C4's 3-byte `F080` sample from 2026-08-25) is a bug class
  that must fail tests before hardware use.
- **Full route tuple.** Request/response IDs alone are insufficient — the
  C4's rain/light module needed an address extension the earlier attempt did
  not carry, and that attempt was therefore invalid, not negative.
- **Serial numbers and VIN never enter a comparison key.** They identify a
  unit, not a family.

---

## 6. Phases

The protocol is six phases. Phases 1–4 are largely automatable; 5 needs a
person at the car; 6 is a review.

```text
1 Desk research ─▶ 2 Reachability ─▶ 3 Identity ─▶ 4 Sweep ─▶ 5 Correlation ─▶ 6 Promotion
   candidates        reached           verified      unlabeled    locally         shared
                     on vehicle        on vehicle    DIDs         confirmed       knowledge
```

### Phase 1 — Desk research: build the candidate pack

**Input.** VIN (WMI, model year), platform code, powertrain.
**Output.** A brand/platform candidate pack in `packages/uds-map` with, per module:

- request/response addresses and the **offset rule** they follow (PSA `6xx`
  is `−0x20`, PSA `7xx` is `−0x100`; VW proprietary `+0x6A`; Hyundai/Toyota/Ford
  `+0x08`; GM `+0x400`; FCA `−0x280`; Renault mostly `+0x20` with exceptions);
- which **service** carries data (`22` for most; `21` for Nissan/Renault
  battery and body modules and older Kia; `1A` for pre-2017 GM);
- 11-bit vs 29-bit, address extension, gateway/LIN child if known;
- discovery session policy (`default_only` / `default_then_extended`);
- candidate identity DIDs: the ISO block (`F186 F187 F18C F190 F191 F195 F197`)
  plus brand identity DIDs (PSA `F080 F0FE`);
- candidate data DIDs with their decode (`offset`, `len`, `scale`, `bias`,
  unit — the `uds-map` convention: offset counts from the byte after the
  echoed identifier);
- for every claim: source class, URL, publication date, license,
  contradictions.

**Search order** (decreasing specificity): exact OEM part/calibration
reference → supplier + ECU family → family + platform + year → platform /
powertrain / equipment → make/model/year as a discovery query only.

**Source classes**, in order of trust: OEM service/build information and
standards; open diagnostic implementations with raw requests; diagnostic
tool coverage/live-data screens; parts catalogs and supplier references;
forum captures (always labeled community).

**Licensing gate.** GPL or proprietary tables are evidence for verification,
never content for a closed knowledge pack. Record the license with the claim.

**Exit criterion.** Every module in the pack has a state of
`research_candidate` or `community_reported` and a full route tuple, or is
explicitly marked "route unknown — do not probe".

### Phase 2 — Reachability: which routes answer on this car

**Procedure** (parked, ignition on, read-only):

1. Functional broadcast `0100` with headers on, to list every responder on
   the default OBD path.
2. Physical probes of each candidate route with a presence read (`22 F186`,
   or the brand's equivalent). Try the pack's addressing mode first; try
   29-bit (`ATSP7`, `18DAxxF1`) only as a separate, labeled hypothesis.
3. Address-extension and LIN-child routes are their own targets, with
   `ATCEA` disabled before every route so state cannot leak between them.

**Outcome taxonomy** (stored, never collapsed):

| Outcome | Interpretation |
|---|---|
| answered | route works; module present |
| refused + NRC | route reaches an ECU; the NRC is the finding (`31` absent DID, `7F` wrong session, `33` security) |
| timed out | *not* proof of absence — check ignition, bus speed, addressing, gateway, pins |
| transport failed / malformed | adapter or parser problem; do not classify the module |

**Closing a hypothesis.** A route is declared closed only after two
independent sessions of silence on the same route and the physical-layer
explanation is recorded (the C4's BSI/cluster: PSA routes them on OBD pins an
ELM cannot switch — 512 DIDs across two sessions plus a negative 29-bit probe
across 18 addresses).

**Exit criterion.** Every candidate route is `reached_on_vehicle` or closed
with a written reason.

### Phase 3 — Identity: fingerprint every reached module

**Procedure.** On every reached route, in the default session, read:

1. The ISO 14229 identity block: `F187` spare part number, `F191` hardware
   version, `F195` software version, `F197` system name, `F18C` serial,
   `F186` active session, `F190` VIN (stored locally, never shared).
2. If ISO DIDs are refused (NRC `31` on all four was the C4 result on every
   module), the brand's identity DIDs. For PSA: `F080` (packed-BCD part
   references, five bytes each at offsets 0 and 7), `F0FE`.
3. Repeat in a second session; identity payloads must be byte-identical
   across sessions before they are trusted (C4 run #2 vs #3: identical).

**Fingerprint.** Stored on `discovered_modules`:

```text
spare_part_number   (ISO F187 or brand equivalent)
hardware_version    (ISO F191)
software_version    (ISO F195 or brand equivalent)
system_name         (ISO F197)
fingerprint_match_key   "part=…|hw=…|sw=…|sys=…"  — labelled by field, not by
                         source DID, so ISO and brand identity for the same
                         family compare equal
fingerprint_evidence_json  the observations that produced each field,
                            naming the source DID and any assumption
```

Serial number is kept as evidence and excluded from the key.

**Assumptions stay visible.** When a brand payload's field order is taken from
community reading (PSA `F080`: reference 1 = part, reference 2 = software),
the evidence label says "order unconfirmed on vehicle" until it is checked
against a physical label. One label check per brand closes it.

**Exit criterion.** Each reached module is `verified_on_vehicle` with at
least a part reference, or is recorded as "identity refused in default
session" with the NRCs.

### Phase 4 — Bounded sweep: where does this module keep its data

Run only on modules that are `verified_on_vehicle`, only in the default
session, only with the read service the brand uses.

**Range selection** — evidence-based, not exhaustive:

1. Ranges where this car's *other* modules already serve live data (the C4's
   engine keeps live values in `D4xx`; the ABS turned out to as well —
   62 DIDs in `D400–D484`, none in `D000–D1FF`).
2. Ranges named by the candidate pack for this family.
3. Deprioritise `F4xx`: it mirrors mode-01 PIDs the app already has.
4. Cap each plan at ~1,000 identifiers; split larger searches across versions.

**Per-identifier rules.** 600 ms timeout; ECUs that answer `7F 22 31` fast
make a 768-DID sweep take a few minutes, ECUs that stay silent make it slow
— both are fine, but the plan states the expected duration to the operator.
Abort after 10 transport errors so a dead adapter cannot masquerade as 700
silent identifiers.

**Storage.** Only answered identifiers become observations (full payload).
Refused/silent counts go in the target's `summary`. Every hit is written to
`discovered_dids` with `confidence = unlabeled` and no meaning.

**Exit criterion.** A summary line per range (`tried / answered / refused /
silent / link errors`) and a list of unlabeled DIDs with their byte lengths
and one baseline sample.

### Phase 5 — Correlation: turn bytes into sensors

This is the only phase that assigns meaning, and it does so only from the
car's own behaviour.

**Design.** One physical input changed at a time (A → B → A), each state
captured ≥3 times, all unlabeled DIDs of the module re-read in every capture,
with the operator's condition label stored on the capture.

**Condition catalogue** (pick the cheapest that isolates the hypothesis):

| Hypothesis | Input | Expected shape |
|---|---|---|
| tyre pressure | drive → warm vs cold next morning; deflate one tyre 0.3 bar | four values, one moves |
| wheel/axle state | brake pedal held; steering turned | pairs or quads change together |
| temperature | cold start vs operating temperature | slow monotonic drift |
| rain/light sensor | cover / uncover; side lights on/off | discrete step |
| parking aid | select reverse with brake held | discrete step |
| electrical load | AC / rear demister on/off | current/voltage shift |
| engine state | off / idle / steady RPM | changes only with engine |

**Guided correlation (human in the loop).** The software cannot press the
brake or turn the wheel, but it can run the loop around the person who can.
A correlation plan is therefore a script of steps, each with:

- an instruction in plain language ("Hold the brake pedal firmly, then press
  Capture"), including the safety precondition (parking brake on, area clear);
- a condition label stored on the capture (`baseline`, `brake_held`,
  `steering_full_left`, `rolled_forward_2m`, `reverse_selected`, `tyre_fl_-0.3bar`);
- the repeat count (default 3);
- an automatic return-to-baseline step after every input (A → B → A).

After each capture the app diffs every unlabeled DID against the baseline and
shows three classes: **changed** (moved with the input, returned after),
**stable** (identical across all captures), **noisy** (varies within a
condition — excluded as a candidate for that input). The person only decides
what to do next; the app never asks them to interpret bytes. Inputs that move
the vehicle (rolling forward a metre, selecting reverse) are allowed because
every request is read-only; the instruction states where the car must be and
that the operator, not the app, is in control of it.

**Pattern heuristics** (candidates, never conclusions): consecutive DIDs of
equal length with equal values (the C4 ABS `D435–D438 = 07 07 07 07`) suggest
a per-wheel array; repeated pairs suggest per-axle values; multi-byte records
with a shared tail suggest structured config.

**Decode.** `value = big_endian(payload[offset .. offset+len]) * scale + bias`,
signedness stated in the label. A decode is `locally_confirmed` only when the
byte moves consistently with the input across all repeats and returns to
baseline. It is then created as a `uds_probes` row — **disabled** — and
enabled by the user.

**Exit criterion.** A candidate list with, for each DID: hypothesis, the
captures that support it, the decode, and the state (`locally_confirmed` or
still `unknown`).

### Phase 6 — Promotion: from this car to the knowledge pack

A finding enters `packages/uds-map` for a **fingerprint + route + DID**, not
for a brand, when:

1. the route answers on the vehicle;
2. identity supports the claimed family (or family is explicitly unknown);
3. for live values, correlation validated shape and conversion;
4. the raw evidence stays attached to the vehicle and connection that
   produced it;
5. license/provenance is reviewed;
6. a human approves.

`community_verified` requires the same fingerprint reproducing on a second
vehicle; the fingerprint experiment harness (`fingerprint_experiment`) counts
this. Entries keyed by DID number alone are not accepted.

---

## 7. Plans: versioning rules

A plan is the executable form of one evidence pass (`parked_verification` in
`uds.rs`; the C4's were `citroen-c41-v1..v3`).

- **Named** `<brand>-<platform>-v<N>`; one file section per version in the
  workflow doc.
- **Immutable once run.** Correct by adding vN+1, never by editing vN.
- **Derived from evidence.** Each version states what the previous run
  answered, what it therefore drops (the C4 v3 dropped `F08A/F08E` and four
  silent TPMS routes), and what new hypothesis it tests with its source.
- **No guessed routes.** A route enters a plan with a source class; "let's
  try" is not a source.
- **Stated cost.** Number of reads and expected duration.
- **Replayable.** Every run's full report is stored in `verification_runs`
  (`vehicle_id`, `connection_id`, `plan_version`, `result_json` including its
  own `run_id`); the driver's replay-JSON harness must be able to re-parse it.

**Write-back after a run** (automatic, silent routes write nothing):

| Evidence | Effect |
|---|---|
| route answered or refused | `discovered_modules.last_seen_at`; label only from identity targets, never from sweep targets |
| identity decoded | fingerprint columns + match key rebuilt |
| sweep hit | `discovered_dids` row, `unlabeled` |

---

## 8. Operator procedure (any car)

1. Connect; confirm the app resolved this connection's own vehicle identity
   (VIN or a named VIN-less vehicle). Evidence is refused without it.
2. Park, parking brake on, ignition on; engine may idle. Touch nothing
   during a baseline pass.
3. Run the current plan version once. Leave the adapter connected until
   every target reports.
4. Read the result with the outcome taxonomy in §6/Phase 2, not as
   pass/fail.
5. If the plan included a sweep, schedule a correlation session (Phase 5)
   before adding any new address hypothesis.
6. Append the run to the workflow doc; write the next plan version from it.

---

## 9. Data model (current implementation)

| Table | Holds | Key fields |
|---|---|---|
| `verification_runs` | one full report per plan execution | `vehicle_id`, `connection_id`, `plan_version`, `result_json` |
| `discovered_modules` | one row per reached route per vehicle | `module_address` (`req/resp`), `module_name`, `route_json`, `route_state`, `identity_fit` (`conflicted` / `provisional` / `stable`), `family_id`, `family_match`, `supplier`, fingerprint columns, `fingerprint_match_key`, `fingerprint_evidence_json`, `last_seen_at` |
| `route_outcomes` | every census outcome per route, including the routes that never answered | `vehicle_id`, `connection_id`, `module_address`, `route_state`, `route_json`, `detail`, `observed_at` |
| `discovered_dids` | every answered identifier | `module_id`, `did`, `raw_sample`, `byte_length`, `label`, `confidence` (`confirmed` / `ai_guess`, never written / `unlabeled`) |
| `hypotheses` | one candidate decode per vehicle, module and DID; the only table with all four dimensions | `knowledge_state`, `vehicle_fit`, `route_state` (never written), `activation`, `label`, `decode_json`, `shape_json`, `interpretations_json`, `confidence`, `discriminating_test`, `next_step_id`, `family_id` |
| `hypothesis_samples` | raw payloads for the correlation engine; schema and retention exist, no production writer | `hypothesis_id`, `ts_ms`, `payload_hex`, `refs_json` |
| `uds_probes` | decodes promoted to sensors | `module`, `did`, `offset`, `len`, `scale`, `bias`, `unit`, `enabled`, `origin` |
| `knowledge_candidates` | reusable knowledge projected out of vehicle history; deliberately no foreign key to a vehicle | `compatibility_key`, `scope` (`ecu_family` / `exact_ecu` / `observation`), `family_id`, `module_address`, `route_json`, `did`, `knowledge_state` (schema default `observed`), decode and shape columns |
| `readings` | values from enabled probes and standard PIDs | `connection_id`, `vehicle_id`, `key`, `value`, `ts` |
| `uds_modules` | user-added routes | `key`, `req`, `resp` |
| `packages/uds-map` | shared, versioned candidate packs | per-brand modules, offset rules, services, DIDs with decode and provenance |

Gaps to close for full compliance with §5 (2026-09-01). The route tuple now
exists: `discovered_modules.route_json` and `route_outcomes.route_json` carry
protocol, bit width, address extension and session, so that gap is closed. The
correlation gap moved rather than closed. `hypothesis_samples` has the right
shape and a retention rule (`db.rs:2343`, `db.rs:2361-2385`) but no production
writer; its only callers are tests (`db.rs:4195`). And `correlation_capture`
(`apps/desktop/src-tauri/src/elm/uds.rs:826`) returns hex payloads with no
timestamp on any sample, so a capture cannot be aligned against a reference
signal even once a writer exists. Correlation captures remain
`verification_runs` rows with a `condition` label and a plan version of the
form `<brand>-<platform>-corr-v<N>`. Wiring the engine to timestamped samples
is DA-14 in `docs/product/discovery-protocol-audit-2026-09-01.md`.

---

## 10. Worked example: Citroën C4 III (C41), 2026-08-14 → 08-27

| Step | Plan | What it established |
|---|---|---|
| Recon | manual, 08-14 | Broadcast `0100`: only `7E8`. Physical: engine `6A8/688` and ABS `6AD/68D` answer; BSI `752/652` and cluster `75F/65F` silent |
| Closure | manual, 08-14/15 | BSI silent across 512 DIDs in two sessions; 29-bit `18DAxxF1` silent on 18 addresses → BSI/cluster closed: physical-layer routing |
| v1 | `citroen-c41-v1`, 08-26 | Camera `74A/64A`, ABS, steering `6B5/695` reachable; ISO identity DIDs refused (NRC 31) on all; CDPL `730/710+70`, AAS `75D/65D`, 29-bit TPMS silent. Camera `F080` captured whole for the first time |
| v2 | `citroen-c41-v2`, 08-27 | PSA identity: `F080`/`F0FE` answer on all three; `F08A/F08E` empty or absent; three older TPMS routes silent → four TPMS hypotheses closed |
| v3 | `citroen-c41-v3`, 08-27 | `F080` decoded (BCD): camera 9817137180/9842725080, ABS 9846124980/9820609380, steering 9844551780/9834578780 — identical across runs; fingerprints written; ABS sweep 768 DIDs → 62 answered in `D400–D484`, 0 in `D000–D1FF`, 0 silent; candidates `D435–D438 = 07×4` |
| next | `citroen-c41-corr-v1` | Correlation: warm vs cold tyres, one-tyre deflation, brake/steering held |

Cost so far: three parked sessions of 2–10 minutes each. Nothing was written
to the car.

Open items carried forward: PSA `F080` reference order unconfirmed against a
label; TPMS still unlocated; `F0FE` structure unknown; the two stubborn
engine-ECU UDS codes (`U1205-81`, `P17ED-94`) refuse clearing and are not yet
interpreted.

---

## 11. New-brand checklist

Before the first parked session on a new brand/platform:

- [ ] WMI → brand profile exists in `uds-map` with its offset rule(s)
- [ ] Per-module read service known (`22`/`21`/`1A`) or marked unknown
- [ ] Identity DIDs listed: ISO block + brand block (if any)
- [ ] Every candidate route has a source class, URL, date, license
- [ ] Routes needing address extension / LIN child / 29-bit are separate targets
- [ ] Plan `<brand>-<platform>-v1` written: presence + identity only, no sweep
- [ ] Expected read count and duration stated
- [ ] Replay fixtures exist for the identity parser of that brand
- [ ] The app resolves the vehicle identity for this connection

After v1: write v2 from the evidence; sweep only on `verified_on_vehicle`
modules; correlate before adding address hypotheses.
