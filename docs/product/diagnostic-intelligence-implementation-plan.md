# Diagnostic intelligence implementation plan

Status: proposed implementation sequence
Product direction: [Diagnostic intelligence product](./diagnostic-intelligence.md)
Primary market: independent mechanics and repair shops

Competitor input: [Car Scanner benchmark and Scainner capability gap](./car-scanner-benchmark.md)

## Objective

Build Scainner into a multi-brand diagnostic intelligence tool that can:

- Identify what a connected vehicle and adapter can expose.
- Scan standard and reachable manufacturer modules safely.
- Normalize fault observations from OBD and UDS into one evidence model.
- Capture the customer complaint and mechanic's initial diagnosis.
- Confirm, challenge, or refine the mechanic's hypothesis using collected evidence.
- Request the next useful question, inspection, or guided measurement when evidence is insufficient.
- Rank possible causes without presenting inference as fact.
- Produce professional technical and customer-facing reports.
- Expand manufacturer-specific coverage continuously and measurably.

Scainner is not intended to become workshop-management software. The existing diagnostic-case foundation may remain as an optional container for evidence and reports, but scanning and diagnostic intelligence are the product center.

## Current position

The project already has:

- ELM/STN connection handling and recovery.
- Standard OBD fault scanning.
- Stored, pending, and permanent fault separation.
- Freeze frames, readiness, voltage, and standard sensors.
- Manual sensor and module discovery foundations.
- UDS module reading and fault access.
- Safe read/write separation and verified fault clearing.
- Vehicle-scoped local history and Supabase synchronization.
- A small offline DTC knowledge library.
- Initial AI-generated reports.

The main architectural gap is fragmentation. Standard faults, UDS faults, discovered sensors, mechanic context, live history, and AI reports do not yet form one traceable diagnostic evidence system.

Estimated position:

- Approximately 35–40% of a convincing workshop diagnostic MVP.
- Approximately 15–20% of the long-term “one device, virtually every car, best available enhanced data” ambition.

A credible workshop beta is approximately 10–16 focused development weeks, followed by a continuous manufacturer-coverage program.

## Principles

1. **Diagnostic truth before AI prose.** Normalize and preserve evidence before adding agent reasoning.
2. **Mechanic expertise is evidence.** Capture the technician's hypothesis and test it; never automatically accept or discard it.
3. **Partial success is valid.** A scan can be useful when one module fails, provided coverage and failure are visible.
4. **Coverage must be honest.** An engine-only emissions scan is never called a complete vehicle scan.
5. **Unknown stays unknown.** A responsive DID or manufacturer code is not assigned a meaning without applicable evidence.
6. **Local first.** Vehicle evidence and versioned local knowledge precede online research.
7. **Every conclusion is auditable.** Preserve provenance, applicability, confidence, contradictory evidence, and report versions.
8. **Read safety remains the default.** Discovery and diagnostic reasoning do not silently expand into writes, coding, or actuator control.

## Milestone 0 — Recenter the product

Duration: 1–2 days.

### Goal

Preserve recent work without allowing workshop administration to become the main experience.

### Work

- Return the scanner dashboard to the primary starting experience.
- Keep Workshop/diagnostic cases secondary or dormant for now.
- Define stable product terms:
  - Diagnostic scan
  - Scan phase
  - Scan coverage
  - Fault observation
  - Evidence item
  - Technician hypothesis
  - Guided test
  - Diagnostic assessment
  - Technical report
  - Customer report
- Decide when the pending Supabase diagnostic-case migration should be applied.

### Exit criteria

- Navigation and language describe Scainner primarily as a scanner and diagnostic tool.
- New features are designed around scan evidence, not repair-order administration.

## Milestone 1 — Unified diagnostic scans

Duration: 2–3 weeks.

### Goal

Create one durable scan record containing everything attempted, found, skipped, or failed.

### Domain model

```ts
type DiagnosticScan = {
  id: string
  vehicleId: number | null
  connectionId: number
  startedAt: string
  completedAt: string | null
  mode: "quick" | "complete" | "targeted"
  ignitionState: "unknown" | "off" | "on" | "engine_running"
  batteryVoltage: number | null
  phases: ScanPhaseResult[]
  coverage: ScanCoverage
}

type ScanPhaseResult = {
  phase: string
  module?: ModuleIdentity
  status: "completed" | "unsupported" | "failed" | "skipped" | "safety_aborted"
  startedAt: string
  completedAt: string
  error?: ScannerError
}
```

