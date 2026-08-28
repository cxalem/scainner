# uds-map pack schema v9

2026-08-28 · multi-brand plan Phase 1 (P1.1–P1.7) · companion to `packages/uds-map/src/types.ts` (TypeScript), `apps/desktop/src-tauri/src/elm/uds_map.rs` (Rust, the frozen contract for Phase 2) and `packages/uds-map/RESEARCH.md` (provenance prose). Every migrated fact is listed in `docs/uds/migration-v9.md`; the per-brand state of the data is generated into `packages/uds-map/COVERAGE.md` by `pnpm coverage`.

## 1. Rules

1. **Brand names appear only as pack data with a `source`.** Nothing in `src/*.ts` or `uds_map.rs` names a brand; `pnpm lint:pack` fails on brand tokens (ids, name words) in package code, and `scripts/lint_brand_tokens.py` keeps the app's baseline from growing.
2. **Layout and encoding identifiers name encodings, never brands**: `iso_ascii`, `bcd_part_refs`, `ascii_part_refs`, `raw`; `be`, `le`, `bcd`, `ascii`, `bitfield`.
3. **Nothing is invented.** Where the research does not say which module carries a DID, the entry has `modules: []` and `binding: "unknown"`; where no registry confirmed a VIN pattern, `vds_pattern` is `null`; where a source's licence is unclassified it is recorded as `NOASSERTION`/`unlicensed`, not guessed.
4. **All v9 fields are additive and optional** in both parsers (`#[serde(default)]`, no `deny_unknown_fields`); a v8 file still parses. The lints, not the parsers, enforce completeness.

## 2. Fields

### `Source` (on every module, band, known DID, family, identity block, platform, gateway rule)

```json
{ "url": "https://…", "date": "2026-08-23", "type": "open_implementation", "licence": "MIT", "note": "optional" }
```

`type`: `oem` · `open_implementation` · `tool_screen` · `parts_catalog` · `community` · `project_capture`. `licence`: SPDX id when GitHub reports one; `NOASSERTION` (custom LICENSE file) or `unlicensed` otherwise — those and GPL sources are verification evidence only (acquisition protocol licence gate). Facts whose only citation is a RESEARCH.md section use `url: "packages/uds-map/RESEARCH.md#<anchor>"`, `type: community`.

### `standard.read_service`, `standard.identity_block`

The default read service (`"22"`) and the ISO 14229-1 identification block (`F187` part, `F191` hardware, `F195` software, `F197` system, `F18C` serial, `F18A` supplier, `F190` vin — all `iso_ascii`) that every brand inherits.

### `brands[].read_service` · `modules[].read_service`

`"22"` ReadDataByIdentifier · `"21"` ReadDataByLocalIdentifier · `"1A"` ReadEcuIdentification. Resolution: module → brand → standard. Brands with no manufacturer routes (`standard_only`) carry none.

### `modules[].route`

```json
{ "protocol": "can11_500", "req": "6F1", "resp": "612", "target_byte": "12", "address_extension": "12", "gateway": null, "source": { … } }
```

`protocol`: `can11_500` · `can11_250` · `can29_normal_fixed` · `can29_target_byte` · `can29_custom` · `kwp2000` · `iso9141`. `target_byte` is the ECU address carried inside the payload (the byte a target-byte scheme iterates); `address_extension` is the ISO-TP extended-address byte the adapter sends (`ATCEA`); `gateway` is the module id a route passes through. `req`/`resp` repeat the module ids so a route is self-contained; the lint fails when they differ. **Derivation when absent**: 11-bit ids → `can11_500`; `18DA<t>F1`/`18DAF1<t>` → `can29_normal_fixed` with `target_byte = t`; any other 29-bit pair → `can29_custom`. `route_for_module` never fails.

### `brands[].identity_block`

```json
{ "dids": [ { "did": "F187", "field": "part", "layout": "iso_ascii" },
            { "did": "F080", "field": "part", "layout": "bcd_part_refs", "offset": 0, "len": 5 },
            { "did": "F080", "field": "hardware", "layout": "bcd_part_refs", "offset": 7, "len": 5 },
            { "did": "F0FE", "field": "software", "layout": "bcd_part_refs", "offset": 21, "len": 3, "prefix": "96", "suffix": "80" },
            { "did": "F0FE", "field": "supplier", "layout": "raw", "offset": 4, "len": 1 } ],
  "source": { … } }
```

