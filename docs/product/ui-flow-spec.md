# Scainner UI — flow schema and design specification

v1.0 · 2026-08-29 · for design review · brand-agnostic by construction

## 0. The one-line brief

One vehicle at a time, one step at a time. The person always knows *which car*, *what Scainner is doing to it*, and *what it learned* — and never sees a control that would act on the wrong car or claim a fact the evidence doesn't back.

## 1. Why the current UI has to change

What ships today is the research tool that discovered the method: **7 top-level views** (Workshop, Overview, Live, History, Diagnose, Lab, Vehicle), a Lab with **8 cards and ~15 action buttons** (auto-discovery, parked verification, guided correlation, DID reader, range scanner, module manager, probe manager, module faults), a "report" that is a Markdown export to paste elsewhere, and no login. It exposes the machinery, not the journey. The backend is now solid and data-driven (66 API routes; coverage, hypotheses, generated guided steps, parked plans, knowledge candidates), so the UI can become a thin, honest, stepped surface on top of it.

Three rules from the product and protocol docs apply directly:
- **Honest coverage, never "supported".** Every screen shows state with evidence, scope and what's missing.
- **Discovery is never a gate.** Every step is usable with whatever exists so far.
- **Live controls only for the connected car.** Browsing another vehicle is read-only.

## 2. The flow (schema)

Three stages, eleven steps. Each step is a screen (or a pair) with one primary action; the stepper is always visible; a step can be revisited; the app remembers where you were per vehicle.

```text
STAGE A — Get in                     STAGE B — Learn the car              STAGE C — Understand and act
A1 Login                             B1 Deep sensor scan                  C1 Scan errors
A2 Connect                           B2 Guided manual feedback            C2 AI report
A3 Scan (quick)                      B3 Learning drive (opt-in)           C3 Learn about this car
A4 Read data (live)                                                       C4 Car details (ask once)
```

### State machine

```text
[signed_out] --login--> [signed_in]
[signed_in] --connect--> [connecting] --ok--> [connected(vehicle)]
                                     --fail--> [connect_failed(reason)]
[connected] --auto S0..S3 (≤3 min, background)--> [connected + coverage(partial|automatic_scope_complete)]
[connected] --quick scan--> [scanned]           (A3: PIDs, DTCs, readiness, identity, coverage report)
[scanned]   --live--> [reading]                  (A4)
[scanned]   --deep scan (parked)--> [deep_scanned]   (B1: bounded sweeps, hypotheses)
[deep_scanned] --guided steps--> [correlated]         (B2: generated A→B→A steps)
[any connected] --learning drive on--> [learning]     (B3: cohort polling ≤20 % link)
[any] --errors--> C1 --report--> C2
[any] --car page--> C3 ; C4 is asked the first time a vehicle is created and whenever facts are missing
[connected] --disconnect / browse other vehicle--> [archive(vehicle)]  (read-only everywhere)
```

Vehicle-scoped: every step's data is for the *selected* vehicle; live actions exist only when `selected == connected` (already enforced by `liveEnabled`).

## 3. Screens, one by one

Each screen: purpose · primary action · what it shows · data (API route) · states · what it replaces.

### A1 Login
- **Purpose:** identity for sync, consent for data collection, subscription later.
- **Primary:** "Continue with email" (magic link) or provider button. One screen, no marketing.
- **Shows:** what Scainner stores locally vs. what is shared (one sentence each, link to details).
- **Data:** Supabase auth (already wired in `sync.ts` as opportunistic; becomes a gate).
- **States:** signed out · sending link · signed in · offline (allow local-only use with a banner: nothing syncs).
- **Replaces:** nothing; new.

### A2 Connect
- **Purpose:** get a live link to one car.
- **Primary:** "Connect". Secondary: "Choose adapter" (profile: serial / Wi-Fi ELM; adapters enumerated).
- **Shows:** adapter state as a single line ("Looking for adapter → waking → talking to the car"), the car as soon as its VIN resolves (brand emblem, WMI-derived brand, VIN-less fallback → "Name this car").
- **Data:** `POST /connect`, `GET /status`, `GET /adapters`, `GET|PUT /adapter`, events `conn-status`, `unknown-brand`.
- **States:** no adapter found (explain + "Choose adapter") · adapter but no car (ignition off?) · connected · unknown brand (callback → "We don't have a profile for this brand yet; standard diagnostics work, deep scan will be conservative").
- **Replaces:** the Connect button in the shell + the AccountSyncCard adapter bits.

