# Universal Discovery Protocol

Version 1.1 · 2026-08-28 · companion to the Vehicle Knowledge Acquisition
Protocol (`vehicle-knowledge-acquisition-protocol.md`)

v1.1 narrows v1.0's "autonomous discovery" to **autonomous hypothesis
generation and bounded validation** after design review: passive learning is
an opt-in, budgeted experiment queue rather than polling every unknown;
correlation ranks hypotheses but only names a sensor with discriminating
evidence; automatic stages stay in the default session; budgets are global;
knowledge state, vehicle fit, route state and activation are separate
dimensions; ECU-family matching includes software compatibility; and the
guided steps are a machine-readable state tree that drives the app.

**One sentence.** When Scainner connects to a car it has not seen before, it
runs an automatic, read-only, time-boxed program that works out what the car
is, which modules answer, what each module is (by supplier and part number),
which of those modules we already understand from other cars, and what is
still unknown — then, in an explicit learning state, it turns the unknowns
into hypotheses, validates what ordinary driving can validate, and walks the
person through the few physical steps that resolve the rest.

The manual protocol describes what a person does over several sessions. This
document describes what the *software* does on its own, on every car, where
it needs research, and where it stops and asks a human.

---

## 1. Goals and non-goals

**Goals**

1. First connection to any car ends with a **coverage report** that is true:
   modules reached, modules identified, decodes known from compatible ECUs
   (untested here), sensors confirmed here, candidates, and routes
   unreachable with the recorded reason.
2. Knowledge **transfers by ECU family, not by brand**. A decode verified on
   a Continental ESP MK100 with compatible software applies to any car
   carrying that unit — Citroën, Peugeot, Opel or otherwise — as an untested
   fit on first connection, and as a confirmed sensor after the car itself
   agrees.
3. Every unknown DID becomes a **tracked hypothesis** with an observed shape,
   candidate interpretations, a confidence, and the cheapest test that would
   discriminate between them.
4. Where a human is needed, the app knows exactly what to ask, in what order,
   and why; it asks through a generated **guided-step state tree**, once.
5. Where the web or a manual can answer, a **research stage** is filed
   automatically with the fingerprint and the open hypotheses.
6. The whole thing is **safe by construction** (read-only, default session,
   globally budgeted, guarded) and shows its extra diagnostic traffic.

**Non-goals**

- Actuation, coding, flashing, security access. Never.
- "Supported" flags. The output is always states with evidence.
- Naming sensors from correlation alone. Correlation proposes; evidence
  confirms.

---

## 2. The classification ladder

A car is identified at five levels. Each level unlocks knowledge and decides
the path for the next stage. The most specific level with evidence wins; the
protocol never skips a level it can establish cheaply.

| Level | Key | Source | What it unlocks |
|---|---|---|---|
| **L0 Standard** | any OBD-II car | mode 01/09; the supported-PID bitmap says which PIDs exist on this car | PIDs, VIN, standard DTCs, readiness — always |
| **L1 Brand group** | WMI (VIN 1–3) | `uds-map.brands[].wmi` | address offset rules, read service (`22`/`21`/`1A`), bit width, gateway class, known module table, `did_bands`, identity-block parser |
| **L2 Platform / generation** | VDS pattern + model year (VIN 4–10), mode 09 calibration IDs, engine ECU identity | brand profile `platforms[]` (new) | which ECU families this platform carries, routes needing address extension / LIN child, brand identity DIDs |
| **L3 ECU family** | supplier + hardware part reference + software/calibration reference from identity DIDs | `ecu_families` (new, cross-brand) | every decode ever verified on a compatible unit, on any brand |
| **L4 This vehicle** | VIN-scoped evidence | local DB | what was actually observed here; overrides everything above |

**ECU compatibility (L3) is a tuple, not a part number:**

```text
(supplier, family, hardware_ref, software_ref, payload_variant, diagnostic_service)
```

- exact hardware ref **and** a software ref already seen with these decodes →
  **strong match**: inherit decodes as `vehicle_fit = untested`, eligible for
  passive validation;
- exact hardware ref, software ref unknown or different → **weak match**:
  inherit as disabled hypotheses only; a differing calibration may change
  payload layouts (the C4's ABS part `9846124980` is known with three
  calibrations: `9695041580`, `9694534480`, `9693899880`);
- same family name/supplier only → decodes are `research_candidate`
  hypotheses here;
- no match → identity captured, zero decodes; module goes to research and
  bounded sweep.

