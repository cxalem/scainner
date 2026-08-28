# Multi-brand audit — making the C4 one car in the list

v1.1 · 2026-08-28 · read-only audit of `main` (three parallel sweeps: Rust backend; knowledge pack, fixtures and scripts; frontend, API, schema, docs) · ~180 findings consolidated into 6 targets · v1.1 corrects counts and protocol wording after independent review (§10)

---

## 1. Why we are doing this

Scainner's product is **multi-brand diagnostic knowledge that compounds**: connect any car, identify it down to the ECU family, reuse what compatible ECUs on other cars already taught us, and learn the rest from evidence. The moat is the shared, evidence-backed knowledge keyed by ECU family — not one car, not one brand.

For four weeks the only car available was one Citroën C4 III. That was the right way to *discover the method*: three ECUs fingerprinted, 14 vehicle-verified decodes, the acquisition protocol, the discovery protocol, the state layer and the correlation engine all came out of it. The risk the founder named on 2026-08-28 is exact: **the method was learned on one car, and the code, data and tests may have quietly become that car's shape.** If so, the next brand does not "slot in" — it hits a wall we cannot see from the C4.

This audit answers one question: **where in the repo is the C4/PSA the default, the special case, or the only evidence, rather than one entry in a brand-agnostic structure?** Every finding is mapped to the pattern that would make the C4 just another car.

## 2. What success looks like

The C4 is one row in every table, one entry in every list, one fixture directory among many. Concretely, we are done when all of the following are true and measurable:

| # | Success criterion | How we measure it |
|---|---|---|
| S1 | **No brand in code.** No CAN id, DID, plan target, identity layout, part-number format or plan name is a Rust/TS constant; all come from `uds-map` data selected by VIN/fingerprint. | `grep -rE "6A8\|6AD\|6B5\|74A\|F080\|F0FE\|citroen\|c41\|psa" src/` returns only comments, tests and the PSA *data entries*; the "builtin four" and `parked_verification` constants are gone. |
| S2 | **The pack schema fits every brand's data shape**, not PSA's: per-module read service (`22`/`21`/`1A`), identity blocks per brand, multi-value decodes per DID, signedness, bit fields, strings, >8-byte payloads, 29-bit/target-byte/extension routes, platforms/generations, gateway semantics. | The facts already written in `RESEARCH.md` prose for Nissan/Renault/GM/BMW/Honda/Volvo/Mercedes/Hyundai are expressible as data and consumed by the engine; `OBDB-NOTICE.md`'s "temperature signals omitted" caveat is removed. |
| S3 | **A multi-brand evidence corpus without owning the cars.** Replay fixtures with real captured payloads from ≥ 5 brands beyond the one we own (from licence-clean open corpora), covering the payload and protocol shapes the current corpus never exercised. | `tests/fixtures/` has per-brand directories; the engine and the state layer pass tests on 0x21 group responses, 1A, 29-bit, multi-frame > 8 bytes, offset-binary signed, ASCII, bit-packed flags. |
| S4 | **A new car reaches a coverage report from data alone.** Connecting a vehicle of a brand we have never touched produces routes, identities, family joins and a report without a code change — and a vehicle of a not-yet-profiled brand produces an honest `protocol_not_profiled` report. | Universal Discovery Protocol acceptance criteria 1–2 pass on any live second-brand vehicle and on replayed vehicles of other brands. |
| S5 | **Coverage is visible per brand.** One table shows, per brand: WMIs, modules, decodable DIDs, module-bound DIDs, families, verified-on-vehicle evidence, read service represented, identity block present. | The table in §6 is generated from the pack, not hand-written, and it moves. |
| S6 | **The product surfaces don't say "PSA".** Lab defaults, API examples, docs, mock data, i18n copy and the onboarding are brand-neutral; the C4 appears as one vehicle among several in demo data. | Findings in §5.5–5.7 closed; a VW/Ford/Hyundai walk-through reads naturally. |

"Done" for this audit is S1–S6 green; the discovery protocol's "learning drive / first connection" acceptance criteria then apply to any brand.

## 3. The shape of the problem (one paragraph)

