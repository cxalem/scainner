# Research: write capabilities (backlog stream G)

## 1. What the app already does (fact, code)

Two write operations exist today, both DTC-clear only, confirm-gated in
the UI (`src/views/Diagnose.tsx:346-432`, mirrored in the UDS Lab):

- `clear_dtcs` (Tauri command, `lib.rs:109`) — standard OBD-II mode `04`.
- `uds_clear` (`lib.rs:163`) → `elm::uds::clear_module` (`uds.rs:235-250`) —
  ISO 14229 `14FFFFFF` (ClearDiagnosticInformation, all groups) on one of
  four built-in PSA modules or a user-added module. Already reads DTCs
  before and after and returns both (`ClearOutcome`) — a before/after log
  already exists for this one operation, just not persisted.

Everything else in `elm/uds.rs` is read-only by the file's own header
comment: `10 03` (session), `22` (ReadDataByIdentifier), `19 02`
(ReadDTCInformation), `3E` (TesterPresent). No `2E`/`31`/`2F`/`27`
(write/routine/IO-control/security-access) anywhere (grep-confirmed).

Hardware: a vGate iCar Pro, a classic-Bluetooth ELM327 clone
(`src-tauri/src/elm/driver.rs:1`, `README.md:85`) — a generic AT-command
adapter, not a manufacturer-licensed interface. "STN2100-class" in the task
brief is the right general category; the exact chip isn't documented in
the repo and doesn't matter below — the constraints come from the
protocol and the car's security policy, not the chip.

## 2. Hardware reality: what an ELM327-class dongle can and cannot do

Fact, from ISO 14229 and the PSA-specific sources below:

- **`31` RoutineControl (actuator tests, self-tests, resets) and `2F`
  IOControlByIdentifier (force an actuator on/off)**: the ELM327 AT-command
  layer passes these through as raw bytes exactly like `22`/`14` today —
  no protocol reason the current driver can't send them. The blocker is
  not the dongle, it's knowing which routine/IO IDs exist per module and
  getting past security access where the module demands it.
- **`2E` WriteDataByIdentifier (adaptations, coding)**: same — passable as
  raw bytes. PSA modules gate most `2E` writes behind `27` SecurityAccess.
- **`27` SecurityAccess (seed/key)**: PSA's algorithm is documented and
  reverse-engineered publicly (`ludwig-v/psa-seedkey-algorithm` — each ECU
  has its own key). Technically implementable in Rust. This is the real
  wall, and it's *legal/ethical*, not technical — deriving unlock keys for
  someone else's ECU firmware sits closer to reverse-engineering than
  diagnostics, and PSA can invalidate/rotate keys.
- **BSI is unreachable from the OBD-II port on this car at all** (11-bit
  and 29-bit both tried, both silent — `UDS_INVESTIGATION_LOG.md` session 1
  and the 2026-08-15 entry). Most PSA body/comfort coding lives on BSI, so
  the biggest category of PSA "coding" (lights, locking, dash options) is
  unreachable **regardless of security access** — a wiring/gateway wall,
  not a software one. Engine and ABS/ESP respond and are where write work
  would have to start.
