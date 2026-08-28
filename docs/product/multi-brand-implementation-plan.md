# Multi-brand implementation plan

v1.1 · 2026-08-28 · closes the gaps in `multi-brand-audit.md` (v1.1) · goal: the car we happen to own becomes one entry in the list of all brands · brand-agnostic by construction: no brand is named here except where its data is being removed from code or cited as a pack entry

## 0. What this plan delivers, in one sentence

After this plan, Scainner has **no brand in code**, a **pack schema that fits every brand's protocol and payload shapes**, a **per-brand replay corpus** that proves the engine on ≥ 5 brands beyond the one we own, without owning the cars, a **connection workflow that runs route → identity → join → coverage automatically from data**, a **generated per-brand coverage table with lints** so drift is impossible, and **brand-neutral product surfaces** — and the car we own is simply one directory among many.

Success = the audit's S1–S6 green, measured as written there. Live validation is **any vehicle we can reach**: the design must produce an honest coverage report for a car of a *profiled* brand (routes, identities, joins) and for a car of a *not-yet-profiled* brand (a report that says `protocol_not_profiled` with a research task) — both without a code change. Which cars those turn out to be is circumstance, not design.

## 1. Principles for every phase

1. **Data first, code second.** Anything a brand needs is a pack entry with a `source`; code reads the pack. A PR adding a CAN id, DID, plan target, identity layout or plan name as a constant is rejected.
2. **Evidence before code** (project rule): each phase starts by converting real captures into fixtures, then makes the code pass them.
3. **Every phase ships with a lint** that fails CI if the pattern regresses (no brand tokens in `src/`, every DID module-bound, every entry sourced, coverage table generated).
4. **Two parallel tracks with disjoint ownership** (as in the discovery plan): a *schema & data* track and a *runtime* track, meeting at typed contracts frozen at the start of each phase. Codex can take either.
5. **Existing evidence is kept, moved, and re-labelled** — never deleted. Every vehicle's fixtures and evidence live under `{brand}/{platform}/`; the current single-vehicle corpus becomes the first such directory.

## 2. Phases

Order follows the reviewer's "shortest path to meaningful multi-brand validation" and the audit's T0–T5. Each phase has: scope, ownership, contract, tests/lints, exit.

### Phase 0 — Hygiene (hours)
- Fix `citroen-c41-v3` vs `v4` mismatch (producer vs tests/OpenAPI/docs) — make the producer derive the version and update tests.
- Correct stale DID counts in `uds-map/README.md` and `RESEARCH.md`.
- Move existing fixtures/evidence into `{brand}/{platform}/` directories under `tests/fixtures/` and `docs/workflows/evidence/`; update paths in scripts and tests.
- Lint 0: a script `scripts/lint_brand_tokens.py` (and a CI step) that fails when `src/`/`src-tauri/src` gain new brand tokens outside tests/comments/pack loader; start with a baseline allow-list that shrinks each phase.

### Phase 1 — Pack schema v9 and data migration (Track A: schema & data, ~3–4 days)
Owner files: `packages/uds-map/**`, `src-tauri/src/elm/uds_map.rs` (types + accessors only), `docs/uds/**`.

Schema additions (all optional, backwards-compatible; every entry carries `source{url,date,type,licence}`):
- `brands[].read_service` (`22|21|1A`) with per-module override `modules[].read_service`; `modules[].route` tuple `{protocol: can11_500|can11_250|can29_nf|can29_target|kwp|iso9141, req, resp, target_byte?, address_extension?, gateway?}`; `brands[].identity_block` `{dids[], layout: iso_ascii|bcd_part_refs|ascii_part_refs|…}` (layout ids name encodings, not brands); `brands[].platforms[]` `{key, vds_pattern, years, ecu_families_expected[], read_service?, notes}`; `brands[].gateway_behaviour` `{silence_means: absent|filtered, writes_blocked, source}`; `brands[].profiled_level`.
- `known_dids[].decodes[]` `{offset,len,signed,encoding: be|le|bcd|ascii|bitfield, bit_offset?, bit_len?, scale,bias,unit,quantity,label}` replacing the single scalar (keep the old fields as a derived first decode for compatibility); `known_dids[].modules` required (lint); `did_bands` re-ranked (`F4xx` demoted).
- `ecu_families[]` unchanged shape; `decodes[]` gain `quantity`.
- Migrate every brand-specific fact that today lives only as prose in `RESEARCH.md` into data with its source: per-module read services (`0x21`, `0x1A` where documented), target-byte and alternative 29-bit addressing schemes, target-byte iteration policies, gateway silence semantics, proprietary-protocol brands marked `protocol_not_profiled`, per-brand identity blocks, and `standard_only` profiles carrying their research notes as sourced candidates.
- Generated artefacts: `packages/uds-map/COVERAGE.md` (the audit §6 table) produced by `pnpm coverage` from the pack, linked from the README; lints: every DID module-bound, every entry sourced, no unscoped fallback, `profiled_level` present for every brand.
- Tests: TS + Rust parse the new schema; round-trip; coverage generator snapshot.

