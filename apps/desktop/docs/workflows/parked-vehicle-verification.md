# Parked vehicle verification

This workflow converts an online ECU/address claim into evidence from the actual car. A claim is not promoted into the vehicle map merely because it appeared in documentation or a community database.

## Before the session

- Park safely, apply the parking brake, and switch the ignition on. The engine may idle.
- Connect through the app so the run receives the current `vehicle_id` and `connection_id`.
- Do not operate lights, wipers, climate, parking controls, or move the vehicle during the baseline.
- Open **Lab → Parked vehicle verification** and run the current plan once.

The initial v1 Citroën C4 C41 plan tested:

| Target | Route | What it resolves |
| --- | --- | --- |
| CVM3 camera | `74A → 64A` | Re-captures complete identity, including the previously truncated `F080` payload |
| CDPL rain/light | `730 → 710`, extension `70` | Tests the LIN-child routing hypothesis that made the earlier normal-addressing attempt invalid |
| ESPMK100 ABS | `6AD → 68D` | Confirms the researched ECU family with standard identity DIDs |
| DAE_UDS2 steering | `6B5 → 695` | Confirms the researched ECU family with standard identity DIDs |
| AAS parking aid | `75D → 65D` | Determines whether this generation/address is present on this car |
| TPMS | `18DAC7F1 → 18DAF1C7` | Tests the 29-bit ECU route and pressure candidates `013C–013F` |

### Current v2 plan

V1 confirmed that the camera, ABS and steering routes are reachable but that
most ISO identity DIDs are not exposed in their default sessions. V2 therefore
uses PSA-specific identity candidates on those confirmed routes instead of
repeating the refused fields. It also replaces the silent modern TPMS route
with three separately sourced older-generation candidates:

| Target | Route | Read candidates |
| --- | --- | --- |
| CVM3 camera | `74A → 64A` | `F186`, `F18C`, `F080`, `F08A`, `F08E`, `F0FE` |
| ESPMK100 ABS | `6AD → 68D` | Same PSA identity candidates |
| DAE_UDS2 steering | `6B5 → 695` | Same PSA identity candidates |
| DSG TPMS | `6AF → 68F` | Presence and PSA identity candidates |
| Legacy TPMS | `740 → 4C0` | `A0F1–A0F4`, `A0A1` |
| Aggregate TPMS | `742 → 642` | `A022` |

V2 does not repeat the silent CDPL and AAS routes and does not guess new ones.
Each observation now stores the exact ELM response alongside its parsed status
and payload, including `NO DATA` and negative responses.

### Current v3 plan

