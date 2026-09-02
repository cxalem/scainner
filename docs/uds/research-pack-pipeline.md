# Research pack pipeline

Version 1.0 · 2026-09-02 · reference for how an authored pack becomes runtime
candidates and how vehicle evidence feeds the next pass

Companions:

- [`brand-research-pack-specification.md`](./brand-research-pack-specification.md)
  (the normative pack contract);
- [`brand-research-protocol.md`](./brand-research-protocol.md), how a pass is
  run and reviewed;
- [`RESEARCH-INGESTION.md`](../../packages/uds-map/scripts/RESEARCH-INGESTION.md)
  (the ten runtime rules a compiled pack must satisfy).

## 1. Today

Verified in the repository at this version.

| Piece | State |
|---|---|
| Authoring format | Specification-shaped directory with an `index.json` manifest, spec v1.0 |
| Compiler | `packages/uds-map/scripts/compile-research-pack.ts`, run as `pnpm --filter @scainner/uds-map research:compile`. Verifies the manifest, archives sources, emits a runtime pack JSON plus a projection report |
| Compiled packs | `renault-deep-research-v1`, `manufacturer-group-deep-research-v1` |
| Legacy path | Per-brand Python scripts append deltas into `data/research/existing-brand-hypotheses-v3.json`. Two brands live there today: `seat` with 100 routes, `vag` with 104 |
| Runtime loading | `elm/discovery/research.rs` embeds packs through a hand-maintained `EMBEDDED: &[(&str, &str)]` table of `include_str!` entries, plus the `data/research-packs.json` index |
| Planner gate | `plan.rs` adds research routes only after an exact platform match, from `uds_map::platform_for_vin` or `research::platform_for_vehicle_facts`. Make-level routes come late |

Gaps as of this version:

- `pnpm research:validate` (spec §23) does not exist.
- No research-request export from vehicle evidence.
- A new pack **file** needs a Rust edit and a rebuild, because the
  `EMBEDDED` table is hand-maintained.
- One brand in the legacy delta has no `platforms[]` entry in the trusted
  map, so its platform-scoped routes are inert until a vehicle-descriptor
  pattern is confirmed. That is correct behaviour, not a defect.

## 2. Decision

**One authoring format, one compiler, one runtime shape.**

1. The specification directory is the only input. The Python delta scripts
   are retired. `existing-brand-hypotheses-v3.json` is frozen as a legacy
   pack, and no new brand is appended to it. A new brand is a new
   specification pack, compiled to its own runtime file at
   `data/research/<brand>-deep-research-v<n>.json`, plus one line in the
   index.
2. **Zero-Rust-change pack loading.** A `build.rs` in
   `apps/desktop/src-tauri` reads `data/research-packs.json` at build time
   and generates the `EMBEDDED` table into `OUT_DIR`. `research.rs` includes
   the generated module. Adding a pack becomes a file plus an index line. A
   unit test asserts every index entry loads and parses.
3. **A standalone validator.** `research:validate <dir>` is the compiler's
   validation stage as its own command, reporting the spec §23 shape and
   extended with the §6 rejections the compiler does not yet perform. It
   exits non-zero on any failure and warns on documentation-only records.
4. **A platform bridge.** The compiler emits `platform-proposals.json` beside
   the projection report for any pack declaring platforms the trusted map
   lacks. A human moves accepted proposals into `uds-map.json`.
5. **A loop back.** A generated, de-identified research request export turns
   what a car said into the next pass's highest-priority questions.
6. **Research coverage is visible.** `COVERAGE.md` gains a per-brand research
   section generated from the runtime packs, so research progress is a
   scoreboard like the trusted map.

## 3. The flow

```text
authoring directory                 docs/product/research/<pack>/
  index.json + canonical JSON            manifest hashes, source ledger
        │
        ▼
  research:validate                 spec §23 report, non-zero on failure
        │                           (target, RP-2)
        ▼
  research:compile                  verifies manifest, archives inputs
        │
        ├──► runtime pack           packages/uds-map/data/research/<pack>.json
        ├──► projection report      docs/product/research/<pack>/projection-report.json
        ├──► platform proposals     docs/product/research/<pack>/platform-proposals.json
        │                           (target, RP-5)
        └──► source archive         docs/product/research/<pack>/source/
        │
        ▼
  data/research-packs.json          one index line per runtime pack
        │
        ▼
  build.rs                          generates the EMBEDDED table (target, RP-1)
        │
        ▼
  research.rs                       loads and parses every indexed pack
        │
        ▼
  plan.rs                           exact-platform candidates first,
        │                           make-level routes late,
        │                           unsupported records never
        ▼
  vehicle evidence                  route outcomes, fingerprints,
        │                           unlabeled answers, conflicts
        ▼
  research request export           de-identified JSON (target, RP-4)
        │
        └──────────────────────────► next pass's prompt
```

