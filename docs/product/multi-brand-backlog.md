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
- ☑ (#60) P2.1 `builtin_modules()` → `known_modules_for_vin` + custom; `builtin` → `source`
- ☑ (#60) P2.2 `parked_verification()` → plan generator from the profile; existing hand-written plan reproduced from pack data as a regression test
- ☑ (#60) P2.3 One fingerprint builder driven by `identity_block` (ISO first, vendor layouts as data-selected decoders); the two hardcoded paths removed; supplier byte from layout; `CompatibilityKey.service` from the module
- ☑ (#60) P2.4 Read service and route parameterised: `22|21|1A` request/NRC handling, `0x21` group and `0x1A` paths, route setup from the tuple (bit rate, target byte, extension, 29-bit scheme), cleanup restores captured state
- ☑ (#60) P2.5 Overlay packs enumerated from `data/packs/`
- ☑ (#60) P2.6 Hypothesis exclusion bands from data; correlation naming from a `scale_catalog` + `quantity` (no label matching)
- ☑ (#60) P2.7 Automatic sequence on connect: census → identity (twice, provisional) → join → coverage within budgets; route outcomes stored; coverage `limitations` entry dropped
- ☑ (#60) P2.8 Lint 0 allow-list at zero for `src-tauri/src` outside tests

## Phase 3 — Multi-brand replay corpus
- ☑ (#59) P3.1 `scripts/import_obdb_fixtures.py`: raw-response ↔ expected-value pairs from every licence-clean open corpus in `RESEARCH.md` → `fixtures/{brand}/{platform}/`; attribution in `OBDB-NOTICE.md`; `docs/uds/CORPUS.md`
- ☑ (#59) P3.2 Seven shapes covered with engine + state-layer tests: `0x21` groups, `0x1A`, 29-bit incl. target iteration, > 8-byte multi-frame, offset-binary signed, ASCII, bit-packed flags
- ☑ (#59) P3.3 `decode_payload` / `signed_guess` handle > 8 bytes and offset-binary
- ☑ (#60) P3.4 Second seed vehicle of another brand in `join`/`coverage`/`db`/`api` tests; cross-brand isolation test

## Phase 4 — Brand-neutral tooling and surfaces
- ☑ (#66) P4.1 `scripts/session.py` replaces the vehicle-specific scripts (modules/DIDs/decodes from the pack by VIN, `vehicle_id` from `/status`, evidence path `{brand}/{platform}/{plan}`, graceful without a steering reference, port from settings)
- ☑ (#66) P4.2 Guided steps generated from open hypotheses (state-tree contract) with `applicable_if`; composed plan version; i18n for the two Lab cards
- ☑ (#66) P4.3 Lab defaults from the profile; `mock.ts` and mobile demo with 3 vehicles across WMIs; single WMI table derived from the pack + emblem sync test
- ☑ (#66) P4.4 API/OpenAPI/docs/README/i18n examples brand-neutral (examples from more than one brand, or none)
- ☑ (#66) P4.5 App-wide vehicle switcher
- ☑ (#66) P4.6 Lint: no brand tokens in `apps/desktop/src` outside tests and per-brand mock directories

## Phase 5 — Transport abstraction
- ☑ (#65) P5.1 `Transport` trait (BT serial, USB serial, TCP ELM, BLE) + platform `BluetoothControl` — BLE not implemented; Windows serial and non-macOS Bluetooth automation return a manual-pairing error
- ☑ (#65) P5.2 Adapter profile in settings with enumeration; `device_kind` from the `ATI`/`STI` banner; per-adapter timing profile

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
- 2026-08-28 — Phase 2 done on `feat/mb-phase2-runtime` (#60, stacked on #57): no brand in `src-tauri/src` runtime code — `profile_modules(vin)` from the pack (`source: profile|custom`), `discovery::plan::generate` replaces the hand-written parked plan (reproduced from pack data as a regression test; `plan_version = {brand}-{platform|unknown}-v{plan_revision}`), one identity-block fingerprint builder (`discovery::identity::fingerprint`, layouts `iso_ascii`/`bcd_part_refs`/`ascii_part_refs`/`raw`), read services `22`/`21`/`1A` and route tuples drive requests, parsing and adapter setup (`ATSP6/7/8`, 29-bit split headers, `ATCEA`; KWP/ISO9141 reported unsupported), cleanup restores the `ATDPN` state captured at connect, overlays enumerated from `data/packs.json`, band classes and exclusions from data, correlation naming from `data/scale_catalog.json`, automatic census → identity (twice) → join → coverage on connect within the protocol budgets with `route_outcomes` persisted (coverage `limitations` entry dropped), second-brand seed vehicle and cross-brand isolation tests. 185 Rust tests; brand-token baseline 59 → 20 (all remaining tokens outside the runtime: `uds_map.rs`/`packs.rs` pack-loader file names, `driver.rs` adapter, frontend copy — Phase 4).
- 2026-08-28 — Phase 3 (P3.1–P3.3) done on `feat/mb-phase3-corpus` (#59, stacked on #57): `scripts/import_obdb_fixtures.py` + `SELECTION.json` import 59 verified fixtures (449 KB, 10 brand directories, 596 cases) from OBDb (CC BY-SA 4.0) and opendbc (MIT, synthetic framing) into `fixtures/{brand}/{platform}/{shape}/` with `docs/uds/CORPUS.md` provenance; shape tests discover them at run time; engine analyses > 8-byte payloads, flags offset-binary windows, bit-packed masks and ASCII. `0x1A` and ASCII have no captured framing in any open source; P3.4 stays with Phase 2. 169 Rust tests; brand-token baseline unchanged (59).
- 2026-08-29 — Phase 5 done on `feat/mb-phase5-transport` (#65, stacked on the Phase 2/3 integration branch): `elm/transport/` with the `Transport` trait (`ElmSerial` termios at any path/baud, `TcpElm` Wi-Fi, `Replay`), `BluetoothControl` (macOS `blueutil` with MAC/PIN/port from the profile; manual-pairing error elsewhere), `AdapterProfile` from `adapter.*` settings with the `SCAINNER_OBD_*` env fallback for one release, `fast|default|slow` timing multiplier on every driver timeout, `GET /adapters` (serial nodes + paired Bluetooth devices, `likely_obd`) and `GET|PUT /adapter`, `connections.device_kind` from the `ATI`/`STI` banner; `ElmDriver` is a thin wrapper and `uds.rs`/`obd.rs` are untouched. `driver.rs` has no compiled-in port or MAC. 208 Rust tests; brand-token baseline 20 → 19 (6 files). Not done: Windows serial, BLE, non-macOS Bluetooth automation, the settings UI (Phase 4).
- 2026-08-29 — Phase 4 (#66): guided steps generated from hypotheses, `session.py`, pack-derived WMI table and demo vehicles, app-wide vehicle switcher; `apps/desktop/src` at zero brand tokens (baseline 20 → 6, all in `src-tauri`).