Unknown WMI is not a dead end: L0 runs, then the conservative generic census
(§4, S1); the result is filed under `brand: unknown` for research.

---

## 3. Knowledge model

Three layers, deliberately separate:

```text
uds-map (shared, versioned, de-identified)
  brands[]        wmi[], resp_offsets[], read_service, scan_policy, modules[], did_bands[], identity_block
  platforms[]     brand, vds_pattern, years, ecu_families_expected[], routes[] (extension / gateway)
  ecu_families[]  supplier, family, hardware_refs[], software_refs[], modules_seen_on[], decodes[]
  decodes[]       (family, route, did) → offset/len/scale/bias/unit/signed, knowledge_state,
                  evidence, vehicles_confirmed, discriminating_test

local DB (this installation, VIN-scoped, raw)
  vehicles, connections, verification_runs (every request + payload + NRC),
  discovered_modules (+ fingerprint, route tuple), discovered_dids,
  hypotheses, hypothesis_samples (bounded), uds_probes, readings

research corpus (local index, sources with licence recorded)
  owner's / workshop manuals, OEM bulletins, open diagnostic implementations,
  prior research reports — queried by fingerprint and platform

contribution (opt-in, outbound)
  fingerprints + confirmed decodes + negatives, keyed by family, no VIN / serial / location
```

### States are four independent dimensions

The acquisition protocol's single state list mixed evidence, applicability,
route status and activation; they are separated here (and the acquisition
protocol should adopt the same split).

```text
knowledge_state  research_candidate | community_reported | locally_confirmed |
                 community_verified | oem_confirmed | unknown      — what the world knows about a decode
vehicle_fit      untested | matched | conflicted | not_applicable   — does that decode hold on THIS car
route_state      candidate | reached | refused | silent | closed    — can we talk to the module
activation       disabled | learning | enabled                      — is it generating traffic / shown as a sensor
```

Rules: a `community_verified` decode inherited onto a new car stays
`community_verified` in knowledge and becomes `untested` in fit. `enabled`
requires `vehicle_fit = matched`. `learning` is the only activation an
automatic stage may set, and only inside a learning state (§4, S5).
`closed` requires the adapter, pins, protocol and evidence to be recorded —
it is a property of *this adapter path to this car*, never of the ECU.

---

## 4. The automatic run: stages, budgets, exits

Runs on the first connection to a new VIN; the cheap stages re-run on every
connection. Budgets are **global per connection** with local caps, and a
stage that runs out records what it did and yields; work carries over.

```text
S0 Standard   S1 Census    S2 Identity   S3 Join       R Research     S4 Sweep        S5 Learning drive   S6 Guided      S7 Promote
handshake,    who answers  fingerprint   match         file tasks     bounded DIDs    adaptive cohort     state tree     states, pack,
VIN, PIDs     on which     every         families,     with           on 1–2 chosen   validated against   for the        contribution
              routes       responder     report        fingerprint    modules         references          remainder      review
≤ 30 s        ── ≤ 3 min together ──     instant       async          ≤ 4 min global  opt-in, ≤ 20 %     on request     human
```

**First-connection ceiling: 10 minutes of diagnostic traffic**, of which
S1+S2 ≤ 3 min, S4 ≤ 4 min, and the rest live gauges. A car connected for two
minutes still gets S0–S3 and a coverage report.

### S0 — Standard (all cars, ≤ 30 s)
Existing behaviour: ELM handshake, protocol autodetect, VIN (mode 09 02),
supported-PID bitmap, DTC scan, readiness. Output: vehicle row, WMI → L1
profile (or `unknown`), calibration IDs (mode 09 04/0A) for L2, and the list
of reference signals actually available on this car.

### S1 — Census (S1+S2 ≤ 3 min)
Goal: a `(route, route_state)` for every candidate module.

1. Functional broadcast (`0100` with headers) → responders on the default path.
2. Per-brand candidate routes (L1) and platform routes (L2), probed with the
   presence DID in the default session and the brand's addressing mode;
   29-bit normal-fixed enumeration only where the brand policy allows.
3. Address-extension / LIN-child routes are separate targets; `ATCEA` reset
   before every route.
4. Unknown WMI: the conservative generic census from `uds-map.standard`.

Outcomes are stored, never collapsed. Silence is `silent`, not "not fitted":
a route becomes `closed` only after silence in two independent connections
*and* a recorded explanation naming adapter, pins, protocol and evidence (PSA
BSI behind unswitchable pins; Tesla not UDS-reachable; SGW-locked FCA).

