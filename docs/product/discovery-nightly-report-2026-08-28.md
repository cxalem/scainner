# Discovery Track A — nightly report, 2026-08-28

Branch `feat/discovery-knowledge-layer` (from `feat/discovery-base`), PR against
`main`, not merged. Implements plan A1–A8 of
`docs/product/discovery-implementation-plan.md`. Backend and data only; no
UI, no supervisor changes, no new dependencies, `contract.rs` untouched.

## What was built

### A1 — `ecu_families` in the uds-map (v8)

- `packages/uds-map/data/uds-map.json`: `version` 8, `generated` 2026-08-28,
  note extended; new top-level `ecu_families[]` with three entries seeded from
  the C4 III fingerprints in
  `apps/desktop/docs/workflows/parked-vehicle-verification.md`:
  - `cont_esp_mk100_psa` — Continental/ATE ESP MK100, hw `9846124980`, sw
    `9695041580`, seen on PSA `6AD/68D`, 12 decodes converted from the ABS
    `known_dids` (`D400–D403`, `D405`, `D406`, `D40C`, `D41F`, `D42E`, `D46D`,
    `D479`, `D412`).
  - `dae_uds2_psa` — steering, hw `9844551780`, sw `9695027380`, `6B5/695`,
    4 decodes (`D40D`, `D40E`, `D40F`, `D411`; the last two `signed`).
  - `cvm3_psa` — camera, hw `9817137180`, sw `9694921880`, `74A/64A`, identity
    only (ten `D4xx` DIDs answered but were constant under every test, so no
    decode is claimed).
  - Decode state mapping from `known_dids.confidence`: `confirmed` →
    `locally_confirmed` (`vehicles_confirmed: 1`); `high` and `low` →
    `research_candidate` (`vehicles_confirmed: 0`) with the evidence note
    extended to say why (Diagbox-derived unit/position not independently
    calibrated; or not verified on a vehicle). Every decode carries a
    `discriminating_test` — the cheapest physical check from the sessions.
  - `known_dids` are untouched; families are the new reuse path.
- `packages/uds-map/src/types.ts`: `KnowledgeState`, `FamilyDecode`,
  `FamilyModuleRef`, `EcuFamily`, `UdsMap.ecu_families?`.
  `src/index.ts`: `ecuFamilies()`, `familyForHardwareRef()`.
  `src/index.test.ts`: families parse, every reference is ten digits, the
  C4 ABS joins to twelve decodes.

### A2 — `apps/desktop/src-tauri/src/elm/discovery/family.rs`

- `CompatibilityKey { supplier, family, hardware_ref, software_ref,
  payload_variant, service }` built by `from_fingerprint(spare_part_number,
  software_version, system_name, f0fe_payload)`: `spare_part_number` →
  `hardware_ref`, `software_version` → `software_ref`, `system_name` →
  `family`, PSA `F0FE` byte 4 → opaque `supplier` code
  (`supplier_code_from_f0fe`), else `None`. The key never carries VIN,
  serial or address (tested).
- `match_family(&key, &UdsMap) -> FamilyMatch::{Strong{family_id},
  Weak{family_id}, NameOnly{family_id}, None}`: same hardware ref + software
  ref in the family's list → Strong; hardware ref only → Weak; family or
  supplier name (case-insensitive, substring) → NameOnly.
- Tests: C4 ABS → Strong; same hw + different/unknown sw → Weak; name only →
  NameOnly; unknown → None; F0FE code extraction.

### A3 — `discovery/state.rs` + `src/db.rs`

- Enums with `as_str`/`parse`/`ALL`: `KnowledgeState` (the protocol's nine
  states), `VehicleFit` (`untested|matched|conflicted|insufficient`),
  `RouteState` (`reached|refused|silent|transport_failed|closed`),
  `Activation` (`disabled|learning|enabled`), `IdentityFit`
  (`provisional|stable|conflicted`).