### Typed scanner errors

Replace free-form backend strings at the application boundary:

```ts
type ScannerError = {
  kind:
    | "adapter_unavailable"
    | "transport_timeout"
    | "ecu_no_response"
    | "unsupported_service"
    | "malformed_response"
    | "protocol_mismatch"
    | "engine_started"
    | "safety_abort"
    | "cancelled"
  stage: string
  module?: ModuleIdentity
  command?: string
  retryable: boolean
  recoveryActions: string[]
  rawDetail?: string
}
```

### Scan modes

**Quick scan**

- Vehicle identity.
- Adapter and supply-voltage health.
- Standard emissions faults.
- Known high-value modules when safe and supported.

**Complete scan**

- Vehicle identity and ECU capability inventory.
- Standard faults.
- Known manufacturer modules.
- Evidence snapshots.
- Honest coverage summary.

**Targeted scan**

- One selected module or diagnostic system.

### Exit criteria

- A failed ABS read does not erase a successful engine scan.
- Unsupported, failed, skipped, and unattempted are distinguishable.
- Progress reflects real backend phases rather than cycling phrases.
- Every result belongs to the correct vehicle and connection.
- Raw diagnostic detail is available for debugging without overwhelming normal UI.
- Scan coverage cannot be overstated.

## Milestone 2 — Unified fault observations

Duration: 2–3 weeks.

### Goal

Route standard OBD and UDS/module faults into one history, classifier, and reporting path.

### Domain model

```ts
type FaultObservation = {
  id: string
  scanId: string
  vehicleId: number | null
  source: "obd" | "uds"
  protocol: string
  service: string
  module: ModuleIdentity
  rawCode: string
  normalizedCode: string | null
  rawBytes: string | null
  status: {
    stored?: boolean
    pending?: boolean
    confirmed?: boolean
    permanent?: boolean
    testFailed?: boolean
    warningRequested?: boolean
    intermittent?: boolean
  }
  observedAt: string
  freezeFrameId: string | null
  voltage: number | null
  rpm: number | null
  engineState: string | null
  decoderVersion: string
  knowledgeProvenance: string | null
}
```

### Work

- Decode UDS DTC status bits instead of keeping them as opaque suffixes.
- Separate extended/subtype bytes from status information.
- Store module faults in the main diagnostic database.
- Show module faults in Diagnose and History.
- Keep identical codes from different modules distinct.
- Compute first seen, last seen, recurrence, and return-after-clear behavior.
- Associate freeze frames and operating conditions with the correct observation.
- Correct compression-ignition/diesel readiness interpretation.
- Clarify permanent-fault behavior in clear-code UX.

### Exit criteria

- A BSI, ABS, engine, or transmission fault can appear in one unified scan.
- Every code retains the ECU that produced it.
- Repeated scans create an accurate fault timeline.
- Before/after clearing is auditable.
- Cross-vehicle leakage is prevented by schema constraints and tests.

This is the highest-priority technical milestone.

## Milestone 3 — Mechanic context and evidence capture

Duration: 2–3 weeks.

### Goal

Combine what the car reports with what the customer and mechanic actually experienced.

### Context intake

Capture:

- Customer complaint in their own words.
- Technician interpretation.
- Conditions when the problem occurs.
- Cold/warm engine state.
- Idle, acceleration, braking, cornering, cruise, or load conditions.
- Constant versus intermittent behavior.
- Recent repairs or battery events.
- Noise, smoke, odor, vibration, starting behavior, and power loss.
- Tests already performed and external measurements.

### Technician hypotheses

```ts
type DiagnosticHypothesis = {
  id: string
  proposedBy: "technician" | "agent"
  candidateCause: string
  status: "proposed" | "accepted" | "rejected" | "confirmed"
  confidence: "low" | "moderate" | "high"
  supportingEvidenceIds: string[]
  contradictingEvidenceIds: string[]
  missingEvidence: string[]
  nextTestId: string | null
}
```

The system evaluates the technician's hypothesis rather than replacing it. It must show supporting evidence, contradictory evidence, missing evidence, and the next discriminating test.

### Guided sensor captures

Create initial templates for:

- Charging and supply voltage.
- Warm-idle fuel control.
- Misfire investigation.
- Airflow and boost.
- Cooling performance.
- Lambda/O₂ and catalyst behavior.
- Wheel-speed comparison.
- Rail-pressure behavior.