### S2 — Identity (S1+S2 ≤ 3 min)
For every reached route, **default session only**: the ISO block (`F186 F187
F18C F190 F191 F195 F197`); if refused, the brand identity block from the
profile (PSA `F080`/`F0FE`; VAG `F19E`/`F1A2`/`F1A3`; Hyundai/Kia `F1A0`
family; Renault `F18A`; …) decoded by the brand's parser into the fingerprint
tuple. Serial and VIN never enter the match key. Identity is trusted after it
repeats byte-identical on a second connection. Modules whose identity is only
readable in the extended session are reported as "identity requires an
explicit parked session" — see §7; the automatic run never opens `10 03`.

### S3 — Join (local, instant)
For each fingerprinted module, resolve the compatibility tuple against
`ecu_families` (§2) and create hypotheses:

- strong match → inherited decodes, `vehicle_fit = untested`, `activation =
  disabled`, eligible for S5 validation with the expected shape/scale;
- weak match → inherited as disabled hypotheses, validated only by guided
  steps or an explicit learning drive that includes them;
- no match → nothing inherited; the module is queued for R and S4.

Then produce the **coverage report** (§8). This stage alone makes today's C4
knowledge visible on the next compatible car.

### R — Research (asynchronous, no car traffic)
For every module with no strong match, and for every open hypothesis, file a
research task carrying the fingerprint tuple, platform, the DID list with
observed shapes, and the questions. The task runs the acquisition protocol's
Phase 1 automatically — search by exact part reference first, then supplier +
family, then platform — over:

1. the local **research corpus**: owner's and workshop manuals, OEM bulletins,
   open diagnostic implementations, prior reports. Manuals reliably answer
   *which systems the car has and how they behave* (the C4's indirect TPMS
   learning window and reset procedure came from the handbook), *reset and
   service procedures*, and *ECU presence per trim*; they almost never contain
   DID decodes — do not expect them to;
2. the web, with the same source-class ranking and licence recording as the
   playbook (GPL and proprietary-derived tables are hypotheses, never pack
   content).

Results enter as `research_candidate` decodes with a `discriminating_test`,
never as facts. The corpus is indexed locally by WMI/platform/part reference;
each document carries its source and licence.

### S4 — Bounded sweep (≤ 4 min global, 30–90 s per module, parked or idling only)
Only for modules with no inherited decodes, and only the **one or two
module/band combinations with the highest expected value** per connection:

1. the brand's `did_bands` for that module class;
2. bands where sibling modules on this car already answered (on PSA every
   module keeps live data in `D4xx`);
3. never identity/config bands already read, never `F4xx` (mode-01 mirror);
4. read service per brand (`22`, `21` groups, `1A`).

A fast-refusing ECU covers ~300 DIDs/min; a silent one ~100/min at the 600 ms
timeout, so the per-module cap is time, not a DID count. Remaining ranges are
carried to later connections. Answered identifiers become `discovered_dids`
(`unlabeled`) and hypotheses with a first sample and a shape. Refused/silent
counts go in the summary. Guards: engine-start detection, low-voltage stop,
>10 transport errors abort.

### S5 — Learning drive (opt-in, adaptive cohort, ≤ 20 % of the loop)
Passive validation is **not** background polling of every unknown. It is an
experiment queue that runs only in a **learning state**:

- **Entering the learning state.** Onboarding offers a "learning drive" on
  first connection; the app can also be put in a learning state explicitly.
  Outside it, `activation` never becomes `learning` and no hypothesis traffic
  exists — consistent with the acquisition protocol's rule that discovered
  DIDs never become background traffic by themselves.
- **Cohort.** At most 4–12 hypotheses at a time, selected by information
  value (inherited untested fits first; arrays; DIDs whose shape suggests a
  dynamic signal; never configuration, identity, opaque blobs or
  security-like material). One module stays routed for a bounded window
  (`read-many` ≈ 10 DIDs in 4 s), then the next module.
- **Sampling.** Every sample carries its own timestamp; reference signals are
  the nearest standard-PID readings with their timestamps, and the
  correlation engine models the sampling lag explicitly (sequential ELM reads
  are not synchronous — the C4 steering fit needed lag handling).
- **References** are the PIDs the S0 bitmap says exist (typically speed, rpm,
  coolant, intake air, load, throttle, MAP, voltage, fuel rate) and derived
  events (acceleration, braking as decel < −1 m/s², stationary, engine
  on/off). Reverse is **not** derivable from unsigned OBD speed; it is a
  guided step.