The archive step is mandatory. The compiler rejects absolute, nested and
traversal manifest paths, duplicate entries, symlinks, non-files, malformed
hashes and hash mismatches before it copies anything. It archives `index.json`
plus exactly the files that index declares, and records every archived hash in
the projection report. Generated runtime data and the report itself stay
outside `source/`.

## 4. The platform bridge

A platform-scoped candidate fires only when the runtime can classify the
vehicle onto that platform. There are two classifiers:

- `uds_map::platform_for_vin`, which needs a `vds_pattern` on a `platforms[]`
  entry of the **trusted** map;
- `research::platform_for_vehicle_facts`, which works from normalized model
  facts when they select one platform unambiguously.

A pack's own `platforms.json` does not grant either. So the compiler emits
`platform-proposals.json` listing every platform the pack declares that the
trusted map lacks, with the pattern hypothesis and its sources. A human
reviews each proposal and moves the accepted ones into `uds-map.json`.

Until a proposal is accepted, that platform's candidates are inert. This is
the designed behaviour. The rule for authors is in
[`brand-research-protocol.md`](./brand-research-protocol.md) §5: tag the
record with its real platform key, and never widen the scope to make it fire.

## 5. The loop back

The export is generated from the vehicle database, never authored. It speaks
the pack's conflicts-and-gaps vocabulary, and it carries no VIN and no serial.

| Field | Contents |
|---|---|
| `wmi` | The VIN prefix that routed the vehicle |
| `platform_key` | The classified platform, or null |
| `modules[].fingerprint` | Hardware, software and system-name tuple |
| `modules[].route` | Protocol and request/response pair reached |
| `route_outcomes[]` | Per route: reached, refused with its negative response code, silent, or transport-failed |
| `unlabeled_dids[]` | DID, byte length and shape class, for answers nothing names |
| `conflicted_identities[]` | Modules whose identity read disagreed across connections |
| `knowledge_key` | The map version and pack set the vehicle ran against |

`unlabeled_dids` is the point of the whole loop. A car answering on an
identifier nothing can name is the cheapest research question in the system,
because the route is already proven and the payload is already in hand. A
pass that starts from this export beats a pass that starts from a public
database sweep.

## 6. Backlog

| Id | What | Size |
|---|---|---|
| RP-1 | `build.rs` pack loader: generate the `EMBEDDED` table from `data/research-packs.json`; unit test that every index entry loads and parses | S |
| RP-2 | `research:validate <dir>`: the spec §23 report, extended with the §6 rejections (duplicate IDs across files, unresolved platform, route and family IDs, count mismatches, enum, address and DID canonical form, the immutable-source rule for executable claims, budgets only narrowing). Non-zero exit on failure | M |
| RP-3 | Re-compile the two legacy-delta brands from their specification directories into their own packs, remove them from the delta, assert route counts equal or higher | M |
| RP-4 | Research request export: `GET /vehicles/{id}/research-request` and an MCP tool, de-identified, in the conflicts-and-gaps vocabulary | M |
| RP-5 | Platform proposals from the compiler, plus a research section in `COVERAGE.md` generated from the runtime packs | S |
| RP-6 | Docs: this file, the protocol, the paste-ready prompt, and `RESEARCH-INGESTION.md` pointing at the single path | S |

Sizes: S is under a day, M is a few days, L is a week or more.

Order: RP-1, RP-2, RP-3, RP-4, RP-5, RP-6. RP-1 removes the Rust edit from
every future pack. RP-2 makes a broken pack fail before it reaches the
runtime. RP-3 empties the legacy path so there is genuinely one path. RP-4
closes the loop.

## 7. Later: packs served remotely

Not now, and nothing in RP-1 through RP-6 blocks it.

The runtime shape is a JSON document keyed by pack id. Once the loader reads
that shape from a generated table rather than a hand-maintained one, the
source of the document stops mattering to `research.rs`. Serving packs from
the backend with the same runtime shape then becomes a fetch, a signature
check and a local snapshot cache, with the embedded packs as the offline
fallback. The authoring format, the compiler and the projection report do not
change.