`field`: `part` · `hardware` · `software` · `system` · `serial` · `supplier` · `vin` · `other`. `layout`: `iso_ascii` printable string; `bcd_part_refs` packed BCD digits, `len` bytes at `offset`, optionally wrapped in a literal `prefix`/`suffix` (the 3-byte group printed as `96xxxxxx80`); `ascii_part_refs` ASCII references at a fixed offset/length; `raw` the bytes as hex. Every brand's block starts with the ISO DIDs; vendor entries follow. `identity_block_for_vin` falls back to `standard.identity_block` for an unknown WMI.

### `brands[].platforms[]`

```json
{ "key": "leaf_ze1", "vds_pattern": "^AZ1", "years": [2018, null], "ecu_families_expected": [], "read_service": "22", "notes": "…", "source": { … } }
```

`vds_pattern` is a regex over VIN characters 4–10 (seven characters) in the subset both implementations support — literals, `.`, `[...]` with ranges and negation, `^`, `$`, `?`, `*`, `+` — and is only set where a registry confirmed the prefix (NHTSA vPIC queries are recorded as `type: oem`). `null` means the platform is selectable by evidence only; `platform_for_vin` never returns it. `years` are `[from, to]` with `null` for unknown/open.

### `brands[].gateway_behaviour`

```json
{ "silence_means": "filtered", "writes_blocked": false, "notes": "…", "source": { … } }
```

`silence_means`: `absent` · `filtered` · `unknown`. Brands without a sourced rule get `unknown` / `false` from the accessor.

### `brands[].profiled_level` + `brands[].sources[]`

`standard_only` (no manufacturer routes) · `routes_sourced` (routes from open implementations or community tables) · `routes_verified` (at least one route confirmed by a recorded request/response capture — a project capture or an open corpus test fixture with raw bytes) · `decodes_verified` (decodes confirmed on a vehicle by this project). The value is data; `pnpm lint:pack` fails a level its sources cannot support (`standard_only` with modules, `routes_verified` without a capture/fixture-backed route, `decodes_verified` without a `project_capture` decode). `sources[]` is the union of every source the brand's entries cite.

### `known_dids[].decodes[]`

```json
{ "offset": 10, "len": 2, "signed": true, "encoding": "be", "scale": 0.1, "bias": 0, "unit": "A", "quantity": "current", "label": "HV battery current" }
{ "offset": 14, "len": 1, "signed": false, "encoding": "bitfield", "bit_offset": 0, "bit_len": 4, "scale": 1, "bias": 0, "unit": "gear", "quantity": "enum", "label": "Gear (low nibble)" }
```

`offset` counts bytes after the echoed identifier (RESEARCH.md §2). `be`/`le`: big/little-endian integer over `len` bytes; `bcd`: packed decimal digits; `ascii`: string (use `decodeString`; numeric decode returns nothing); `bitfield`: the `len` bytes as a big-endian integer, shifted right by `bit_offset` (0 = least significant bit) and masked to `bit_len` bits. `signed` is two's complement over the value's width; offset-binary values are encoded unsigned with a negative `bias` (as their sources express them). `quantity` is machine-readable (`speed`, `voltage`, `current`, `temperature`, `pressure`, `percentage`, `distance`, `time`, `power`, `energy`, `charge`, `flag`, `count`, `identifier`, `enum`, `angle`, `rotational_speed`, `volume`, `raw`). The legacy `offset/len/scale/bias/unit` fields on the entry are a **mirror of `decodes[0]`** for v8 consumers; the lint fails when they disagree or when a full scalar has no `decodes[]`.

### `known_dids[].modules` (required) + `binding`

Every entry is bound to exact address pairs or carries `modules: []` with `binding: "unknown"`. Module-scoped lookups (`knownDid` / `known_did`, `decodesForDid` / `decodes_for_did`) return only bound entries; the v8 unscoped fallback is gone. `knownDidUnscoped` / `known_did_unscoped` return the first entry for browsing and research tooling only.

### `did_bands[]`

Unchanged shape plus `source`. The `F400–F4FF` mode-01 mirror band is `low` on every brand (RESEARCH.md §3.2).

### `scan_policy`

Adds `conventional_11bit_and_target_byte_11bit` (iterate target bytes on a fixed 11-bit request id as well as the conventional range). Until Phase 2 implements target-byte iteration the engine treats it as conventional-only; it never silently enables 29-bit enumeration.

### `ecu_families[]`

Unchanged shape plus `source` on the family and `quantity` on each decode.

### Overlay packs (`data/packs/*.json`)

Same brand shape with `source` on every entry and `decodes[]` on every known DID; the pack keeps its own `license` and `source` header. `obdb-citroen.json` v2 imports the tyre temperatures its v1 omitted (second decode of `013C–013F`) and the four validity flags of `012F` as bit fields.

## 3. Accessors (frozen contract)