- Rules as functions: `check_activation` (`enabled` requires
  `vehicle_fit=matched`; `learning` requires `app_settings.learning_state =
  "on"`), `next_identity_fit` (first read → provisional; byte-identical
  repeat → stable; mismatch → conflicted, sticky). `RuleViolation { rule,
  reason }` is what the API returns as 409.
- Class filter `is_hypothesis_candidate(did, payload_len, payload_sample)`:
  excludes `F000–F1FF` and `D600–D7FF`, payloads ≥ 16 bytes (security /
  checksum material), serial-like printable ASCII (≥ 6 chars), and ≥ 10-byte
  payloads with high distinct-byte ratio (opaque blobs). Tested against the
  C4's real answers (`F080`, `D619 "DSGiRESC00.1170001"`, the `D636` blob,
  `D400`, `D406`, `D40C`, `D422`).
- Schema v10 (idempotent, same style as v7): tables `hypotheses` (all
  columns from plan A3, unique on `vehicle_id, module_id, did`, `cloud_id`)
  and `hypothesis_samples`; `discovered_modules` gains `identity_fit`,
  `identity_reads`, `identity_hash`, `route_json`, `family_id`,
  `family_match`. `DiscoveredModuleRow` (and therefore
  `GET /vehicles/{id}/modules`) now also carries those five fields.
- Queries: `upsert_hypothesis` (refreshes knowledge, never touches
  `vehicle_fit`/`activation`, never downgrades a confirmed state),
  `list_hypotheses`, `hypothesis`, `patch_hypothesis` (rule enforcement),
  `insert_hypothesis_sample` (+ `_keeping`; retention keeps the newest 5000
  per hypothesis by insertion order), `hypothesis_samples`,
  `record_identity`, `set_module_family`, `set_module_route`,
  `standard_coverage`.

### A4 — `discovery/join.rs`

`join_vehicle(db, map, vehicle_id) -> JoinSummary`. For every module in
`discovered_summary`: identity `conflicted` → skipped; no fingerprint →
skipped ("identity block not answered yet"); otherwise match a family, store
`family_id`/`family_match` on the module, and for Strong/Weak matches upsert
one hypothesis per family decode with `knowledge_state` = the decode's
state, `vehicle_fit = untested`, `activation = disabled`, `label`,
`decode_json` (contract `InheritedDecode` fields + `family_id`,
`family_match`, `family_state`, `vehicles_confirmed`, `evidence`) and
`discriminating_test`. NameOnly → same rows as `research_candidate`. Every
`discovered_dids` row that is not a family decode and passes the class
filter becomes an `unknown` hypothesis. Idempotent: re-running reports
`refreshed` instead of `created`, never duplicates, never overwrites what
the vehicle established. Tests on a seeded C4 (`join::fixtures::seed_c4`,
shared with coverage and API tests): 12 ABS + 4 EPS inherited, camera 0,
engine skipped; 4 unknown hypotheses and 3 filtered DIDs; weak match flagged
`weak`; name-only → research candidates; conflicted identity → skipped;
re-run after a manual `matched/enabled` keeps it.

### A5 — `discovery/coverage.rs`

`coverage(db, map, vehicle_id) -> Option<CoverageReport>` (Serialize):
`vehicle` (id, name, `vin_known`, WMI, brand — the VIN itself is not
repeated), `standard` (distinct reading keys, reading count, latest DTC scan;
**omitted** when no readings/scans exist rather than zeroed), `routes`
(reached count, module ids, `states_stored: ["reached"]`, `limitations`
saying refused/silent/closed are not persisted per route yet), `identified`
(fingerprinted/total, stable/provisional/conflicted, family matches, per
module), `decodes` (buckets with hypothesis ids: `inherited_untested`,
`matched`, `conflicted`, `insufficient`, `research_candidate`, `unknown`,
`enabled`, `closed_route`), `hypotheses` (summary rows), `learning`
(`learning_state_on`, `passive_would_validate` = untested hypotheses with a
decode, `guided_steps` = unmatched hypotheses with a `discriminating_test`),
`evidence` (`run_ids` from `verification_runs`, `module_ids`,
`hypothesis_ids`), `status: complete|partial` with `remaining` reasons.