V2 (evidence run #2, 2026-08-27) answered `F080` and `F0FE` on the camera, ABS
and steering routes, showed `F08A`/`F08E` to be empty (camera) or absent (ABS
and steering, NRC `31`), and found all three older-generation TPMS routes
silent. Together with the 29-bit route from v1 and the unreachable BSI, four
TPMS address hypotheses are now closed.

`F080` decodes as packed BCD: five bytes per ten-digit PSA reference, the
first at byte 0 and the second at byte 7 (`98 17 13 71 80` → `9817137180`).
Only groups whose every nibble is a decimal digit are accepted, so `FF`
padding never turns into a number.

| Target | Route | Reads |
| --- | --- | --- |
| CVM3 camera | `74A → 64A` | `F186`, `F18C`, `F080`, `F0FE` |
| ESPMK100 ABS | `6AD → 68D` | Same identity set |
| DAE_UDS2 steering | `6B5 → 695` | Same identity set |
| ABS data sweep | `6AD → 68D` | Every identifier in `D000–D1FF` and `D400–D4FF`, default session |

The sweep is the remaining evidence-based route for tyre pressure: it targets
the ranges where this car's engine ECU already serves live PSA values (`D4xx`)
and the range the earlier BSI hunt aimed at. Only answered identifiers are
stored as observations; refusals and silence are counted in the target's
`summary`. It takes a few minutes and aborts if the link degrades.

After a v3 run the app also writes back what the car itself answered:

- Every reached route (answered or refused) refreshes `last_seen_at` and the
  module label in `discovered_modules`.
- A decoded `F080` fills `spare_part_number` (reference 1) and
  `software_version` (reference 2) and rebuilds the fingerprint match key.
  That ordering follows the community reading of PSA `F080` and is **not yet
  confirmed against a label on this vehicle**; the evidence JSON names the
  source DID so the assumption stays visible. Confirm it once by comparing
  the camera's reference against the sticker behind the mirror cover.
- Sweep hits become unlabeled `discovered_dids` rows, so the vehicle map can
  show them without implying a meaning.

Match keys are now labelled by field (`part=`, `hw=`, `sw=`, `sys=`) rather
than by source DID, so an ISO `F187` part number and a PSA `F080` reference
for the same ECU family compare equal.

Silent routes write nothing.

## Safety boundary

The automated run only uses UDS service `22` (`ReadDataByIdentifier`) in the default diagnostic session. It never sends `10 03`, `2E`, `2F`, `31`, `14`, or an ECU reset. Adapter state is restored afterward, including disabling `ATCEA`, even when a route fails.

## Reading the result

- **answered**: the route and DID worked on this car. Preserve the full payload and use repeated captures to validate a decoder.
- **refused + NRC**: the route reached an ECU. The NRC is evidence; it may mean the DID is absent, conditions are wrong, or authorization is required.
- **timed out**: not proof that the ECU is absent. Check ignition state, route, gateway, bus speed, and addressing mode.
- **transport failed / malformed**: adapter or parser failure; do not use it to classify the ECU.

Every run is saved in `verification_runs`, scoped to both vehicle and connection. The JSON contains every target, DID, typed outcome, full payload, and printable representation.

## Follow-up correlation tests

Only after a baseline route answers should we add a separate correlation plan. Capture the same read while changing exactly one input at a time—for example cover/uncover the rain sensor, switch side lights on/off, select reverse with the brake held, or compare cold and warmed tyre pressures. Repeat each state at least three times. A value becomes a decoded sensor only when its byte changes consistently with the physical input and returns to baseline.

Climate routing remains unresolved and is deliberately absent from v1 rather than guessed. Add it to a later version only when the route itself has source evidence; keep old plan versions replayable.

## Promotion rule

Promote a finding from `research_candidate` to `verified_on_vehicle` only when:

1. The physical route answers on the vehicle.
2. Identity payloads support the claimed ECU family, or the family remains explicitly unknown.
3. For live values, repeated one-variable correlation validates the byte shape and conversion.
4. The raw evidence remains attached to the vehicle and connection that produced it.

### Current v4: guided correlation (`citroen-c41-corr-v1`)

V3's ABS sweep found 62 answering identifiers in `D400–D484` and none in
`D000–D1FF`. No further address hypothesis is added; the next evidence comes
from the car's own behaviour. **Lab → Guided correlation** runs the A → B → A
loop around the operator:

| Step | Condition label | What the operator does |
| --- | --- | --- |
| 1 | `baseline` | Hands off everything, parking brake on |
| 2 | `brake_held` | Brake pedal held for the whole capture |
| 3 | `baseline` | return |
| 4 | `steering_full_left` | Wheel fully left, held |
| 5 | `baseline` | return |
| 6 | `steering_full_right` | Wheel fully right, held |
| 7 | `baseline` | return |
| 8 | `reverse_selected` | R selected with the brake held, stationary |
| 9 | `baseline` | return |
| 10 | `rolled_forward_2m` (optional) | Roll forward two metres, stop, parking brake, capture |
| 11 | `baseline` | return |
| 12 | `rolled_backward_2m` (optional) | Reverse two metres, stop, parking brake, capture |
| 13 | `baseline` | return |

Tyre pressure is not a parked step. The ABS identifies its software as `DSG`
(`D619`, captured 2026-08-23) — *Détection de Sous-Gonflage*, PSA's indirect
system computed from wheel speeds. There is no pressure value to decode, only
per-wheel status (`D435–D438 = 07 07 07 07` is the candidate block), and it
refreshes only after several kilometres. It gets its own driven session
(`citroen-c41-corr-v2`): one tyre −0.5 bar → 10 km → capture → re-inflate and
reset DSG in the menu → 10 km → capture. Before that, `citroen-c41-v5` should
sweep `D500–D7FF` on the ABS, where an earlier manual scan already found
answers (`D611–D701`).

Each capture reads every unlabeled identifier on the chosen module three
times, round-robin, in the default session, and is saved as a
`verification_runs` row whose JSON carries the step, condition label, and
every payload. The app classifies each identifier against the first baseline:

- **changed** — stable inside both captures and different between them;
- **stable** — identical throughout;
- **noisy** — varies between repeats of the same condition; excluded as a
  candidate for that input;
- **no answer** — refused or silent in one of the captures.

A DID is listed as a *candidate* for a condition only when it changed during
the input **and** returned to its baseline value in the baseline captured
right after. Candidates are shown, never polled: promotion to a `uds_probes`
row still requires a repeat session and a written decode.

Inputs that move the car are optional, marked with their precondition, and
allowed because every request is read-only; the operator, not the app, is in
control of the vehicle.

#### Session 2026-08-27 16:25–16:40 (`citroen-c41-corr-v1`, evidence runs #4–#16)

13 captures on ABS/ESP `6AD→68D`, 75 identifiers × 3 reads each. Findings
against the first baseline (#4), with the A → B → A test applied:

| DID | Rest | Under input | Returned | Reading |
| --- | --- | --- | --- | --- |
| `D406` | `00` | `01` while the pedal was down (brake held; first reads of both roll steps) | yes | brake pedal switch — candidate |
| `D40C` | `00` | `1E–23` firm pedal; `09/0E` light braking after the roll; `22` after reversing | yes | brake pressure, varies with effort — candidate, unit unknown |
| `D400–D403` | `00 00` ×4 | `00 3E / 00 3D / 00 3D / 00 3D` in the one read that caught the car still moving (reverse roll) | yes | four wheel speeds — candidate by shape; unit unknown |
| `D464` | `01` | `00` with R selected (stationary) and during the reverse roll | yes | reverse-selected flag (inverted) — candidate |
| `D479` | `B3` | `B1` under brake/steering load, `A1–AC` while rolling | drifts back | load-dependent, voltage-like — unproven |
| `D46D` | `00` | `01` during the reverse roll only | yes | single observation, untested |
| `D462`, `D444` | `01`, `00` | `02`, `01` in the brake-held capture only | yes | **confounded**: the parking brake was toggled during that capture; not reproduced when the parking brake was released/applied before the roll captures. Retest cleanly |

Negative results: the steering full-left / full-right steps changed nothing
cleanly. `D40E` flickers `7E/7D` in every capture regardless of input and
`D425`/`D45A` moved sporadically; steering angle is not exposed in this DID
set of the ABS in the default session. `D42E` is an event-like counter,
`D405`/`D410` wobble ±1 continuously, `D41F` counts down — none correlate.

Consequence for the next script (`citroen-c41-corr-v2`): capture *during* a
slow roll instead of after stopping, so all three reads see wheel speed; add a
parking-brake released/applied pair with the pedal held constant; repeat the
brake-held step without touching anything else. The classifier now treats
"stable at rest, every sample different under input" as a change.

#### Drive 2026-08-27 18:44–18:49 (`citroen-c41-drive-v1`, evidence run #17)

The app had lost the dongle after the parked session, so the capture ran
outside it: `scripts/drive_logger.py` (read-only, same termios/handshake as
`driver.rs`, revived the V-LINK with the blueutil unpair → pair 1234 → connect
cure) polled nine ABS identifiers plus OBD speed/RPM/voltage round-robin at
~1 Hz for 196 cycles. Raw CSV: `docs/workflows/evidence/citroen-c41-drive-v1-2026-08-27.csv`.
The drive was ~200 m with normal braking, starting and ending with a reverse
manoeuvre.

| DID | Result | State |
| --- | --- | --- |
| `D400–D403` | Four 16-bit values tracking OBD speed with slope 97–99 per km/h over 93 moving samples (median ratio 100.7–101.2): **wheel speed, 0.01 km/h**. `D400`/`D402` stay closest to each other, as do `D401`/`D403`, so the pairs are the two sides of the car; which side is left is not established. | `locally_confirmed` (decode), side unconfirmed |
| `D406` | `1` in 66 of 196 cycles, exactly the deceleration phases and the stationary pedal test; `0` otherwise. **Brake pedal switch.** | `locally_confirmed` |
| `D40C` | `0` at rest, 1–14 in normal braking, 28–33 with the pedal held firmly while stationary; never non-zero without `D406 = 1`. **Brake pressure**, scale unknown (bar-sized magnitudes). | candidate, needs unit |
| `D46D` / `D464` | `D46D = 1` with `D464 = 0` during both reverse manoeuvres (18:45:47–18:46:04 and 18:48:30–18:48:46), `0`/`1` otherwise, with single-cycle transitions. **Reverse engaged** and its inverse. | `locally_confirmed` |
| `D479` | 179 at rest, 160–176 while driving; mean while braking (173.1) ≈ cruising (174.2), so the parked-session "voltage-like" reading is not supported. Unexplained. | `unknown` |

Write-back: the eight raw probes enabled for the drive now carry these
labels and the 0.01 km/h scale; `D46D` was added. They remain enabled on the
ABS module for live polling; disable them in Lab → Probes if the extra ABS
traffic is unwanted. Promotion to the shared `uds-map` pack still requires
human approval and a second vehicle with the same fingerprint.

#### Correction 2026-08-27 (after `docs/research/c41-abs-did-research.md`)

`F080` reference 2 is a *complementary hardware reference*, not a software
version (three concordant sources: PyPSADiag `IdentUDSECU.json`,
arduino-psa-diag `UDS_FLASH.md`, Diagbox-derived definitions). The software /
calibration reference is `F0FE` bytes 21–23 printed as `96xxxxxx80`.
`psa_identity_fingerprint` now maps ref 1 → `spare_part_number`, ref 2 →
`hardware_version`, `F0FE` → `software_version`; stored rows were corrected:
camera sw `9694921880`, ABS sw `9695041580`, steering sw `9695027380`.
The ABS is a Continental/ATE ESP MK100 (ATE `10.0220-2524.4`), not Bosch.

Probe relabels from the same research, consistent with our captures:
`D46D` = rear-left wheel rolling direction (why it moved only when the car
actually rolled back), `D464` = AEB deceleration state, `D40C` = brake
pressure in bar (claimed), `D479` = brake-servo vacuum ×5 hPa (claimed).
New decodes verified against the parked captures and added as **disabled**
probes: `D41F` steering angle ×0.1 −1250° (±500° at full lock), `D42E` clutch
pedal ×0.5 % (`C8` while selecting R), `D405` ECU voltage ×0.1 V. Researched
but unverified: `D45B` outside temperature, `D412` km since DSGi reset.

#### Session 2, 2026-08-27 20:10–20:35 — through the agent API (`scripts/c41_session2.py`)

Wheel order (runs #26–#40, `citroen-c41-corr-v1`, condition `turn_manoeuvre`):
15 chained correlation captures of `D400–D403` + `D41F` at ~10 Hz during a
short drive with real corners (150 moving samples, up to 77 km/h). In left
turns (`D41F` > +45°) `D401`/`D403` were faster; in right turns `D400`/`D402`
were faster; within a side the front wheel led mid-corner. **Confirmed:
`D400` RL, `D401` RR, `D402` FL, `D403` FR (×0.01 km/h); steering angle
positive = left.** Probe labels updated. Raw samples in
`docs/workflows/evidence/c41-session2-turn-*.json`.

Method note: `POST /uds/read` costs ~1.3 s per DID (route reconfigured per
call), so single reads cannot sample a manoeuvre; probe polling runs only
every 30–60 s. `POST /verification/capture` with `repeats=10` reads the set
round-robin at ~10 Hz and is the right tool for short physical tests. Worth
adding a `/uds/read-many` or a configurable probe interval to the API.

Brake-servo vacuum (runs #41–#49, condition `pedal_pump_engine_off`, engine
off, ignition on): `D479` fell 156 → 4 over the first six pedal pumps and
stayed at 4 for the rest of the 45 s. **Confirmed: `D479` = brake-servo
vacuum / depression, ×5 hPa** (780 hPa with the reserve full, ~20 hPa
exhausted; only the running engine rebuilds it). `D40C` reached 46 during the
hard pumps, consistent with the bar scale. Probe decode set to ×5 hPa.

Engine ECU UDS clear (`c41-session2-dtc-clear-*.json`): before `P17ED-94`
(`U1205-81` had already aged out on its own), UDS `14 FFFFFF` **accepted**
with a positive response, after: none. The earlier refusals were the
engine-running state, as the research suggested; the outcome is now recorded
with the request.

ABS sweep `D500–D7FF` (`c41-session2-abs-sweep-D500-D7FF-*.json`): nothing
in `D5xx`; 14 answers in `D6xx`/`D7xx`, all configuration/identity-like:
`D611` `"0000178734"`, `D619` `"DSGiRESC00.1170001"` (the indirect-TPMS
software identifier — DSGi confirmed by name), `D612/D616/D618/D623/D631`
small flags, `D622 = 00 07`, `D636–D639` 10–18-byte opaque blobs (checksums
or keys; not to be decoded), `D640 = 00 03`, `D701 = 00 0B 40` (2880).
No live data lives in this block; `D4xx` remains the ABS live-data range.

State after session 2 on the ABS/ESP (Continental MK100, `9846124980`):
`locally_confirmed` — wheel speeds RL/RR/FL/FR ×0.01 km/h, steering angle
(+ = left), brake pedal switch, brake pressure (bar, magnitudes), brake-servo
vacuum ×5 hPa, clutch pedal, ECU voltage, rear-wheel rolling direction.
Still open: DSGi per-wheel state values (`D435–D438`), `D45B`, `D412`.
