# Scainner diagnostic intelligence product

Status: product direction and target architecture
Primary market: independent mechanics and repair shops
Secondary markets: car dealers, mobile mechanics, and technically curious drivers

Implementation sequence: [Diagnostic intelligence implementation plan](./diagnostic-intelligence-implementation-plan.md)

Competitor capability benchmark: [Car Scanner benchmark and Scainner gap](./car-scanner-benchmark.md)

## Product thesis

Scainner is not workshop-management software. It is a vehicle diagnostic intelligence tool.

Its purpose is to connect to a vehicle, collect the best evidence the vehicle and technician can provide, explain what that evidence means for the exact vehicle configuration, and produce a defensible map of possible causes and next tests.

The product is not valuable because it can display a fault code. Commodity scanners already do that. Its value is the layer between raw vehicle data and a professional diagnostic conclusion:

> One device, broad vehicle coverage, evidence-guided diagnosis, and reports that explain what was found, what it may mean, what remains uncertain, and what should be tested next.

Scainner may retain a lightweight diagnostic-case or repair-order container to group evidence and reports, but it is not intended to manage customers, appointments, inventory, invoicing, or the complete lifecycle of cars inside a workshop.

## Who the product serves

The initial buyer is an independent workshop or mechanic who scans multiple brands and wants more diagnostic value from each scan.

The primary users are:

- Experienced mechanics who often form a strong hypothesis from the customer complaint and vehicle behavior before connecting a scanner.
- Less-experienced technicians who need help turning codes and sensor values into a structured investigation.
- Service advisors who need an accurate, understandable explanation for the customer.
- Mobile mechanics who need a portable multi-brand diagnostic workflow.

Later versions can offer simplified experiences for dealers and curious drivers, but all experiences should use the same evidence and diagnostic engine. The difference should be how much technical detail is shown, not a separate source of truth.

## The role of the mechanic

Scainner must augment professional judgment rather than compete with it.

An experienced mechanic may hear a complaint such as “it loses power when warm, but restarting it makes the problem disappear” and immediately suspect a narrow set of causes. That expertise is valuable evidence. The product should capture it before presenting its own conclusions.

A mechanic should be able to enter:

- The customer’s description in their own words.
- The mechanic’s interpretation of that description.
- One or more initial hypotheses.
- The conditions under which the behavior occurs.
- Recent work, parts replacement, or relevant vehicle history.
- Observations such as noises, smoke, odor, vibration, poor starting, unstable idle, reduced power, or dashboard behavior.
- Tests already performed and their results.

Scainner then has two responsibilities:

1. **Confirmation:** find evidence that supports the mechanic’s hypothesis and show how strongly it supports it.
2. **Challenge:** identify contradictory evidence, alternative causes, common-cause failures, or missing tests that could prevent an unnecessary repair.

The system must never turn a mechanic’s hypothesis into a fact merely because an expert entered it. It should preserve attribution:

```text
Technician hypothesis: intake leak
Supporting evidence: positive trims at idle that reduce under load
Contradicting evidence: MAF reading also appears low for calculated engine load
Current confidence: moderate
Best next test: smoke test intake, then compare measured and calculated airflow
```

The desired relationship is similar to a second diagnostic technician who is meticulous about data, recurrence, documentation, and research.

## Core workflow

The product workflow is diagnostic rather than administrative:

```text
Connect hardware
  → Identify vehicle and configuration
  → Establish scan capabilities and coverage
  → Perform quick or complete scan
  → Normalize faults from every reachable ECU
  → Collect relevant freeze frames and sensor evidence
  → Capture mechanic and customer context
  → Build and rank diagnostic hypotheses
  → Request missing information or guided measurements
  → Update the hypothesis map
  → Produce technical and customer-facing reports
  → Optionally verify before/after repair evidence
```

The workflow must support partial success. If one ECU does not respond, the scan can still be useful, but its coverage must be reported honestly.

## High-level and low-level experiences

Scainner should expose two levels from one evidence model.

### Guided view

The guided view explains:

- What the vehicle reported.
- Which findings are likely related.
- What symptoms those findings may produce.
- Whether current evidence supports the reported behavior.
- Which causes are plausible.
- What information is missing.
- What test should be performed next.
- What may be unsafe or require urgent attention.

It is appropriate for service advisors, junior technicians, and eventually drivers.