### A6 — API

`src/api/ops.rs`, `src/api/mod.rs`, `src/api/openapi.rs`,
`scripts/scainner_api.py`:

| Route | Python | Notes |
|---|---|---|
| `GET /vehicles/{id}/coverage` | `coverage(id)` | 404 unknown vehicle |
| `GET /vehicles/{id}/hypotheses` | `hypotheses(id)` | 404 unknown vehicle |
| `POST /vehicles/{id}/join` | `join_vehicle(id)` | local, no car, idempotent |
| `PATCH /hypotheses/{id}` | `patch_hypothesis(id, **fields)` | body: any of `knowledge_state`, `vehicle_fit`, `activation`, `label`; 400 empty body, 404 unknown id, 409 `{"error", "rule"}` on a rule violation |
| `GET /learning-state` | `learning_state()` | `{"on": bool}` |
| `PUT /learning-state` | `set_learning_state(on)` | `{"on": bool}` → `app_settings.learning_state` |

Router test `join_coverage_and_hypothesis_rules_through_the_router` walks
join → coverage → hypotheses on the seeded C4 and checks both 409 rules,
the learning-state switch and the matched/enabled path; the existing
`openapi_matches_the_router` test covers the six new routes.

### A7 — `discovery/identity.rs`

`record_identity(db, module_id, &EcuFingerprint) -> Option<(IdentityFit,
reads)>`: hashes the fingerprint `match_key` (FNV-1a 64, written out so a
toolchain change cannot flip persisted hashes; serial and VIN never enter
it) and applies `next_identity_fit` through `Db::record_identity`. A
fingerprint without comparison material does not count as a read. Not wired
into the supervisor (outside ownership) — see follow-ups.

## Tests

| Suite | Before | After |
|---|---|---|
| `cargo test` (apps/desktop/src-tauri) | 98 | 126 |
| `vitest` (packages/uds-map) | 19 | 21 |