- **Retirement.** Hypotheses that stay constant, or whose fit converges, leave
  the cohort; the next cohort rotates in on later drives.
- **Visibility.** The app shows that extra diagnostic traffic is running and
  which modules it touches.

### S6 — Guided steps (on request, human in the loop)
Whatever the learning drive cannot separate is resolved by **generated
guided steps**: a state tree ordered by information gain per minute, each
step with instruction, precondition, condition label, capture spec and
success criteria (§9). The app renders the tree as a full-screen guided flow
("Turn the steering wheel all the way to the left"). Same A→B→A discipline as
the C4 sessions, now generated from open hypotheses instead of hand-written.

### S7 — Promotion and contribution
`unknown → research_candidate` is automatic. `research_candidate →
locally_confirmed` requires discriminating evidence (§6). `locally_confirmed`
decodes join the local pack immediately (the next compatible car on this
installation inherits them) and are queued for de-identified contribution.
`community_verified` needs a second vehicle; `oem_confirmed` a documented
source. A human approves anything entering the shared `uds-map`.

---

## 5. Path selection: brand classes

The path per L1 class comes from `uds-map` data, never from code branches:

| Class | Examples | Path |
|---|---|---|
| **Sweepable UDS, 11-bit** | PSA, Hyundai/Kia, Toyota, Ford, Honda, Mazda | full S1–S5; offset rule derives response ids |
| **Identity behind extended session** | some VAG modules, BMW target-byte 29-bit | S1 in default; identity reported as "requires an explicit parked session"; that session is a separate opt-in operation (§7) |
| **Mixed services** | Renault (EVC/DCM `22`, LBC/UCH `21`), Nissan Leaf (`21` groups), older Kia (`21`) | S4/S5 use the per-module service from the profile |
| **KWP-era** | GM pre-2017 (`1A`), older Toyota hybrids | identity via `1A`; sweeps only where the profile lists groups |
| **Gateway-locked** | FCA/Stellantis NA 2018+ (SGW), some Mercedes | S0 + census only; report "secure gateway: manufacturer modules require authorised access" |
| **Not UDS-reachable from the port** | Tesla, Mitsubishi (per map research) | S0 only; report why; no enumeration |
| **Unknown WMI** | anything else | S0 + conservative generic census; research task filed |

---

## 6. The correlation engine

Input: for each hypothesis `h = (module, did)`, samples with timestamps and
the nearest reference readings with theirs.

Per hypothesis, in order:

1. **Shape**: byte length, signedness guess (values straddling `7F/80` or
   `FF FF` at rest), variability (stable / slow / fast / event-like),
   sentinels (`FF`, `FFFF`, `0FFE`-style).
2. **Array detection**: consecutive DIDs of equal length, equal at rest,
   diverging together while moving → per-wheel / per-axle arrays.
3. **Reference fits**: linear regression against each available reference on
   moving samples, with lag modelled; report r, slope, bias, residual for
   every reference, not only the best.
4. **Event fits**: binary/step values against derived events, ≥ 3 clean
   A→B→A transitions.
5. **Cornering fit** for arrays: outer-side speed-up vs steering sign →
   left/right; front lead → axle.
6. **Physics sanity**: proposed units must give plausible magnitudes; failing
   candidates stay `unknown` with the fit attached.
7. **Inherited hypotheses**: the expected shape/scale from the family is
   tested first; match → `vehicle_fit = matched`; mismatch → `conflicted`
   (same part, different behaviour is itself a finding for research).

Output per hypothesis:

```text
observed_shape · reference_correlations[] · candidate_interpretations[]
· discriminating_test · confidence
```

**Naming rule.** Correlation ranks; it does not name. Many unrelated signals
correlate at |r| ≥ 0.9 with speed or rpm (vehicle speed vs wheel speed, rpm
vs a proportional derived value, brake pressure vs deceleration demand,
steering angle vs yaw rate, temperature vs a slow counter). A hypothesis
becomes `locally_confirmed` with a semantic label only when either

- an inherited or source-backed interpretation predicts the observed shape,
  scale and behaviour, **or**
- a guided step (or an intrinsic discriminator such as a four-wheel array
  with a cornering split) separates it from the competing interpretations.

Everything else stays a ranked candidate with its discriminating test
queued. Nothing becomes `enabled` without `vehicle_fit = matched`.

---

## 7. Safety envelope and budgets

Enforced in code, verified by replay tests on every stage's transcript:

- **Automatic stages S0–S5: default session only.** Services `22`/`21`/`1A`/
  `19 02`/`3E`. No `10 03`, ever, in an automatic stage.