### A3 Scan (quick)
- **Purpose:** the 60-second truth: standard OBD + identities + coverage. Runs automatically after connect; the screen is where you watch it.
- **Primary:** "Scan" (re-run). One button.
- **Shows:** a progress list with the protocol's stages as plain language: *Standard data · Modules found · Modules identified · Known sensors · Errors*; then the **coverage card** (§5).
- **Data:** the automatic sequence (S0–S3) already runs on connect; `GET /vehicles/{id}/coverage`, `GET /dtc/scan` result, `GET /vehicles/{id}/modules`.
- **States:** partial (short connection) · complete for scope · protocol not profiled · adapter limited · gateway limited — each with one sentence of what that means and what remains.
- **Replaces:** Overview's scan bits, AutoDiscovery card, the Vehicle evidence map's summary.

### A4 Read data (live)
- **Purpose:** watch the car. Standard PIDs plus every **enabled** decoded sensor, grouped by module.
- **Primary:** none (it's a display); per-sensor "pin"/"hide".
- **Shows:** gauges/sparklines; each manufacturer sensor carries its state pill (`verified on this car` / `inherited, untested` / `candidate`). Nothing unverified is shown as a number without its pill.
- **Data:** `GET /live`, `GET /readings`, `GET /probes`, events `live-update`.
- **States:** connected · archive (history only, no live) · learning drive on (traffic indicator).
- **Replaces:** Live + History (history becomes a time-range control on the same screen) + FuelCard.

### B1 Deep sensor scan
- **Purpose:** the bounded, parked, read-only sweep of unknown modules — the one "scan everything" button the Lab never had.
- **Primary:** "Deep scan" with the preconditions shown (parked, ignition on, ~N minutes, read-only). Optional "Extended (15/30/60 min)".
- **Shows:** the generated plan (targets, identifier ranges, estimated time) before running; during: per-module progress; after: *new hypotheses found* and what a learning drive or guided steps would resolve.
- **Data:** `GET /vehicles/{id}/parked-plan`, `POST /verification/parked`, `GET /vehicles/{id}/hypotheses`, event `uds-scan-progress`.
- **States:** needs preconditions · running (cancel) · done (n hypotheses, m modules) · nothing safe to sweep (profile says so).
- **Replaces:** ParkedVerification, RangeScanner, DidReader, ModuleManager (advanced) — one screen, one button; a small "Advanced" drawer keeps *read one identifier* and *add a module route* for research use.

### B2 Guided manual feedback
- **Purpose:** the human is the actuator. Full-screen steps generated from open hypotheses.
- **Primary:** "Capture" (one big button), then "Next".
- **Shows:** one instruction at a time ("Turn the steering wheel all the way to the left and hold it"), its precondition, a 3-count capture, and immediately after: *what changed* (byte moved / returned) in plain words — not hex, unless expanded.
- **Data:** `GET /vehicles/{id}/guided-steps`, `POST /verification/capture`, reference reads via `read-many`.
- **States:** no open steps (nothing to ask — good) · step needs a confirmation (gearbox unknown → ask, feeds C4) · capture failed (reference module unreachable) · session complete with candidates.
- **Replaces:** GuidedCorrelation card, ProbeManager's manual promotion (promotion becomes "Enable this sensor" on a confirmed candidate).

### B3 Learning drive (opt-in)
- **Purpose:** passive validation while driving; bounded traffic.
- **Primary:** toggle "Learning drive" with the cost stated ("adds a little diagnostic traffic; ≤ 20 %").
- **Shows:** which hypotheses are in the current cohort, what resolved after the drive.
- **Data:** `PUT /learning-state`, `GET /vehicles/{id}/hypotheses`.
- **States:** off · on (indicator in the header) · resolved list after a drive.
- **Replaces:** nothing; new (backend exists, UI never had it).

### C1 Scan errors
- **Purpose:** fault codes, standard and manufacturer, with honest status.
- **Primary:** "Scan errors"; secondary "Clear" behind a confirmation that shows before/after (already the backend contract).
- **Shows:** grouped codes, MIL, freeze frame, per-module UDS faults; each code with its source (standard / module) and status (stored, pending, permanent).
- **Data:** `POST /dtc/scan`, `GET /uds/modules/{key}/dtcs`, `POST /dtc/clear`, `POST /uds/clear`, `GET /dtc/history`.
- **States:** none found · found · cleared (verified) · refused (with NRC and a sentence).
- **Replaces:** Diagnose + ModuleFaults.

### C2 AI report
- **Purpose:** a plain-language interpretation of C1 plus the car's history, for the owner and for a mechanic.
- **Primary:** "Generate report". Today this is the Markdown export (`GET /vehicles/{id}/report`) handed to a model; the screen should already be built for the server-side version (report stored with the vehicle, versioned, re-generable) so the UI does not change when the backend does.
- **Shows:** two tabs — *For me* (what it means, drive or stop, cost band) and *For the workshop* (evidence, codes, readings, coverage scope). Every claim links to evidence.
- **Data:** `GET /vehicles/{id}/report`, `GET /cases` (diagnostic cases), coverage.
- **States:** no data yet · generated · stale (new scan since).
- **Replaces:** AiReportCard, Workshop's report parts.

### C3 Learn about this car
- **Purpose:** what Scainner knows about *this* car: identity, modules, sensors and their evidence, history.
- **Primary:** none; links into B1/B2 for the gaps.
- **Shows:** identity (VIN, brand, platform, the facts from C4), modules with fingerprints and family match, sensors by state, coverage scope/status, timeline of sessions.
- **Data:** `GET /vehicles/{id}`, `/modules`, `/coverage`, `/hypotheses`, `/evidence-map`, `/knowledge/candidates` (what this car taught the shared knowledge, de-identified).
- **States:** as coverage.
- **Replaces:** Vehicle view + VehicleEvidenceMap + parts of Overview.

### C4 Car details (ask once)
- **Purpose:** the facts we cannot read from the port.
- **When:** the first time a vehicle row is created (after A2), and again from C3 whenever a needed fact is missing; guided steps that depend on a fact (gearbox) ask inline and store the answer.
- **Ask, minimally:** model, model year, engine (from a short list derived from the brand/platform where the pack knows it, else free text), gearbox (manual / automatic / other), fuel/energy type, mileage. Prefill what the VIN gives (brand from WMI; platform where a VDS pattern exists; year where the VIN encodes it — many EU VINs don't).
- **Data:** `vehicles.make/model/year/trim` exist; add `engine`, `gearbox`, `energy`, `odometer_km`, `facts_source` (user/vin/pack) — a small schema addition.
- **Replaces:** the "name this vehicle" placeholder flow.

## 4. What to trim (with file names)

| Today | Decision |
|---|---|
| `views/Workshop.tsx` (report + picker) | Fold: picker → header switcher (already exists); reports → C2. Remove view. |
| `views/Overview.tsx` + `overview/*` (verdicts, fuel card/gauge) | Fold into A3 (coverage card) and A4 (fuel as a sensor). Remove view. |
| `views/Live.tsx`, `views/History.tsx` | Merge into A4 with a time-range control. |
| `views/Diagnose.tsx` + `diagnose/*` | Becomes C1 (+ C2 for `AiReportCard`). |
| `views/Lab.tsx` + `lab/AutoDiscovery.tsx` | Auto runs on connect; its progress lives in A3. Remove card. |
| `lab/ParkedVerification.tsx`, `lab/RangeScanner.tsx`, `lab/DidReader.tsx` | One B1 screen, one button; DID read + range scan go under an *Advanced* drawer. |
| `lab/GuidedCorrelation.tsx` | Becomes B2 full-screen. |
| `lab/ProbeManager.tsx` | Replaced by "Enable this sensor" on candidates (B2/C3) + a list in C3. |
| `lab/ModuleManager.tsx`, `lab/ModuleFaults.tsx` | Module routes come from the pack; adding one is Advanced in B1. Faults → C1. |
| `views/Vehicle.tsx` + `vehicle/AccountSyncCard.tsx`, `VehicleEvidenceMap.tsx` | C3 + settings (account in A1/Settings). |
| Nav (7 items, `advanced` flag) | Replaced by the 3-stage stepper + a Settings gear (account, adapter, language, learning drive). |
| `VehicleScene.tsx` 3D scene | Keep the emblem (cheap identity cue) only if it stays under 300 ms to first paint; otherwise drop. |

Keep as-is behind the scenes: the API, MCP, session script, all backend behaviour.

## 5. The coverage card (the product's honesty surface)

Appears in A3 and C3. Fixed lines, plain language, each line clickable to its evidence:

```text
Scope        ELM adapter · 11-bit CAN · read-only
Status       Quick scan complete · knowledge incomplete
Modules      5 answered · 1 refused · 2 silent (retry next time)
Identified   4 of 5 (part numbers read)
Sensors      12 verified on this car · 8 known from similar cars (untested) · 41 unknown
Next         Deep scan (≈ 4 min parked) · 6 guided steps · learning drive would test 8
```

Never the word "supported"; never a count without its scope.

## 6. Design principles for the visual pass

1. **Stepper, not tabs.** Three stages across the top, eleven steps as a left rail inside the stage; the current step is the whole screen.
2. **One primary action per screen**, large; everything else secondary or in an Advanced drawer.
3. **State pills everywhere a number appears**: `verified here` · `from similar cars` · `candidate` · `standard`. Same four colours app-wide.
4. **Progress is a list of sentences**, not a spinner: "Reading standard data ✓ · Finding modules 5/7 · Identifying…".
5. **Archive mode is visible**: a persistent banner and greyed primary actions when the selected car is not the connected one.
6. **Plain words first, bytes on demand**: hex, DIDs, NRCs live behind an expander on every row.
7. **Empty states teach**: what this step needs (parked, ignition on, a drive), how long, what it will and won't do.
8. **No brand in the UI logic**: the emblem, names and defaults come from the pack; demo data uses three brands.

## 7. Open questions for the design review

1. **Login before connect, or connect first and log in to sync?** Spec says login first (gate); the alternative is a local-only mode with a nag. Decide with the subscription model.
2. **How much of B (learning) to show a normal owner** vs. keep behind an "Advanced" switch. Proposal: B1 visible with a plain explanation; B2/B3 offered only when hypotheses exist.
3. **Report authorship**: "AI report" today = export; when server-side, does the workshop tab need a mechanic sign-off state?
4. **Car details**: ask at first connect (friction) or on first need (context)? Proposal: minimal at first connect (model, year, gearbox), the rest when a screen needs it.
5. **Mobile**: same flow, fewer steps (A1–A4, C1–C3); B stays desktop for now.

## 8. Data contract per screen (for engineering, one table)

| Screen | Reads | Writes | Events |
|---|---|---|---|
| A1 | session | login | — |
| A2 | `/status`, `/adapters`, `/adapter` | `/connect`, `/adapter`, `/vehicle/name` | `conn-status`, `unknown-brand` |
| A3 | `/vehicles/{id}/coverage`, `/modules`, `/dtc/history` | (auto sequence) | `discovery-progress` |
| A4 | `/live`, `/readings`, `/probes` | `/probes/{id}` enable | `live-update` |
| B1 | `/vehicles/{id}/parked-plan`, `/hypotheses` | `/verification/parked`, `/uds/scan` (advanced) | `uds-scan-progress` |
| B2 | `/vehicles/{id}/guided-steps` | `/verification/capture`, `/uds/read-many` (refs), `/hypotheses/{id}` | — |
| B3 | `/learning-state`, `/hypotheses` | `/learning-state` | `live-update` |
| C1 | `/dtc/history`, `/uds/modules/{k}/dtcs` | `/dtc/scan`, `/dtc/clear`, `/uds/clear` | — |
| C2 | `/vehicles/{id}/report`, `/cases` | `/cases` | — |
| C3 | `/vehicles/{id}`, `/modules`, `/coverage`, `/hypotheses`, `/evidence-map`, `/knowledge/candidates` | — | — |
| C4 | `/vehicles/{id}` | `/vehicles/{id}` (new fields) | — |

All routes exist today except the `vehicles` fact fields (C4) and a stored report (C2, later).
