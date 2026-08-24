# Car Scanner benchmark and Scainner capability gap

Status: competitor capability map
Reviewed: 2026-08-24
Competitor: Car Scanner ELM OBD2
Inputs: official store/product information and user-provided screenshots running demo data

Related:

- [Diagnostic intelligence product](./diagnostic-intelligence.md)
- [Implementation plan](./diagnostic-intelligence-implementation-plan.md)

## Purpose

This document maps what Car Scanner appears to do, where Scainner currently stands, and which capabilities Scainner should adopt without copying Car Scanner's interface.

The screenshots reviewed here use **demo data, not a live Citroën scan**. They reveal interface concepts, shipped configuration, and intended scanning strategies. They do not prove that any displayed ECU exists on the user's Citroën, that Car Scanner can reach it, or that the displayed readiness values came from a real ECU.

## Evidence levels

Every competitor capability in this document uses one of three evidence levels:

- **Observed in demo:** visible in the screenshots, but not verified against a real vehicle.
- **Officially claimed:** stated by Car Scanner in its official App Store listing or website.
- **Hardware verified:** reproduced on a real vehicle and adapter. Nothing from the reviewed screenshots reaches this level.

This distinction prevents a polished demo or broad marketing statement from becoming an assumed technical capability.

## Car Scanner product surface

### Standard OBD scanning

Officially claimed capabilities include:

- Connect through compatible ELM327 Bluetooth Low Energy or Wi-Fi adapters.
- Read and reset DTCs.
- Show a large local database of DTC descriptions.
- Read freeze-frame data.
- Read Mode 06 on-board monitoring results.
- Read emissions readiness.
- Show all supported standard sensors.
- Display live gauges and charts.
- Create custom dashboards.
- Act as a trip computer and calculate fuel consumption.