`cargo fmt --check` clean. `cargo clippy --all-targets`: no new warnings in
owned files — the remaining ones are the pre-existing `uds_map.rs` ones
(`version`/`note` never read, `hex_any`, `extended_modules_for_vin`), the
two pre-existing "too many arguments" in `db.rs`, and the scaffold's
`correlation/contract.rs` dead-code warnings (Track B's). `npx tsc --noEmit`
clean in `apps/desktop` and `packages/uds-map`.

## How to exercise it on the real C4 database

The app must be running (it serves the API from the process that owns the
database). Token and port come from the app data dir.

```bash
TOKEN=$(cat ~/Library/Application\ Support/com.cxalem.scainner/api-token)
H="Authorization: Bearer $TOKEN"
B=http://127.0.0.1:47811

curl -s -H "$H" $B/vehicles | jq '.[] | {id, display_name}'   # find the C4's id
V=1                                                            # substitute

curl -s -X POST -H "$H" $B/vehicles/$V/join | jq
#   expect: modules 6AD/68D strong cont_esp_mk100_psa inherited 12,
#           6B5/695 strong dae_uds2_psa inherited 4, 74A/64A strong cvm3_psa 0,
#           6A8/688 skipped "no fingerprint"; unknown_created = the swept DIDs
#           that pass the class filter (D4xx on ABS/EPS/camera/engine)

curl -s -H "$H" $B/vehicles/$V/coverage | jq '{status, remaining, decodes: (.decodes | with_entries(.value |= (.count // .)))}'
curl -s -H "$H" $B/vehicles/$V/hypotheses | jq '.[] | select(.family_id != null) | {id, module_address, did, label, knowledge_state, vehicle_fit, activation}'

# Walk one hypothesis through the rules (D400 on the ABS):
ID=$(curl -s -H "$H" $B/vehicles/$V/hypotheses | jq '.[] | select(.module_address=="6AD/68D" and .did==54272) | .id')
curl -s -X PATCH -H "$H" -H 'content-type: application/json' $B/hypotheses/$ID -d '{"activation":"enabled"}'      # 409 enabled_requires_matched
curl -s -X PATCH -H "$H" -H 'content-type: application/json' $B/hypotheses/$ID -d '{"activation":"learning"}'     # 409 learning_requires_learning_state
curl -s -X PUT   -H "$H" -H 'content-type: application/json' $B/learning-state -d '{"on":true}'
curl -s -X PATCH -H "$H" -H 'content-type: application/json' $B/hypotheses/$ID -d '{"activation":"learning"}'     # 200
curl -s -X PATCH -H "$H" -H 'content-type: application/json' $B/hypotheses/$ID -d '{"vehicle_fit":"matched","activation":"enabled"}'  # 200
```

```python
from scripts.scainner_api import Client, NotConfirmed
c = Client()
v = c.vehicles()[0]["id"]
print(c.join_vehicle(v))
r = c.coverage(v); print(r["status"], r["remaining"], r["decodes"]["inherited_untested"]["count"])
d400 = next(h for h in c.hypotheses(v) if h["module_address"] == "6AD/68D" and h["did"] == 0xD400)
try:
    c.patch_hypothesis(d400["id"], activation="enabled")
except NotConfirmed as e:   # 409 is mapped onto NotConfirmed by the client
    print(e.body["rule"])   # enabled_requires_matched
```

Note on the real rows: `parked-vehicle-verification.md` records that the
stored fingerprints were corrected by hand (ref 1 → `spare_part_number`,
ref 2 → `hardware_version`, `F0FE` → `software_version`). The join reads
`spare_part_number` and `software_version`, so those rows match Strong. The
code on `feat/discovery-base` (`psa_identity_fingerprint`) still stores
F080 ref 2 as `software_version`; a module fingerprinted afresh by that
code would match **Weak** (right part, software ref not in the family
list) until the parser follow-up below lands. The behaviour is correct
either way: weak matches inherit the same rows, flagged.

## Decisions and assumptions

1. **`knowledge_state` is global, `vehicle_fit` is local.** Inherited
   hypotheses keep the decode's world-state (`locally_confirmed` for the
   verified C4 decodes, `research_candidate` for the Diagbox-derived ones)
   and express "inherited, not yet confirmed here" as `family_id IS NOT
   NULL AND vehicle_fit = untested`. The plan says "knowledge_state from the
   decode"; the protocol's `inherited` state remains in the enum for rows
   that need it (e.g. a decode taken from another *installation*), but the
   join does not use it, because collapsing the two dimensions into one
   state is what the four-dimension model exists to avoid.
2. **Weak matches inherit the same rows**, flagged `weak` on the module and
   inside `decode_json`. NameOnly matches create `research_candidate` rows
   with the decode attached, so the correlation engine can test them first.
3. **Modules fingerprinted before `identity_fit` existed are treated as
   provisional** by the join and the coverage report (one read is exactly
   what provisional means), and the report says so in `remaining`.
4. **Class filter bands are global for now** (`F0xx–F1xx`, `D6xx–D7xx`).
   The C4 ABS evidence supports excluding `D6xx/D7xx`, but the engine ECU
   keeps measurements in `D6xx` (`did_bands` says 84 answers). Per-module
   bands are a data change for the uds-map; until then engine `D6xx`
   answers are not turned into hypotheses.
5. **Supplier from `F0FE`** is returned as an opaque code
   (`psa-f0fe-XX`); no verified supplier-code table exists, so nothing is
   named from it. `NameOnly` matching therefore works through
   `system_name`/family names in practice.