The **research** (`packages/uds-map/RESEARCH.md`, 21 brands, licence-aware) and the **protocol designs** are already multi-brand — the discovery protocol even names the missing fields (`read_service`, `identity_block`, `platforms[]`) and uses a second-brand vehicle as its worked example. What is single-brand is the layer in between: the **JSON schema** encodes PSA's data shape as universal (one unsigned value per DID, ≤ 8 bytes, service `0x22`); the **compiled-in tables** (`builtin_modules()`, `parked_verification()`, `psa_identity_fingerprint()`) are the C4; the **evidence corpus** is one car (35 correlation replay inputs, 2 real vehicle ELM captures out of 13 fixtures, 16 evidence files, one DB seed, one knowledge pack); and the **product surfaces** default to PSA keys, examples and copy. Everything below is that gap, with file:line.

## 4. Numbers

| Layer | Findings | Blocking | Notes |
|---|---|---|---|
| Rust backend (`src-tauri/src`) | 81 | 3 clusters | 7 hardcoded-plan, 5 brand-parser-in-code, 6 builtin-defaults, 9 adapter, 13 protocol assumptions, 20 single-car tests/fixtures, 21 doc-only |
| Knowledge pack, fixtures, scripts | 40 | 9 | schema gaps, single-brand data, all-C4 fixtures, C4-only scripts |
| Frontend, API, schema, docs | 62 | 10 | Lab hardcodes, API/docs examples, mock data, adapter/platform, single-vehicle UI |
| Pack data | 197 known DIDs, **112** fully decodable (offset+len+scale+bias), **33 module-bound (all PSA)**, **16 with evidence (all PSA)**; 3 ECU families (all PSA) with 16 decodes; 4 modules with discovery-session data (all PSA); 1 overlay pack (Citroën) | | |

## 5. Findings, grouped by the pattern that fixes them

Severity: **B** blocking for multi-brand, **I** important, c cosmetic. Paths are relative to `apps/desktop/src-tauri/src` unless stated.

### 5.1 Plans and identity are code, not data → *plan templates and identity blocks in `uds-map`, selected by VIN + fingerprint*

| Sev | Where | What | Pattern |
|---|---|---|---|
| B | `elm/uds.rs:89-104` `builtin_modules()` | Four PSA routes (`bsi 752/652`, `abs 6AD/68D`, `cluster 75F/65F`, `engine 6A8/688`) compiled in and served to every car via `ops::uds_modules` (`api/ops.rs:197`), the resolver and the Lab default (`src/views/Lab.tsx:31,54` `useState("engine")`). The same four already exist in `uds-map.json`. | `uds_map::known_modules_for_vin(vin)` + custom modules; drop the `builtin` flag for `source: profile\|custom`. |
| B | `elm/uds.rs:324-472` `parked_verification()` | `const PSA_IDENTITY`, `const ABS_SWEEP`, four literal C4 targets, `plan_version: "citroen-c41-v3"` (tests/OpenAPI say `v4` — a mismatch on its own). This is the whole `/verification/parked` endpoint and the ParkedVerification card (`src/views/lab/ParkedVerification.tsx:50,71`). | Plan template per brand class in the pack (targets = profile modules ∩ reached routes; identity DIDs = profile `identity_block`; sweep bands = `did_bands` minus config bands); `plan_version = {brand}-{platform}-v{n}`. |
| B | `elm/uds.rs:623-760` `decode_psa_references`, `decode_psa_software_reference`, `psa_identity_fingerprint`; called unconditionally at `elm/supervisor.rs:893`; `elm/discovery/family.rs:56-64` `supplier_code_from_f0fe` (`psa-f0fe-` prefix in stored keys) | The only fingerprint producer on the verification path requires PSA `F080`; the ISO path (`elm/uds.rs:1299-1348` `build_fingerprint`, F187/F191/F195/F197 compiled in) is a separate mirror image used only by auto-discovery. A non-PSA car gets a PSA decoder pointed at its payloads; a PSA car gets no fingerprint from discovery. | One fingerprint builder driven by the brand profile's `identity_block` (DID list + layout/decoder id: ISO ASCII, PSA BCD, VAG ASCII, HK `F1A0` family…), ISO first, vendor decoders as data-selected plugins. |
| B | `elm/uds_map.rs:261-275,345` | Exactly one knowledge overlay pack, `obdb-citroen.json`, with its id asserted in Rust and hardwired into four lookup sites. | Packs enumerated from `data/packs/` as data (manifest or `include_dir!`). |
| I | `elm/discovery/state.rs:265-276` | Hypothesis class filter bands (`F000–F1FF`, `D600–D7FF`) are one car's observation applied to every brand (self-identified TODO). | Per-module/family `hypothesis_exclude_bands` in the pack. |
| I | `elm/discovery/family.rs:51` | `service: Some("22")` hardcoded in every compatibility key. | From the module's `read_service`. |

