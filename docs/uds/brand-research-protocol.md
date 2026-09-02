# Brand research protocol

Version 1.0 · 2026-09-02 · how a research pass is run and reviewed

This document is the procedure. It does not define what a pack contains.
[`brand-research-pack-specification.md`](./brand-research-pack-specification.md)
is the normative contract for pack shape, vocabularies, safety and
projection, and it stays authoritative wherever the two documents touch the
same subject. Nothing here relaxes a spec rule.

Companions:

- [`brand-research-prompt.md`](./brand-research-prompt.md), the paste-ready
  prompt one pass hands to a deep-research tool;
- [`research-pack-pipeline.md`](./research-pack-pipeline.md), how an authored
  pack becomes runtime candidates;
- [`RESEARCH-INGESTION.md`](../../packages/uds-map/scripts/RESEARCH-INGESTION.md)
  (the ten runtime rules a compiled pack must satisfy).

## 1. Goal and non-goal

A research pass produces, in this order:

1. executable **routes** with an immutable source;
2. **identity** records that distinguish the fitted ECU;
3. **platform and generation classification** with the evidence that selects
   it;
4. **ECU-family hypotheses** that make one validated signal reusable;
5. **DID candidates**, and only where each carries a validation recipe.

The non-goal is a flat brand-wide address table. Spec §25 states the bar:

> Success is not "20,000 DIDs."

A DID with no route, no scope and no way to prove it on a car is a liability.
It costs bus traffic and reviewer time and returns nothing.

**Soft caps per pack:**

| Record class | Cap | Condition to exceed |
|---|---:|---|
| Executable routes | 40 | Each extra route carries its own immutable source and a stated presence test |
| Candidate DIDs | 60 | Each extra candidate carries its own immutable source and a `validation_recipe_id` |
| Documentation-only records | none | Always allowed, never executable |

Caps are soft because evidence can justify more. They are caps because
volume without evidence is the failure mode this protocol exists to prevent.
A pack that hits a cap states in its README which records were held back and
why, so the next pass can pick them up.

## 2. Inputs the researcher gets

A pass starts with three inputs. The first is fixed, the second is pasted,
the third is pasted when it exists.

### 2.1 The prompt

[`brand-research-prompt.md`](./brand-research-prompt.md), self-contained. The
research tool has no repository access, so the prompt embeds the whole
contract. Fill its double-brace placeholders before pasting.

### 2.2 The coverage snapshot

Paste the brand's current state so the pass can tell a gap from a duplicate.
From `packages/uds-map/COVERAGE.md`:

- the brand's row of the main table (WMIs, modules, DIDs, decodable, bound,
  families, decodes, on-vehicle, read services, identity, platforms, level,
  gateway, confidence);
- its line under **Profiled levels**;
- its entries under **Unknown bindings**;
- its rows in the **Sources** table.

From `packages/uds-map/data/uds-map.json`, the brand object:

- `id`, `name`, `wmi[]`, `profiled_level`, `confidence`, `scan_policy`;
- `platforms[]` with each `vds_pattern`, or the fact that the array is empty;
- `modules[]` request/response pairs, `read_service` and `address_extension`;
- `did_bands[]` with their notes;
- `known_dids[]` identifiers, their `modules`/`binding` and whether they
  decode;
- `identity_block`, `gateway_behaviour`, `sources[]`.

Finally list the brand's existing research packs under
`docs/product/research/` by directory name and version. A new pass extends
them; it never silently re-authors what is already there.

### 2.3 The research request export

Generated, not authored. Backlog item RP-4 exposes it at
`GET /vehicles/{id}/research-request` and as an MCP tool. It is de-identified
and speaks the pack's conflicts-and-gaps vocabulary. Fields:

| Field | Meaning | How the pass uses it |
|---|---|---|
| `wmi` | The VIN prefix that routed the vehicle | Confirms the pass targets the right brand |
| `platform_key` | Classified platform, or null | Null means the pass owes a `vds_pattern` hypothesis |
| `modules[].fingerprint` | Hardware, software and system-name tuple, no VIN, no serial | Seeds ECU-family hypotheses with a real reference example |
| `modules[].route` | Protocol and request/response pair reached | Confirms or contradicts a sourced route |
| `route_outcomes[]` | Per route: `reached`, `refused` with NRC, `silent`, `transport_failed` | A refused route is a fitted ECU; a silent one is a gap record, not absence |
| `unlabeled_dids[]` | DID, byte length, shape class | The highest-priority decode questions: the car answers here and nothing names it |
| `conflicted_identities[]` | Modules whose identity read disagreed across connections | Becomes a conflict record with both variants retained |
| `knowledge_key` | The map version and pack set the vehicle ran against | Pins the snapshot the answers apply to |

