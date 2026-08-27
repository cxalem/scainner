# Universal Discovery Protocol

Version 1.0 · 2026-08-28 · companion to the Vehicle Knowledge Acquisition
Protocol (`vehicle-knowledge-acquisition-protocol.md`)

**One sentence.** When Scainner connects to a car it has not seen before, it
runs an automatic, read-only, time-boxed program that works out what the car
is, which modules answer, what each module is (by part number, not by brand),
which of those modules we already understand from other cars, and what is
still unknown — and then it keeps learning from every drive until the unknowns
become sensors.

The manual protocol describes what a person does over several sessions. This
document describes what the *software* does on its own, on every car, on the
first connection and continuously after, and where it stops and asks a human.

---

## 1. Goals and non-goals

**Goals**

1. First connection to any car ends with a **coverage report** that is true:
   modules reached, modules identified, sensors decoded (with state), sensors
   candidate, modules unreachable and why.
2. Knowledge **transfers by ECU family, not by brand**. A Continental ESP
   MK100 decoded on a Citroën C4 must light up on a Peugeot 208, an Opel
   Mokka, and any other car carrying the same part, on their first connection.
3. Every unknown DID becomes a **tracked hypothesis** that the car itself can
   confirm during ordinary driving, without a person doing anything.
4. Where a human is needed (press the brake, turn the wheel, deflate a tyre),
   the system knows exactly what to ask and why, and asks once.
5. The whole thing is **safe by construction** (read-only, bounded, guarded)
   and **cheap** (first connection ≤ 10 minutes of car time, most of it while
   the car is being driven anyway).

**Non-goals**

- Actuation, coding, flashing, security access. Never.
- "Supported" flags. The output is always states with evidence.
- Replacing the per-car research playbook: desk research still produces the
  candidate packs the protocol consumes; the protocol tells research where to
  look next.

---

## 2. The classification ladder

A car is identified at five levels. Each level unlocks knowledge and decides
the path for the next stage. The most specific level with evidence wins; the
protocol never skips a level it can establish cheaply.

| Level | Key | Source | What it unlocks |
|---|---|---|---|
| **L0 Standard** | any OBD-II car | mode 01/09 | PIDs, VIN, standard DTCs, readiness — always |
| **L1 Brand group** | WMI (VIN 1–3) | `uds-map.brands[].wmi` | address offset rules, read service (`22`/`21`/`1A`), bit width, gateway class, discovery session policy, known module table, `did_bands` |
| **L2 Platform / generation** | VDS pattern + model year (VIN 4–10), mode 09 calibration IDs, engine ECU identity | brand profile `platforms[]` (new) | which ECU families this platform carries, which routes need address extension / LIN child, which brand identity DIDs to use |
| **L3 ECU family** | supplier + part reference from identity DIDs (`F187`/`F191`/`F195`, PSA `F080`/`F0FE`, …) | `ecu_families` (new, cross-brand) | every decode ever verified on that family, on any brand |
| **L4 This vehicle** | VIN-scoped evidence | local DB | what was actually observed here; overrides everything above |

Rules:

- **L3 is the unit of reuse.** Decodes are keyed `(ecu_family, route, did)`.
  Brand and platform are how we *find* the ECU; the part number is how we
  *know* it. Suppliers reuse modules across OEMs (Continental MK100 on PSA
  and Opel; Bosch ESP 9.x across VAG, Renault, Hyundai; Nidec/JTEKT EPS
  across Japanese brands), so the family table is where knowledge compounds.
- **A family match is byte-level.** Same part reference → apply decodes at
  their existing state, flagged `inherited` until this car confirms them
  (§6). Same family name but different part reference → decodes are
  `research_candidate` on this car, tested by the same correlation engine.
- **Unknown WMI is not a dead end.** L0 runs, then a generic enumeration
  (§4, S1) with the conservative policy; the result is filed under
  `brand: unknown` for research to name.

---

## 3. Knowledge model

Three layers, deliberately separate:

```text
uds-map (shared, versioned, de-identified)
  brands[]        wmi[], resp_offsets[], read_service, scan_policy, modules[], did_bands[]
  platforms[]     brand, vds_pattern, years, ecu_families_expected[], routes[] (with extension / session)
  ecu_families[]  supplier, part_refs[], name, modules_seen_on[], decodes[]  ← the reuse unit
  decodes[]       (family, route, did) → offset/len/scale/bias/unit/signed, state, evidence, vehicles_confirmed

local DB (this installation, VIN-scoped, raw)
  vehicles, connections, verification_runs (every request + payload + NRC),
  discovered_modules (+ fingerprint), discovered_dids, hypotheses (new), uds_probes, readings

contribution (opt-in, outbound)
  fingerprints + confirmed decodes + negatives, keyed by family, no VIN / serial / location
```

States (from the acquisition protocol, unchanged): `research_candidate`,
`community_reported`, `reached_on_vehicle`, `verified_on_vehicle`,
`inherited` (new: applied from a family match, not yet confirmed here),
`locally_confirmed`, `community_verified`, `oem_confirmed`, `unknown`,
plus `closed` for routes proven unreachable with a recorded reason.

---

## 4. The automatic run: stages, budgets, exits

Runs on the first connection to a new VIN, and re-runs the cheap stages on
every connection. Every stage has a time budget; a stage that runs out of
budget records what it did and yields — it never blocks the live gauges for
longer than its budget says.

```text
S0 Standard      S1 Census        S2 Identity       S3 Join           S4 Sweep          S5 Passive       S6 Guided         S7 Promote
handshake, VIN,  who answers on   fingerprint       match families,   bounded DID       correlate while  ask the human     states, pack,
PIDs, DTCs       which routes     every responder   apply decodes     ranges on unknown driving          for one input     contribution
≤ 30 s           ≤ 90 s           ≤ 60 s            local, instant    ≤ 4 min / module  every drive       on request       review
```

### S0 — Standard (all cars, ≤ 30 s)
Existing behaviour: ELM handshake, protocol autodetect, VIN (mode 09 02),
supported PIDs, DTC scan, readiness. Output: vehicle row, WMI → L1 brand
profile (or `unknown`), calibration IDs (mode 09 04/0A) for L2.

### S1 — Census (≤ 90 s)
Goal: a list of `(route, outcome)` for every candidate module.

1. Functional broadcast (`0100` with headers) → list responders on the default
   path.