### 5.2 Protocol assumptions baked into the engine → *per-module protocol facts from the profile*

| Sev | Where | What | Pattern |
|---|---|---|---|
| B | `elm/uds.rs:270,297,1539,1550`; `elm/discovery/family.rs:51`; `scripts/scainner_mcp.py:29` | Service `0x22` assumed everywhere (request format, `7F 22` NRC match, presence probe, MCP docstring). `EcuFamily.diagnostic_service` (`elm/uds_map.rs:46`) has **zero readers**. RESEARCH.md §3.3: Nissan Leaf LBC, Renault LBC/UCH, older Kia (`0x21` groups), GM pre-2017 and older Toyota hybrids (`0x1A`) silently read as "empty car". | `modules[].read_service` in the pack; request/NRC parsing parameterised on the service; `0x21`/`0x1A` request paths. |
| B | `elm/uds.rs:157-190,1493-1523`; `elm/uds_map.rs:393-405,448-455` | The runtime already supports normal-fixed 29-bit (`ATSP7`, receive filters, flow-control headers) and has an `ATCEA` address-extension path (`elm/uds.rs:194`) — but only 11-bit 500k and `18DA..F1` are *selectable*, `response_addr` is 11-bit only, and the pack cannot say when a module needs an extension, a target byte (BMW `6F1`), a different 29-bit scheme (GM Ultium `14DA..`), a bit rate (250k) or a non-CAN protocol. The gap is route representation in data, not transport capability. | Route tuple as data: protocol/bit-rate, request id, response rule, target byte, address extension, gateway class (already specified in the discovery protocol). |
| I | `elm/operation.rs:67-69` | Cleanup runs `ATSP0` then `ATSH 7DF` (11-bit functional id) after every UDS op — an unsafe assumption on a 29-bit OBD side; not yet demonstrated to break a real car, but the restore should come from captured state. | Restore the header/protocol captured at connect (`ATDPN`). |
| I | `elm/correlation/sanity.rs:51-70,118-180` | Naming heuristics compiled in from the C4: wheel speed only if slope 94–104 raw/km/h and `×0.01`; steering only if 9–11 counts/°; inherited-fit matching by English label substrings. VAG `×0.0625 km/h` or mph scales fall through unnamed. | `scale_catalog` per quantity in data; a machine-readable `quantity`/`reference` field on decodes instead of label parsing. |

### 5.3 The pack schema is PSA's data shape → *schema that fits every brand*

