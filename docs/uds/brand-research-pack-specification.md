# UDS brand research pack specification

Version 1.0 · 2026-08-31 · normative authoring and runtime-projection contract

Implementation language in this document is deliberate:

- **Current** describes behavior verified in the repository at this version.
- **Required** describes the contract new packs and planner work must satisfy.
- **Target** describes an intended interface that is not evidence of an
  existing implementation.

Review feedback is non-authoritative. A proposed rule enters this specification
only when it matches repository behavior or closes a demonstrated safety,
correctness, interoperability or operating-cost gap.

Companion to:

- [`pack-schema-v9.md`](./pack-schema-v9.md) — trusted `uds-map.json` format;
- [`universal-discovery-protocol.md`](../product/universal-discovery-protocol.md) — vehicle-facing acquisition phases;
- [`research-driven-discovery-plan.md`](../product/research-driven-discovery-plan.md) — delivery roadmap;
- [`RESEARCH-INGESTION.md`](../../packages/uds-map/scripts/RESEARCH-INGESTION.md) — current conversion procedure.

## 1. Purpose

A brand research pack is the versioned, evidence-bearing layer between public
automotive research and Scainner's vehicle observations. It helps the engine
answer:

1. Which platform and transport are plausible?
2. Which ECU routes are worth trying first?
3. Which identity records distinguish the fitted ECU?
4. Which ECU-family knowledge may be reusable?
5. Which DIDs and decoder variants are worth validating?
6. Which requests are disproven, unsafe or unresolved?
7. Why should discovery stop?
8. What evidence is required before promotion to the trusted map?

The goal is not a flat, brand-wide PID/DID database. The hierarchy is:

```text
vehicle → brand group → platform/generation → transport → ECU route
        → ECU fingerprint → ECU family → DID → decoder variant
```

The pack is additive. It never overwrites vehicle evidence or trusted map
knowledge. It is not directly polled as a giant address list.

## 2. The missing bridge: the candidate planner

The engine's state and safety models are already strong. The essential bridge
is an evidence-aware candidate planner between research packs and vehicle
observations:

```text
rich research pack
        ↓ normalize and validate
safe candidate catalog
        ↓ select by vehicle context
prioritized read-only plan
        ↓ execute presence → identity → candidate reads
raw vehicle observations
        ↓ correlate and review
trusted ECU-family/map promotion
```

Build this bridge once and a large cross-manufacturer corpus becomes an
advantage. Without it, the same corpus is only a huge, slow address list.

The planner must:

- preserve source, scope, contradictions and proposed validation;
- choose requests by observed vehicle context;
- replan after route and identity evidence arrives;
- keep every decoder disabled until matched on this vehicle;
- treat unsupported and unresolved records as evidence, never traffic;
- stop when further requests have low value or exceed policy.

## 3. Three knowledge layers

| Layer | Purpose | May drive traffic? | May display a decoded sensor? |
|---|---|---:|---:|
| Research pack | External claims and hypotheses | Only after safe projection | No |
| Vehicle evidence | Raw outcomes, fingerprints and local hypotheses | Yes | Only when vehicle-matched |
| Trusted map | Reviewed reusable routes/families/decodes | Yes | Yes |

Promotion changes the layer and evidence state. Copying a formula from a
source is not promotion.

## 4. Independent state dimensions

Do not collapse route reachability, global knowledge, vehicle compatibility
and activation into one `supported` or `confirmed` value.

The required model keeps these dimensions independent:

```text
knowledge_state  research_candidate · community_reported · inherited
                 locally_confirmed · community_verified · oem_confirmed
                 unknown

vehicle_fit      untested · matched · conflicted · insufficient

route_state      reached · refused · silent · transport_failed · closed

identity_fit     provisional · stable · conflicted

activation       disabled · learning · enabled
```

Current code implements `knowledge_state`, including `reached_on_vehicle` and
`verified_on_vehicle`. The other dimensions below are the normative projection
model; they must not be presented as fully implemented runtime fields until the
planner and observation schema carry them end to end.