Source: [official App Store listing](https://apps.apple.com/us/app/car-scanner-elm-obd2/id1259933623).

### Enhanced and manufacturer-specific data

Car Scanner officially claims:

- Custom extended PIDs.
- Brand/vehicle connection profiles providing additional features.
- Extra profiles for a broad list of manufacturers.
- Some VAG coding capability on supported MQB/PQ26 vehicles.

Its listing correctly notes that an application cannot expose sensors an ECU does not provide and that adapter quality materially affects connection stability.

These are product claims until tested against matching vehicles and adapters.

### Monetization

Car Scanner exposes a broad free feature set and offers Pro through subscriptions or a low-cost lifetime purchase. Its US iOS listing currently shows a lifetime option around $7.99, alongside shorter subscriptions.

This makes Car Scanner a difficult competitor on raw scanner price. Scainner should not attempt to charge consumers merely to see standard codes or ordinary live data. Scainner's paid value must be the diagnostic investigation and report.

## What the demo screenshots show

### Candidate ECU/module catalog

The demo exposes a selectable list of possible modules for a chosen brand, including:

- OBD-II.
- Multiple possible engine control units.
- Multiple possible transmission control units.
- BSI/body controller.
- ABS.
- SRS/airbag.
- Power steering.
- Comfort systems.
- Key reader.
- Parking system.
- Radio/GPS facade.
- Engine relay unit/BSM.
- Climate control.
- Instrument cluster/dashboard.
- Steering-wheel controls.
- Voltage-maintenance device.
- TPMS.
- Telematics/navigation.
- Other possible body and multimedia systems.

The explanatory copy says the list contains supported module candidates for the selected brand and that selecting all candidates lets the app detect which units actually exist.

Evidence level: **observed in demo**.

This reveals a likely product model:

```text
Selected brand/profile
  → predefined candidate-module catalog
  → module-specific probe strategies
  → responding modules retained
  → identifiers/faults read
```

It does not establish which modules the application can successfully reach on a real vehicle.

### Automatic and advanced DTC modes

The demo shows two top-level choices:

- Automatic, recommended.
- Advanced.

Advanced mode exposes multiple levels of scan aggressiveness. The highest visible level claims to use:

- Multiple read/clear command sets.
- Functional addressing.
- Common non-standard addresses.
- An extended-diagnostics session before DTC commands.

The UI warns that this strategy is not recommended for several vehicle families, including VAG, Renault/Nissan/Dacia, newer Hyundai/Kia, and Dodge.

Evidence level: **observed in demo**.

This is important architecture evidence: a universal product needs manufacturer/platform-specific scan strategies. It cannot safely send one broad command sequence to every car.

### Fault-state options

The demo exposes options to:

- Include archived/non-active DTCs.
- Include diagnostic states related to incomplete tests.

It strongly warns that incomplete tests do not mean a malfunction exists.

Evidence level: **observed in demo**.

This supports Scainner's planned distinction between genuine fault observations and diagnostic status records such as:

- Active/test failed.
- Pending.
- Confirmed.
- Permanent.
- Historical/archived.
- Test not completed.
- Warning indicator requested.
- Unknown status.

### Readiness and emissions tests

The demo presents two scopes:

- Status since DTC reset.
- Current drive-cycle status.

It includes monitors associated with both spark- and compression-ignition vehicles:

- Misfire.
- Fuel system.
- Components.
- Catalyst and heated catalyst.
- Evaporative system.
- Secondary air.
- Oxygen sensor and heater.
- EGR/VVT.
- NMHC catalyst.
- NOx/SCR.
- Boost pressure.
- Exhaust gas sensor.
- PM filter monitoring.
- A/C refrigerant.

Evidence level: **observed in demo**.

The displayed fixture contains confusing combinations such as unsupported monitors with a completion value and inconsistent red/green semantics. Because this is demo data, it is not evidence of incorrect ECU decoding. It is evidence that the presentation can be confusing.

## What the screenshots do not prove

They do not prove:

- Real module discovery on the user's Citroën.
- Successful communication with any listed module.
- Exact PSA request/response addresses.
- Correct ECU identification.
- Real stored, pending, archived, or extended fault results.
- Real enhanced sensor definitions.
- Formula correctness.
- Live manufacturer-specific polling.
- Report or explanation quality.
- Scan reliability or duration.
- Correct teardown after an extended diagnostic session.
- Actual iOS hardware behavior with the user's adapters.

Those questions require a controlled real-car comparison.

## Current Scainner position

### Areas where Scainner is already strong

#### Interface and information design

Scainner currently has the stronger product direction for:

- A calm, modern diagnostic workspace.
- Progressive disclosure rather than long technical checklists.
- Separating standard Live data from experimental Lab functions.
- Showing stored, pending, and permanent codes as meaningful groups.
- Verified before/after clearing.
- Vehicle-scoped history.
- Clearer tables, navigation, and bilingual presentation.
- Avoiding unsupported severity scores.
- Building toward evidence-backed reports rather than generic health labels.

This UX direction should be preserved.

#### Safety and provenance

Scainner already includes important controls:

- Full sensor sweeps are manual.
- Discovered UDS probes are vehicle-scoped.
- Discovered probes are not automatically turned into background polling.
- Known DIDs are matched using module applicability and response shape.
- Discovery tears modules down to a default session.
- Scanning can abort when the engine starts unexpectedly.
- Writes are explicitly confirmed and logged with before/after state.

#### Evidence history

Scainner stores:

- Connections.
- Standard readings.
- Standard DTC scans.
- Freeze frames.
- Write history.
- Discovered modules and DIDs.
- Vehicle-scoped probes.
- Local history with optional Supabase synchronization.

That longitudinal, auditable data foundation is strategically valuable.

### Areas roughly comparable in concept

Both products expose or intend to expose:

- Standard DTC reading and clearing.
- Standard live data.
- Freeze frames.
- Readiness.
- Manufacturer profiles/modules.
- Extended PID/DID concepts.
- Custom or discovered parameters.
- Multiple vehicle support.

Actual comparative depth cannot be determined from demo screenshots.

### Areas where Scainner is currently behind the demonstrated product surface

#### Manufacturer diagnostic profiles

Scainner has a growing address/DID map, but it does not yet have a complete profile abstraction containing:

- Candidate modules per platform.
- Probe order.
- Identification commands.
- Diagnostic-session requirements.
- DTC service variants.
- Known unsupported or unsafe strategies.
- Status decoding rules.
- Readiness layout.
- Known sensors and formulas.
- Teardown behavior.

This is the largest capability worth adopting.

#### Full-vehicle module scan UX

Scainner currently separates standard Diagnose from manual module-fault reads in Lab. It does not yet provide one complete scan that:

- Chooses applicable module candidates.
- Probes them safely.
- Records which responded.
- Reads faults from each responding module.
- Preserves partial failures.
- Produces an honest coverage summary.

#### Unified module fault history

UDS/module faults currently do not enter the same durable history, classification, detail, and AI-report pipeline as standard OBD faults.

#### UDS DTC status decoding

Scainner currently preserves UDS records largely as code-like strings. It needs to decode status flags into meaningful fields and keep subtype/status bytes separate.

#### Complete readiness decoding

Scainner's current readiness path is oriented toward spark-ignition monitors. It needs correct compression-ignition selection and support for diesel-specific monitors.

#### Adapter/mobile transport coverage

The desktop app's current classic-Bluetooth/macOS transport is not an iOS transport. A consumer mobile product needs tested BLE, Wi-Fi, or appropriate MFi-compatible adapter support plus Android Bluetooth support.

## Capabilities Scainner should adopt

### 1. Manufacturer diagnostic profiles

Add a versioned profile above the existing DID map:

```text
ManufacturerDiagnosticProfile
  applicability
  candidate modules
  probe order
  addressing
  identification commands
  session requirements
  DTC read strategies
  DTC status mapping
  unsupported/risky strategies
  readiness layout
  known sensors
  teardown rules
  sources and confidence
```

This is not a license to copy Car Scanner's proprietary data. It is the architecture Scainner needs for independently sourced, validated coverage.

### 2. Automatic full-vehicle scan

Provide one guided action:

> Scan vehicle

Internally it can:

1. Identify the vehicle and adapter.
2. Select an applicable diagnostic profile.
3. Check voltage and ignition conditions.
4. Scan standard OBD.
5. Probe high-confidence module candidates.
6. Read faults from responding modules.
7. Preserve failures and unsupported states.
8. Restore any diagnostic sessions.
9. Produce a coverage summary.

Advanced users can inspect or target modules, but drivers should not select among Engine ECU #1–#4.

### 3. Honest scan coverage

Show the result as:

```text
18 module candidates checked
12 modules identified
10 scanned successfully
2 identified but did not support the requested fault service
4 did not respond
2 skipped by this vehicle profile
```

Then list the real modules and their evidence.

### 4. Complete fault-state model

Separate:

- Actual faults.
- Historical faults.
- Incomplete monitor/test states.
- Unsupported statuses.
- Unknown raw observations.

The consumer report should not call an incomplete test a malfunction.

### 5. Correct readiness model and UX

Decode the correct spark/compression monitor layout, then present only meaningful combinations:

```text
Since codes were cleared
  Supported and complete
  Supported and incomplete
  Not supported by this vehicle

Current drive cycle
  Supported and complete
  Supported and incomplete
  Not supported by this vehicle
```

Do not display completion for unsupported monitors.

### 6. Technical mode without technical clutter

Preserve Scainner's progressive disclosure:

- Default: identified systems, faults, evidence, and coverage.
- Expand module: ECU identity, addresses, services, raw response, and errors.
- Lab/advanced: targeted probing, raw DID experiments, profile inspection.

## Capabilities Scainner should not copy

- Long lists of every possible module as the default experience.
- Asking ordinary users to choose ECU variants manually.
- Combining read and clear configuration into one ambiguous flow.
- Exposing scan aggressiveness without a profile-driven recommendation.
- Treating red/green as the only explanation of a multi-dimensional status.
- Displaying unsupported monitor completion.
- Presenting profile support as proof that a module exists on the connected vehicle.
- Making users interpret internal diagnostic commands before they can scan.

## Proposed Scainner experience

### Consumer

```text
Connect
  → Scan vehicle
  → Watch real systems become identified
  → See modules reached and coverage limitations
  → See factual codes and definitions for free
  → Add symptoms/context
  → Purchase evidence-backed diagnostic report
```

### Workshop

```text
Connect
  → Quick or complete scan
  → Review coverage and module results
  → Add mechanic hypothesis
  → Run guided measurements
  → Confirm/challenge possible causes
  → Export technical and customer reports
```

Both use the same scan and evidence engine.

## Controlled real-vehicle benchmark

The next competitor test should use the same real vehicle, ignition conditions, and comparable adapter capabilities. Do not clear codes during the comparison.

Capture:

| Measurement | Car Scanner | Scainner |
|---|---:|---:|
| Connection time | | |
| Vehicle identity | | |
| Candidate modules attempted | | |
| Modules identified | | |
| Modules successfully scanned | | |
| Partial failures explained | | |
| Stored faults | | |
| Pending faults | | |
| Historical/module faults | | |
| Status flags decoded | | |
| Standard sensors | | |
| Enhanced sensors | | |
| Freeze frames | | |
| Readiness interpretation | | |
| Export/report usefulness | | |
| Scan teardown/reconnection | | |

Test automatic mode first. Only test advanced modes after recording their exact commands, vehicle conditions, and warnings.

## Priority gap list

### P0 — diagnostic correctness

1. Unified diagnostic scan with phases and coverage.
2. Unified OBD/UDS fault observations.
3. UDS status decoding.
4. Spark/compression readiness correctness.

### P1 — coverage

5. Manufacturer diagnostic profile schema.
6. Profile-driven module probing.
7. Automatic full-vehicle scan with safe teardown.
8. Persisted module inventory and module fault history.

### P1 — diagnostic value

9. Mechanic/customer context.
10. Evidence-linked possible causes.
11. Guided sensor captures.
12. Paid diagnostic reports.

### P2 — platform expansion

13. Mobile adapter compatibility matrix.
14. iOS BLE/Wi-Fi/MFi transport.
15. Android Bluetooth Classic/BLE transport.

## Position summary

Scainner should not assume it already exceeds Car Scanner in raw manufacturer coverage. The reviewed demo does not prove Car Scanner's real coverage, but it shows a mature intended surface and several architectural concepts Scainner still needs.

Scainner's stronger direction is the experience above the scan:

- Honest coverage.
- Clean progressive disclosure.
- Vehicle and module provenance.
- Persistent evidence.
- Mechanic hypothesis confirmation and challenge.
- No fabricated severity.
- Reports that separate facts, possible causes, contradictory evidence, and next tests.

The goal is not to imitate Car Scanner's control-heavy UI. The goal is to match or exceed the useful diagnostic coverage underneath it while retaining Scainner's substantially clearer interface and building a more trustworthy diagnostic explanation layer.