6. **Sample retention** is by insertion order (newest 5000 by row id), one
   indexed lookup per insert. The test exercises the rule with a 50-row
   window through `insert_hypothesis_sample_keeping` to keep the suite fast.
7. **`route_state` on hypotheses** is a column with no writer yet; the
   coverage report parses it (`closed_route` bucket) so a writer needs no
   report change.
8. **Identity hash** is FNV-1a over the existing `fingerprint_match_key`
   material. `identity_hash` is an extra column not in the plan; it is what
   makes "byte-identical repeat" checkable without re-reading the evidence
   JSON.
9. `PATCH /hypotheses/{id}` accepts `knowledge_state` changes without a
   promotion rule beyond value validity. The promotion evidence rules
   (protocol S7) are not modelled tonight; the API is the agent's and the
   engine's write path, and a human approves before anything enters the
   shared map.
10. `DiscoveredModuleRow` gained five fields; the frontend ignores unknown
    JSON fields and `tsc` is clean, so no frontend edit was needed.

## Not done, and why

- Nothing calls `record_identity` or writes `hypothesis_samples` in the
  binary: both live in `supervisor.rs` (not owned). They are behind
  explicit `#[allow(dead_code)]` with the reason in the comment.
- Refused / silent / closed route counts are not in the coverage report:
  they only exist inside `verification_runs.result_json` summaries. The
  report says so in `routes.limitations` rather than printing zeros.
- No `learn` step: `correlation::analyze` is still the scaffold; the
  `decode_json` stored on inherited hypotheses deserialises straight into
  the contract's `InheritedDecode` (serde ignores the extra fields), which
  is the hand-off point.

## Proposed contract changes

None needed for this track. One suggestion for the morning: `HypothesisReport`
could carry the `hypothesis_id` it was computed for, so the learn step can
persist `shape_json`/`interpretations_json` without keeping a side map.
Not blocking.

## Follow-ups outside ownership

1. `supervisor.rs`, right after `db.update_ecu_fingerprint(module_id,
   &fingerprint)`: add
   `crate::elm::discovery::identity::record_identity(&db, module_id, &fingerprint);`
   (one line). Then `identity_fit` moves provisional → stable on the second
   connection and the coverage `remaining` line about it disappears.
2. `uds.rs` `psa_identity_fingerprint`: map F080 ref 2 → `hardware_version`
   and `F0FE` bytes 21–23 → `software_version`, as the correction in
   `parked-vehicle-verification.md` describes (the stored rows were fixed by
   hand; the parser was not). Until then fresh fingerprints match Weak.
3. `supervisor.rs`: the S5 hypothesis poll — read `activation = learning`
   hypotheses round-robin and call `db.insert_hypothesis_sample(...)` with
   the nearest standard-PID readings as `refs_json`.
4. `supervisor.rs` / `uds::discover`: persist the route tuple
   (`db.set_module_route`) and per-route outcomes so the coverage report can
   drop its `routes.limitations` entry.
5. uds-map data: per-module `did_bands` classes so the hypothesis class
   filter stops excluding engine `D6xx`.
6. Call `join_vehicle` automatically after a discovery/verification run
   writes fingerprints (supervisor), so the coverage report is populated
   without the `POST /join`.
7. Optional API: `GET /hypotheses/{id}/samples` once samples exist.

## Merge notes

- Additive only: schema v10 ALTERs are idempotent; existing databases keep
  every row. `PRAGMA user_version` moves 9 → 10.
- Files touched are all inside Track A ownership; `contract.rs`,
  `supervisor.rs`, `uds.rs`, `lib.rs`, `Cargo.toml` and the frontend are
  unchanged. Merge after Track B (pure module, no schema) as the plan says;
  no expected conflicts since Track B does not edit `db.rs`, `api/`,
  `uds_map.rs` or the uds-map data.
- Commits on the branch: uds-map v8 + TS mirror; knowledge layer (family,
  state, identity, join, coverage, db); API + Python client; this report.
