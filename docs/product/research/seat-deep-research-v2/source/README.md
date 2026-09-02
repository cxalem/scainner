# SEAT deep research v2

**Pack id:** `seat-deep-research` · **Pack version:** 2 · **Migrated:** 2026-09-02
**Authoring contract:** [UDS brand research pack specification](../../../uds/brand-research-pack-specification.md) v1.0

This directory carries the same research as `seat-deep-research-v1`, rewritten
into the specification's shape by
`packages/uds-map/scripts/migrate-legacy-research-pack.ts`. The evidence did
not change; the shape, the identifiers and the source pins did, which is why
it is a new version rather than an edit of the directory it came from.

## What the migration changed

| v1 | v2 |
|---|---|
| No manifest | `index.json` hashes every canonical file with SHA-256 and declares every record count |
| `0x`-prefixed, mixed-case addresses | Uppercase hexadecimal without a prefix, one request/response pair per route |
| Packed alternatives such as `730/748` | One route record per address pair |
| `can11_isotp_uds` / `_candidate` | `can11_500`, the runtime transport, or documentation-only with the original label kept in `transport_notes` |
| Free-text `knowledge_state` values | The closed §4 vocabulary, plus `vehicle_fit`, `identity_fit` and `activation` |
| Routes with no ids or scope | `route_id`, structured `scope`, `read_services`, `session: default_only` |
| A single `decode` per DID | `decoder_variants[]` with canonical `scale`/`bias` signals and a plausibility window |
| Platform `id` / `models_examples` / `approx_era` | `platform_id` and a structured scope with normalized model ids and year bounds |
| Sources cited by branch or repository root | URLs pinned to a 40-character blob digest; sources without one are documentation-only |
| No `claims[]` | 7 claims, one per execution-eligible source, each with an action, a promotion test and a boundary |

The steering-route conflict the v1 README called out is now a `conflicts-and-gaps.json` record that names both route ids instead of prose.

## What it contains

| Record | Count |
|---|---|
| Routes | 102 (102 authorized for automatic execution) |
| DID candidates | 246 (246 authorized) |
| Command evidence | 0 |
| Platforms | 10 |
| ECU families | 7 |
| Module inventories | 6 |
| Validation recipes | 8 |
| Conflicts / gaps | 5 / 23 |
| Sources | 28 (8 pinned to an immutable revision) |

## What could not be expressed

- 5 records had no single canonical identifier or no resolved
  response address. They are preserved as research leads in
  `conflicts-and-gaps.json` and generate no traffic.
- 2 source decoders describe a field layout the canonical
  `scale`/`bias` language cannot state: a repeated array, an unresolved
  scale, a list of what the payload "contains". The identifier survives as a
  candidate; the source form is preserved beside it in
  `source_decode_unconverted` and listed as a gap.
- No platform is VIN-selectable from this pack. Every platform ships an
  explicit `platform_not_vin_selectable` gap, and the compiler emits
  `platform-proposals.json` for a human to review.

## Regenerating

From the repository root:

```sh
node --experimental-strip-types \
  packages/uds-map/scripts/migrate-legacy-research-pack.ts --brand seat \
  --input docs/product/research/seat-deep-research-v1 \
  --output docs/product/research/seat-deep-research-v2
```

`source/` is the compiler's archive of exactly the files `index.json`
declares, written by `research:compile` beside the projection report.