Contract frozen for Phase 2: the Rust types in `uds_map.rs` (`Route`, `IdentityBlock`, `Decode`, `Platform`, accessors `route_for_module`, `identity_block_for_vin`, `read_service_for_module`, `decodes_for_did`).

### Phase 2 — No brand in code (Track B: runtime, ~4–5 days, starts on the Phase 1 contract)
Owner files: `src-tauri/src/elm/{uds.rs,discovery/**,operation.rs,supervisor.rs}`, `src-tauri/src/api/**`, `scripts/scainner_api.py`, `scripts/scainner_mcp.py`.
- `builtin_modules()` → `known_modules_for_vin` + custom; `builtin` → `source`.
- `parked_verification()` → **plan generator**: targets = profile modules ∩ reached routes; identity DIDs from `identity_block`; sweep bands from `did_bands` minus config bands and Phase-1 exclusions per family; `plan_version = {brand}-{platform|unknown}-v{n}`; the existing hand-written plan becomes a regression test that the generator reproduces from that brand's pack data.
- **One fingerprint builder** driven by `identity_block` (ISO first; vendor layouts as data-selected decoders); the two current hardcoded paths (`psa_identity_fingerprint`, `build_fingerprint`) collapse into it; the vendor supplier-byte extraction becomes a layout field; `CompatibilityKey.service` from the module's read service.
- **Service and route parameterised**: request formatting and NRC matching for `22|21|1A`; `0x21` group and `0x1A` request paths; route setup from the route tuple (bit rate, target byte, extension, 29-bit scheme); cleanup restores captured `ATDPN`/header.
- Overlay packs enumerated from `data/packs/`.
- Hypothesis exclusion bands from family/brand data; correlation naming thresholds from a `scale_catalog` per quantity and a machine-readable `quantity` on decodes (no English-label matching).
- **Automatic sequence on connect** (S4): after S0, run census → identity (twice, provisional) → join → coverage, within the discovery protocol's budgets, storing route outcomes (refused/silent/closed) so the coverage report drops its `limitations` entry; expose `GET /vehicles/{id}/coverage` as the product surface.
- Lint 0 allow-list shrinks to zero for `src-tauri/src` outside tests.
- Tests: the existing vehicle replay must still yield the same fingerprints, plan and verified decodes from pack data alone; a second seed vehicle of a different brand (Phase 3 fixture) must pass every layer.

### Phase 3 — Multi-brand replay corpus (Track A after Phase 1, ~3 days; parallel with Phase 2)
Owner files: `src-tauri/tests/fixtures/**`, `scripts/import_obdb_fixtures.py`, `docs/uds/CORPUS.md`.
- Import raw-response ↔ expected-value pairs from the licence-clean (CC BY-SA 4.0) open corpora already catalogued in `RESEARCH.md` — every brand for which such a corpus exists — into `fixtures/{brand}/{platform}/` as `HypothesisInput` and ELM replay JSON, with attribution in `OBDB-NOTICE.md`.
- Cover the seven untested shapes: `0x21` groups, `0x1A`, 29-bit routes incl. target-byte iteration, multi-frame > 8 bytes, offset-binary signed, ASCII, bit-packed flags. Each shape gets an engine test and a state-layer test, drawn from whichever brand's corpus exhibits it.
- GPL-licensed sources are used only to *verify* expectations and recorded as such.
- Add a second seed vehicle of a different brand to `join.rs`/`coverage.rs`/`db.rs`/`api` tests; cross-brand isolation test with two different WMIs.
- Exit: the engine and state layer pass on captured bytes from ≥ 5 brands beyond the one we own; `decode_payload` and `signed_guess` handle > 8 bytes and offset-binary.