**Priority rule.** When a research request is present, its `unlabeled_dids`
and `route_outcomes` are the pass's highest-priority questions, ahead of any
public database sweep. The car has already narrowed the search. A pass that
ignores the export and returns a generic address list has failed even if
every record is well sourced.

## 3. Source order and grading

Work down this order. Stop promoting a claim the moment its tier cannot
support it.

| Tier | Source class | Executable? | Requirement |
|---:|---|---|---|
| 1 | Open diagnostic databases with immutable revisions | Yes | 40-character blob or commit SHA, and a URL containing it |
| 2 | OEM documents with a date | Yes, with care | Publication or retrieval date, plus a content checksum where legally practical |
| 3 | Forum and community captures | Yes at `community_reported` | A resolvable citation and a stated scope |
| 4 | Everything else | No | `automatic_execution_authorized: false`, documentation only |

Rules that override the tier:

- **Mutable URLs are tier 4.** A `main` or `master` path is documentation
  only, whatever repository it points at. Resolve the blob SHA and cite that,
  or drop the claim to documentation.
- **Licence gates execution.** GPL-derived and proprietary-derived material
  yields hypotheses and validation leads, never a copied formula presented as
  fact. Record the licence on every source.
- **Reliability is per claim, not per source.** A high-reputation repository
  can carry a low-reliability claim, for instance one address noted in a
  comment with no capture behind it. Grade what the source proves for this
  claim.
- **Screenshots and tool captures** are evidence of one tool's belief, not of
  the bus. They are tier 3 at best, and they need the vehicle facts around
  them.

## 4. Anti-fabrication rules

These bind any pass, and they bind a deep-research language model hardest.
A model asked for a table will produce a table. The rules exist so that an
empty answer is a legal answer.

1. **Every executable record resolves.** A route or DID marked executable
   carries at least one `source_refs` entry, that ref exists in
   `source-ledger.json`, and the ledger entry has a URL that resolves to the
   exact revision cited. Unresolvable means documentation-only.
2. **No sibling inheritance without a record.** A route or DID may not be
   copied from another brand in the same group because the platform is
   "probably shared". Either produce an explicit record with
   `knowledge_state: "inherited"`, the source that establishes the shared
   platform, and a `non_generalization_boundary`, or omit it.
3. **Conflicts are kept, never averaged.** Two sources giving different
   response IDs for the same role become two scoped route records plus a
   conflict entry. Two scale factors for one DID become two
   `decoder_variants`. Never pick by source order, recency or majority.
4. **Unknown is an empty array plus a gap.** Where nothing is known, the file
   holds `[]` and `conflicts-and-gaps.json` holds a gap record with its
   priority, the evidence required and the safe next action. A plausible
   guess in place of an empty array is the single worst failure mode.
5. **Self-consistency pass.** Before finishing, list every claim supported by
   exactly one source. Print that list. A single-source executable claim is
   allowed, but it must be visible to the reviewer rather than buried.
6. **No invented identifiers.** Every `platform_id`, `route_id`,
   `candidate_id`, `ecu_family_id` and `validation_recipe_id` referenced
   somewhere is defined somewhere. The validator rejects dangling foreign
   keys, so a fabricated reference fails the build rather than shipping.
7. **Counts must match.** Any declared count equals the length of the array
   it describes.

## 5. Platform-first discipline

A pack that lists DIDs before it proposes platforms has skipped the step that
makes the DIDs usable.

Required order inside a pass:

1. Propose platform and generation branches in `platforms.json`. Each branch
   carries a `scope`, an `architecture`, `transport_candidates`, its
   `classification_evidence` and a `non_generalization_boundary`.
2. Give each branch a selector: a `vds_pattern` hypothesis with its source,
   or explicit vehicle facts (model, year range, powertrain) that select it.
   A branch with neither selector is inert at runtime and must say so.
3. Scope every route and candidate to a `platform_ids` entry or an
   `ecu_family_ids` entry.
4. Use brand-wide scope only with evidence from more than one independent
   platform family. Spec §21 expects that to be rare.

Two consequences worth stating plainly:

- **A platform-scoped record with no accepted `vds_pattern` is inert.** That
  is correct behaviour, not a bug. Tag the record with its real platform key
  anyway. Fudging it to a broader scope to make it fire is a defect.