New packs express reachability and verification through `route_state`, identity
evidence and `vehicle_fit`. During migration, the projector may also emit the
legacy knowledge-state values required by the current runtime.

Example:

```json
{
  "knowledge_state": "research_candidate",
  "vehicle_fit": "untested",
  "route_state": "reached",
  "identity_fit": "stable",
  "activation": "disabled"
}
```

A sensor may be enabled only when `vehicle_fit = matched`.

## 5. Pack layout

```text
<brand-id>-deep-research-v<version>/
├── README.md
├── index.json
├── <brand-id>-profile-overlay.json
├── platforms.json
├── connection-playbook.json
├── transport-session-safety-policy.json
├── ecu-routes.json
├── did-candidates.json
├── command-support-evidence.json       optional
├── ecu-family-hypotheses.json
├── observed-module-inventories.json    optional
├── validation-plan.json
├── conflicts-and-gaps.json
└── source-ledger.json
```

Human exports such as DOCX or PDF are optional, generated artifacts. They are
never authoritative and must not contain knowledge absent from Markdown/JSON.
Missing concepts are represented by empty arrays or explicit gaps, not
invented entries.

## 6. Manifest and integrity

`index.json` is a manifest, not a second knowledge store:

```json
{
  "schema_version": 1,
  "pack_id": "vag-deep-research",
  "pack_version": 1,
  "research_date": "2026-08-31",
  "brand_ids": ["vag"],
  "files": [
    {
      "path": "ecu-routes.json",
      "sha256": "<lowercase 64-character digest>"
    }
  ]
}
```

A validator must reject:

- missing or unlisted canonical files;
- hash mismatch;
- duplicate pack, claim, route, platform or candidate IDs;
- unresolved `source_refs`, platform IDs, route IDs or family IDs;
- declared counts that differ from actual arrays;
- malformed enum, date, address, DID, scope or decoder values.

## 7. Canonical identifiers and scope

Use stable lowercase IDs for entities and uppercase hexadecimal strings for
wire identifiers. Presentation names do not serve as foreign keys.

```json
{
  "brand_ids": ["vag"],
  "marques": ["volkswagen"],
  "platform_ids": ["vw_meb_gen1"],
  "models": ["id4"],
  "years": { "from": 2021, "to": 2023 },
  "powertrains": ["bev"],
  "ecu_roles": ["gateway"],
  "ecu_family_ids": ["vag_meb_gateway_energy"]
}
```

Rules:

- `null` means an open year bound; an absent field means not established.
- Do not put the literal string `unknown` in an ID array.
- A broad scope lowers priority; it does not authorize generalization.
- Model evidence does not become platform or brand-wide evidence implicitly.
- Scope always narrows automatically during promotion; widening requires new
  evidence.

## 8. Canonical transport and address representation

Runtime-supported research protocols are a closed vocabulary:

```text
can11_500 · can11_250 · can29_normal_fixed
can29_target_byte · can29_custom
```

Research may document unsupported transports separately:

```text
kwp2000 · iso9141 · tp2_0 · tp1_6 · doip · can_fd · unknown
```

Unsupported transports never get coerced into CAN routes.

Address rules:

- Uppercase hexadecimal without `0x`.
- One request/response pair per route record.
- 11-bit IDs must fit `000–7FF`; 29-bit IDs must fit `00000000–1FFFFFFF`.
- Do not encode alternatives as `730/748`; create two routes.
- `target_byte`, `address_extension` and `gateway` are separate fields.
- Request and response widths must agree with the protocol.

```json
{
  "route_id": "vag_gateway_710_77a",
  "protocol": "can11_500",
  "req": "710",
  "resp": "77A",
  "target_byte": null,
  "address_extension": null,
  "gateway": null
}
```

## 9. Platforms

`platforms.json` describes diagnostic generations, not marketing alone:

```json
{
  "platform_id": "vw_meb_gen1",
  "scope": {
    "brand_ids": ["vag"],
    "marques": ["volkswagen"],
    "models": ["id3", "id4", "id5"],
    "years": { "from": 2020, "to": 2023 },
    "powertrains": ["bev"]
  },
  "architecture": "MEB generation 1",
  "transport_candidates": ["can11_500"],
  "gateway_architecture": "J533-family gateway",
  "security_behavior": ["sfd_possible_read_only"],
  "classification_evidence": [],
  "confidence": "high",
  "knowledge_state": "research_candidate",
  "source_refs": ["S01", "S05"],
  "vds_patterns": ["^E1EA", "^E1EB"],
  "non_generalization_boundary": "Do not apply to MEB Gen2 without a matching fingerprint."
}
```

Platform classification may use VIN/VDS, explicit vehicle facts, reached
routes, gateway identity and characteristic module inventory. Its output is:

```text
platform_id · confidence · supporting evidence · alternatives
```

Ambiguity is valid. The planner uses only the intersection of safe candidates
until stronger evidence arrives.

### 9.1 `vds_patterns`

**Required** for new packs. Optional in the JSON schema — a platform may
legitimately have no VIN rule — but a platform that omits it must be named by
a `platform_not_vin_selectable` gap instead. Exactly one of the two, never
neither.

```json
"vds_patterns": ["^KA1HK", "^KB1HK"],
"source_refs": ["S03"]
```

An array of anchored regex **strings** over the vehicle-descriptor
characters, one per VIN family. Sources are the platform's own
`source_refs`; a platform that declares patterns with no `source_refs` is
rejected.

| Rule | Detail |
|---|---|
| Subset | Literals `A-Z0-9`, `.`, `[...]` classes with ranges and negation, `(a\|b)` alternation, and `^`, `$`, `?`, `*`, `+`. No `{n,m}`, no escapes, no capture semantics. `I`, `O` and `Q` never appear in a VIN and never appear as literals. |
| Anchoring | Every entry starts with `^`, and every top-level `\|` alternative inside one entry is anchored — group them as `^(A\|B)`, not `^A\|B`. An unanchored pattern is a substring search over the descriptor. |
| Non-empty | A pattern that matches the empty string classifies nothing and is rejected. |
| Granularity | One entry per VIN family. Two families are two entries, never one loosened pattern. |

**What the pattern is matched against.** Per ISO 3779:2009 §4.3 the vehicle
descriptor section is VIN positions **4–9**, six characters whose coding and
sequence are the manufacturer's own; position 10 is the model-year character
and position 11 the plant. The runtime matcher
(`apps/desktop/src-tauri/src/elm/uds_map.rs::platform_for_vin`) takes
`vin[3..10]` — **VIN characters 4–10 inclusive**, so the six descriptor
characters *plus* the model-year character. A rule that constrains only
positions 4–9 is therefore anchored at the start and left open at the end
(`^KA1`); a closing `$` constrains all seven characters including the model
year.

**Required.** A pattern is scoped to a **generation**, never to a nameplate:
nameplates outlive diagnostic architectures and get reused across them. If
two generations cannot be separated by descriptor characters, that is a
`platform_not_vin_selectable` gap, not a widened pattern.

**Current.** The compiler maps this field into the trusted map's
`brands[].platforms[].vds_pattern` through `platform-proposals.json`. The
trusted map holds one regex string per platform, so a proposal carries both
the full `vds_patterns` list and a single `vds_pattern`: the one entry when
the platform declares one, otherwise the entries joined into one alternation,
`^(KA1HK|KB1HK)`. `elm/uds_map.rs::vds_matches` expands groups and top-level
alternation before matching, so that form resolves. The compiler never writes
to `data/uds-map.json`; a human moves accepted proposals across.

`projection-report.json` reports `vin_selectable_platforms`: the platform IDs
that carry a VIN rule. An empty list means no platform-scoped route in the
pack can ever fire from a VIN alone.

### 9.2 The gap alternative

A platform with no sourced descriptor rule is declared, not left silent:

```json
{
  "gap_id": "examplebrand_gen2_not_vin_selectable",
  "kind": "platform_not_vin_selectable",
  "scope": { "platform_ids": ["examplebrand_gen2"] },
  "priority": "P1",
  "required_evidence": "A registry or type-approval table mapping this generation's descriptor characters, or a second confirmed VIN from the generation.",
  "safe_next_action": "Classify by model year plus mode 09 calibration identifiers, or by gateway identity, until a descriptor rule is sourced; leave platform-scoped candidates inert.",
  "retry_condition": "A registry table or a second confirmed VIN appears.",
  "source_refs": ["S03"]
}
```

**Current.** `research:validate` counts platforms carrying neither and
reports them on the line `platforms without a VIN classifier`, one warning
`platform_without_vin_classifier: <platform_id>` each. It is a warning, not a
failure: a pack whose platforms are honestly unclassifiable is still a valid
pack. Reviewer checklist rows 8a and 8b in the protocol turn that number into
a merge decision.

## 10. Routes: where to ask

`ecu-routes.json` stores routes independently from DIDs:

```json
{
  "route_id": "vag_gateway_710_77a",
  "scope": { "brand_ids": ["vag"] },
  "module_role": "gateway",
  "route": {
    "protocol": "can11_500",
    "req": "710",
    "resp": "77A",
    "target_byte": null,
    "address_extension": null,
    "gateway": null
  },
  "read_services": ["22"],
  "session": "default_only",
  "requires_identity": true,
  "confidence": "medium",
  "knowledge_state": "community_reported",
  "source_refs": ["S02"],
  "automatic_execution_authorized": true,
  "non_generalization_boundary": "Presence candidate; not proof the ECU is fitted."
}
```

Known routes and enumeration policies are different records. Runtime order is:

```text
trusted known routes → exact-platform candidates → broad research routes
                     → bounded enumeration allowed by central policy
```

## 11. Identity and ECU-family matching

Preferred ISO identity records include `F187`, `F18A`, `F18C`, `F190`,
`F191`, `F195` and `F197`; a platform may add sourced vendor records.

VIN and serial remain evidence but never enter the family compatibility key.
Family match classes are:

| Match | Evidence | Reuse behavior |
|---|---|---|
| Strong | Exact part plus compatible software | Inherit disabled hypotheses |
| Weak | Exact part, software missing/different | Research hypotheses only |
| Name-only | Exact normalized system/family name | Research hypotheses only |
| None | Supplier, route or partial name alone | No family reuse |

An ECU-family hypothesis includes exact reference examples, applicable
platforms, observed routes, diagnostic service, source boundaries and proposed
decodes. It becomes family-confirmed only after compatible fingerprints and
decoders reproduce on at least two vehicles.

## 12. DID candidates and canonical decoders

Research uses the same decoder language as `uds-map` v9. Do not create a
second formula dialect.

```json
{
  "candidate_id": "vag.meb.gateway.2a53",
  "scope": {
    "brand_ids": ["vag"],
    "platform_ids": ["vw_meb_gen1"],
    "models": ["id4"],
    "ecu_roles": ["gateway"]
  },
  "route_id": "vag_gateway_710_77a",
  "service": "22",
  "did": "2A53",
  "semantic": "DC/DC low-voltage voltage and current",
  "route_status": "source_observed",
  "did_status": "source_observed",
  "decode_status": "candidate",
  "decoder_variants": [
    {
      "variant_id": "S05-a",
      "signals": [
        {
          "offset": 0,
          "len": 1,
          "encoding": "be",
          "signed": false,
          "scale": 0.1,
          "bias": 0,
          "unit": "V",
          "quantity": "voltage",
          "label": "DC/DC low-voltage output"
        }
      ],
      "sentinel_values": [],
      "valid_range": { "min": 0, "max": 20 },
      "source_refs": ["S05"]
    }
  ],
  "validation_recipe_id": "voltage_cross_check",
  "support_status": "source_observed",
  "automatic_execution_authorized": true,
  "source_refs": ["S05"]
}
```

The required pack vocabulary for `support_status` is closed:

```text
candidate · source_observed · supported
physically_supported_on_test_vehicle
unsupported · explicitly_unsupported_on_test_vehicle
```