### Technical view

The technical view exposes:

- ECU identities and diagnostic addresses.
- Standard OBD and manufacturer-specific services.
- Raw and normalized fault codes.
- UDS status flags and raw responses.
- Stored, pending, confirmed, intermittent, and permanent state.
- Freeze frames and timestamps.
- Live-data graphs and captured test sessions.
- Sensor formulas, units, byte shape, and provenance.
- Evidence supporting and contradicting each hypothesis.
- Source applicability and confidence.

Both views must describe the same underlying observations. A simplified view must not silently discard uncertainty, and a technical view must not invent precision that the source data does not provide.

## Universal vehicle coverage

“One device, all cars” is the product ambition, but the implementation and marketing promise must distinguish standard coverage from enhanced coverage.

A compatible ELM/STN-class adapter can provide broad access to regulated OBD data on many vehicles. It cannot guarantee dealer-level access to every module on every vehicle. Manufacturer diagnostics may require:

- Brand- and platform-specific ECU addresses.
- Proprietary session initialization.
- Security access or seed/key authentication.
- Secure diagnostic gateways.
- CAN FD or DoIP/Ethernet transport.
- Older pre-OBD or brand-specific protocols.
- Licensed definitions and diagnostic procedures.

The defensible promise is:

> Universal standard diagnostics with continuously expanding manufacturer-level module, fault, and sensor coverage.

Coverage must be visible for each scan:

- Vehicle identity confidence.
- Expected modules, when known.
- Discovered modules.
- Successfully scanned modules.
- Modules that timed out or refused access.
- Supported standard PIDs.
- Supported enhanced parameters.
- Locked or unsupported capabilities.
- Knowledge-pack coverage for the exact configuration.

The interface must not label an engine-only emissions scan as a complete vehicle scan.

## Sensor discovery

Universal sensor discovery has three separate problems that must not be conflated.

### Capability discovery

Determine which modules, services, standard PIDs, and manufacturer DIDs respond. Discovery must be explicit and bounded; a discovered identifier must not automatically become recurring background traffic.

### Sensor identification

A responding DID does not reveal its meaning by itself. Correct identification may depend on:

- Brand and platform.
- Model year and market.
- Engine, transmission, battery, and drivetrain configuration.
- Exact request and response module addresses.
- ECU software or part identification.
- DID number.
- Response length and byte shape.
- Endianness and signedness.
- Scaling formula and unit.
- Valid range and operating conditions.

Knowledge entries must therefore be keyed by vehicle and module applicability, not by DID number alone.

### Experimental identification

Unknown identifiers can be investigated, but guesses must remain guesses. Scainner should preserve raw samples and operating conditions, correlate unknown values with known parameters, and allow controlled experiments such as:

- Engine off versus running.
- Cold versus operating temperature.
- Idle versus steady RPM.
- Brake pedal released versus pressed.
- Stationary versus controlled wheel movement.
- Electrical load off versus on.

An experimental match can become a candidate sensor with evidence and confidence. It must require confirmation before joining the trusted knowledge map.

Useful provenance states include:

- `standard`: defined by a supported standard.
- `oem_confirmed`: identified by applicable OEM information.
- `community_verified`: independently reproduced on matching configurations.
- `locally_confirmed`: verified through a controlled capture on this vehicle.
- `candidate`: plausible but not confirmed.
- `unknown`: response preserved without interpretation.

## Unified fault observations

Standard OBD faults and manufacturer/module faults must enter the same diagnostic pipeline.

Each observation should retain:

- Vehicle, connection, and scan identity.
- Source protocol and service.
- ECU/module identity and addresses.
- Raw response bytes.
- Raw and normalized code.
- Status flags such as stored, pending, confirmed, test failed, warning requested, and permanent.
- First seen, last seen, and recurrence count.
- Warning-lamp state.
- Freeze frame or evidence snapshot.
- Battery voltage, RPM, ignition, and engine state.
- Decoder and knowledge-source version.

Codes that look identical but originate from different modules must remain distinguishable.

## Fault classification

Classification should explain the relationship between observations, not merely attach a generic severity label.

Useful classifications include:

- Likely primary fault.
- Likely consequence of another fault.
- Common-cause candidate.
- Currently active.
- Historical or intermittent.
- Communication-related.
- Voltage-related.
- Probably unrelated.
- Insufficient evidence.

