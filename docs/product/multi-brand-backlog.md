# Multi-brand backlog

Execution log for `multi-brand-implementation-plan.md` v1.1. One branch per phase, stacked; one PR per phase against `main`; independent review after each. Status: ☐ open · ◐ in progress · ☑ done (PR) · ✗ blocked.

Started 2026-08-28.

## Phase 0 — Hygiene
- ☑ (#56) P0.1 Plan-version producer derives `{brand}-{platform}-v{n}`; fix the `v3`/`v4` mismatch in tests, OpenAPI and docs
- ☑ (#56) P0.2 Correct stale DID counts in `packages/uds-map/README.md` and `RESEARCH.md`
- ☑ (#56) P0.3 Move fixtures and evidence into `{brand}/{platform}/` directories; update paths in tests and scripts
- ☑ (#56) P0.4 `scripts/lint_brand_tokens.py` + CI step with a baseline allow-list that must only shrink

## Phase 1 — Pack schema v9 and data migration
- ☑ (#57) P1.1 Schema: `read_service` (brand + module), `modules[].route` tuple, `identity_block`, `platforms[]`, `gateway_behaviour`, `profiled_level`, `source` on every entry
- ☑ (#57) P1.2 Schema: `known_dids[].decodes[]` (multi-value, signed, encodings, bit fields, strings, `quantity`); old scalar kept as derived first decode
- ☑ (#57) P1.3 Migrate every prose-only brand fact from `RESEARCH.md` into data with sources
- ☑ (#57) P1.4 `known_dids[].modules` required; `did_bands` re-ranked; unscoped fallback removed
- ☑ (#57) P1.5 Rust `uds_map.rs` types + accessors (`route_for_module`, `identity_block_for_vin`, `read_service_for_module`, `decodes_for_did`) — the frozen contract for Phase 2
- ☑ (#57) P1.6 `pnpm coverage` → `packages/uds-map/COVERAGE.md` generated from the pack; lints (module-bound, sourced, no unscoped fallback, `profiled_level` present); CI
- ☑ (#57) P1.7 Tests: TS + Rust parse, round-trip, coverage snapshot

## Phase 2 — No brand in code (runtime)
- ☐ P2.1 `builtin_modules()` → `known_modules_for_vin` + custom; `builtin` → `source`
- ☐ P2.2 `parked_verification()` → plan generator from the profile; existing hand-written plan reproduced from pack data as a regression test
- ☐ P2.3 One fingerprint builder driven by `identity_block` (ISO first, vendor layouts as data-selected decoders); the two hardcoded paths removed; supplier byte from layout; `CompatibilityKey.service` from the module
- ☐ P2.4 Read service and route parameterised: `22|21|1A` request/NRC handling, `0x21` group and `0x1A` paths, route setup from the tuple (bit rate, target byte, extension, 29-bit scheme), cleanup restores captured state
- ☐ P2.5 Overlay packs enumerated from `data/packs/`
- ☐ P2.6 Hypothesis exclusion bands from data; correlation naming from a `scale_catalog` + `quantity` (no label matching)
- ☐ P2.7 Automatic sequence on connect: census → identity (twice, provisional) → join → coverage within budgets; route outcomes stored; coverage `limitations` entry dropped
- ☐ P2.8 Lint 0 allow-list at zero for `src-tauri/src` outside tests

## Phase 3 — Multi-brand replay corpus
- ☐ P3.1 `scripts/import_obdb_fixtures.py`: raw-response ↔ expected-value pairs from every licence-clean open corpus in `RESEARCH.md` → `fixtures/{brand}/{platform}/`; attribution in `OBDB-NOTICE.md`; `docs/uds/CORPUS.md`
- ☐ P3.2 Seven shapes covered with engine + state-layer tests: `0x21` groups, `0x1A`, 29-bit incl. target iteration, > 8-byte multi-frame, offset-binary signed, ASCII, bit-packed flags
- ☐ P3.3 `decode_payload` / `signed_guess` handle > 8 bytes and offset-binary
- ☐ P3.4 Second seed vehicle of another brand in `join`/`coverage`/`db`/`api` tests; cross-brand isolation test

## Phase 4 — Brand-neutral tooling and surfaces
- ☐ P4.1 `scripts/session.py` replaces the vehicle-specific scripts (modules/DIDs/decodes from the pack by VIN, `vehicle_id` from `/status`, evidence path `{brand}/{platform}/{plan}`, graceful without a steering reference, port from settings)
- ☐ P4.2 Guided steps generated from open hypotheses (state-tree contract) with `applicable_if`; composed plan version; i18n for the two Lab cards
- ☐ P4.3 Lab defaults from the profile; `mock.ts` and mobile demo with 3 vehicles across WMIs; single WMI table derived from the pack + emblem sync test
- ☐ P4.4 API/OpenAPI/docs/README/i18n examples brand-neutral (examples from more than one brand, or none)
- ☐ P4.5 App-wide vehicle switcher
- ☐ P4.6 Lint: no brand tokens in `apps/desktop/src` outside tests and per-brand mock directories

## Phase 5 — Transport abstraction
- ☐ P5.1 `Transport` trait (BT serial, USB serial, TCP ELM, BLE) + platform `BluetoothControl`
- ☐ P5.2 Adapter profile in settings with enumeration; `device_kind` from the `ATI`/`STI` banner; per-adapter timing profile

## Gates
- ☐ G1 Replay of the vehicle we own reproduces fingerprints, decodes and plan from pack data only
- ☐ G2 Replays of ≥ 3 other brands cover `0x21`, 29-bit, > 8-byte shapes end-to-end
- ☐ G3 Any live vehicle of a profiled brand reaches a coverage report within 3 min (needs a car)
- ☐ G4 Any live vehicle of a not-yet-profiled brand reports `protocol_not_profiled` (needs a car)
- ☐ G5 `COVERAGE.md` generated in CI; ≥ 5 brands with fixtures

## Log
- 2026-08-28 — backlog created; Phase 0 started.
- 2026-08-28 — Phase 0 done on `feat/mb-phase0-hygiene` (#56, stacked on #55): `PARKED_PLAN_VERSION` const, counts corrected (197 / 112 / 3 families / 16 decodes), fixtures and evidence under `psa/c41/` and `psa/unknown-platform/`, `lint_brand_tokens.py` in CI with a 59-token / 9-file baseline. 148 Rust tests, 21 uds-map tests.
- 2026-08-28 — Phase 1 done on `feat/mb-phase1-schema` (#57, stacked on #56): pack schema v9 (sources everywhere, read services, route tuples, identity blocks with encoding-named layouts, 33 platforms, gateway semantics, profiled levels, `decodes[]`), RESEARCH.md prose migrated to data with `docs/uds/migration-v9.md`, 169/203 DIDs module-bound (34 honest unknowns), unscoped fallback removed, Rust contract accessors, `pnpm lint:pack` + generated `COVERAGE.md` in CI. 159 Rust tests, 42 uds-map tests; brand-token baseline unchanged (59).
- 2026-08-28 — #57 review fixes: RESEARCH.md anchors corrected and lint-checked, hyundai `0101`/`E004` decodes re-read from OVMS, `1A` demoted to a per-DID `read_service` with DID → module → platform → brand → standard precedence (`read_service_for_did`), subaru `standard_only`, psa silence `unreachable_pins`.
