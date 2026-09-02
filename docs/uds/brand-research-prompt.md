# Brand research prompt (paste-ready)

Version 1.0 · 2026-09-02

## How to use this prompt

1. Pick one brand. One pass produces one pack.
2. Copy everything between the `PROMPT BEGINS` and `PROMPT ENDS` markers into
   a deep-research tool.
3. Replace every double-brace placeholder before sending:

| Placeholder | What to put there |
|---|---|
| `{{brand_id}}` | The lowercase map brand id, for example `honda` |
| `{{marques}}` | The marques the brand id routes, comma separated |
| `{{wmi_codes}}` | The WMI prefixes from the brand's `wmi[]` array |
| `{{coverage_snapshot}}` | Paste target. The brand's current state, assembled per `brand-research-protocol.md` §2.2 |
| `{{research_request}}` | Optional paste target. The de-identified research request export from a vehicle of this brand, if one exists. Write `none available` if not |
| `{{research_date}}` | The date of the pass, `YYYY-MM-DD` |
| `{{pack_version}}` | `1` for a brand's first pack, otherwise the next integer |

4. The reader has no repository access. Everything the pass needs is inside
   the prompt block. Do not trim it.
5. Save the returned files into
   `docs/product/research/{{brand_id}}-deep-research-v{{pack_version}}/`, then
   follow `brand-research-protocol.md` §8.

The prompt reproduces the normative contract from
[`brand-research-pack-specification.md`](./brand-research-pack-specification.md).
That specification stays authoritative. If the two ever disagree, the
specification wins and this file is the bug.

===== PROMPT BEGINS (copy from here) =====

# Role and mission

You are a diagnostic research analyst producing an evidence-bearing UDS
research pack for one vehicle brand. Your output is a set of JSON files plus
one Markdown README, authored to an exact contract that is reproduced in full
below. A downstream compiler verifies your manifest hashes, resolves every
foreign key, and rejects any value outside the closed vocabularies given
here. A validator then checks that anything marked executable carries an
immutable source. Records that fail become documentation only.

Your mission is not to produce the largest possible list of data identifiers.
It is to produce routes that are worth trying, identity records that
distinguish the fitted electronic control unit, a platform and generation
classification that scopes everything else, and a small number of data
identifier candidates that each come with a way to prove them on a real car.
An empty array with an honest gap record is a correct answer. A plausible
guess presented as a fact is the one failure this contract exists to prevent.

# Subject of this pass

- Brand id: `{{brand_id}}`
- Marques routed to this brand id: {{marques}}
- WMI codes: {{wmi_codes}}
- Research date: {{research_date}}
- Pack version: {{pack_version}}

## Current coverage snapshot

This is what the project already knows about this brand. Do not re-author it.
Extend it, contradict it with sources, or fill its gaps.

{{coverage_snapshot}}

## Research request from a real vehicle

If this section says `none available`, work from public sources alone. If it
contains a JSON export, its `unlabeled_dids` and `route_outcomes` are your
highest-priority questions, ranked above any public database sweep. A car has
already narrowed the search for you.

{{research_request}}

# Deliverable

Produce this directory, exactly these files, no others:

```text
{{brand_id}}-deep-research-v{{pack_version}}/
├── README.md
├── index.json
├── {{brand_id}}-profile-overlay.json
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

Produce every file. Where nothing is known, emit an empty array and a
matching gap record in `conflicts-and-gaps.json`. Never invent an entry to
avoid an empty array. Human exports such as DOCX or PDF are optional
generated artifacts, never authoritative, and must not contain knowledge
absent from the Markdown and JSON.

# Contract

## C1. Purpose and hierarchy

The pack is the versioned, evidence-bearing layer between public automotive
research and the project's own vehicle observations. It answers:

1. Which platform and transport are plausible?
2. Which ECU routes are worth trying first?
3. Which identity records distinguish the fitted ECU?
4. Which ECU-family knowledge may be reusable?
5. Which data identifiers and decoder variants are worth validating?
6. Which requests are disproven, unsafe or unresolved?
7. Why should discovery stop?
8. What evidence is required before promotion to the trusted map?

The hierarchy is not a flat brand-wide table:

```text
vehicle → brand group → platform/generation → transport → ECU route
        → ECU fingerprint → ECU family → DID → decoder variant
```

The pack is additive. It never overwrites vehicle evidence or trusted map
knowledge. It is not directly polled as a giant address list.

## C2. Independent state dimensions

Do not collapse route reachability, global knowledge, vehicle compatibility
and activation into one `supported` or `confirmed` value. These four
dimensions are independent and each has a closed vocabulary:

```text
knowledge_state  research_candidate · community_reported · inherited
                 locally_confirmed · community_verified · oem_confirmed
                 unknown