Each template specifies required sensors, operating conditions, duration, sample rate, safety guidance, and completeness checks.

### Exit criteria

- A complaint and technician hypothesis can be captured before or after scanning.
- Relevant sensor data is recorded under known operating conditions.
- Evidence is timestamped and linked to a scan and hypothesis.
- Technician claims remain distinguishable from vehicle facts.
- Missing or unsupported parameters are reported honestly.

## Milestone 4 — Deterministic classification engine

Duration: 2–4 weeks.

### Goal

Produce useful, explainable classification offline before involving an LLM.

### Classification layers

1. **Structural:** system, subsystem, standard/manufacturer origin, and ECU ownership.
2. **State:** active, pending, historical, permanent, intermittent, or returned after clearing.
3. **Relationships:** likely primary, likely consequence, common voltage cause, communication cluster, shared-reference candidate, or probably unrelated.
4. **Applicability:** exact ECU, vehicle-family, brand-only, generic, or unknown match.

### Knowledge entry shape

Every known fault or sensor definition should include:

- Code or DID.
- Brand/platform applicability.
- Model year and market applicability.
- Engine/transmission applicability.
- ECU identity and addresses.
- Meaning and known symptoms.
- Possible causes.
- Discriminating tests.
- Source and source type.
- Confidence and knowledge version.

### Exit criteria

- Classification works offline.
- Every classification exposes its reason.
- Unknown codes remain unknown.
- Low-voltage and network cascades are grouped conservatively.
- No part replacement is recommended from a fault code alone.
- Captured hardware fixtures and golden diagnostic scenarios test the rules.

## Milestone 5 — Diagnostic agent and research

Duration: 3–5 weeks.

### Goal

Add evidence-oriented reasoning, trusted research, and a request-for-information loop.

### Agent tools

- `get_vehicle_profile`
- `get_scan_coverage`
- `get_fault_timeline`
- `get_fault_observation`
- `get_module_inventory`
- `get_freeze_frames`
- `get_sensor_window`
- `get_guided_capture`
- `get_technician_context`
- `get_current_hypotheses`
- `lookup_local_dtc`
- `lookup_local_sensor`
- `lookup_oem_information`
- `lookup_recalls`
- `search_trusted_web`
- `fetch_source`
- `request_information`
- `request_guided_capture`

The agent receives no vehicle-write, coding, or actuator-control tools.

### Reasoning loop

```text
Establish vehicle applicability
  → Summarize observed facts
  → Evaluate the technician hypothesis
  → Identify related fault clusters
  → Generate alternative hypotheses
  → Find evidence for and against each
  → Determine missing discriminating evidence
  → Ask a question or request a measurement
  → Resume when evidence arrives
  → Produce an assessment at supported confidence
```

### Structured output

```ts
type DiagnosticAssessment = {
  observations: EvidenceReference[]
  evaluatedTechnicianClaims: EvaluatedClaim[]
  hypotheses: DiagnosticHypothesis[]
  missingInformation: InformationRequest[]
  recommendedTests: GuidedTest[]
  safetyNotes: string[]
  sources: ResearchSource[]
  overallConfidence: "insufficient" | "low" | "moderate" | "high"
}
```

### Research policy

- Local vehicle evidence first.
- Exact vehicle and ECU applicability before general search.
- OEM information above third-party databases and forums.
- Official recall sources where relevant.
- Community evidence labeled anecdotal.
- Full VIN excluded from general web searches.
- External claims include citations and retrieval dates.
- Retrieved content is treated as untrusted input.
- Facts, technician claims, retrieved knowledge, and model inference remain visibly distinct.

### Exit criteria

- The agent can conclude that evidence is insufficient.
- It can pause and request a useful discriminating test.
- Hypotheses update when new evidence arrives.
- Reports distinguish facts, claims, sources, and inference.
- Model-specific online claims require citations and applicability.
- Evidence changes invalidate or version prior assessments.

## Milestone 6 — Professional reports

Duration: 1–2 weeks.

### Goal

Make every completed diagnostic scan a professional, shareable product.

### Technical report

- Vehicle and ECU identity.
- Hardware and protocol.
- Scan coverage and limitations.
- Reached, missed, locked, and unsupported modules.
- Fault observations and statuses.
- Freeze frames and relevant sensor captures.
- Customer complaint and technician observations.
- Technician's initial hypothesis.
- Ranked possible causes.
- Evidence for and against each cause.
- Tests performed and results.
- Missing evidence and recommended next steps.
- Sources, applicability, confidence, and technician conclusion.
- Optional pre-repair/post-repair comparison.