Current runtime projections validate their smaller accepted vocabulary during
pack loading. The pack validator and projector must reject unknown authoring
values rather than silently broadening execution. Unsupported records remain
evidence and never generate a request.

Decoder rules:

- `offset` counts bytes after the echoed DID.
- `encoding`: `be`, `le`, `bcd`, `ascii` or `bitfield`.
- Use `scale` and `bias`, not parallel `div`, `multiplier` or `add` fields.
- Preserve conflicting variants; never choose by source order.
- Record sentinel values and valid ranges separately from the formula.
- A proposed decoder stays disabled and outside `known_did` lookup.

## 13. Validation recipes

Recipes are reusable data referenced by candidates:

```json
{
  "validation_recipe_id": "steering_center_left_right",
  "kind": "guided_sequence",
  "safe_vehicle_state": "stationary",
  "instructions": ["hold center", "turn left", "hold center", "turn right"],
  "expected_behavior": [
    "changes sign",
    "returns near zero",
    "moves monotonically with reference",
    "remains within plausible steering range"
  ],
  "reference_signals": ["steering_angle_standard_or_verified"],
  "promotion_result": "vehicle_fit_matched"
}
```

Common recipes cover wheel speed, steering, brake input/pressure,
temperature, 12 V voltage, SOC and charging. A recipe never authorizes an
actuator command.

## 14. Positive and negative command evidence

Command evidence preserves the observation and its interpretation:

```json
{
  "evidence_id": "audi-j1-2022-tpms-18a0",
  "scope": {
    "platform_ids": ["audi_j1"],
    "models": ["rs_etron_gt"],
    "years": { "from": 2022, "to": 2022 }
  },
  "ecu_fingerprint": null,
  "route_id": "vag_tpms_70b_775",
  "service": "22",
  "session": "default",
  "did": "18A0",
  "adapter": { "model": "source-test-tool", "firmware": null },
  "vehicle_state": "ignition_on_stationary",
  "attempts": 1,
  "outcome": {
    "status": "refused",
    "nrc": 49,
    "payload_hex": null,
    "raw_response_ref": "source:S07"
  },
  "support_status": "explicitly_unsupported_on_test_vehicle",
  "source_refs": ["S07"],
  "non_generalization_boundary": "One 2022 J1 vehicle only."
}
```

Observation status is closed:

```text
answered · refused · unsupported · timed_out · transport_failed
malformed · skipped_for_safety
```

Silence is not absence. Negative evidence affects only its recorded scope and
compatible fingerprint. A later physical answer creates a conflict; physical
evidence wins without deleting the older observation.

## 15. Sources and claims

Every source record contains:

```json
{
  "ref": "S05",
  "title": "OBDb Volkswagen ID.4 signalset",
  "url": "https://github.com/.../blob/<40-char-sha>/...",
  "source_type": "open_diagnostic_database",
  "licence": "CC-BY-SA-4.0",
  "revision": "<40-char-sha>",
  "retrieved_at": "2026-08-31",
  "content_sha256": null,
  "scope": "VW ID.4 / MEB",
  "reliability": "high"
}
```

Executable Git-derived claims require a 40-character immutable revision and a
URL containing it. Mutable `main`/`master` URLs are documentation-only. For
OEM pages/PDFs without revisions, record retrieval/publication dates and a
content checksum where legally practical.

Every important claim has a unique ID, exact wording, structured scope,
source references, separate validation status, action if connected, promotion
test and non-generalization boundary. Reliability describes what the source
proves for that claim, not the source's reputation in general.

`vehicle_applicability` in current runtime projections is closed:

```text
untested_by_project · partially_project_confirmed
```

## 16. Safety policy

Automatic research-driven discovery is read-only, default-session-only and
single-request-at-a-time.

Never automatic:

```text
10 non-default session · 11 ECUReset · 14 ClearDiagnosticInformation
27 SecurityAccess · 28 CommunicationControl · 2E WriteDataByIdentifier
2F InputOutputControl · 31 RoutineControl · 34/35/36/37 transfer services
3D WriteMemoryByAddress
```