Possible-cause ranking should consider:

- Exact vehicle and ECU applicability.
- Fault status and recurrence.
- Order and timing of observations.
- Freeze-frame conditions.
- Sensor values near the event.
- Customer-described behavior.
- Mechanic hypothesis and observations.
- Known failure patterns for the vehicle configuration.
- Recent repair history.
- Evidence that contradicts the candidate cause.

The product should prefer the next cheapest discriminating test over a long generic list of possible parts.

## Diagnostic evidence model

The application needs a shared evidence layer rather than separate islands for faults, Lab discoveries, live data, and AI reports.

Evidence may include:

- Fault observations.
- Freeze frames.
- Live-data capture windows.
- Readiness and capability results.
- ECU identification.
- Battery and connection quality.
- Mechanic observations.
- Customer complaint.
- Photographs, recordings, or external measurements.
- Test procedures and results.
- OEM documents, bulletins, recalls, and trusted research.

Every evidence item needs provenance, timestamp, vehicle applicability, and confidence. Derived conclusions must point back to the evidence used to derive them.

## Diagnostic hypotheses

A diagnostic hypothesis is not a prose paragraph. It is a persistent, updateable object:

```text
Candidate cause
Current confidence
Applicability to this vehicle
Evidence supporting it
Evidence contradicting it
Missing evidence
Recommended next test
Expected result if true
Expected result if false
Source and reasoning provenance
Technician disposition: proposed / accepted / rejected / confirmed
```

The system should update hypotheses as new evidence arrives rather than generate an unrelated report after every interaction.

## Requesting additional information

When existing evidence cannot distinguish plausible causes, Scainner should pause and request information instead of forcing a diagnosis.

Requests may ask the mechanic to:

- Confirm engine, transmission, or ECU identification.
- Clarify when the behavior occurs.
- Describe recent repairs or battery events.
- Inspect a connector, hose, fuse, ground, or component.
- Enter a measurement from an external tool.
- Upload a dashboard or component image.
- Scan an additional module.
- Perform a guided live-data capture.

Every request should explain:

- Why the information is needed.
- The required vehicle conditions.
- The safe procedure.
- Which hypotheses the result will distinguish.
- The expected values only when supported by an applicable source.

The agent may recommend diagnostic actions, but vehicle writes, actuator tests, coding, and other consequential operations must remain explicitly authorized and separately safety-gated.

## AI diagnostic agent

The AI layer should be an evidence-oriented diagnostic orchestrator, not a single prompt that turns a data dump into confident prose.

It should have narrow tools such as:

- Read vehicle identity and configuration.
- Read scan coverage and phase results.
- Read the fault timeline.
- Read module inventory and status.
- Query sensor windows around an event.
- Read freeze frames and guided captures.
- Search the local diagnostic knowledge base.
- Retrieve applicable OEM information through authorized sources.
- Search trusted online sources with citations.
- Request technician context.
- Request a safe guided measurement.

The agent should follow a local-first policy:

1. Establish the exact vehicle and evidence scope.
2. Use captured vehicle data and trusted local knowledge.
3. Evaluate the mechanic’s hypothesis.
4. Identify missing discriminating evidence.
5. Research externally only when it can materially improve the result.
6. Preserve citations, applicability, and retrieval dates.
7. Produce a report only at the confidence the evidence supports.

Online content is untrusted input. Retrieved text must not control agent behavior, and community claims must be labeled as anecdotal unless independently verified.

## Knowledge-source hierarchy

Sources should be prioritized as follows:

1. Evidence captured from the connected vehicle.
2. Applicable standards and versioned local diagnostic knowledge.
3. OEM service information for the exact vehicle and ECU.
4. Government recall and safety information.
5. Reputable licensed technical databases.
6. Independently reproduced technical research.
7. Community reports, explicitly marked anecdotal.

Manufacturer-specific meanings must not be inferred from a generic web result solely because the code text looks similar.

## Reports as the subscription product

The paid product is not merely scanning. It is repeatable evidence collection, diagnostic reasoning, and professional communication on every scan.

### Technical report

The workshop report should include:

- Vehicle and ECU identity.
- Scan date, hardware, protocol, and coverage.
- Modules reached, missed, locked, or unsupported.
- Raw and normalized faults with provenance.
- Status, recurrence, and freeze-frame context.
- Relevant sensor evidence.
- Customer complaint and technician observations.
- Technician’s initial hypothesis.
- Ranked candidate causes.
- Evidence for and against each candidate.
- Tests performed and results.
- Missing information and recommended next steps.
- Sources, applicability, and confidence.
- Technician conclusion.
- Optional pre-repair and post-repair comparison.

### Customer-facing report

The customer report should explain:

- What the vehicle reported.
- What the mechanic observed and tested.
- What is confirmed versus suspected.
- What requires attention.
- What additional diagnosis is recommended.
- What was repaired, when applicable.
- Whether post-repair evidence confirmed the result.

It should be clear and calm without hiding uncertainty or technical limitations.

## Safety, privacy, and trust

Diagnostic credibility depends on honest boundaries:

- Never claim complete coverage when modules were not scanned.
- Never present a candidate sensor as confirmed.
- Never convert a fault code directly into a parts recommendation.
- Never hide contradictory evidence.
- Never call an AI hypothesis a confirmed diagnosis.
- Never send VINs, fault histories, or customer context online without an explicit policy and appropriate consent.
- Redact the full VIN from general web queries by default.
- Preserve raw evidence so a technician can audit the interpretation.
- Version decoders, knowledge entries, prompts, models, and reports.

## Commercial positioning

The initial subscription promise for independent workshops is:

> Multi-brand scanning with evidence-guided fault classification, mechanic-assisted diagnosis, and professional reports for every vehicle.

The product becomes stronger as its manufacturer coverage and knowledge packs expand, but the initial paid beta does not need dealer-level coverage of every module on every brand. It needs to be exceptionally honest and useful within declared coverage.

Potential subscription value includes:

- Continuously updated brand knowledge packs.
- Enhanced module and sensor coverage.
- Diagnostic research and cited known-failure information.
- Guided tests and evidence capture.
- Persistent scan history and recurrence analysis.
- Technical and customer-ready reports.
- Team review of difficult diagnostic cases.

## Delivery sequence

### Phase 1: diagnostic truth layer

- Introduce unified diagnostic scans and fault observations.
- Route standard OBD and UDS/module faults into the same history.
- Decode UDS statuses.
- Add typed scan phases, coverage, partial failure, and recovery information.
- Preserve raw responses and decoder provenance.

### Phase 2: evidence and mechanic context

- Capture customer complaint and technician observations.
- Capture the mechanic’s initial hypotheses.
- Add guided sensor recording under defined operating conditions.
- Associate freeze frames and sensor windows with faults.
- Add recurrence, relationship, and common-cause classification.

### Phase 3: diagnostic agent

- Build local diagnostic retrieval.
- Add structured hypotheses and evidence links.
- Add the request-for-information and guided-test loop.
- Add controlled OEM and web research with citations.
- Generate versioned technical and customer reports.

### Phase 4: manufacturer coverage program

- Create versioned module and sensor knowledge packs.
- Measure coverage by brand, model, powertrain, ECU, and year.
- Add controlled validation workflows for unknown sensors.
- Support additional hardware transports when required.
- Pursue licensed OEM or technical-data access where commercially justified.

## Product success metrics

Useful metrics should measure diagnostic value rather than the number of supported codes:

- Percentage of expected modules successfully scanned.
- Percentage of observations with exact vehicle/module applicability.
- Percentage of report claims linked to evidence or sources.
- Time from connection to a useful hypothesis map.
- Reduction in unnecessary parts replacement.
- Percentage of investigations where the next requested test discriminates between hypotheses.
- Technician acceptance, rejection, and confirmation rates for suggested causes.
- Percentage of repairs with successful post-repair verification.
- Report delivery and customer-understanding rates.

## Immediate architectural direction

The next implementation priority is the diagnostic truth layer, not additional workshop-management UI.

The existing lightweight diagnostic-case foundation may remain as an optional container for evidence and reports. It should not become the product center. The center is a unified diagnostic scan containing vehicle identity, coverage, normalized faults, sensor evidence, mechanic context, hypotheses, requested tests, and report provenance.

That foundation enables Scainner to confirm a skilled mechanic’s diagnosis when the data supports it, challenge it when the data does not, and help any technician move from symptoms and codes toward the real problem with a transparent chain of evidence.