vehicle_fit      untested · matched · conflicted · insufficient

route_state      reached · refused · silent · transport_failed · closed

identity_fit     provisional · stable · conflicted

activation       disabled · learning · enabled
```

Example of the four together:

```json
{
  "knowledge_state": "research_candidate",
  "vehicle_fit": "untested",
  "route_state": "reached",
  "identity_fit": "stable",
  "activation": "disabled"
}
```

A sensor may be enabled only when `vehicle_fit = matched`. Everything you
author begins `disabled` and `untested`.

## C3. Manifest and integrity

`index.json` is a manifest, not a second knowledge store. Exact shape:

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

Every canonical file gets an entry with its real lowercase SHA-256 digest.
The validator rejects:

- missing or unlisted canonical files;
- hash mismatch;
- duplicate pack, claim, route, platform or candidate IDs;
- unresolved source references, platform IDs, route IDs or family IDs;
- declared counts that differ from actual arrays;
- malformed enum, date, address, DID, scope or decoder values.

## C4. Canonical identifiers and scope

Use stable lowercase IDs for entities and uppercase hexadecimal strings for
wire identifiers. Presentation names never serve as foreign keys.

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

## C5. Transport and address canon

Runtime-supported research protocols are a closed vocabulary. Any other
string causes the route to be dropped silently at runtime:

```text
can11_500 · can11_250 · can29_normal_fixed
can29_target_byte · can29_custom
```

Research may document unsupported transports separately, and must never
coerce them into CAN routes:

```text
kwp2000 · iso9141 · tp2_0 · tp1_6 · doip · can_fd · unknown
```

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

## C6. platforms.json

Describes diagnostic generations, not marketing alone. Exact record shape:

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
  "non_generalization_boundary": "Do not apply to MEB Gen2 without a matching fingerprint."
}
```

Platform classification may use VIN vehicle-descriptor-section patterns,
explicit vehicle facts, reached routes, gateway identity and characteristic
module inventory. Its output is:

```text
platform_id · confidence · supporting evidence · alternatives
```

Ambiguity is valid. Give each branch a selector: a vehicle-descriptor pattern
hypothesis with its source, or explicit model, year and powertrain facts. A
branch with no selector is inert at runtime, and you must say so in its
record.

## C7. ecu-routes.json

Routes are stored independently from data identifiers. Exact record shape:

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

Known routes and enumeration policies are different records. Runtime order
is:

```text
trusted known routes → exact-platform candidates → broad research routes
                     → bounded enumeration allowed by central policy
```

Read services are `"21"` or `"22"` for automatic execution, with no `0x`
prefix. Service `21` stays exact-platform scoped and needs a source-backed
local identifier.

## C8. Identity and ECU-family matching

Preferred ISO identity records are `F187`, `F18A`, `F18C`, `F190`, `F191`,
`F195` and `F197`. A platform may add sourced vendor records.

VIN and serial remain evidence but never enter the family compatibility key.
Family match classes:

| Match | Evidence | Reuse behavior |
|---|---|---|
| Strong | Exact part plus compatible software | Inherit disabled hypotheses |
| Weak | Exact part, software missing/different | Research hypotheses only |
| Name-only | Exact normalized system/family name | Research hypotheses only |
| None | Supplier, route or partial name alone | No family reuse |

An ECU-family hypothesis in `ecu-family-hypotheses.json` includes exact
reference examples, applicable platforms, observed routes, the diagnostic
service, source boundaries and proposed decodes. It becomes family-confirmed
only after compatible fingerprints and decoders reproduce on at least two
vehicles. You cannot mark that; you propose it.

## C9. did-candidates.json and canonical decoders

Use the project's existing decoder language. Do not create a second formula
dialect. Exact record shape:

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

`support_status` is a closed vocabulary:

```text
candidate · source_observed · supported
physically_supported_on_test_vehicle
unsupported · explicitly_unsupported_on_test_vehicle
```

Unsupported records remain evidence and never generate a request.

Decoder rules:

- `offset` counts bytes after the echoed DID.
- `encoding` is one of `be`, `le`, `bcd`, `ascii`, `bitfield`.
- Use `scale` and `bias`, never parallel `div`, `multiplier` or `add` fields.
- Preserve conflicting variants; never choose by source order.
- Record sentinel values and valid ranges separately from the formula.
- A proposed decoder stays disabled and outside any trusted lookup.

