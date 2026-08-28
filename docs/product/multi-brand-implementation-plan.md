# Multi-brand implementation plan

2026-08-28 · closes the gaps in `multi-brand-audit.md` (v1.1) · goal: the C4 becomes one entry in the list of all brands

## 0. What this plan delivers, in one sentence

After this plan, Scainner has **no brand in code**, a **pack schema that fits every brand's protocol and payload shapes**, a **per-brand replay corpus** that proves the engine on ≥ 5 non-PSA brands without owning the cars, a **connection workflow that runs route → identity → join → coverage automatically from data**, a **generated per-brand coverage table with lints** so drift is impossible, and **brand-neutral product surfaces** — and the C4 is simply `psa/c41`, one of many.

Success = the audit's S1–S6 green, measured as written there. The first live validation targets are the two non-PSA cars we can reach: the **Hyundai Kona** (vehicle #3, already in the DB, Hyundai/Kia profile) and a **Mitsubishi Mirage** (protocol not yet profiled — its coverage report must say so honestly, which is itself a test of the design).

## 1. Principles for every phase

1. **Data first, code second.** Anything a brand needs is a pack entry with a `source`; code reads the pack. A PR adding a CAN id, DID, plan target, identity layout or plan name as a constant is rejected.
2. **Evidence before code** (project rule): each phase starts by converting real captures into fixtures, then makes the code pass them.
3. **Every phase ships with a lint** that fails CI if the pattern regresses (no brand tokens in `src/`, every DID module-bound, every entry sourced, coverage table generated).
4. **Two parallel tracks with disjoint ownership** (as in the discovery plan): a *schema & data* track and a *runtime* track, meeting at typed contracts frozen at the start of each phase. Codex can take either.
5. **The C4 evidence is kept, moved, and re-labelled** — never deleted. It becomes `fixtures/psa/c41/` and `evidence/psa/c41/`.

## 2. Phases

Order follows the reviewer's "shortest path to meaningful multi-brand validation" and the audit's T0–T5. Each phase has: scope, ownership, contract, tests/lints, exit.

### Phase 0 — Hygiene (hours)
- Fix `citroen-c41-v3` vs `v4` mismatch (producer vs tests/OpenAPI/docs) — make the producer derive the version and update tests.
- Correct stale DID counts in `uds-map/README.md` and `RESEARCH.md`.
- Move existing fixtures/evidence into brand directories: `tests/fixtures/{psa/c41,elm}/`, `docs/workflows/evidence/psa/c41/`; update paths in scripts and tests.
- Lint 0: a script `scripts/lint_brand_tokens.py` (and a CI step) that fails when `src/`/`src-tauri/src` gain new brand tokens outside tests/comments/pack loader; start with a baseline allow-list that shrinks each phase.

### Phase 1 — Pack schema v9 and data migration (Track A: schema & data, ~3–4 days)
Owner files: `packages/uds-map/**`, `src-tauri/src/elm/uds_map.rs` (types + accessors only), `docs/uds/**`.