| TypeScript (`src/index.ts`) | Rust (`uds_map.rs`) | Returns |
|---|---|---|
| `routeForModule(vin, req, resp)` | `route_for_module(vin, req, resp) -> Route` | explicit route or derived |
| `identityBlockForVin(vin)` | `identity_block_for_vin(vin) -> IdentityBlock` | brand block or ISO |
| `readServiceForModule(vin, req, resp)` | `read_service_for_module(vin, req, resp) -> ReadService` | module → brand → `22` |
| `decodesForDid(vin, req, resp, did)` | `decodes_for_did(vin, req, resp, did) -> Vec<Decode>` | module-scoped decodes |
| `profiledLevelForVin(vin)` | `profiled_level_for_vin(vin) -> Option<ProfiledLevel>` | `None` for unknown WMI |
| `gatewayBehaviourForVin(vin)` | `gateway_behaviour_for_vin(vin) -> GatewayBehaviour` | honest default |
| `platformForVin(vin)` | `platform_for_vin(vin) -> Option<Platform>` | VDS regex match |
| `knownDid(vin, did, module)` / `knownDidUnscoped(vin, did)` | `known_did(vin, req, resp, did)` / `known_did_unscoped(vin, did)` | bound only / browsing |
| `decodeValue(decode, bytes)` | `decode_value(&Decode, &[u8]) -> Option<f64>` | shared decode semantics |

## 4. Generated artefacts and lints

- `pnpm coverage` writes `packages/uds-map/COVERAGE.md` (per brand: WMIs, modules, known DIDs, decodable, module-bound, families, decodes with evidence, on-vehicle, read services, identity block, platforms, `profiled_level`, gateway, confidence; totals; decode shapes; unknown bindings; overlays; sources). `pnpm coverage:check` fails CI when it is stale.
- `pnpm lint:pack` fails on: unbound DIDs without `binding: "unknown"`, missing `source`, scalar/`decodes[0]` disagreement, missing or unsupported `profiled_level`, malformed decodes, `vds_pattern` outside the subset, route ids differing from module ids, brand tokens in `src/*.ts`.
- Both run in the CI JavaScript job; the vitest suite also asserts `lintPack()` is empty and `COVERAGE.md` equals the generator output.

## 5. Facts that could not be migrated into data (and why)

| Fact (RESEARCH.md) | Why not |
|---|---|
| Module bindings for 34 known DIDs (listed under "Unknown bindings" in `COVERAGE.md`) | the research names the brand and formula but not the module; binding to the engine route would be a guess |
| VAG MEB 29-bit `FC00` + target-address surface (108 cell voltages, module temperatures) | request-id construction from OBDb `hdr`/`pri`/`tst` unconfirmed — deliberately unencoded, as the research says |
| Volvo/Polestar `EE6F`/`4028` request ids | same caveat; DIDs kept with `binding: "unknown"` |
| Volvo P1/P2 VIDA command set (`000FFFFE`, `A6`/`A3`/`B1`) | not ISO 14229; recorded as a platform note, no route (no `protocol` fits a proprietary command set) |
| Honda bit offsets for `2660`, `6001`, `2663`, `2610` | signalsets give bit positions but the base point is unconfirmed — omitted rather than guessed |
| Mercedes `2002` vehicle-dynamics frame, `6502`/`6504` scales | multi-signal frame not extracted; scales absent in the research |
| Toyota `106C` minimum SOC byte, `1F05`/`1074`/`1021` modules | offsets/modules not stated |
| Hyundai `E004` accelerator scale, `0105` full health block | scale not stated (raw byte kept), health block only SOC at 25 |
| BMW F/G-series ENET tester `F4` / gateway `10`, ZGW/GWS routes | unreproduced; kept as platform notes, `gateway` field unset |
| GM `1A` DIDs `DF`/`6D` module | wican profile module not stated in the research; `binding: "unknown"`, platform `read_service: "1A"` |
| Mercedes KWP-era module read service | pairs sourced, service not — inherits the brand default with a platform note |
| Smart EQ 453 (OVMS `vehicle_smarteq`) | deliberately not folded into the Mercedes entry (different alliance platform); needs its own brand entry |
| VDS patterns for most platforms (E-GMP, MEB, i3, Ultium, EQB, Zoe, Soul EV, C4 III, …) | no registry confirmation obtained; `vds_pattern: null` |
| OVMS Ioniq 5 `0101` scales (current ×0.1 signed, voltage ×0.1, temps signed) | offsets are in RESEARCH.md; the scales were read from OVMS `hif_can_poll.cpp` directly (2026-08-28) and are cited to that file, confidence unchanged |