- **Model evidence is not platform evidence.** One model's capture scopes to
  that model until a source establishes the platform boundary.

## 6. Review checklist

A reviewer ticks every row before a pack merges. A blank row blocks the pack.

| # | Check | Where to look | Pass condition |
|---:|---|---|---|
| 1 | Manifest hashes | `index.json` vs the files | Every canonical file listed, every SHA-256 matches |
| 2 | Immutable sources on executable claims | `source-ledger.json` | Every executable claim's source has a 40-character revision inside its URL, or a dated OEM record |
| 3 | Closed vocabularies | all files | Every enum value appears in the spec's closed lists; no invented status strings |
| 4 | One address per route | `ecu-routes.json` | No `730/748` shorthand; uppercase hex, no `0x`, widths agree with the protocol |
| 5 | Session discipline | `ecu-routes.json` | Every automatically executable route is `session: "default_only"` |
| 6 | Budgets narrow only | `transport-session-safety-policy.json` | No value exceeds the central ceilings in spec §17 |
| 7 | Negative evidence preserved | `command-support-evidence.json` | Refusals, timeouts and unsupported results are recorded with scope and NRC, not deleted |
| 8 | Platform proposals present | `platforms.json` | At least one branch, each with a selector or an explicit statement that it has none |
| 9 | Conflicts and gaps non-empty | `conflicts-and-gaps.json` | A first pack with an empty file is rejected; a first pass always leaves open questions |
| 10 | Projection report counts | `projection-report.json` | Input and projected counts reconcile; deferred records are explained |
| 11 | Runtime test | Rust test suite | One test asserts this brand's candidates surface from `routes_for_context`, and that inapplicable ones stay inert |
| 12 | Caps respected | README | Route and DID counts within §1 caps, or each excess record justified |

Row 11 is not optional. A protocol string outside the closed vocabulary
fails silently: the route is dropped from every plan with no error. A zero
route count is the symptom, and only a test catches it.

## 7. Priorities and cadence

Order of brands for the pass, from the coverage brief:

1. **Cars reachable for physical validation.** A pack that can be tested on a
   car within the same week is worth more than three that cannot. Validation
   is the bottleneck, not authoring.
2. **Brands with sourced routes and zero decodes.** Today: `honda`, `skoda`,
   `seat`. Routes and identity blocks already exist, so a pass starts from a
   reachable module rather than from nothing, and one validated decode moves
   the brand a whole level.
3. **The two enumeration questions.** Brands recorded as `standard_only`
   where enhanced diagnostics are believed reachable but unprofiled, and
   brands where a `scan_policy` gap would authorise enumeration by default.
   Both are answered by evidence, not by opinion.
4. **Badge-only brands.** No map entry at all. These are from-scratch packs,
   the most expensive per unit of validated knowledge, and they go last.

Cadence:

- **One pack per brand per pass.** A pass that covers three brands produces
  three packs, each with its own manifest, ledger and version.
- **Re-run a brand** when its coverage snapshot changes (new routes, a new
  accepted platform, a first decode) or when a new research request export
  arrives from a vehicle of that brand. Both change the questions.
- **Version, never overwrite.** A second pass on a brand is
  `<brand>-deep-research-v2`, authored beside v1. The older pack stays as the
  record of what was believed and why.

## 8. What happens after

1. **Compile.** Run `research:compile` with `--input`, `--output`, `--report`
   and the mandatory `--archive`. The archive keeps the manifest-verified
   authoring inputs beside the runtime output.
2. **Validate.** Run `research:validate` on the authoring directory (target,
   backlog RP-2). It reports the spec §23 shape and exits non-zero on any
   failure.
3. **Test.** Run the Rust discovery tests, including the new brand's
   surfacing test from checklist row 11.
4. **Open the PR** with a **What this unlocks** section: which vehicles the
   pack newly plans for, how many executable routes and candidate DIDs, what
   stays inert and why, and which gaps the pass deliberately left open.
5. **Attach the physical validation plan.** Which vehicles, in what order,
   which recipes, and what result would promote which record.
6. **Point at the promotion rules.** Spec §21 governs. Promotion needs the
   route, DID, payload shape and physical behaviour reproduced, at the
   narrowest valid scope, and never overwrites stronger vehicle evidence.

A pack is not finished when it merges. It is finished when one of its
candidates has been proven or disproven on a car, and the result has been
written back.