Schema additions (all optional, backwards-compatible; every entry carries `source{url,date,type,licence}`):
- `brands[].read_service` (`22|21|1A`) with per-module override `modules[].read_service`; `modules[].route` tuple `{protocol: can11_500|can11_250|can29_nf|can29_target|kwp|iso9141, req, resp, target_byte?, address_extension?, gateway?}`; `brands[].identity_block` `{dids[], layout: iso_ascii|psa_bcd|vag_ascii|hk_f1a0|…}`; `brands[].platforms[]` `{key, vds_pattern, years, ecu_families_expected[], read_service?, notes}`; `brands[].gateway_behaviour` `{silence_means: absent|filtered, writes_blocked, source}`; `brands[].profiled_level`.
- `known_dids[].decodes[]` `{offset,len,signed,encoding: be|le|bcd|ascii|bitfield, bit_offset?, bit_len?, scale,bias,unit,quantity,label}` replacing the single scalar (keep the old fields as a derived first decode for compatibility); `known_dids[].modules` required (lint); `did_bands` re-ranked (`F4xx` demoted).
- `ecu_families[]` unchanged shape; `decodes[]` gain `quantity`.
- Migrate the prose facts from `RESEARCH.md` into data: Nissan/Renault/older-Kia `0x21` modules; GM/Opel pre-2017 `1A`; BMW `6F1` target bytes; Honda 29-bit target iteration; GM Ultium `14DA` scheme; Mercedes/FCA gateway semantics; Volvo VIDA marked `protocol_not_profiled`; VAG `F19E/F1A2/F1A3` and Hyundai/Kia `F1A0` identity blocks; Mitsubishi `standard_only` with the MUT/ETACS notes as sourced research candidates.
- Generated artefacts: `packages/uds-map/COVERAGE.md` (the audit §6 table) produced by `pnpm coverage` from the pack, linked from the README; lints: every DID module-bound, every entry sourced, no unscoped fallback, `profiled_level` present for every brand.
- Tests: TS + Rust parse the new schema; round-trip; coverage generator snapshot.

Contract frozen for Phase 2: the Rust types in `uds_map.rs` (`Route`, `IdentityBlock`, `Decode`, `Platform`, accessors `route_for_module`, `identity_block_for_vin`, `read_service_for_module`, `decodes_for_did`).

### Phase 2 — No brand in code (Track B: runtime, ~4–5 days, starts on the Phase 1 contract)
Owner files: `src-tauri/src/elm/{uds.rs,discovery/**,operation.rs,supervisor.rs}`, `src-tauri/src/api/**`, `scripts/scainner_api.py`, `scripts/scainner_mcp.py`.
- `builtin_modules()` → `known_modules_for_vin` + custom; `builtin` → `source`.
- `parked_verification()` → **plan generator**: targets = profile modules ∩ reached routes; identity DIDs from `identity_block`; sweep bands from `did_bands` minus config bands and Phase-1 exclusions per family; `plan_version = {brand}-{platform|unknown}-v{n}`; the C4 plan becomes a regression test that the generator reproduces from `psa` data.
- **One fingerprint builder** driven by `identity_block` (ISO first; PSA BCD, VAG ASCII, HK layouts as data-selected decoders); `psa_identity_fingerprint` and `build_fingerprint` collapse into it; `supplier_code_from_f0fe` becomes a layout field; `CompatibilityKey.service` from the module's read service.
- **Service and route parameterised**: request formatting and NRC matching for `22|21|1A`; `0x21` group and `0x1A` request paths; route setup from the route tuple (bit rate, target byte, extension, 29-bit scheme); cleanup restores captured `ATDPN`/header.
- Overlay packs enumerated from `data/packs/`.
- Hypothesis exclusion bands from family/brand data; correlation naming thresholds from a `scale_catalog` per quantity and a machine-readable `quantity` on decodes (no English-label matching).
- **Automatic sequence on connect** (S4): after S0, run census → identity (twice, provisional) → join → coverage, within the discovery protocol's budgets, storing route outcomes (refused/silent/closed) so the coverage report drops its `limitations` entry; expose `GET /vehicles/{id}/coverage` as the product surface.
- Lint 0 allow-list shrinks to zero for `src-tauri/src` outside tests.
- Tests: the C4 replay must still yield the same fingerprints, plan and 14 decodes from `psa` data; a second seed vehicle (Phase 3 fixture) must pass every layer.