Explicit DTC clearing remains a separate user-confirmed product operation,
not discovery. Extended-session research is a separate Lab operation requiring
an exact route, DID, fingerprint, source, stationary state and guaranteed
cleanup back to default. It never proceeds to security access automatically.

Generic 29-bit enumeration is deny-by-default. Silence on 11-bit, an unknown
brand or unresolved database header notation does not authorize it.

Passive capture is attempted only when the adapter can monitor the active
pins/protocol reliably. Otherwise record `passive_capture_unavailable`.

## 17. Central budgets and brand reductions

Request budgets are product safety policy, not manufacturer facts. The
central engine owns maximums. Brand packs may only reduce them unless a
separately reviewed project change raises the central ceiling.

Current product phases are:

```text
S0 standard handshake                         ≤ 30 seconds
S1 census + S2 identity                       ≤ 180 seconds
S4 bounded parked sweep                       ≤ 240 seconds
whole automatic connection                    ≤ 600 seconds
learning drive                                user controlled, ≤ 20% link occupancy
```

Every phase stops on user cancellation, unsafe adapter state or bus-health
failure. NRCs are observations. `0x78` waits within a bounded deadline without
resending; security-related NRCs terminate that path.

## 18. Candidate projection: research to runtime

The runtime does not execute the authoring pack directly. A deterministic
projection creates safe candidates.

| Research fact | Runtime projection |
|---|---|
| Exact-platform sourced route | Presence and identity candidate |
| Make-level route | Late, lower-priority presence candidate |
| Candidate DID | Read only after route discovery succeeds |
| Proposed decoder | Disabled hypothesis metadata |
| Unsupported command | Negative planning evidence; no request |
| Unauthorized command | Documentation only; no request |
| Unresolved transport | Terminal/gap record; no request |
| Extended-session requirement | Explicit Lab-only candidate |
| Mutable/unlicensed source | Documentation or validation lead only |

Current runtime projection shape:

```json
{
  "route_id": "vag_gateway_710_77a",
  "platform": "vw_meb_gen1",
  "protocol": "can11_500",
  "req": "710",
  "resp": "77A",
  "service": "22",
  "session": "default_only",
  "claim_ids": ["vag.s05.id4_gateway"],
  "module_role": "gateway",
  "requires_identity": true,
  "candidate_dids": [
    {
      "did": "2A53",
      "semantic": "DC/DC voltage and current",
      "decode": { "variants_retained": true },
      "validation": {
        "kind": "voltage_cross_check",
        "instructions": [],
        "expected_behavior": []
      },
      "automatic_execution_authorized": true,
      "support_status": "source_observed"
    }
  ]
}
```

Full decoder JSON is retained in the authoring pack. The current parked report
surfaces semantic and validation intent; persisting the entire proposed
formula beside observations is planned work and does not weaken the trust
gate.

## 19. Evidence-aware planning algorithm

For a connection:

1. Select the brand from WMI or remain manufacturer-agnostic.
2. Build platform candidates from VIN/VDS and known vehicle facts.
3. Add trusted known routes.
4. Add exact-platform research routes when classification permits.
5. Add broad routes as a bounded late fallback.
6. Configure each full transport tuple in the default session.
7. Read presence and identity first.
8. If any discovery read answers or refuses, record the route as reached and
   query executable scoped candidate DIDs.
9. If every discovery read is silent or transport-failed, skip candidate DIDs.
10. Reclassify platform and ECU family from new evidence, remove incompatible
    pending actions and add newly applicable ones.
11. Stop on budget, safety threshold or an informative terminal state.

Priority is transparent, not machine-learned:

```text
specificity + source quality + platform fit + ECU-family fit
+ expected information gain + user value
- traffic cost - prior scoped silence - transport uncertainty
```

Persisted action attempts eventually make plans resumable: reached routes are
not needlessly repeated, silence follows retry policy, transport failures wait
for a material adapter/transport change, and deferred high-value work resumes
before new low-value work.