### Phase 4 — Brand-neutral tooling and surfaces (~3 days, either track)
- `scripts/session.py` replaces the vehicle-specific session and logger scripts: modules, DIDs, decodes from the pack by VIN; `vehicle_id` from `/status`; evidence named `{brand}/{platform}/{plan}`; graceful degradation without a steering reference; serial port from settings.
- Guided steps generated from open hypotheses via the state-tree contract (discovery protocol §9) with `applicable_if` (gearbox, drivetrain, module presence); `PLAN_VERSION` composed; i18n for the two Lab cards.
- Lab defaults from the profile (module, range); `mock.ts` and mobile demo with 3 vehicles across WMIs; single WMI table derived from the pack + emblem sync test; API/OpenAPI/docs/README/i18n examples ISO-neutral with a second brand in every "for example"; app-wide vehicle switcher.
- Lint: no brand tokens in `apps/desktop/src` outside tests/mock data directories per brand.

### Phase 5 — Transport abstraction (~1 week, after Phase 2)
- `Transport` trait (BT serial, USB serial, TCP ELM, BLE) + platform `BluetoothControl`; adapter profile in settings with enumeration; `device_kind` from the `ATI`/`STI` banner; per-adapter timing profile. Not brand work, but required before any user who is not the author.

## 3. Validation gates (S4 in practice)

| Gate | Vehicle | What must be true |
|---|---|---|
| G1 | Replay of the vehicle we own | Same fingerprints, same verified decodes, same plan — produced from its brand's pack data, no constants |
| G2 | Replays of ≥ 3 other brands (covering `0x21`, 29-bit and > 8-byte shapes) | Routes, identities, joins and coverage from data; engine names nothing without discriminating evidence |
| G3 | **Any live vehicle of a profiled brand** | Within 3 min: reached routes, identities per its identity block, family matches or research tasks, coverage report; after a learning drive ≥ 1 candidate array |
| G4 | **Any live vehicle of a not-yet-profiled brand** | Coverage report says `protocol_not_profiled` with the sourced notes and a research task — no generic enumeration, no false "supported" |
| G5 | Generated coverage table | `COVERAGE.md` regenerates in CI and shows ≥ 5 brands with fixtures and ≥ 2 with live evidence |

## 4. Ownership split for parallel execution

```text
Track A (schema, data, corpus)                 Track B (runtime, API, surfaces)
packages/uds-map/**                            src-tauri/src/elm/{uds,operation,supervisor}.rs
src-tauri/src/elm/uds_map.rs (types/accessors) src-tauri/src/elm/discovery/**, correlation/sanity.rs
src-tauri/tests/fixtures/**                    src-tauri/src/api/**, lib.rs
scripts/import_obdb_fixtures.py, lint scripts  scripts/session.py, scainner_api.py, scainner_mcp.py
docs/uds/**, COVERAGE.md, OBDB-NOTICE.md       apps/desktop/src/**, apps/mobile/**, docs/api.md
Frozen contract per phase: uds_map.rs types + accessors (Phase 1), correlation contract (unchanged)
```

## 5. Order and estimate

Phase 0 (hours) → Phase 1 (3–4 d) ‖ then Phase 2 (4–5 d) ‖ Phase 3 (3 d) → Phase 4 (3 d) → G1–G5 → Phase 5 (1 w). Roughly three weeks of parallel work to S1–S6 green, with the first live test on a second brand possible after Phase 2.

## 6. First PRs (this week)

1. `chore/phase0-hygiene` — v3/v4 fix, counts, fixture/evidence directories, lint 0 with baseline.
2. `feat/uds-map-v9-schema` — schema + accessors + coverage generator + lints (Track A).
3. `feat/fixture-corpus` — imports from every licence-clean open corpus in `RESEARCH.md` and the seven shape tests (Track A, after 2).
4. `feat/no-brand-in-code` — plan generator, identity builder, service/route parameterisation, auto-sequence on connect (Track B, on the v9 contract).