### Phase 3 — Multi-brand replay corpus (Track A after Phase 1, ~3 days; parallel with Phase 2)
Owner files: `src-tauri/tests/fixtures/**`, `scripts/import_obdb_fixtures.py`, `docs/uds/CORPUS.md`.
- Import raw-response ↔ expected-value pairs from the CC BY-SA 4.0 OBDb test corpora already cited in `RESEARCH.md`: `Mercedes-Benz-EQB`, `Nissan-Leaf` (incl. the `0x21` LBC block), `Polestar-2`, `Volvo-XC40-Recharge`, and Honda/Mazda/Toyota model signalsets — into `fixtures/{brand}/{model}/` as `HypothesisInput` and ELM replay JSON, with attribution in `OBDB-NOTICE.md`.
- Cover the seven untested shapes: `0x21` groups, `0x1A`, 29-bit routes (Honda target iteration, Volvo `18DA10F1`), multi-frame > 8 bytes (Hyundai `22 01 01`, Toyota cell voltages), offset-binary signed, ASCII, bit-packed flags. Each shape gets an engine test and a state-layer test.
- GPL sources (OVMS, CanZE) are used only to *verify* expectations and recorded as such.
- Add a second seed vehicle (VW or Hyundai) to `join.rs`/`coverage.rs`/`db.rs`/`api` tests; cross-brand isolation test with two different WMIs.
- Exit: the engine and state layer pass on ≥ 5 non-PSA brands' captured bytes; `decode_payload` and `signed_guess` handle > 8 bytes and offset-binary.

### Phase 4 — Brand-neutral tooling and surfaces (~3 days, either track)
- `scripts/session.py` replaces `c41_session2.py`/`drive_logger.py`: modules, DIDs, decodes from the pack by VIN; `vehicle_id` from `/status`; evidence named `{brand}/{platform}/{plan}`; graceful degradation without a steering reference; serial port from settings.
- Guided steps generated from open hypotheses via the state-tree contract (discovery protocol §9) with `applicable_if` (gearbox, drivetrain, module presence); `PLAN_VERSION` composed; i18n for the two Lab cards.
- Lab defaults from the profile (module, range); `mock.ts` and mobile demo with 3 vehicles across WMIs; single WMI table derived from the pack + emblem sync test; API/OpenAPI/docs/README/i18n examples ISO-neutral with a second brand in every "for example"; app-wide vehicle switcher.
- Lint: no brand tokens in `apps/desktop/src` outside tests/mock data directories per brand.

### Phase 5 — Transport abstraction (~1 week, after Phase 2)
- `Transport` trait (BT serial, USB serial, TCP ELM, BLE) + platform `BluetoothControl`; adapter profile in settings with enumeration; `device_kind` from the `ATI`/`STI` banner; per-adapter timing profile. Not brand work, but required before any user who is not the author.

## 3. Validation gates (S4 in practice)

| Gate | Vehicle | What must be true |
|---|---|---|
| G1 | C4 replay (`psa/c41`) | Same four fingerprints, same 14 decodes, same plan — produced from `psa` data, no constants |
| G2 | Non-PSA replay (Nissan Leaf `0x21`, Polestar 29-bit, Hyundai > 8-byte) | Routes, identities, joins and coverage from data; engine names nothing without discriminating evidence |
| G3 | **Hyundai Kona, live** (vehicle #3) | Within 3 min: reached routes, ISO/HK identities, family matches or research tasks, coverage report; after a learning drive ≥ 1 candidate array |
| G4 | **Mitsubishi Mirage, live** | Coverage report says `protocol_not_profiled` with the sourced MUT/ETACS notes and a research task — no generic enumeration, no false "supported" |
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

Phase 0 (hours) → Phase 1 (3–4 d) ‖ then Phase 2 (4–5 d) ‖ Phase 3 (3 d) → Phase 4 (3 d) → G1–G5 → Phase 5 (1 w). Roughly three weeks of parallel work to S1–S6 green, with the Kona live test possible after Phase 2.

## 6. First PRs (this week)

1. `chore/phase0-hygiene` — v3/v4 fix, counts, fixture/evidence directories, lint 0 with baseline.
2. `feat/uds-map-v9-schema` — schema + accessors + coverage generator + lints (Track A).
3. `feat/obdb-fixture-corpus` — Nissan Leaf + Polestar + Mercedes EQB imports and the seven shape tests (Track A, after 2).
4. `feat/no-brand-in-code` — plan generator, identity builder, service/route parameterisation, auto-sequence on connect (Track B, on the v9 contract).
