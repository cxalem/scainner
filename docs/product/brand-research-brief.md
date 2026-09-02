# Sonda — Product & Brand Coverage Brief

_Generated 2026-08-30, for the owner's brand-by-brand research pass, on
`redesign/hi-fi-v2` at commit `9ca5057`. Every fact below traces to a file in
this repo — the path is given wherever a number or a claim comes from data
rather than prose._

---

## 1. What Sonda is

From `brand.md`: Sonda is a personal OBD2 diagnostic app for macOS. Its
identity is "calm instrument" — a clean, data-forward tool on paper-white,
deliberately not the black-cockpit, skeuomorphic-gauge, racing-font cliché of
the OBD app category. One accent voice (blurple), a warm-neutral ink ramp,
and the 3D chrome emblem of the connected car as the one visual flourish. The
product itself (from `docs/product/multi-brand-audit.md` §1) is "multi-brand
diagnostic knowledge that compounds": connect any car, identify it down to
the exact ECU, reuse what compatible ECUs on other cars already taught the
system, and learn the rest from evidence gathered on that car. The moat is
the shared, evidence-backed knowledge keyed by ECU family — not one car, not
one brand.

---

## 2. What's shipped today (screen by screen)

The app on this branch has six top-level views plus a three-part onboarding
flow (login → connect → first-time discovery), wired in
`apps/desktop/src/App.tsx` and framed by `apps/desktop/src/components/Shell.tsx`.
A `docs/product/ui-flow-spec.md` (v1.0, 2026-08-29) proposes a further
redesign into an 11-step "stepper" flow (stages A/B/C) — that document is a
**design spec for future work**, not yet what's built; the brand and
component foundation it depends on (design tokens, motion vocabulary,
primitives, the login/connect gates) landed on this branch in commit
`864888b`, but the view-level restructuring (folding Overview/Live/History
into the new step screens) has not. What follows describes the six views and
onboarding flow as they exist right now.

- **Login** (`apps/desktop/src/components/Login.tsx`) — the sign-in gate: a
  brand panel with the 3D-emblem carousel (every marque with a modeled
  emblem cycles through it) and an email/one-time-code sign-in, or "Continue
  without an account." Account is for cloud sync; the app works fully
  offline.
- **ConnectGate** (`apps/desktop/src/components/ConnectGate.tsx`) — one
  card: an empty plug icon until a VIN resolves, then the brand's emblem; a
  title that changes as the car is read; a log of what happened; one Connect
  button. Shown once per app session, until the first successful connect.
- **DiscoveryFlow** (`apps/desktop/src/components/DiscoveryFlow.tsx`) —
  shown once, the first time a VIN the app has never seen finishes
  connecting. Walks through the same steps the backend actually performs
  (VIN/identity read, then a fault-code check), so nothing shown is ahead of
  what the car has actually confirmed.
- **Overview** (`apps/desktop/src/views/Overview.tsx`) — what the app knows
  about this car right now, and what it thinks the owner should do. The 3D
  vehicle scene and a verdict at the top, four stat tiles, a fuel card and
  recent sessions below. Reads `useVehicleReport`, `useVehicles`, and builds
  verdicts from `buildVerdicts` (`apps/desktop/src/views/overview/buildVerdicts.ts`).
- **Diagnose** (`apps/desktop/src/views/Diagnose.tsx`) — fault codes: a scan
  console, DTC history with detail modals, and the AI report card
  (`views/diagnose/AiReportCard.tsx`). Reads `useDtcHistory`; scans and
  clears go through `ScanConsole`.
- **Live** (`apps/desktop/src/views/Live.tsx`) — "the same sensors on two
  time scales": the standing gauge set (see §10) plus whatever this car's
  UDS probes push, grouped and pinnable ("Now"), and the stored history of
  the same keys ("Over time", `views/live/Trend.tsx`). This view already
  absorbed the old standalone History view (deleted on this branch — see
  the git status at session start, `D apps/desktop/src/views/History.tsx`).
- **Workshop** (`apps/desktop/src/views/Workshop.tsx`) — the diagnostic
  cases you have open, each with the complaint that started it. Pure
  presentation over `useDiagnosticCases` / `useCreateDiagnosticCase`
  (`apps/desktop/src/features/workshop/cases.ts`); the case data model is
  unchanged from before this redesign.
- **Lab** (`apps/desktop/src/views/Lab.tsx`) — manufacturer diagnostics
  beyond the standard PID set: one investigation surface with three modes
  (auto sweep, the backend's verification plan, guided correlation steps)
  plus a drawer of by-hand tools (DID reader, module manager, probe manager,
  range scanner, module faults) for research use. This is already
  consolidated toward the ui-flow-spec's B1/B2 shape (one screen, mode
  switch, Advanced drawer) rather than the eight-card layout the spec
  describes as the pre-redesign state.