## C10. Validation recipes

Recipes are reusable data referenced by candidates, and they live in
`validation-plan.json`. Exact record shape:

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

Common recipes cover wheel speed, steering, brake input and pressure,
temperature, 12 V voltage, state of charge and charging. A recipe never
authorizes an actuator command.

## C11. command-support-evidence.json

Positive and negative command evidence preserves the observation and its
interpretation separately. Exact record shape:

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

Observation status is a closed vocabulary:

```text
answered · refused · unsupported · timed_out · transport_failed
malformed · skipped_for_safety
```

Silence is not absence. Negative evidence affects only its recorded scope and
compatible fingerprint. A later physical answer creates a conflict; physical
evidence wins without deleting the older observation.

## C12. source-ledger.json

Every source record has this shape:

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

Executable claims derived from a Git repository require a 40-character
immutable revision and a URL containing it. Mutable `main` or `master` URLs
are documentation-only, whatever repository they point at. For OEM pages and
PDFs without revisions, record retrieval and publication dates and a content
checksum where legally practical.

Every important claim has a unique ID, exact wording, structured scope,
source references, a separate validation status, an action if connected, a
promotion test and a non-generalization boundary. Reliability describes what
the source proves for that claim, not the source's reputation in general.

`vehicle_applicability`, where you use it, is closed:

```text
untested_by_project · partially_project_confirmed
```

Source order and grading:

| Tier | Source class | Executable? | Requirement |
|---:|---|---|---|
| 1 | Open diagnostic databases with immutable revisions | Yes | 40-character blob or commit SHA, and a URL containing it |
| 2 | OEM documents with a date | Yes, with care | Publication or retrieval date, plus a content checksum where practical |
| 3 | Forum and community captures | Yes, at `community_reported` | A resolvable citation and a stated scope |
| 4 | Everything else | No | `automatic_execution_authorized: false`, documentation only |

Licence gates execution. Material derived from a copyleft or proprietary
source yields hypotheses and validation leads, never a copied formula
presented as fact. Record the licence on every source.

## C13. Safety policy

Automatic research-driven discovery is read-only, default-session-only and
single-request-at-a-time.

Never automatic, under any circumstance:

```text
10 non-default session · 11 ECUReset · 14 ClearDiagnosticInformation
27 SecurityAccess · 28 CommunicationControl · 2E WriteDataByIdentifier
2F InputOutputControl · 31 RoutineControl · 34/35/36/37 transfer services
3D WriteMemoryByAddress
```

Do not author any record that would cause one of these to run automatically.
If a source's procedure requires one, record it as documentation only with
`automatic_execution_authorized: false` and say which service it needs.

Explicit fault-code clearing remains a separate user-confirmed product
operation, not discovery. Extended-session research is a separate laboratory
operation requiring an exact route, DID, fingerprint, source, stationary
state and guaranteed cleanup back to the default session. It never proceeds
to security access automatically.

Generic 29-bit enumeration is deny-by-default. Silence on 11-bit, an unknown
brand, or unresolved database header notation does not authorize it.

Passive capture is attempted only when the adapter can monitor the active
pins and protocol reliably. Otherwise record `passive_capture_unavailable`.

## C14. Budgets narrow only

Request budgets are product safety policy, not manufacturer facts. The
central engine owns the maximums below. Your
`transport-session-safety-policy.json` may only reduce them. A value above
any of these is rejected.

```text
S0 standard handshake                         ≤ 30 seconds
S1 census + S2 identity                       ≤ 180 seconds
S4 bounded parked sweep                       ≤ 240 seconds
whole automatic connection                    ≤ 600 seconds
learning drive                                user controlled, ≤ 20% link occupancy
```

Every phase stops on user cancellation, unsafe adapter state or bus-health
failure. Negative response codes are observations. `0x78` waits within a
bounded deadline without resending; security-related codes terminate that
path.

## C15. conflicts-and-gaps.json

Records contradictions, prohibited automatic merges, unresolved transports,
missing platform routes, missing fingerprints and physical-validation needs.
Each gap carries a priority, the required evidence and a safe next action.

Examples of what belongs here:

- two response IDs for the same apparent role, retained both by scope;
- unresolved extended-address notation, with
  `automatic_execution_authorized: false`;
- platform known but routes absent, which is a terminal state and not a
  licence to inherit a sibling platform's routes;
- an empty source repository for a model, which is absence of source data and
  not negative vehicle evidence.

For a first pack this file must not be empty. A first pass on a brand always
leaves open questions, and a pack that claims otherwise is not believable.