- **Extended-session identity** (for profiles that need it) is a separate,
  parked, explicitly started, module-specific operation, recorded as its own
  run, with a tested cleanup path (`10 01`, `ATCEA`, headers, filters) and
  replay coverage before a profile may enable it. Never during a learning
  drive.
- `14` only on explicit, confirmed user action. Never `2E 2F 31 11 27`.
- Adapter state restored after every route.
- Per-DID timeouts 600 ms (sweep) / 800 ms (learning poll); abort on >10
  transport errors; stop on engine start during parked stages; stop below
  11.8 V; back off on modules that refuse or time out.
- Budgets per connection: S0 30 s; S1+S2 3 min; S4 4 min global, 30–90 s per
  module; S5 ≤ 20 % of the polling loop and only in the learning state; a
  global diagnostic-traffic ceiling of 10 min on first connection.

---

## 8. Coverage report (the product surface)

Produced after S3 and updated after every drive and guided session:

```text
Vehicle       WMI KMH → Hyundai/Kia profile (high) · platform match: Kona OS 2019 (medium)
Standard      39 PIDs available, 0 DTCs, readiness complete
Routes        7 candidates → 5 reached, 1 refused (7F), 1 silent (2nd connection pending)
Identified    5/5 fingerprinted; 1 strong family match, 4 new families (research filed)
Decodes       12 inherited (untested) · 0 confirmed here · 41 unlabeled DIDs → 41 hypotheses
Learning      learning drive would validate 6 inherited fits; 2 guided steps queued (brake pedal, reverse)
Unreachable   none closed yet
```

Every line links to the evidence (runs, samples, states). This is the
honest-coverage requirement from the product doc, made automatic.

---

## 9. The guided-step state tree (drives the UI)

S6 emits data, not screens. The app renders it. Contract per step:

```json
{
  "id": "eps-angle-left",
  "module": "6B5/695",
  "hypotheses": ["D40D", "D40E", "D40F", "D411"],
  "precondition": {"parked": true, "engine": "running", "parking_brake": true},
  "instruction": "Turn the steering wheel all the way to the left and hold it.",
  "condition_label": "steering_full_left",
  "capture": {"dids": ["D40D","D40E","D40F","D411"], "reference_dids": {"6AD/68D": ["D41F"]}, "repeats": 10, "hold_seconds": 8},
  "success": {"changed_vs_baseline": ["D40D"], "returns_after": true},
  "on_success": "eps-angle-right",
  "on_failure": "eps-angle-retry-or-skip",
  "safety": "read-only; you control the car; stop if anything feels wrong",
  "estimated_seconds": 25
}
```

Rules: every input step is preceded and followed by a `baseline` node
(A→B→A); nodes that move the car carry an explicit precondition and are
optional; the tree is ordered by information gain per minute; a node's
`hypotheses` are exactly what its capture can discriminate; completed nodes
record their run ids. The same contract feeds the desktop Lab, a full-screen
onboarding flow, an API client and an agent equally.

---

## 10. Data model additions

| Addition | Purpose |
|---|---|
| `vehicles.wmi, vds, model_year, platform_key, brand_confidence` | L1/L2 stored, not recomputed |
| `discovered_modules.route_json` | full route tuple (protocol, bits, extension, gateway, session) |
| `discovered_modules.fingerprint` completed for every module (the C4 engine ECU currently has none) | L3 needs it |
| `ecu_families` (local cache of the shared table) | compatibility tuple → family → decodes |
| `hypotheses` | `(vehicle_id, module_id, did, knowledge_state, vehicle_fit, activation, label, decode_json, shape_json, interpretations_json, confidence, discriminating_test, next_step_id)` |
| `hypothesis_samples` | `(hypothesis_id, ts, payload_hex, ref_ts, ref_json)` — bounded, downsampled after fit, retention policy |
| `guided_steps` | the state-tree nodes with their run ids |
| `research_tasks` / corpus index | fingerprint-keyed questions and sources with licence |
| `verification_runs.plan_version` values | `auto-s1`, `auto-s2`, `auto-s4-<module>`, `learn-<date>`, `guided-<node>` |
| `uds-map`: `platforms[]`, `ecu_families[]`, `decodes[].knowledge_state / vehicles_confirmed / discriminating_test` | the reuse layer |

---

## 11. Worked example: the car we already missed (an expectation to test)