- **Vehicle** (`apps/desktop/src/views/Vehicle.tsx`) — identity and
  provenance: where every fact about this car came from (VIN decode,
  evidence map, database path), plus ECU re-read and data export. The one
  write is the connected car's display name.

---

## 3. How the discovery protocol works

The full protocol is specified in `docs/product/universal-discovery-protocol.md`
(v1.3) and `docs/product/vehicle-knowledge-acquisition-protocol.md` (v1.0,
the manual/original version it generalizes). The **actual runtime
implementation** lives in `apps/desktop/src-tauri/src/elm/discovery/` and
`apps/desktop/src-tauri/src/elm/uds.rs` / `uds_map.rs`. This section
describes what the code does, function by function.

### The standard layer (every car, brand-independent)

Before any manufacturer-specific work, the supervisor runs the standard
OBD-II layer: mode 01 PID discovery (the supported-PID bitmap), VIN read
(mode 09 02), calibration IDs (mode 09 04/0A), a DTC scan and readiness
monitors. This is what feeds the fixed gauge set (§10) and is available on
literally any OBD-II-compliant car regardless of whether its brand has a
`uds-map` profile.

### The automatic run (`elm/discovery/auto.rs::run`)

On every new connection, `auto::run(drv, db, vehicle_id, vin, connection_id,
cancel, config, progress)` executes three phases in order, budgeted to
`AutoConfig::census_and_identity_secs` (180 s, S1+S2 together) and
`AutoConfig::global_secs` (600 s, the whole run):

1. **S1 census.** Every `AddressCandidate` from
   `uds_map::addresses_to_probe(vin)` — the brand's documented module routes
   plus, where the brand's `scan_policy` allows it, the conventional address
   range and normal-fixed 29-bit enumeration — is pointed at with
   `uds::point_at` and probed with the presence DID
   (`uds::probe_addr`). Every outcome (`reached` / `refused` / `silent` /
   `transport_failed`) is written to `route_outcomes` via
   `db.record_route_outcome`, and a reached or refused route becomes a
   `discovered_modules` row (`db.upsert_discovered_module`,
   `db.set_module_route_state`, `db.set_module_route`).
2. **S2 identity.** For every reached module, the brand's identity block
   (`uds_map::identity_block_for_vin(vin)` → the DID list from
   `pack_ext::identity_dids`) is read **twice** — once immediately, once
   after every other module has had its turn — using the module's actual
   read service (`uds_map::read_service_for_module`, one of `22`/`21`/`1A`).
   `identity::fingerprint(vin, route, observations)` turns the raw payloads
   into an `EcuFingerprint` (part/hardware/software/system, plus a
   `match_key` that deliberately excludes VIN and serial); `identity::record_identity`
   compares the two reads and sets `identity_fit` to `provisional` (first
   read), `stable` (byte-identical on an independent connection) or
   `conflicted` (payload changed — sticky, and the module is excluded from
   the join below).