### Customer-facing report

- Reported concern.
- What the vehicle reported.
- What was observed and tested.
- Confirmed versus suspected findings.
- Recommended next steps.
- Repair performed, when applicable.
- Post-repair verification.
- Clear limitations in calm language.

### Formats

- In-app report.
- PDF and print.
- Expiring share link.
- Workshop branding.
- English and Spanish.

### Exit criteria

- Customer reports never present hypotheses as confirmed facts.
- Technical reports expose their evidence chain.
- Delivered reports are immutable and versioned.
- New evidence produces a new report version.
- Shared reports minimize VIN and personal-data exposure.

## Milestone 7 — Manufacturer coverage program

Duration: continuous.

### Goal

Turn “any car” into a measurable, continuously expanding coverage program.

### Knowledge-pack hierarchy

```text
Brand
  → Platform/model/year/market
    → Powertrain
      → ECU identity and addresses
        → Supported services
        → Fault definitions
        → Sensors and formulas
        → Known diagnostic patterns
```

### Validation requirements

Every enhanced entry must record a source, applicability, response shape, formula test, plausibility check, matching-vehicle confirmation, confidence, and regression fixture.

Useful provenance states:

- `standard`
- `oem_confirmed`
- `community_verified`
- `locally_confirmed`
- `candidate`
- `unknown`

### Coverage dashboard

Track:

- Brands and configurations tested.
- Expected and reached modules.
- Known faults decoded.
- Enhanced sensors decoded.
- Unknown responsive DIDs.
- Locked modules.
- Transport limitations.
- Hardware compatibility.

### Hardware evolution

Add transport capability only when coverage evidence justifies it:

- Reliable STN adapter support.
- Windows and Linux transport support.
- CAN FD.
- DoIP.
- Secure-gateway integrations.
- Commercially justified legacy-brand connectors.

## Release boundaries

### Release A — trustworthy scanner foundation

After Milestones 1 and 2:

- Real scan phases.
- Typed errors.
- Honest coverage.
- Unified standard and module faults.
- Correct history and recurrence.

### Release B — offline diagnostic assistant

After Milestones 3 and 4:

- Mechanic context and hypotheses.
- Guided captures.
- Evidence linkage.
- Deterministic classification and relationships.

### Release C — paid workshop beta

After Milestones 5 and 6:

- Constrained diagnostic agent.
- Information-request loop.
- Cited research.
- Technical and customer-facing reports.
- Report versioning and provenance.

## Initial beta scope

Do not wait for every brand. Start with approximately 5–10 independent workshops and real diagnostic jobs.

The beta should include:

- Broad standard OBD coverage on compatible vehicles.
- Strong enhanced support for selected European brands/configurations.
- Engine, ABS, body, and transmission modules where verified.
- Unified fault history.
- Mechanic context and guided captures.
- Evidence-based classifications.
- Technical and customer PDF reports.
- A clearly published coverage matrix.

Every unsupported module, incorrect classification, unknown sensor, and requested parameter becomes coverage evidence and a prioritized knowledge task.

## Success metrics

- Percentage of expected modules successfully scanned.
- Percentage of observations with exact vehicle/module applicability.
- Percentage of report claims linked to evidence or sources.
- Time from connection to a useful hypothesis map.
- Percentage of suggested tests that distinguish between hypotheses.
- Technician acceptance, rejection, and confirmation rates.
- Reduction in unnecessary part replacement.
- Percentage of repairs with successful post-repair verification.
- Report generation and delivery rates.

## Immediate engineering order

1. Recenter the UI on scanning.
2. Add `DiagnosticScan`, scan phases, and coverage.
3. Add typed scanner errors.
4. Add unified `FaultObservation` storage.
5. Decode and record UDS/module fault statuses.
6. Present complete and partial coverage honestly.
7. Add mechanic context and technician hypotheses.
8. Add guided sensor captures.
9. Build deterministic classifications.
10. Add the diagnostic agent and research tools.
11. Add versioned professional reports.
12. Expand manufacturer knowledge and transports continuously.

The next implementation stream should cover Milestones 0 and the first vertical slice of Milestone 1: recenter the product, introduce a durable diagnostic scan, and make the existing standard OBD scan report real phases and typed failure information without changing its safe vehicle behavior.