Vehicle #3, `KMHK…` — a 2019 Hyundai Kona OS 1.0 T-GDI, connected on
2026-08-23 for 87 minutes, 50,022 standard readings logged, no discovery run,
no module identified. Its module reachability and identity behaviour have
**not** been measured; what follows is the expectation this protocol should
meet, to be checked on its next connection:

- **L1**: WMI `KMH` → `hyundai_kia` profile (high; `+0x08`; service `22`;
  16 known modules, 11 known DIDs).
- **S1/S2** (≤ 3 min): probe the profile's routes (`7E0` engine, `7D1` ABS,
  `7D4` EPS, `7D2` airbag, `7C6` cluster, `7B3` climate, `7A0` body …); read
  the ISO identity block where answered → fingerprints; the ABS is probably a
  Mando unit and a **new family** → research task filed, S4 on ABS `D4xx`/
  `01xx` bands per the profile.
- **Coverage report** within three minutes.
- **Learning drive** (if Jesús opts in): wheel-speed arrays and a steering
  angle are the expected outcome of the correlation engine on a 87-minute
  drive; brake and reverse queued as guided steps.

If the Kona's ABS refuses everything in the default session, that is the
finding: the report says so, and research gets the fingerprint.

---

## 12. What exists today vs what to build

| Stage | Today | To build |
|---|---|---|
| S0 | ✅ supervisor, PID bitmap | store WMI/VDS/year; expose available references |
| S1 | ✅ `uds::discover` + `uds_map::addresses_to_probe`, per-brand policies, 29-bit normal-fixed | run automatically on new VIN; route tuple persisted; `closed` with recorded reason; global budget |
| S2 | ✅ ISO block fingerprint; ✅ PSA `F080/F0FE` parser | per-brand identity blocks + parsers as data; repeat-for-identity; engine ECU fingerprint completed |
| S3 | ⚠️ `known_did()` by VIN+route+DID | `ecu_families` + compatibility tuple; four-dimension states; inherited hypotheses; coverage report |
| R | ⚠️ manual research reports | research task filing; corpus index; result import as candidates |
| S4 | ✅ bounded sweep (`parked_verification`, `scan_range`) | driven by S3 gaps + sibling bands; global + per-module time budgets; carry-over |
| S5 | ⚠️ probe polling (fixed set), drive logger, `read-many` | learning state; adaptive cohort; bounded samples with per-sample timestamps; correlation engine as a pure module with replay tests on the C4 captures |
| S6 | ✅ Guided correlation UI + `capture` API | state-tree generation from hypotheses; full-screen guided flow rendering the contract in §9 |
| S7 | ⚠️ manual `uds-map` edits with evidence notes | state machine; contribution export; review queue |
| API/MCP | ✅ every stage callable | `GET /vehicles/{id}/coverage`, `GET /hypotheses`, `GET /guided-steps`, `POST /learning-state` |

**Implementation order** (value first, continuous traffic last):

1. `ecu_families` schema and compatibility matching.
2. Evidence-linked coverage report.
3. The four state dimensions in DB and API.
4. Inherited hypotheses, disabled by default.
5. Correlation engine as a pure module, replay-tested on the existing C4
   captures (runs #4–#49, the drive log, session 3).
6. Learning state with a bounded adaptive cohort; onboarding "learning drive".
7. Automatic S1/S2 on new vehicles.
8. Globally budgeted S4.
9. Guided-step state tree generation and the full-screen flow.
10. Research task filing + corpus; contribution and review pipeline.

---

## 13. Acceptance criteria

1. Connecting the C4 to a fresh install with `uds-map` v7: within three
   minutes and without any button, every reachable module it can safely
   fingerprint is identified, compatible decodes are inherited as untested
   fits, and an evidence-linked coverage report exists. After one learning
   drive, the dynamic signals the drive can validate (wheel speeds, steering
   angle, brake switch) are `matched`, and the report lists the exact guided
   steps for the remainder (servo vacuum, brake pressure, clutch).
2. Connecting the Kona: within three minutes, reached routes and identities
   are reported; after one learning drive, ≥ 1 candidate array with its
   discriminating test, with zero human input. If nothing answers in the
   default session, the report says so and a research task exists.
3. No automatic stage ever leaves the default session or sends a service
   outside §7, verified by the replay harness on every stage's transcript.
4. First-connection diagnostic traffic never exceeds the global ceiling; a
   two-minute connection still yields S0–S3.
5. A car with unknown WMI ends S1 within budget and files a research task.
6. Every state in the report is traceable to a run id and samples; every
   `closed` route names adapter, pins, protocol and evidence.