3. **S3 join + coverage.** `join::join_vehicle(db, uds_map::map(),
   vehicle_id)` walks every module with a joinable identity, builds a
   `CompatibilityKey` (`family::CompatibilityKey::from_fingerprint`, the
   part/software/system/service tuple, explicitly never VIN/serial/address),
   and calls `family::match_family(&key, map)`. This returns a
   `FamilyMatch::{Strong, Weak, NameOnly, None}` against the pack's
   `ecu_families[]`: **Strong** (same part *and* software reference) inherits
   the family's decodes as `vehicle_fit = untested`, `activation =
   disabled` hypotheses (`db.upsert_hypothesis`); **Weak** (same part,
   different/unknown software) inherits the same rows but flagged weak;
   **NameOnly** (family/system name matches, no part match) creates
   `research_candidate` hypotheses instead. Every discovered DID that isn't
   a family decode, and that passes the class filter
   (`state::is_hypothesis_candidate` — excludes identity/config bands,
   opaque high-entropy blobs, serial-like ASCII, security-like material),
   becomes an `unknown` hypothesis. Finally `coverage::coverage(db, map,
   vehicle_id)` builds the `CoverageReport` (routes reached/refused/silent,
   modules identified, decode buckets by state, learning/guided-step
   summary, evidence run ids) — this is what the app's coverage card reads.

The whole run never opens the extended diagnostic session (`10 03`) — the
module's docstring states explicitly "no `enter_extended_session` call
exists in this file" — and is skipped entirely when
`app_settings.auto_discovery` is `off` (`auto::enabled(db)`).

### Services actually used

Per `apps/desktop/src-tauri/src/elm/uds.rs`'s own header comment and the
functions in it: `22` ReadDataByIdentifier (default for most brands), `21`
ReadDataByLocalIdentifier and `1A` ReadEcuIdentification where the pack says
a module uses them (`ReadService` enum, `uds_map.rs`), `19 02`
ReadDTCInformation (`uds::read_dtcs`), `3E` TesterPresent
(`uds::tester_present`), `10 01`/`10 03` DiagnosticSessionControl
(`operation::enter_extended_session` — extended session only in explicit,
non-automatic Lab operations), and `14` ClearDiagnosticInformation only on
explicit user action (`uds::clear_module`), audited with before/after state.
No `2E` WriteDataByIdentifier, `2F` InputOutputControl, `31` RoutineControl,
`11` ECUReset or `27` SecurityAccess call exists anywhere in the file — this
matches the safety envelope in `universal-discovery-protocol.md` §7 exactly.

### What gets promoted into live sensors vs. stays a candidate

A decode only reaches the Live view as a numbered sensor once its hypothesis
has `activation = enabled`, which the state rules
(`discovery/state.rs::check_activation`) require `vehicle_fit = matched` for
— i.e. the correlation engine (or a guided step) confirmed the byte moves
the way the family's decode says it should, on *this* car. Everything else —
inherited-but-untested family decodes, name-only research candidates,
unlabeled discovered DIDs — stays a hypothesis, visible in the coverage
report as a count, never shown as a bare number in the UI.

### Naming: 21 real names, not "L1–L4"

The protocol's classification ladder (`universal-discovery-protocol.md` §2)
names the same five levels the code implements: L0 Standard (any OBD-II
car), L1 Brand group (WMI → `uds-map.brands[]`), L2 Platform/generation
(`brands[].platforms[]`, VDS pattern), L3 ECU family
(`ecu_families[]`, the supplier+part+software tuple —
`family::match_family`), L4 This vehicle (local DB, overrides everything
above).

---

## 4. Knowledge map format

`packages/uds-map/data/uds-map.json` is currently **schema v9**
(`version: 9`, `generated: 2026-08-28` — see the file's own top-level
`note` field for the full migration history). The frozen contract for the
Rust runtime is documented in `apps/desktop/src-tauri/src/elm/uds_map.rs`'s
own header comment and, in full, in `docs/uds/pack-schema-v9.md`. A
researcher filling in findings needs these fields:

- **`Source`** — required on every module, band, known DID, family,
  identity block, platform and gateway rule:
  ```json
  { "url": "https://…", "date": "2026-08-23", "type": "open_implementation", "licence": "MIT", "note": "optional" }
  ```
  `type` is one of `oem` · `open_implementation` · `tool_screen` ·
  `parts_catalog` · `community` · `project_capture`. `licence` is the
  audited SPDX id/expression, `NOASSERTION` when unclassified,
  `unlicensed` when no permission was found. A `RESEARCH.md`-only citation
  uses `url: "packages/uds-map/RESEARCH.md#<anchor>"`, `type: community`.
- **`did_bands[]`** — a `{from, to, note, confidence, source}` range,
  documenting where a module keeps live data before individual DIDs inside
  it are decoded.
- **`known_dids[].decodes[]`** — the actual per-value decode, v9 shape:
  ```json
  { "offset": 10, "len": 2, "signed": true, "encoding": "be", "scale": 0.1, "bias": 0, "unit": "A", "quantity": "current", "label": "HV battery current" }
  ```
  `encoding` is `be`/`le` (big/little-endian integer), `bcd` (packed
  decimal), `ascii` (string), or `bitfield` (`bit_offset`/`bit_len` inside
  the byte). `quantity` is a machine-readable tag (`speed`, `voltage`,
  `current`, `temperature`, `pressure`, `percentage`, `distance`, `time`,
  `power`, `energy`, `charge`, `flag`, `count`, `identifier`, `enum`,
  `angle`, `rotational_speed`, `volume`, `raw`). A DID can carry more than
  one `decodes[]` entry (multi-value payloads); the legacy scalar fields
  (`offset`/`len`/`scale`/`bias`/`unit` directly on the DID) are kept as a
  mirror of `decodes[0]` for older consumers — `pnpm lint:pack` fails if
  they disagree.
- **`known_dids[].modules`** (required) + **`binding`** — every known DID
  must be bound to exact `{req, resp}` address pairs, or explicitly carry
  `modules: []` with `binding: "unknown"`. There is **no unscoped
  fallback** in v9 — a module-scoped lookup returns nothing for an unbound
  DID; `known_did_unscoped` exists separately for browsing.
- **Confidence vocabulary** — `packages/uds-map/src/types.ts` defines
  `type Confidence = "confirmed" | "high" | "medium" | "low"` (checked
  directly in the source, not assumed). This is used both on `known_dids[]`
  entries and on the brand's own top-level `confidence` field. It is a
  **different vocabulary** from the one in `apps/desktop/src/lib/brand.ts`
  (`"high" | "medium-high" | "medium" | "low"`), which grades how sure the
  WMI→marque badge mapping is, not how sure a decode is — don't mix the
  two up when writing a finding.
- **`brands[].profiled_level`** — `standard_only` (no manufacturer routes)
  · `routes_sourced` (routes from open implementations/community tables) ·
  `routes_verified` (at least one route confirmed by a captured
  request/response) · `decodes_verified` (decodes confirmed on a vehicle by
  this project). `pnpm lint:pack` rejects a level the brand's `sources[]`
  can't support.
- **`ecu_families[]`** — the cross-brand reuse layer (protocol §2, L3): one
  entry per supplier/family/hardware+software reference tuple, with its own
  `decodes[]` (same shape as above) and `knowledge_state` per decode.

### One real, complete example (verbatim, `psa` brand, `known_dids[]`)

```json
{
  "did": "D400",
  "label": "Wheel speed rear-left",
  "modules": [{ "req": "6AD", "resp": "68D" }],
  "unit": "km/h",
  "offset": 0,
  "len": 2,
  "scale": 0.01,
  "bias": 0.0,
  "confidence": "confirmed",
  "evidence": "vehicle-verified on one C4 III (Continental ESP MK100, part 9846124980), 2026-08-27, sessions in apps/desktop/docs/workflows/parked-vehicle-verification.md; side and axle by cornering (right side faster in left turns, front leads mid-corner), scale by regression vs OBD speed (slope 99/km/h, n=93)",
  "source": {
    "url": "apps/desktop/docs/workflows/parked-vehicle-verification.md",
    "date": "2026-08-27",
    "type": "project_capture",
    "licence": "MIT",
    "note": "this project's own reads on one vehicle; evidence under apps/desktop/docs/workflows/evidence/"
  },
  "decodes": [
    {
      "offset": 0, "len": 2, "signed": false, "encoding": "be",
      "scale": 0.01, "bias": 0.0, "unit": "km/h", "quantity": "speed",
      "label": "Wheel speed rear-left"
    }
  ]
}
```

That's the shape a research finding should drop into — a `known_dids[]`
entry under the right brand, bound to the module(s) that answered it, with
a `source` and either `confidence: "confirmed"` (verified on a vehicle) or
one of `high`/`medium`/`low` (documentation-sourced, not yet verified here).

---

## 5. Brand coverage table

Generated by cross-referencing `packages/uds-map/data/uds-map.json` (21
group brands, the diagnostic-routing layer) with
`apps/desktop/src/data/wmi.json` (the generated per-marque badge table,
built by `pnpm wmi-table` from `uds-map.json` + the overlay source
`apps/desktop/src/data/wmi-marques.json`) and
`apps/desktop/src/components/emblems.tsx`'s `EMBLEMS` registry (34 keys with
real modeled 3D geometry, as of 2026-09-02). **38 distinct marque keys** exist in the current
`wmi.json`; 7 of them (`byd`, `chery`, `geely`, `jaguar`, `land-rover`,
`porsche`, `suzuki`) have a WMI/badge entry but **no `uds-map` brand
routing** (`brand: null` — no diagnostic profile at all, standard OBD-II
only). Grouped by manufacturer family, in `uds-map` group order; "did_bands
/ known_dids / decoded" are the **group brand's** totals (decodes aren't
marque-specific — Citroën, DS and Peugeot all read the same `psa` profile).

Numbers below are read directly from the pack via a script against the live
JSON, cross-checked against the generated `packages/uds-map/COVERAGE.md`
(itself built by `pnpm coverage` and CI-checked for staleness against the
same file).

| Marque | Group (`uds-map` id) | WMI codes | 3D emblem? | did_bands | known_dids (decoded) | Confidence | Notable existing decodes |
|---|---|---|---|---:|---:|---|---|
| **Stellantis Europe (PSA)** | | | | | | | |
| Citroën | `psa` | VF7, VR7 | yes | 11 | 33 (21) | high | wheel speed rear-left, battery voltage, HV battery state of charge |
| DS | `psa` | VR1 | nameplate | 11 | 33 (21) | high | (same `psa` decodes as Citroën/Peugeot) |
| Peugeot | `psa` | VF3, VR3 | yes | 11 | 33 (21) | high | (same `psa` decodes) |
| PSA (generic/unbadged) | `psa` | LPA, VS7, VS8 | nameplate | 11 | 33 (21) | high | see above — `psa` is the only `decodes_verified` brand in the map |
| Opel/Vauxhall (2017+, PSA platform) | `opel_psa` | VXE, VXK, W0V | nameplate | 4 | 3 (3) | medium | HV battery state of, HV battery voltage |
| **Stellantis North America (FCA)** | | | | | | | |
| Alfa Romeo | `fca` | ZAR | nameplate | 5 | 7 (5) | low | HV battery voltage/state, engine oil temp/pressure (RAM-sourced) |
| Fiat | `fca` | ZFA | yes | 5 | 7 (5) | low | (same `fca` decodes) |
| FCA (generic — Chrysler/Dodge/Jeep/RAM) | `fca` | 19 codes | nameplate | 5 | 7 (5) | low | (same) |
| **GM (incl. Opel/Vauxhall pre-2017)** | | | | | | | |
| GM (Chevrolet/Cadillac/GMC/Buick) | `gm` | 13 codes | nameplate | 4 | 5 (4) | low | tyre pressure, HV battery state of charge, engine oil life |
| Opel/Vauxhall (pre-2017, GM platform) | `gm` | W0L | yes | 4 | 5 (4) | low | (same `gm` decodes; same brand id as US GM, different marque badge) |
| **Volkswagen Group (VAG)** | | | | | | | |
| Audi | `vag` | TRU, WA1, WAU | yes | 15 | 31 (17) | high | HV battery pack voltage/current, absolute state, displayed SOC |
| Volkswagen | `vag` | WV1, WV2, WVW | yes | 15 | 31 (17) | high | (same `vag` decodes) |
| VW Group (generic) | `vag` | 9 codes | nameplate | 15 | 31 (17) | high | (same) |
| Škoda | `skoda` | TMB, TMK, TML, TMP | yes | 8 | 4 (0) | medium | none decoded yet — routes/identity sourced, zero decoded DIDs |
| SEAT | `seat` | VSS | yes | 6 | 4 (0) | medium | none decoded yet |
| Cupra | `cupra` | *(see note below)* | yes | 10 | 9 (5) | medium | (own `cupra` group; 5 decoded DIDs) |
| **BMW / Mini** | | | | | | | |
| BMW | `bmw` | 11 codes (incl. `WMW`/`WMZ`, real-world Mini codes) | yes | 6 | 16 (7) | medium | coolant temp (DME/alternate), transmission fluid temp, intake air temp |
| Mini | *(no distinct marque row — see §6)* | — | — | — | — | — | routed to `bmw` diagnostically; badge shows "BMW" |
| **Mercedes-Benz (incl. Smart)** | | | | | | | |
| Mercedes-Benz | `mercedes` | 11 codes | yes | 4 | 10 (7) | medium | wheel speeds (EQB), 12V aux battery voltage, HV battery coolant temp |
| **Renault-Dacia** | | | | | | | |
| Renault | `renault` | 8 codes | yes | 6 | 7 (5) | high | HV battery state of charge, 12V battery voltage (EVC), max charging power |
| Dacia | `renault` | UU1 | yes | 6 | 7 (5) | high | (same `renault` decodes) |
| **Nissan / Infiniti** | | | | | | | |
| Nissan | `nissan` | 17 codes | yes | 4 | 11 (5) | high | 12V battery voltage/current, motor power, vehicle speed (LBC module) |
| **Hyundai / Kia / Genesis** | | | | | | | |
| Hyundai | `hyundai_kia` | KMH, TMA | yes | 6 | 11 (9) | high | BMS SOC, BMS SOH, cell voltages 1–32 / 33–64 |
| Kia | `hyundai_kia` | KNA, KNE, U5Y | yes | 6 | 11 (9) | high | (same `hyundai_kia` decodes) |
| Hyundai/Kia (generic) | `hyundai_kia` | 14 codes | nameplate | 6 | 11 (9) | high | (same) |
| Genesis | *(no distinct marque row — see §6)* | — | — | — | — | — | uds-map brand name says "Hyundai / Kia / Genesis"; no separate WMI overlay found |
| **Ford / Lincoln** | | | | | | | |
| Ford | `ford` | 21 codes | yes | 8 | 18 (16) | medium | battery SOC, battery voltage/current/temperature (BCM) |
| **Toyota / Lexus** | | | | | | | |
| Toyota | `toyota` | 29 codes | yes | 4 | 11 (7) | high | HV battery SOC/pack voltage, max HV cell temperature |
| Lexus | *(no distinct marque row — see §6)* | — | — | — | — | — | uds-map brand name says "Toyota / Lexus"; no separate WMI overlay found |
| **Honda / Acura** | | | | | | | |
| Honda | `honda` | 20 codes | nameplate | 6 | 7 (**0**) | medium | **zero decoded DIDs** — routes/identity sourced only |
| Acura | *(no distinct marque row — see §6)* | — | — | — | — | — | uds-map brand name says "Honda / Acura"; no separate WMI overlay found |
| **Mazda** | | | | | | | |
| Mazda | `mazda` | 15 codes | nameplate | 7 | 13 (11) | medium | engine oil temp, transmission fluid temp, tyre pressure/temperature |
| **Volvo / Polestar** | | | | | | | |
| Volvo | `volvo` | 9 codes | yes | 1 | 2 (2) | medium | accelerator pedal position (Polestar-sourced), HV battery state of charge |
| Polestar | *(no distinct marque row — see §6)* | — | — | — | — | — | uds-map brand name says "Volvo / Polestar"; decodes partly Polestar-sourced already |
| **Subaru** | | | | | | | |
| Subaru | `subaru` | 7 codes | nameplate | 1 | 1 (**0**) | low | `standard_only` — no manufacturer routes in data yet |
| **Mitsubishi** | | | | | | | |
| Mitsubishi | `mitsubishi` | 11 codes | nameplate | 1 | 0 (0) | low | `standard_only` — enhanced diagnostics reachable but unprofiled (protocol §5) |
| **Tesla** | | | | | | | |
| Tesla | `tesla` | 5 codes | yes | 0 | 0 (0) | high (negative finding) | `standard_only` — no request/response server on OBD-port addresses (§6) |
| **Badge-only, no `uds-map` routing (`brand: null`)** | | | | | | | |
| Porsche | *(none)* | WP0, WP1 | **yes (accepted)** | — | — | — | emblem accepted 2026-09-02: the 2026-08-30 mirrored/backward defect was a face-down export, fixed by a half-turn about X baked into the `.glb`; still no diagnostic profile |
| Jaguar | *(none)* | SAJ | **yes (accepted)** | — | — | — | emblem accepted 2026-09-02: re-meshed solid leaper replacing the flat shell, same baked orientation fix; still no diagnostic profile |
| Suzuki | *(none)* | JS2 | **nameplate (excluded)** | — | — | — | source geometry genuinely broken (torn edges, bowed face); `.glb` removed, not just unregistered; needs re-sourcing from a clean batch |
| Land Rover | *(none)* | SAL | **yes (accepted)** | — | — | — | emblem accepted 2026-08-30; still no diagnostic profile |
| BYD | *(none)* | LGX | yes | — | — | — | badge + emblem only, no diagnostic profile |
| Chery | *(none)* | LVV | yes | — | — | — | badge + emblem only, no diagnostic profile |
| Geely | *(none)* | LB3 | yes | — | — | — | badge + emblem only, no diagnostic profile |

**Cupra's WMI note.** `uds-map.json`'s `cupra` brand entry claims WMI `VSS`,
the same code `seat` claims. This is not a routing bug: `wmi-table.ts`'s
shared-WMI tie-break deliberately resolves it to `seat` (documented at the
tie-break site and in `cupra`'s own `sources[]` note, added 2026-08-30) —
SEAT's `VSS` is well-established, Cupra's is an unverified analogy (same
Martorell plant) that doesn't hold for the Born, built at VW Zwickau and
possibly on a different code entirely. Cupra's emblem is reachable today
only via a `?brand=` dev override, not from a real VIN. **The actual fix
is research, not code**: a real Cupra Born VIN and a real Cupra Formentor
VIN (`RESEARCH.md` §4/§8 item 1) — the single cheapest high-value target in
the whole file, and squarely in scope for this pass.

---

## 6. Known gaps and good next targets

**Zero or thin `known_dids` (highest-value research targets):**
- **Honda** — 7 known DIDs, **0 decoded**. Routes and the identity block are
  sourced (`routes_sourced`, medium confidence) but nothing has a `decodes[]`
  entry. 20 WMI codes route here (Honda + implicitly Acura).
- **Škoda** and **SEAT** — 4 known DIDs each, **0 decoded**, both `vag`-group
  siblings that inherit VAG's routes but have no brand-specific decode work
  yet. **SEAT has a first full research pass already** — see
  `docs/product/research/seat-deep-research-v1/` (README.md there explains
  its own scope). It's a staged research/import inbox, not a merge: 10
  platform branches, 86 VAG route candidates + 12 exact Mii-electric route
  overrides, 251 candidate DIDs (route/DID/decoder tracked as three
  independent knowledge states, not one confidence number), 7 ECU-family
  hypotheses, 28 graded sources, and its own conflicts-and-gaps and
  validation-plan files. Its own merge rule is explicit:
  `merge_mode: "additive_only"`, never overwrite `locally_confirmed` or
  stronger project evidence, and defers DID/decoder promotion to physical
  validation on a prioritized fleet (Leon 5F, Ibiza KJ, Leon KL, Arona,
  Ateca, Mii electric, Ibiza 6J) it also lays out. Nothing from it has been
  merged into `uds-map.json` yet.
- **Subaru** — `standard_only`; only 1 known DID (unbound, `binding:
  "unknown"`), 0 decoded. No manufacturer routes in the map at all.
- **Mitsubishi** — `standard_only`, literally zero known DIDs, zero modules.
  Per the discovery protocol (§5) this is explicitly *not* the same as
  "adapter limited" — enhanced diagnostics (engine `7E0/7E8`, ETACS
  `753/754`, MUT-III) are reachable through the connector, they're just
  unprofiled. A good target if someone owns or can borrow a Mitsubishi.
- **Tesla** — `standard_only` by design, not by gap: the pack's own note
  (`uds_map.rs`'s brand table, "adapter-path limited") records that Model
  3/Y expose only cyclic broadcast frames with no request/response server on
  standard OBD-port addresses — two independent DBC reverse-engineering
  projects agree on this. Not a research target in the usual sense; a
  finding here would be "which frames are on the bus" (DBC-style), not UDS
  DID decodes.

**Brands with WMI recognition but literally no `uds-map` entry** (badge/
emblem only, standard OBD-II diagnostics only): **Porsche, Jaguar** (3D
emblems accepted 2026-09-02; both earlier rejections were a face-down export,
now corrected by a half-turn baked into the `.glb`, and Jaguar is a re-meshed
file), **Suzuki** (still excluded: its source geometry is broken, so the
asset needs re-sourcing, which is a separate task from the diagnostic
research), **Land Rover** (emblem accepted, no diagnostic profile), **BYD,
Chery, Geely** (emblem present, no diagnostic profile). The emblem work
changes none of the diagnostics. Any of these seven is a from-scratch brand: no
`did_bands`, no `known_dids`, no identity block beyond the ISO default.

**Marque badges that don't exist yet despite the group brand covering them.**
The `uds-map` brand *names* explicitly mention sub-marques that have no
separate row in `wmi-marques.json`/`wmi.json`: **Genesis** (under
`hyundai_kia`, name "Hyundai / Kia / Genesis"), **Mini** (under `bmw`, name
"BMW / Mini" — and BMW's own WMI list already contains `WMW`/`WMZ`, which
are real-world Mini manufacturer codes bucketed under the BMW badge),
**Lexus** (under `toyota`, name "Toyota / Lexus"), **Acura** (under `honda`,
name "Honda / Acura"), **Polestar** (under `volvo`, name "Volvo / Polestar" —
and some existing `volvo` decodes are already sourced from an
`OBDb/Polestar-2` fixture). These cars are diagnosed correctly today (they
inherit the group brand's routes and decodes), they just show the parent
brand's badge/name/emblem instead of their own. Adding a marque overlay row
for each is a data-only fix in `wmi-marques.json`, not a diagnostic-research
task — but worth doing alongside the brand research pass since the
identities are closely related.

**Specific "noted, not yet decoded" DID ranges** (bands where the map
records that data lives, with a source, but no per-DID decode exists yet —
these are cheap wins, the band is already narrowed):
- **PSA BSI configuration zone `2200–23FF`** — the band note explicitly
  lists sub-ranges: fuel tank `2201-2203`, **oil level `2205-2207`**,
  battery type `2333`, DPF type `232D`, SCR present `23D0`. Source:
  `arduino-psa-diag`'s `BMF.md` zone table (community, GPL-3.0), confidence
  `high`. None of these five sub-zones has a `known_dids[]` entry yet.
- **PSA BSI zone `2100-210F`** — "list/values zone pairs" (`2100` gauging
  list, `2101` gauging values including fuel and oil, `2102` maintenance
  list, `2103` maintenance values) — same source, confidence `high`, also
  undecoded. The band's own note says to read the list zone first to see
  what a given vehicle actually populates.
- **VAG MEB battery pack, individual cell data, `1850-1870`** (voltage) and
  `1821-1841` (temperature) — confirmed present on VW ID.4 and Cupra Born
  OBDb test fixtures, module `7E5/7ED` (legacy 11-bit address, not the newer
  extended-addressing `FC00` scheme), but the exact per-DID scale/offset was
  never extracted from the source. Same note appears verbatim on both `vag`
  and `cupra` brand entries.
- **PSA `D000-D0FF`** — flagged `confidence: low`, explicitly "NOT
  reproduced on this project's 2023 C4 (zero answers) and absent from
  arduino-psa-diag's BSI zone table" — a community claim contradicted by
  this project's own evidence. Worth confirming dead on a second PSA
  vehicle rather than researching further.

**Unbound known DIDs** (34 total across the map — the research names the
brand and often the decode formula, but not which module carries it, so
they sit with `modules: [], binding: "unknown"` and never label a live
sensor): vag (`2A0B`, `1E0E`, `1E0F`, `F40C`, `F41F`), bmw (`DEA7`, `DE84`,
`DEF5`, `DB99`), hyundai_kia (`F100`, `F110`), ford (`1E1C`, `1E12`,
`DE00`), gm (`00DF`, `006D`), fca (`B010`, `0121`, `022A`, `F132`), toyota
(`1F9A`, `106C`, `1F05`, `1074`, `1021`), honda (`F112`), mazda (`1310`,
`1E1C`, `61B1`, `0415`, `D901`), volvo (`EE6F`, `4028`), subaru (`F100`).
Source: `packages/uds-map/COVERAGE.md`'s generated "Unknown bindings"
section.

**Backend maturity note, for context.** `docs/product/multi-brand-audit.md`
(v1.1, 2026-08-28, audited against `main` @ `1174bb3`) found the multi-brand
plan mostly "Red" — brand names compiled into Rust, a PSA-shaped schema,
single-car test evidence. Reading the actual code on *this* branch shows
real progress against that audit's six criteria since then: the pack is
schema v9 with `ecu_families[]`, per-module `read_service`, `identity_block`
and `source` on every entry; `builtin_modules()`/hardcoded PSA plan targets
are gone (`plan::plan_version` and `plan::generate` are fully data-driven);
`join.rs` has a real second-brand test fixture
(`join::fixtures::seed_second_brand`); and `packages/uds-map/COVERAGE.md` is
now the generated, CI-checked scoreboard the audit's success criterion S5
asked for. This brief's brand table (§5) is built from that same generated
data. Whether the audit's other criteria (S1 no brand names in code, S3
multi-brand replay fixtures, S6 brand-neutral product surfaces) are now
green was **not independently re-verified for this brief** — that would need
its own read-only sweep the way the audit did it, not a brand-research pass.

---

## 7. How to contribute a finding back

1. **Edit `packages/uds-map/data/uds-map.json` directly.** Find the brand by
   `id` under `brands[]`. Add or extend a `known_dids[]` entry with the
   shape shown in §4 — `modules` (bound address pairs, or `[]` +
   `binding: "unknown"` if the research doesn't say which module), a
   `source` object, a `confidence` (`confirmed` only once verified on a
   vehicle; `high`/`medium`/`low` for documentation-sourced claims not yet
   tried on a car), and a `decodes[]` array (can hold more than one value
   per DID). For a brand-wide fact (a `did_bands[]` range, a
   `read_service`, an `identity_block`, a `platforms[]` entry, a
   `gateway_behaviour`), the same `source`/`confidence` discipline applies —
   see `docs/uds/pack-schema-v9.md` §2 for every field's exact shape.
2. **Run `pnpm lint:pack`** (from `packages/uds-map`) before committing. It
   fails on: a known DID with no module binding and no `binding: "unknown"`;
   any module/band/DID/family/platform/identity-block/gateway-rule missing
   a `source`; a known DID whose legacy scalar fields disagree with
   `decodes[0]`; a brand with no `profiled_level` or one its `sources[]`
   can't support (e.g. claiming `decodes_verified` without a
   `project_capture`-sourced decode); malformed decodes (a bitfield missing
   `bit_len`, an unrecognized `encoding`); a `vds_pattern` outside the
   shared regex subset; and brand names/ids appearing as literal tokens
   anywhere in `src/*.ts` outside tests and comments (brands are pack data,
   never code — `docs/uds/pack-schema-v9.md` §1 rule 1).
3. **Run `pnpm coverage`** (same package) to regenerate
   `packages/uds-map/COVERAGE.md` — the per-brand scoreboard used to build
   §5/§6 above. `pnpm coverage:check` is the CI-safe version that fails
   instead of writing, for verifying the file isn't stale.
4. **Run `pnpm wmi-table`** (mentioned in `apps/desktop/src/lib/brand.ts`'s
   header comment) to regenerate `apps/desktop/src/data/wmi.json` from
   `uds-map.json`'s `brands[].wmi[]` plus the marque overlay in
   `apps/desktop/src/data/wmi-marques.json` — needed after adding a new WMI
   code, a new brand, or a new marque overlay row (e.g. adding the missing
   Genesis/Mini/Lexus/Acura/Polestar marque rows discussed in §6).
   `pnpm wmi-table:check` is the CI-safe check variant.
5. **Run `pnpm test`** (vitest, in `packages/uds-map`) — it asserts
   `lintPack()` comes back empty and that `COVERAGE.md` matches the
   generator's output, so a stale coverage file or a lint violation fails
   the suite, not just CI.
6. `cargo test` in `apps/desktop/src-tauri` exercises the Rust side of the
   same map (`uds_map.rs`, `discovery/*`) — run it if the finding touches
   anything the Rust runtime reads (routes, read services, identity blocks,
   `ecu_families`), since the TypeScript and Rust sides are two consumers of
   the one JSON file by design (`uds_map.rs`'s own header: "same file, two
   consumers, zero drift by construction").

No other regeneration or validation script referencing `uds-map` was found
in any `package.json` across the monorepo (checked the root, `apps/desktop`,
and `packages/uds-map` — the root `package.json` only delegates to `turbo`).