- **Timing-sensitive flashing/telecoding needs a clock-accurate interface.**
  Dealer tooling (Actia VCI behind Diagbox/Lexia) is called out for this;
  generic/clone interfaces "drop frames, risking a bricked BSI"
  ([firstdiag.com](https://firstdiag.com/blog/diagbox-9-129-complete-guide/),
  [elektroda.com](https://www.elektroda.com/qa,bsi-coding-diagbox-lexia3-abrites-psa.html)).
  Rules out ECU flashing and full telecoding on this hardware even if BSI
  were reachable — a harder wall than security access.

Assessment: on this exact car and dongle, the ceiling is roughly "engine
and ABS/ESP module routines and adaptations that don't require security
access, or where the seed/key is already public" — everything past that
(BSI coding, flashing) needs different hardware, full stop.

## 3. Competitor capability matrix (assessment, sourced)

| Tool | PSA/Stellantis official? | Ships (tiered, rising) | Source |
|---|---|---|---|
| Generic ELM327 clones (this app's tier) | n/a, not brand-specific | Code read/clear, live data, freeze frame | prior art |
| OBDeleven NextGen/3 | **No** — officially licensed for VAG, BMW, Toyota Group, Ford, Mercedes only; Stellantis not listed | n/a for PSA | [obdeleven.com](https://obdeleven.com/obdeleven-explained-complete-buying-guide) |
| Carly | Multi-brand, PSA coverage varies by car; general tiers: DTC clear, live data, service reset, coding | Service reset can be blocked by car-side logic (e.g. oil-service still overdue); coding needs specific comm-speed workarounds | [mycarly.com support](https://support.mycarly.com/hc/en-us/articles/360010640600) |
| PSACOM / Stellacan (PSA-dedicated aftermarket) | Yes, PSA-specific hardware+software | Read/clear DTCs w/ descriptions, live data, actuator tests, **and** dealer-tier: key programming, service reset, DPF regen, EGR self-test, airbag programming, injector programming, guided coding/adaptation | [vxdas.com](https://www.vxdas.com/products/psa-com-bluetooth-diagnostic-tool), [en.stellacan.com](https://en.stellacan.com/) |
| Launch / Autel (generic multi-brand pro tools) | Multi-brand incl. PSA, tiered by subscription | Actuator tests, adaptations, some resets across brands; bidirectional control common at this tier | general industry knowledge, not independently re-verified here (see scope cuts) |
| Diagbox / Lexia-3 (OEM) | Yes, official PSA/Stellantis tool | Everything: full telecoding tree, ECU flashing, BSI, airbag, air suspension calibration, "every dealer function, no locked features" | [firstdiag.com](https://firstdiag.com/blog/diagbox-vs-lexia3-vs-psa-com/), [elektroda.com](https://www.elektroda.com/qa,bsi-coding-diagbox-lexia3-abrites-psa.html) |

Pattern: PSA-*specific* aftermarket tools (PSACOM, Stellacan) sit one tier
below OEM, already shipping actuator tests plus some adaptations on
ELM-class or PSA-dedicated USB hardware. That's the realistic ceiling for
a non-dealer tool on this platform — closer to Scainner's dongle than to
Diagbox's.

## 4. Candidate features, rising risk order

| # | Feature | Protocol | Doable on C4 + this dongle? | Worst failure mode |
|---|---|---|---|---|
| 1 | Per-module DTC clear (**shipped**) | `14` | Yes | Loses fault history the user wanted to keep — already logged before/after |
| 2 | Actuator test, engine/ABS only (fuel pump relay, fan, injector cutout) | `31`/`2F`, no security access on many routines | Likely yes, unverified per-routine on this car | Actuator stuck on if session drops mid-test; needs hard timeout + auto-revert |
| 3 | Service-light / maintenance-counter reset | Usually BSI/cluster on PSA | **No** — BSI/cluster confirmed unreachable from this port | n/a, not buildable on this hardware |
| 4 | Adaptation reset (throttle body, idle relearn) on engine/ABS | `2E` write, sometimes behind `27` | Only where not security-access gated; unverified which adaptations qualify | Silent bad relearn — car runs worse, no error shown, hardest to detect |
| 5 | Security-access-gated writes (most coding, forced DPF regen, injector coding) | `27` then `2E`/`31` | Technically possible via public seed/key algorithm, but crosses into circumventing manufacturer write protection | Bricked module, voided workshop trust, a line not yet crossed |
| 6 | BSI telecoding, ECU flashing | needs clock-accurate OEM-grade interface | **No**, hardware wall even ignoring #5 | Bricked BSI — why dealer tools use different silicon |

## 5. Safety rail design (per BACKLOG's hard rule)

Rule restated: every write action needs (a) explicit confirmation, (b) a
logged before/after state, (c) a documented reversal path. No write ships
without all three.

- **(a) Confirmation UX**: extend the pattern already shipped for DTC clear
  (Diagnose.tsx modal, "Clear codes on {module}..." → warning banner →
  "Yes, clear") into a generic `ConfirmWrite` component that always states,
  in plain language, what will change, on which module, and whether it
  reverts automatically or needs a manual step. Enforce at the Tauri
  command boundary too: each write command takes a `confirmed: bool` the
  frontend must set, so a stray automated call can't skip the modal.
- **(b) Logged before/after**: new SQLite table `writes_log` (mirrors the
  existing `ClearOutcome` shape, already proven): `id, ts, module, action,
  params_json, before_state, after_state, outcome, error`. Every write
  handler reads state before and after, same as `clear_module` does today,
  and always inserts a row, success or failure. This table is the audit
  trail stage 5 (cross-exam) and any future support conversation needs.
- **(c) Reversal path, stated per feature, not generic**: some writes
  self-revert (actuator test with a hard timeout), some need a second
  write to undo (adaptation reset might mean "redo it," not a true undo),
  some have none (DTC clear — the UI already handles this honestly with
  before/after lists instead of claiming reversibility). Ship nothing
  where the reversal path is "we don't know."

## 6. Two roadmap approaches

**A. PSA-deep-first.** Build actuator tests and non-gated adaptations for
the two modules already confirmed reachable (engine, ABS/ESP), reusing the
read-verified-first discipline from the UDS hunt sessions and the existing
`setup`/`teardown` scaffolding. Pro: matches the car in hand, fastest path
to a real differentiator. Con: doesn't generalize; each new brand repeats
the discovery-and-verify cycle from `UDS_INVESTIGATION_LOG.md`.

**B. Generic-shallow-first.** Build the write *infrastructure* (writes_log,
ConfirmWrite, command pattern) against routines standardized across
UDS-compliant brands, brand-agnostic from day one like the existing
custom-module UI. Pro: pays off across every future car. Con: standardized
write routines are rarer than reads; risks infrastructure with nothing
meaningful to run on it yet.

**Recommendation: A, but build the safety rail (writes_log, ConfirmWrite)
generically from the start** — the rail doesn't need to be PSA-specific
even though the first features it gates are, matching how DTC-clear
already shipped (module-agnostic `clear_module`, PSA-specific
`builtin_modules()`). Start with feature #2 (actuator test, engine/ABS, no
security access): smallest step past what's shipped, exercises the full
safety rail, stays honest about reversibility (hard timeout = revert).

## 7. Scope cuts

Did not: independently re-verify Launch/Autel's exact PSA feature tier
(industry knowledge, not a primary source, lower confidence than other
rows); enumerate actual RoutineControl/IOControl identifiers for the C4's
engine/ABS modules (needs a hunt session against the real car, a
build-stage task, not armchair research); evaluate non-PSA brands in depth
(out of scope, this car is the only test bed).