## 20. Terminal states

Discovery reports why it stopped. Recommended stable states include:

```text
transport_not_detected · unsupported_transport
platform_known_route_knowledge_incomplete
transport_detected_no_diagnostic_response · known_routes_silent
vehicle_asleep_or_conditions_not_correct
gateway_blocked_or_unreachable · protected_security_required
unresolved_transport_encoding · ecu_responsive_identity_unreadable
ecu_identified_no_known_signals · route_responding · signals_observed
aborted_bus_health · aborted_budget · aborted_user
```

A terminal state carries `reason`, `safe_next_action` and `retry_condition`.
It is knowledge, not an error string.

## 21. Physical validation and promotion

Per vehicle:

1. Record vehicle facts and adapter/firmware.
2. Capture passively when supported.
3. Probe scoped routes and save every outcome.
4. Read identity twice; stability requires an independent connection.
5. Query scoped candidate DIDs and preserve complete payloads.
6. Run one-variable physical validation recipes.
7. Mark `vehicle_fit = matched`, `conflicted` or `insufficient`.
8. Repeat on another compatible fingerprint before family promotion.

Promotion requirements:

| Scope | Minimum evidence |
|---|---|
| Vehicle-matched | Route, DID, payload shape and physical behavior reproduced on one vehicle |
| Multi-vehicle | Same result on at least two compatible vehicles |
| Family-confirmed | Compatible fingerprint plus same DID/shape/decoder on at least two vehicles |
| Brand-wide | Evidence across multiple independent platform families; expected to be rare |

Promotion uses the narrowest valid scope. Conflicting equal-strength decoders
remain variants until a discriminating test resolves them. Higher-confidence
vehicle/project evidence is never overwritten by incoming research.

## 22. Conflicts and gaps

`conflicts-and-gaps.json` records contradictions, prohibited automatic merges,
unresolved transports, missing platform routes, missing fingerprints and
physical-validation needs. Each gap has a priority, required evidence and safe
next action.

Examples:

- two response IDs for the same apparent role → retain both by scope;
- unresolved `FC00/FE00xx` notation → `automatic_execution_authorized: false`;
- platform known but routes absent → terminal state, not inherited MQB routes;
- model repository empty → absence of source data, not negative vehicle
  evidence.

## 23. Validation command and quality gates

The target interface is:

```text
pnpm research:validate <pack-directory>
```

It should report:

```text
valid records · documentation-only records · executable routes/DIDs
negative evidence · blocked transport records · missing immutable sources
unresolved references · scope conflicts · decoder variants
```

A pack is releasable only when:

- all JSON parses and the manifest hashes match;
- every foreign key and source reference resolves;
- every executable Git source is immutable and licensed;
- addresses, DIDs, protocols and enums are canonical;
- known routes are separate from enumeration policy;
- platform, transport, 29-bit, session and security behavior are explicit;
- route, DID and decoder status remain independent;
- decoder variants and negative evidence are preserved;
- budgets can only narrow central policy;
- conflicts, gaps, terminal states and physical validation are documented;
- projection tests prove applicable candidates surface and inapplicable ones
  remain inert;
- no research record silently overwrites trusted or vehicle evidence.

## 24. Minimum and full packs

Minimum viable pack:

```text
manifest · source ledger · platform hypothesis · connection playbook
safety policy · known routes · conflicts/gaps · validation plan
```

Full pack adds:

```text
transport grammar · scoped DID/decoder variants · positive/negative support
ECU-family hypotheses · module inventories · validation recipes
```

Lack of public data is `knowledge incomplete`, never fabricated completeness.

## 25. North-star behavior

Success is not “20,000 DIDs.” Success is:

```text
Vehicle A validates a signal on an identified ECU family.
Vehicle B has never been researched directly.
The engine identifies a compatible ECU on Vehicle B,
inherits the disabled hypothesis,
validates it with minimal additional traffic,
and promotes only the evidence-supported scope.
```

That is the difference between a static diagnostic database and a safe,
knowledge-driven universal discovery engine.