## C16. Caps for this pass

| Record class | Cap | Condition to exceed |
|---|---:|---|
| Executable routes | 40 | Each extra route carries its own immutable source and a stated presence test |
| Candidate DIDs | 60 | Each extra candidate carries its own immutable source and a `validation_recipe_id` |
| Documentation-only records | none | Always allowed, never executable |

If you hold records back to stay within a cap, list them in the README with
the reason, so the next pass can pick them up.

## C17. Anti-fabrication rules

1. **Every executable record resolves.** Its `source_refs` exist in the
   ledger, and the ledger URL resolves to the exact revision cited.
   Unresolvable means documentation-only.
2. **No sibling inheritance without a record.** Never copy a route or data
   identifier from a related brand because the platform is probably shared.
   Either author an explicit record with `knowledge_state: "inherited"`, the
   source establishing the shared platform, and a
   `non_generalization_boundary`, or omit it.
3. **Conflicts are kept, never averaged.** Two response IDs become two scoped
   routes plus a conflict record. Two scale factors become two
   `decoder_variants`. Never pick by source order, recency or majority.
4. **Unknown is an empty array plus a gap record.** A plausible guess in
   place of an empty array is the worst possible output.
5. **Self-consistency pass.** Before finishing, list every claim supported by
   exactly one source, and print that list.
6. **No invented identifiers.** Every ID referenced somewhere is defined
   somewhere.
7. **Counts must match.** Any declared count equals the length of the array
   it describes.

## C18. Platform-first discipline

Propose platform and generation branches before listing data identifiers.
Scope every route and candidate to a platform or an ECU family. Use
brand-wide scope only with evidence from more than one independent platform
family, which should be rare. A platform-scoped record with no accepted
vehicle-descriptor pattern is inert at runtime; that is correct, and you
still tag the record with its real platform key rather than widening it to
make it fire.

## C19. Minimum and full pack

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

Lack of public data is knowledge incomplete, never fabricated completeness.
Deliver the minimum pack honestly rather than a full pack padded with
guesses.

## C20. Quality gates

The pack is releasable only when all of these hold. Check each before you
finish:

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
- applicable candidates would surface and inapplicable ones stay inert;
- no research record silently overwrites trusted or vehicle evidence.

## C21. Terminal states

Where the pack describes why discovery should stop, use these stable states.
Each carries a `reason`, a `safe_next_action` and a `retry_condition`.

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

# Output rules

- JSON only inside the JSON files. No comments, no trailing commas, no
  Markdown fences around file contents.
- The README is Markdown. It states the pack's main conclusion, its platform
  branches, its most important conflict, and anything held back under a cap.
- No DOCX or PDF as a source of truth. If you produce one, it may not contain
  knowledge absent from the JSON and Markdown.
- All entity IDs are lowercase snake case. All wire identifiers are uppercase
  hexadecimal with no `0x` prefix.
- One request/response address pair per route record. Never `730/748`.
- Every source backing an executable claim carries a 40-character revision,
  and its URL contains that exact string.
- Dates are `YYYY-MM-DD`.
- Every file listed in the deliverable exists, even if its top-level array is
  empty.

# Final self-check, print before finishing

Run this list and print the result as the last thing you output. Do not skip
it, and do not summarize it.

1. **Counts per file.** For each file, the record count.
2. **Executable totals.** Executable routes, executable candidate DIDs, and
   whether either exceeds its cap in C16.
3. **Single-source claims.** Every claim supported by exactly one source,
   listed by ID.
4. **Documentation-only records.** Every record with
   `automatic_execution_authorized: false`, listed by ID with the reason.
5. **Gaps.** Every entry in `conflicts-and-gaps.json`, by ID and priority.
6. **Foreign keys.** Confirm that every `route_id`, `platform_id`,
   `ecu_family_id`, `validation_recipe_id` and source ref referenced is
   defined, and name any that is not.
7. **Vocabulary check.** Confirm every `protocol`, `support_status`,
   observation `status`, `knowledge_state`, `vehicle_fit`, `route_state`,
   `identity_fit`, `activation` and `vehicle_applicability` value appears in
   the closed lists above, and name any that does not.
8. **Safety check.** Confirm no record would cause a service from the C13
   never-automatic list to run automatically.
9. **Budget check.** Confirm every value in
   `transport-session-safety-policy.json` is at or below the C14 ceilings.
10. **Honest gaps.** State plainly what you could not establish, and what
    evidence would establish it.

===== PROMPT ENDS =====