2. Per-brand candidate routes from `uds-map` (L1) and platform routes (L2),
   probed with the presence DID (`22 F186` or the brand's equivalent) in the
   default session, in the brand's addressing mode; 29-bit normal-fixed
   enumeration only where the brand policy allows.
3. Routes needing an address extension / LIN child are separate targets;
   `ATCEA` reset before every route.
4. Unknown WMI: generic enumeration policy from `uds-map.standard.address_scan`
   (conservative range, presence DID only).

Outcome taxonomy is stored, never collapsed: answered · refused+NRC · timed
out · transport failed · malformed. A route is `closed` only after silence in
two independent connections *and* a recorded physical explanation (PSA BSI
behind unswitchable pins; Tesla not UDS-reachable; SGW-locked FCA).

### S2 — Identity (≤ 60 s)
For every reached route, in the default session: ISO block (`F186 F187 F18C
F190 F191 F195 F197`); if the ISO block is refused, the brand identity block
(PSA `F080`/`F0FE`; VAG `F19E`/`F1A2`/`F1A3`; Hyundai/Kia `F1A0`/`F1B0`
family; Renault `F18A`; etc. — from the brand profile). Decode with the
brand's parser (PSA BCD references, VAG ASCII, …) into the fingerprint
columns; serial and VIN never enter the match key. Repeat once for
byte-identity before trusting.

### S3 — Join (local, instant)
For each fingerprinted module, look up `ecu_families` by part reference:

- **Exact part match** → apply every decode of that family as `inherited`
  probes (disabled, but registered as hypotheses with an expected value shape,
  see §6). The coverage report says "12 sensors known from N other vehicles,
  awaiting confirmation on this car".
- **Family match by name/supplier only** → decodes become `research_candidate`
  hypotheses here.
- **No match** → module is `verified_on_vehicle` (identity captured) with
  zero decodes; goes to S4.

### S4 — Bounded sweep (≤ 4 min per unknown module, parked or idling only)
Only for modules with no family decodes. Range selection is evidence-based:

1. The brand's `did_bands` for that module class.
2. Bands where **sibling modules on this car** already answered (on PSA every
   module keeps live data in `D4xx`; the engine's populated bands predict the
   ABS's).
3. Deprioritise `F4xx` (mode-01 mirror) and identity/config bands already read.
4. Read service per brand (`22`, `21` groups, `1A`).
5. Cap ~1,000 identifiers per module per connection; carry the remainder to
   the next connection.

Answered identifiers become `discovered_dids` (`unlabeled`) **and**
hypotheses with a first sample. Refused/silent counts go in the summary.
Guards: engine-start detection, low-voltage stop, >10 transport errors abort.

### S5 — Passive correlation (every drive, no human)
This is where most decoding happens from now on. While the car is driven the
supervisor already logs the standard PIDs at ~1 Hz. The protocol adds a
**hypothesis poll**: every unlabeled/inherited DID on reached modules is read
round-robin (`read-many`, route set once per module, budgeted so live gauges
keep ≥ 1 Hz), and each sample is stored with the synchronous reference
signals:

```text
reference signals (always available from mode 01):
  speed, rpm, coolant, intake air, load, throttle, MAP, voltage, fuel rate
derived references:
  acceleration (d speed/dt), braking (decel < −1 m/s²), stationary, engine on/off,
  reverse-likely (speed>0 shortly after stationary with … ), time since start
```

The correlation engine (§6) runs after each drive over the accumulated
samples and assigns candidate labels with a score. Nothing is enabled or
shown as a sensor automatically; it moves state to `candidate` and queues a
guided check when one is needed.

### S6 — Guided correlation (on request, human in the loop)
For hypotheses that passive data cannot separate (brake pressure vs pedal
switch, steering torque vs angle, per-wheel TPMS state, lens/light inputs),
the app proposes a **script of steps** (from the acquisition protocol's
condition catalogue) ordered by information gain per minute, each with its
instruction, precondition, condition label, and A→B→A structure. The person
performs inputs; the app captures at ~10 Hz and diffs. Same UI as the C4's
Guided correlation, now generated from open hypotheses instead of hand-written.

### S7 — Promotion and contribution
State transitions require the evidence the acquisition protocol names.
`locally_confirmed` decodes on a family become part of the local pack
immediately (so the next same-family car on this installation inherits them)
and are queued for contribution (de-identified). `community_verified` needs a
second vehicle; `oem_confirmed` needs a documented source. A human approves
anything entering the shared `uds-map`.

---

## 5. Path selection: brand classes

The protocol picks a path per L1 class, from `uds-map` data, never from code
branches:

| Class | Examples | Path |
|---|---|---|
| **Sweepable UDS, 11-bit** | PSA, Hyundai/Kia, Toyota, Ford, Honda, Mazda | full S1–S5; offset rule derives response ids |
| **UDS with brand session policy** | VAG (some modules need extended for identity), BMW (target-byte 29-bit) | S1 in default; S2 may open `10 03` **only** on modules the profile marks `default_then_extended`, closing it after |
| **Mixed services** | Renault (EVC/DCM `22`, LBC/UCH `21`), Nissan Leaf (`21` groups), older Kia (`21`) | S4/S5 use the per-module service from the profile; `22`-only sweeps are known to return nothing |
| **KWP-era** | GM pre-2017 (`1A`), older Toyota hybrids | identity via `1A`; sweeps disabled unless profile lists groups |
| **Gateway-locked** | FCA/Stellantis NA 2018+ (SGW), some Mercedes | S0 + census only; report "secure gateway: manufacturer modules require authorised access"; no retries |
| **Not UDS-reachable from the port** | Tesla, Mitsubishi (per map research) | S0 only; report why; no enumeration |
| **Unknown WMI** | anything else | S0 + conservative generic census; file for research |

---

## 6. The correlation engine

Input: for each hypothesis `h = (module, did)` a time series of raw payloads
with reference signals at the same timestamps.

Per hypothesis, in order:

1. **Shape**: byte length, signedness guess (values straddling `7F/80` or
   `FF FF` at rest), variability (stable / slow / fast / event-like),
   valid-range sentinels (`FF`, `FFFF`, `0FFE`-style).
2. **Array detection**: consecutive DIDs of equal length whose values are
   equal at rest and diverge together while moving → per-wheel / per-axle
   arrays (the C4's `D400–D403`, `D435–D438`).
3. **Reference fit**: linear regression of the decoded integer against each
   reference signal on moving samples; accept when |r| ≥ 0.9 over ≥ 60
   samples and the slope is stable across two drives. Reports scale, bias,
   residual. (Wheel speeds: slope 99 raw/km/h → 0.01 km/h.)
4. **Event fit**: binary/step values matched against derived events (braking,
   stationary→moving, engine start) with ≥ 3 clean A→B→A transitions.
5. **Cornering fit** for arrays: outer-side speed-up vs steering sign →
   left/right; front lead → axle.
6. **Physics sanity**: a proposed unit must make magnitudes plausible
   (14.1 V, 40 bar, 500°, 895 hPa). Fails are kept as `unknown` with the fit
   attached.
7. **Inherited hypotheses**: the expected shape/scale from the family is
   tested first; a match → `locally_confirmed`; a mismatch → flagged
   `inherited_conflict` for review (same part, different behaviour is itself
   a finding).

Output per hypothesis: `state`, `label`, `decode`, `score`, the samples that
support it, and — if unresolved — the cheapest guided step that would resolve
it. Nothing becomes an enabled probe without a state ≥ `locally_confirmed`.

---

## 7. Safety envelope and budgets

Unchanged from the acquisition protocol and enforced in code, not policy:

- Services: `22`/`21`/`1A`/`19 02`/`3E` only in automatic stages; `10 03`
  only where the brand profile marks the module and always closed after;
  `14` only on explicit, confirmed user action. Never `2E 2F 31 11 27`.
- Adapter state restored after every route (`ATCEA`, headers, filters).
- Per-DID timeouts 600 ms (sweep) / 800 ms (hypothesis poll); abort on
  >10 transport errors; stop on engine start during parked stages; stop
  below 11.8 V.
- Budgets per connection: S1 90 s, S2 60 s, S4 4 min/module and 1,000 DIDs,
  S5 ≤ 20 % of the polling loop. A car that is only ever connected for two
  minutes still gets S0–S3 and a coverage report.
- Rate: hypothesis polling backs off on modules that refuse or time out.

---

## 8. Coverage report (the product surface)

Produced after S3 and updated after every drive:

```text
Vehicle       Hyundai Kona OS 1.0 T-GDI 2019 (WMI KMH, platform match: high)
Standard      39 PIDs, 0 DTCs, readiness complete
Modules       7 candidate routes → 5 answered, 1 refused (7F), 1 silent (closed: not fitted on this trim)
Identified    5/5 fingerprinted: engine (Bosch MED17.9.8 …), ABS (Mando MGH-80 …), EPS, airbag, cluster
Sensors       23 verified (inherited from 4 vehicles, confirmed here), 9 candidates, 41 unlabeled DIDs
Learning      next drive resolves 6 candidates (speed/rpm correlation); 2 need you: brake pedal, reverse
Unreachable   — 
```

Every line links to the evidence (runs, samples, states). This is the
honest-coverage requirement from the product doc, made automatic.

---

## 9. Data model additions

| Addition | Purpose |
|---|---|
| `vehicles.wmi, vds, model_year, platform_key, brand_confidence` | L1/L2 classification stored, not recomputed |
| `discovered_modules.route_json` | full route tuple (protocol, bits, extension, gateway, session) — gap noted in the acquisition protocol |
| `ecu_families` (local cache of the shared table) | `(supplier, part_ref) → family_id`, decodes |
| `hypotheses` | `(vehicle_id, module_id, did, state, label, decode_json, score, samples_json, next_step)` — the unit S5/S6 work on |
| `hypothesis_samples` | `(hypothesis_id, ts, payload_hex, speed, rpm, coolant, voltage, …)` — or a wide `readings` join keyed by timestamp |
| `verification_runs.plan_version` values | `auto-s1`, `auto-s2`, `auto-s4-<module>`, `auto-s5-<date>`, `guided-<n>` |
| `uds-map`: `platforms[]`, `ecu_families[]`, `decodes[].state/vehicles_confirmed` | the reuse layer |

---

## 10. Worked example: the car we already missed

Vehicle #3, `KMHK…` — a 2019 Hyundai Kona OS 1.0 T-GDI, connected on
2026-08-23 for 87 minutes, 50,022 standard readings logged, **no discovery
run, no module identified, no sensor beyond OBD**. Under this protocol the
same session would have produced:

- **L1**: WMI `KMH` → `hyundai_kia` profile (high confidence, `+0x08` rule,
  service `22`, 16 known modules, 11 known DIDs).
- **S1** (≤ 90 s): probe `7E0/7E8` engine, `7D1/7D9` ABS, `7D4/7DC` EPS,
  `7D2/7DA` airbag, `7C6/7CE` cluster, `7B3/7BB` climate, `7A0/7A8` body …
  → answered list.
- **S2**: ISO identity block (Hyundai answers `F187`/`F191`/`F195` on most
  modules) → fingerprints; ABS likely a Mando unit — a **new family**, no
  join.
- **S4** while parked at the start: Hyundai `did_bands` for ABS/EPS from the
  map (`01xx` groups on some units are `21`, `22 01xx` on others — the profile
  says which) → unlabeled DIDs.
- **S5** during the 87-minute drive: wheel-speed arrays and steering angle
  would have fit speed and cornering exactly as on the C4, automatically;
  brake and reverse flagged for a guided step.
- **Report**: modules identified, N sensors candidate, two questions queued
  for Jesús ("press the brake", "select reverse") the next time the app is
  open in that car.

Cost: zero extra human time. That is the difference between a logger and a
learning system.

---

## 11. What exists today vs what to build

| Stage | Today | To build |
|---|---|---|
| S0 | ✅ supervisor | — |
| S1 | ✅ `uds::discover` + `uds_map::addresses_to_probe`, per-brand policies, 29-bit normal-fixed | run automatically on new VIN; route tuple persisted; `closed` state with reason |
| S2 | ✅ ISO block fingerprint; ✅ PSA `F080/F0FE` parser | per-brand identity blocks + parsers (VAG, HK, Renault, BMW, Toyota) as data; repeat-for-identity |
| S3 | ⚠️ `known_did()` by VIN+route+DID | `ecu_families` table and join by part reference; `inherited` state; instant coverage report |
| S4 | ✅ bounded sweep (`parked_verification` targets, `scan_range`) | driven by S3 gaps + sibling bands; per-module budgets; carry-over |
| S5 | ⚠️ probe polling (fixed set, 30–60 s), drive logger script | hypothesis poll inside the supervisor, sample storage with references, correlation engine as a pure Rust module with replay tests |
| S6 | ✅ Guided correlation UI + `capture` API | script generated from open hypotheses; information-gain ordering |
| S7 | ⚠️ manual `uds-map` edits with evidence notes | state machine in code; contribution export; review queue |
| API/MCP | ✅ every stage callable | `GET /vehicles/{id}/coverage`, `GET /hypotheses`, `POST /hypotheses/{id}/guided-step` |

Suggested order: S3 join + coverage report (makes today's C4 knowledge reusable
and visible) → S5 hypothesis poll + correlation engine (the compounding part)
→ automatic S1/S2/S4 on new VIN → S6 generation → S7 tooling. Each step is
testable on the two cars already in the database and on replay fixtures from
the C4 evidence runs.

---

## 12. Acceptance criteria

1. Connecting the C4 to a fresh install with `uds-map` v7 produces, within
   three minutes and without any button, a coverage report listing four
   identified modules and 14 sensors as `inherited` → `locally_confirmed`
   after one drive.
2. Connecting the Kona produces, within three minutes, identified modules and
   ≥ 1 candidate array (wheel speeds) after one drive, with zero human input.
3. No automatic stage ever sends a service outside §7, verified by the replay
   harness on every stage's transcript.
4. A car with unknown WMI ends S1 within budget and files a research item.
5. Every state shown in the report is traceable to a run id and samples.