| Sev | Where | What | Pattern |
|---|---|---|---|
| B | `packages/uds-map/src/types.ts:60-72`, `index.ts:270-281` | **One unsigned big-endian value per DID** on the brand `known_dids` path (the `ecu_families` decodes do carry `signed`; the main brand knowledge path does not). No multi-value, no bit fields, no strings. Non-PSA entries work around it in prose or fake it (`ford 402B` `bias: -128`; `toyota 1F9A` second field described in the label; `hyundai_kia C00B/C002/E004` offsets only in text). `OBDB-NOTICE.md` records temperature signals **dropped** for this reason. 85/197 known DIDs have no complete decode, mostly because they are multi-value. | `decodes[]` per DID with `offset/len/signed/encoding(be\|le\|bcd\|ascii\|bitfield)/bit_offset/bit_len/scale/bias/unit/quantity`. |
| B | `types.ts:82-92`, `uds-map.json` | No `identity_block`, no `read_service`, no `platforms[]` — all three named as required in the discovery protocol (`docs/product/universal-discovery-protocol.md:126-127`). Identity exists only as PSA's `F080-F0FF` band. Generation facts (Soul EV `0x21` vs E-GMP `0x22`; Opel pre/post-2017; Volvo P1/P2 vs SPA2) are unencodable. | Add the three fields; migrate the prose facts from `RESEARCH.md` into them. |
| B | `uds-map.json` `known_dids[].modules` | Module binding on 33/197 DIDs — all PSA. Other brands' DIDs attach to whichever module answers (the exact bug class of the Nissan `743/763 → 797/79A` correction). | Bind every DID to a route; make the unscoped fallback a lint failure. |
| I | `uds-map.json` `evidence`/`source` | Provenance on 16/197 DIDs, all PSA; no `source` field at all, so non-PSA provenance lives only in `RESEARCH.md`. | `source{url,date,type,licence}` on every DID and family. |
| I | `uds-map.json` `resp_offsets` | Absent on 9 brands → silent `req+8` for BMW `6F1`, Mercedes `730`. `discovery_session` on 4/180 modules, all PSA. | Fill from `RESEARCH.md`; per-block rules like PSA's. |
| I | `uds-map.json` `did_bands` | `F400–F4FF` (mode-01 mirror) ranked `high` on 8 brands, ahead of real bands — contradicts the research. `standard.address_scan` `700–7F6` misses Mercedes `4E0/5B4/662` and BMW `6F1`. | Rank bands from research; per-brand scan ranges. |
| I | `uds-map.json`, 4 low-confidence brands, 3 label-only brands | `gm`, `fca`, `subaru`, `mitsubishi` low; `skoda`, `seat`, `honda` have 0 decodable DIDs; `tesla`/`mitsubishi` are brand-shaped holes. | Research tasks per the protocol's R stage; `profiled_level` per brand. |
| I | RESEARCH.md facts with no data: Mercedes/FCA gateway silence semantics, Honda 29-bit target iteration, GM Ultium scheme, Volvo VIDA | The coverage report's `gateway_limited`/`protocol_not_profiled` statuses exist but nothing sets them. | `gateway_behaviour`/`silence_semantics` brand fields; scan policies that iterate target bytes. |

### 5.4 The evidence corpus is one car → *a per-brand replay corpus from licence-clean sources*

| Sev | Where | What | Pattern |
|---|---|---|---|
| B | `tests/fixtures/correlation/*` (35 replay inputs), `tests/fixtures/elm/*` (13 fixtures; the 2 real vehicle captures are both Stellantis, the rest exercise clear/error/transport outcomes), `elm/discovery/join.rs:209-270` `seed_c4()`, `apps/desktop/docs/workflows/evidence/*` (16 files, all `c41-*`) | Every vehicle byte the engine or the state layer has ever been tested on is the C4 (the remaining ELM fixtures are synthetic outcome cases, not vehicles). Payload lengths present: {1,2,3,4,6,7,8}. **Untested shapes:** `0x21` group responses, `0x1A`, 29-bit routes, multi-frame > 8 bytes (`decode_payload` returns `None` above 8), offset-binary signed (`signed_guess` only detects two's complement), ASCII, bit-packed flags. Isolation tests use two *PSA* VINs, so cross-brand isolation is untested. | Per-brand fixture directories. Ready-made sources already cited in RESEARCH.md with raw response ↔ expected value pairs under **CC BY-SA 4.0** (already accepted once): `OBDb/Mercedes-Benz-EQB`, `OBDb/Nissan-Leaf` (incl. `0x21` LBC), `OBDb/Polestar-2`, `OBDb/Volvo-XC40-Recharge`, Honda/Mazda/Toyota signalsets. GPL sources (OVMS, CanZE) are verification evidence only, per the acquisition protocol's licence gate — record that gate on every entry derived from them. |
| I | `elm/uds_map.rs` tests, `db.rs` tests (~40), `api/mod.rs` tests, `elm/discovery/*` tests | Sole worked example is PSA (`VR7EXAMPLE…`, `6A8/688`, `9846124980`); VAG `+0x6A` and GM `+0x400` rules are in the JSON but never asserted in Rust; only one 29-bit AT-sequence test (PSA TPMS). | A second seed vehicle (VW or Ford) and a non-PSA family in every layer's tests. |

### 5.5 Scripts and session tooling → *brand-agnostic session tooling driven by the pack*

| Sev | Where | What | Pattern |
|---|---|---|---|
| I | `scripts/c41_session2.py` (module keys `abs`/`engine`, DIDs, `×0.1−1250`, `×5`, `vehicle_id=2`, `c41-` filenames), `scripts/drive_logger.py` (C4 ABS DIDs, `6AD/68D`, `/dev/cu.V-LINK`), `scripts/correlation_replay.py` (C4 paths and routes) | Research scripts are C4 by name and content. | One `session.py` that resolves modules/DIDs/decodes from the pack by VIN, takes `vehicle_id` from `/status`, names evidence `{brand}-{platform}-{plan}`, degrades gracefully without a steering reference. `scainner_api.py` and `scainner_mcp.py` are already generic. |

### 5.6 Product surfaces default to PSA → *brand-neutral defaults, examples and copy*

| Sev | Where | What | Pattern |
|---|---|---|---|
| B | `src/views/lab/GuidedCorrelation.tsx:38-102` | `PLAN_VERSION = "citroen-c41-corr-v1"` for every capture on every car; a fixed six-step C4 script (assumes an automatic gearbox with P; a PSA DSGi rationale in comments); zero i18n. | Steps generated from hypotheses + vehicle facts (the discovery protocol's state-tree contract, §9) with `applicable_if`; composed plan version; i18n. |
| I | `src/views/lab/ParkedVerification.tsx:71`, `RangeScanner.tsx:33-34` (`D000–D3FF` default), `Lab.tsx:31,54` | C4 sweep size in copy; PSA data block as default range; `engine` default key; zero i18n in two Lab cards. | Defaults from the plan/profile; i18n. |
| I | `src/lib/mock.ts` (VIN `VR7…`, one vehicle, PSA modules that don't even match the real builtins, `citroen-c41-v3`, PSA part numbers), `apps/mobile/src/data/demo.ts:17-81` (two PSA demo cars) | Demo mode is one Citroën; the demo diff only works for the C4 brake step. | 2–3 demo vehicles across WMIs drawn from the pack. |
| I | `src/data/wmi.json` (59 entries) vs `uds-map.json` `brands[].wmi` (251) | Two divergent WMI tables; GM, Ford US, Jeep/Chrysler, Mitsubishi, Subaru, Mini, Opel `W0V`, MG… missing from the UI table; emblem registry not synced. | One WMI table (from the pack or `packages/core`) + a sync test. |
| I | `api/openapi.rs:57-106`, `apps/desktop/docs/api.md:133-224`, `README.md:135-137`, `en.ts:298,332` / `es.ts:307,341` | API examples (`abs`, `6A0/68A`, `D400`, `citroen-c41-v4`, `Grey C4`, BSI `752/652`), README ("on any other brand they won't answer"), i18n ("the four built-in modules use PSA…", "BSI/cluster" in generic guidance). | ISO-neutral examples (`7E0/7E8`, `F195`, `<family>-v1` placeholders); copy rewritten once 5.1 lands. |
| I | `src/App.tsx:98,128-136`; `BACKLOG.md:69-71` | Only Workshop has a vehicle picker; other views show only the connected car (DB is multi-vehicle; UI is not). | Vehicle switcher app-wide. |
| c | `src/components/VehicleScene.tsx:54-55`, `FuelCard.tsx:59-61`, `packages/core` comments, `UDS_INVESTIGATION_LOG.md`, playbook/protocol examples | C4 3D assets shipped but dormant; C4 anecdotes as rationale; all examples PSA. | Leave logs as history; add a second brand to every "for example". |

### 5.7 One adapter, one platform → *transport abstraction (separate from brand, but the same "one car" habit)*

| Sev | Where | What | Pattern |
|---|---|---|---|
| B | `elm/driver.rs:1-33,124-125,255-277,362-428`; `elm/supervisor.rs:232` (`device_kind = "vgate_icar_pro"` literal), `:534` (PIN 1234) | vGate iCar Pro on macOS: the author's dongle MAC and `/dev/cu.V-LINK` compiled in (env-overridable, no UI), POSIX termios at B115200 only, ELM banner required, Homebrew `blueutil` for reconnect, timeouts tuned on the C4 (`driver.rs:157-163`). Every connection row claims a vGate. | `Transport` trait (BT serial, USB, TCP ELM, BLE) + platform `BluetoothControl`; adapter profile in settings with enumeration; `device_kind` from the `ATI`/`STI` banner. Already in `BACKLOG.md:72`. |

### 5.8 Not brand bias, but found on the way — fix now

| Sev | Where | What |
|---|---|---|
| **B** | `apps/mobile/src/data/demo.ts:20` | **The real C4 VIN** was in the mobile demo data although `BACKLOG.md:46` says it was scrubbed before publishing; the repo is public. **Fixed on this branch** (`8d20be1`, replaced with `VR7EXAMPLE0000001`); it remains in git history. |
| I | `elm/uds.rs:472` vs `coverage.rs:417`, `api/mod.rs:1104`, `openapi.rs:85`, `api.md` | Producer emits `citroen-c41-v3`; tests, OpenAPI and docs say `v4`. |
| c | `packages/uds-map/README.md:7`, `RESEARCH.md:475,876` | DID counts stale in three places (159 / 181 / "180+"; actual 197). |

## 6. Per-brand coverage today (from the pack; this table should become generated)

| Brand | WMI | Modules | known_dids | decodable | module-bound | Families | Verified on a car | Read svc as data | Identity block | Conf |
|---|---:|---:|---:|---:|---:|---:|---|---|---|---|
| psa | 8 | 23 | 33 | 21 | **33** | **3** | **yes** (1 car) | no (22 implicit) | yes (band only) | high |
| vag | 15 | 20 | 31 | 16 | 0 | 0 | no | no | no (docs only) | high |
| ford | 22 | 9 | 18 | 16 | 0 | 0 | no | no | no | medium |
| bmw | 11 | 7 | 16 | 7 | 0 | 0 | no | no (needs 6F1 target byte) | no | medium |
| hyundai_kia | 18 | 16 | 11 | 4 | 0 | 0 | no | ⚠ needs 21 on PS platform | no (docs only) | high |
| nissan | 17 | 5 | 11 | 5 | 0 | 0 | no | ⚠ needs 21 | no | high |
| toyota | 29 | 10 | 11 | 7 | 0 | 0 | no | ⚠ older hybrids 1A | no | high |
| mercedes | 11 | 14 | 10 | 7 | 0 | 0 | no | no (gateway silence unmodelled) | no | medium |
| cupra | 1 | 10 | 9 | 5 | 0 | 0 | no | no | no | medium |
| renault | 9 | 16 | 7 | 5 | 0 | 0 | no | ⚠ needs 21 | no | high |
| fca | 21 | 7 | 7 | 5 | 0 | 0 | no | no | no | low |
| honda | 20 | 7 | 7 | **0** | 0 | 0 | no | no (29-bit target iteration) | no | medium |
| mazda | 15 | 4 | 7 | 5 | 0 | 0 | no | no | no | medium |
| gm | 14 | 5 | 5 | 4 | 0 | 0 | no | ⚠ needs 1A + Ultium 29-bit | no | low |
| skoda | 4 | 10 | 4 | **0** | 0 | 0 | no | no | no | medium |
| seat | 1 | 9 | 4 | **0** | 0 | 0 | no | no | no | medium |
| opel_psa | 3 | 6 | 3 | 3 | 0 | 0 | no | ⚠ needs 1A pre-2017 | no | medium |
| volvo | 9 | 1 | 2 | 2 | 0 | 0 | no | no (VIDA unmodellable) | no | medium |
| subaru | 7 | 1 | 1 | 0 | 0 | 0 | no | no | no | low |
| mitsubishi | 11 | 0 | 0 | 0 | 0 | 0 | no | n/a | no | low |
| tesla | 5 | 0 | 0 | 0 | 0 | 0 | no | n/a | no | high (negative) |
| **total** | 251 | 180 | 197 | 116 | 33 (PSA) | 3 (PSA) | 1 brand | 0 brands | 1 brand | |

## 7. The six bounded targets (what to change, in order)

The gap is narrower than the finding count suggests: research and protocols are multi-brand; the layer between them is five code/data targets plus the corpus.

| # | Target | Closes | Effort |
|---|---|---|---|
| T0 | **Scrub the real VIN from `apps/mobile`; fix the `v3/v4` plan-version mismatch.** | 5.8 | hours |
| T1 | **Pack schema v9**: `decodes[]` per DID (multi-value, signed, encodings, bit fields, strings), `read_service`, `identity_block`, `platforms[]`, `source` on every entry, route tuple (target byte, extension, protocol), `gateway_behaviour`; migrate the prose facts from `RESEARCH.md`; regenerate the coverage table (§6) from the pack. | 5.3, S2, S5 | days |
| T2 | **No brand in code**: `builtin_modules` → `known_modules_for_vin`; `parked_verification` → plan template from the pack; one fingerprint builder driven by `identity_block`; overlay packs enumerated; service and route parameterised from data; hypothesis bands per family. | 5.1, 5.2, S1 | days |
| T3 | **Multi-brand corpus**: import the licence-clean open corpora catalogued in `RESEARCH.md` as per-brand fixtures with attribution; add a second seed vehicle of another brand to every layer's tests; cover the seven untested payload shapes. | 5.4, S3 | days |
| T4 | **Session tooling + surfaces**: generic `session.py`; generated guided steps with `applicable_if`; Lab/API/docs/mock/i18n/WMI table brand-neutral; app-wide vehicle switcher. | 5.5, 5.6, S6 | days |
| T5 | **Transport abstraction** (`Transport` + `BluetoothControl` traits, adapter profiles, `device_kind` from the banner). Independent of brand; needed for any user who is not the author. | 5.7 | week |

Then **S4** is a test, not a task: connect any vehicle of another brand and replay vehicles of others; the discovery protocol's acceptance criteria decide.

## 8. Rules from here on

1. A PR that adds a CAN id, DID, identity layout or plan name as a code constant is rejected; it goes in the pack with a `source`.
2. Every new fixture or test that uses a vehicle lives under `fixtures/{brand}/{platform}/`; the vehicle we own is one such directory.
3. Every "for example" in docs, API and copy carries examples from more than one brand, or none.
4. The per-brand coverage table is regenerated in CI from the pack and linked from the README; it is the scoreboard for this goal.

## 9. Sources for this audit

Three read-only sweeps on 2026-08-29 over `main` @ `1174bb3`: Rust backend (`src-tauri/src`), knowledge/evidence (`packages/uds-map`, `tests/fixtures`, `docs`, `scripts`), and frontend/API/schema (`src`, `src-tauri/src/api`, `supabase`, `apps/mobile`, `packages/core`). Every finding carries a path and line; counts are as of that commit.


## 10. Independent review of v1.0 (2026-08-28) and what changed in v1.1

An independent review re-ran the suites (uds-map 16, discovery 26, correlation 19 — all passing) and re-parsed the pack. Its status call, adopted here as the baseline:

| Criterion | Status | Why |
|---|---|---|
| S1 no brand in code | **Red** | PSA modules, identity parsing, plans, plan names, UI defaults and correlation thresholds compiled in |
| S2 universal schema | **Red** | several required protocol and payload shapes inexpressible |
| S3 multi-brand evidence | **Red** | all vehicle evidence is C4 |
| S4 new car reaches coverage from data | **Partial** | join/hypotheses/coverage exist but are manual and depend on fingerprints/routes the generic runtime cannot reliably acquire |
| S5 generated coverage | **Red** | §6 is hand-written |
| S6 brand-neutral product | **Red** | Lab, API, mock, scripts, copy PSA-oriented |

Honest product statement today: *Scainner has a tested vehicle-knowledge acquisition method and a 21-brand research map, but automatic manufacturer-specific discovery is proven only on the single vehicle we own and its ECU families.*

Corrections applied in v1.1 (all verified against the repo): fully decodable DIDs 116 → **112** (schema definition: offset+len+scale+bias); evidence files 19 → **16**; ELM fixtures stated as **13, of which 2 real vehicle captures**; the VIN fix recorded as done on this branch; 29-bit and address-extension support described as a *representation* gap rather than a transport gap; the `7DF` cleanup finding qualified; `signed` noted as present on family decodes; date corrected to 2026-08-28; the §6 table's "decodable" column should be read as 112 in total (per-brand cells retained from the sweep pending the generated table).

What the review confirmed as already solid and not to be rebuilt: VIN → profile selection, known-module ordering and per-brand bands, per-block response-offset rules, normal-fixed 29-bit discovery, compatibility keys and strong/weak/name-only joins, inherited hypotheses disabled until evidence, evidence-backed coverage, deterministic correlation, vehicle-scoped storage, honest partial states.
