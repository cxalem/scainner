# uds-map coverage

Generated from `data/uds-map.json` v9 (2026-08-28) by `pnpm coverage` — do not edit by hand; CI fails when this file is stale.

Columns: **WMIs** VIN prefixes routed to the brand · **Modules** documented address pairs (29-bit in brackets) · **DIDs** known DIDs · **Decodable** DIDs with at least one decode · **Bound** DIDs bound to an exact module (unknown-binding entries in brackets) · **Families** ECU families seen on the brand · **Decodes** decode values (DIDs with an evidence note) · **On vehicle** DIDs decoded from this project's own captures · **Read svc** read services represented in data · **Identity** identity block · **Platforms** platform entries (with a VIN-selectable pattern in brackets) · **Level** `profiled_level` · **Gateway** silence semantics · **Conf** brand confidence.

| Brand | WMIs | Modules | DIDs | Decodable | Bound | Families | Decodes | On vehicle | Read svc | Identity | Platforms | Level | Gateway | Conf |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---:|---|---|---|
| psa | 8 | 23 | 33 | 21 | 33 | 3 | 21 (16 ev.) | 17 | 22 | iso + 4 vendor | 1 (1 vds) | decodes_verified | unreachable_pins | high |
| opel_psa | 3 | 6 | 3 | 3 | 3 | 0 | 3 | 0 | 22 | iso | 1 | routes_sourced | unknown | medium |
| vag | 15 | 20 | 31 | 17 | 26 (5 unknown) | 0 | 18 | 0 | 22 | iso + 1 vendor | 3 | routes_sourced | unknown | high |
| skoda | 4 | 10 | 4 | 0 | 4 | 0 | 0 | 0 | 22 | iso | 0 | routes_sourced | unknown | medium |
| seat | 1 | 9 | 4 | 0 | 4 | 0 | 0 | 0 | 22 | iso | 0 | routes_sourced | unknown | medium |
| cupra | 1 | 10 | 9 | 5 | 9 | 0 | 5 | 0 | 22 | iso | 1 | routes_sourced | unknown | medium |
| bmw | 11 | 7 | 16 | 7 | 12 (4 unknown) | 0 | 7 | 0 | 22 | iso | 3 | routes_sourced | unknown | medium |
| mercedes | 11 | 14 | 10 | 7 | 10 | 0 | 10 | 0 | 22 | iso | 3 | routes_sourced | filtered | medium |
| renault | 9 | 16 | 7 | 5 | 7 | 0 | 5 | 0 | 21, 22 | iso | 1 | routes_sourced | unknown | high |
| nissan | 17 | 5 | 11 | 5 | 11 | 0 | 5 | 0 | 21, 22 | iso | 2 (2 vds) | routes_sourced | unknown | high |
| hyundai_kia | 18 | 16 | 11 | 9 | 9 (2 unknown) | 0 | 113 | 0 | 21, 22 | iso + 2 vendor | 2 | routes_sourced | unknown | high |
| ford | 22 | 9 | 18 | 16 | 15 (3 unknown) | 0 | 16 | 0 | 22 | iso | 1 | routes_sourced | unknown | medium |
| gm | 14 | 5 (1) | 5 | 4 | 3 (2 unknown) | 0 | 4 | 0 | 1A, 22 | iso | 2 | routes_sourced | unknown | low |
| fca | 21 | 7 (1) | 7 | 5 | 3 (4 unknown) | 0 | 5 | 0 | 22 | iso + 1 vendor | 2 | routes_sourced | unknown, writes blocked | low |
| toyota | 29 | 10 | 11 | 7 | 6 (5 unknown) | 0 | 8 | 0 | 21, 22 | iso | 8 (5 vds) | routes_sourced | unknown | high |
| honda | 20 | 7 (6) | 7 | 0 | 6 (1 unknown) | 0 | 0 | 0 | 22 | iso + 1 vendor | 2 | routes_sourced | unknown | medium |
| mazda | 15 | 4 | 13 | 11 | 8 (5 unknown) | 0 | 11 | 0 | 22 | iso | 0 | routes_sourced | unknown | medium |
| volvo | 9 | 1 (1) | 2 | 2 | 0 (2 unknown) | 0 | 2 | 0 | 22 | iso | 2 (1 vds) | routes_sourced | unknown | medium |
| subaru | 7 | 0 | 1 | 0 | 0 (1 unknown) | 0 | 0 | 0 | — | iso + 1 vendor | 1 | standard_only | unknown | low |
| mitsubishi | 11 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | iso | 1 | standard_only | unknown | low |
| tesla | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | iso | 2 (2 vds) | standard_only | unknown | high |
| **total** | 251 | 179 (9) | 203 | 124 | 169 (34 unknown) | 3 | 233 (16 ev.) | 17 | 18 brands | 21 brands | 38 (11 vds) | 1 decodes_verified / 0 routes_verified / 17 routes_sourced / 3 standard_only | 3 brands | |

## Profiled levels

`standard_only`: no manufacturer routes in data · `routes_sourced`: routes from open implementations or community tables · `routes_verified`: at least one route confirmed by a recorded request/response capture (a project capture or an open corpus test fixture with raw bytes) · `decodes_verified`: decodes confirmed on a vehicle by this project. Levels are data (`brands[].profiled_level`) with `brands[].sources[]` behind them; `pnpm lint:pack` fails a level the sources cannot support.

- **decodes_verified** (1): psa
- **routes_verified** (0): —
- **routes_sourced** (17): opel_psa, vag, skoda, seat, cupra, bmw, mercedes, renault, nissan, hyundai_kia, ford, gm, fca, toyota, honda, mazda, volvo
- **standard_only** (3): subaru, mitsubishi, tesla

## Decode shapes

- `be`: 225
- `be/signed`: 7
- `bitfield[0+4]`: 1

## Read services and routes

- service `21` on 4 module(s): renault 79B/7BB, renault 745/765, nissan 79B/7BB, hyundai_kia 7D6/7DE
- route protocol `can11_500`: 170 module(s)
- route protocol `can29_custom`: 1 module(s)
- route protocol `can29_normal_fixed`: 8 module(s)

## Unknown bindings

Known DIDs whose module the research does not name (`modules: []`, `binding: "unknown"`). They are browsable but never label a module's answer; binding one needs a source that says which module carries it.

- vag: 2A0B, 1E0E, 1E0F, F40C, F41F
- bmw: DEA7, DE84, DEF5, DB99
- hyundai_kia: F100, F110
- ford: 1E1C, 1E12, DE00
- gm: 00DF, 006D
- fca: B010, 0121, 022A, F132
- toyota: 1F9A, 106C, 1F05, 1074, 1021
- honda: F112
- mazda: 1310, 1E1C, 61B1, 0415, D901
- volvo: EE6F, 4028
- subaru: F100

## Overlay packs

- `obdb-citroen` v2 (CC-BY-SA-4.0): psa — 1 module(s), 5 DID(s), 13 decode(s)

## Research

Research candidates are evidence about *where to look*, never trusted knowledge: no row here decodes a value or labels a module. Counted from the runtime packs listed in `data/research-packs.json`. Columns: **Packs** research packs carrying a profile for the brand · **Routes** candidate routes (platform-scoped in brackets) · **Exploration** routes offered only to explicit parked exploration · **Candidate DIDs** identifiers a reached route may ask for · **Negative** candidates the research itself marks never-to-request (unsupported, or disproven on a test vehicle).

| Brand | Packs | Routes | Exploration | Candidate DIDs | Negative |
|---|---|---:|---:|---:|---:|
| bmw | 1 | 0 | 0 | 0 | 0 |
| byd | 1 | 1 (1 platform-scoped) | 0 | 6 | 0 |
| ferrari | 1 | 0 | 0 | 0 | 0 |
| gm | 1 | 0 | 0 | 0 | 0 |
| honda | 1 | 0 | 0 | 0 | 0 |
| hyundai_kia | 1 | 0 | 0 | 0 | 0 |
| jlr | 1 | 3 (3 platform-scoped) | 0 | 0 | 0 |
| livan_maple | 1 | 0 | 0 | 0 | 0 |
| lucid | 1 | 0 | 0 | 0 | 0 |
| maxus | 1 | 2 (2 platform-scoped) | 0 | 6 | 0 |
| mazda | 1 | 1 | 0 | 0 | 0 |
| mg | 1 | 1 (1 platform-scoped) | 0 | 2 | 0 |
| mitsubishi | 1 | 0 | 0 | 0 | 0 |
| nissan | 1 | 0 | 0 | 0 | 0 |
| omoda | 1 | 0 | 0 | 0 | 0 |
| porsche | 1 | 1 (1 platform-scoped) | 0 | 2 | 0 |
| psa | 2 | 53 (53 platform-scoped) | 49 | 7 | 0 |
| renault | 1 | 76 (76 platform-scoped) | 0 | 23 | 0 |
| rivian | 1 | 0 | 0 | 0 | 0 |
| seat | 1 | 100 (12 platform-scoped) | 0 | 323 | 0 |
| skoda | 1 | 3 | 0 | 0 | 0 |
| subaru | 1 | 2 | 0 | 0 | 0 |
| suzuki | 1 | 2 | 0 | 1 | 0 |
| tesla | 1 | 0 | 0 | 0 | 0 |
| toyota | 1 | 8 (8 platform-scoped) | 0 | 9 | 0 |
| vag | 1 | 104 (14 platform-scoped) | 0 | 235 | 18 |
| volvo | 1 | 0 | 0 | 0 | 0 |
| **total** | 5 packs | 357 (171 platform-scoped) | 49 | 614 | 18 |

- `new-brand-research-v2` v2 (2026-08-29): byd, ferrari, jlr, livan_maple, lucid, maxus, mg, omoda, porsche, rivian, suzuki
- `existing-brand-hypotheses-v3-delta` v5 (2026-08-31): bmw, gm, honda, hyundai_kia, mazda, mitsubishi, nissan, psa, seat, skoda, subaru, tesla, vag, volvo
- `renault-deep-research-runtime-v1` v1 (2026-08-31): renault
- `psa-deep-research-runtime-v1` v1 (2026-08-31): psa
- `toyota-deep-research-runtime-v1` v1 (2026-09-02): toyota

## Sources

| Source | Type | Licence | Brands |
|---|---|---|---|
| apps/desktop/docs/research/c41-abs-did-research.md | project_capture | MIT | psa |
| apps/desktop/docs/workflows/parked-vehicle-verification.md | project_capture | MIT | psa |
| docs/uds/hunt_results.txt | project_capture | MIT | psa |
| https://github.com/ConnorHowell/vag-uds-ids | community | unlicensed | cupra, seat, skoda, vag |
| https://github.com/EVNotify/EVNotiPi | open_implementation | CC-BY-NC-4.0 | hyundai_kia |
| https://github.com/OBDb | community | CC-BY-SA-4.0 | honda, mazda, toyota |
| https://github.com/OBDb/Cupra-Born | community | CC-BY-SA-4.0 | cupra |
| https://github.com/OBDb/Mercedes-Benz-EQB | community | CC-BY-SA-4.0 | mercedes |
| https://github.com/OBDb/Nissan-Leaf | community | CC-BY-SA-4.0 | nissan |
| https://github.com/OBDb/Polestar-2 | community | CC-BY-SA-4.0 | volvo |
| https://github.com/OBDb/Toyota-Prius | community | CC-BY-SA-4.0 | toyota |
| https://github.com/OBDb/Volkswagen-ID.4 | community | CC-BY-SA-4.0 | vag |
| https://github.com/Tigo2000/Volvo-VIDA | open_implementation | GPL-3.0 | volvo |
| https://github.com/commaai/opendbc | open_implementation | MIT | cupra, fca, ford, gm, hyundai_kia, toyota, vag |
| https://github.com/commaai/opendbc/blob/master/opendbc/car/uds.py | open_implementation | MIT | bmw, cupra, ford, gm, mazda, mercedes, mitsubishi, nissan, opel_psa, psa, renault, seat, skoda, tesla, toyota, volvo |
| https://github.com/fesch/CanZE | open_implementation | GPL-3.0-or-later | renault |
| https://github.com/jcevanco/rcp_bmw_service_0x22/blob/master/src/inc/pid_debug.lua | open_implementation | GPL-3.0 | bmw |
| https://github.com/jyseojys/diag-server | tool_screen | unlicensed | psa |
| https://github.com/ludwig-v/arduino-psa-diag/blob/master/ECU_LIST.md | community | GPL-3.0 | psa |
| https://github.com/ludwig-v/arduino-psa-diag/blob/master/zones/BMF.md | community | GPL-3.0 | psa |
| https://github.com/meatpiHQ/wican-fw/blob/main/vehicle_profiles/fiat/600e.json | open_implementation | GPL-3.0 | fca, opel_psa, psa |
| https://github.com/meatpiHQ/wican-fw/blob/main/vehicle_profiles/gmc/sierra.json | open_implementation | GPL-3.0 | gm |
| https://github.com/meatpiHQ/wican-fw/blob/main/vehicle_profiles/opel/astra.json | open_implementation | GPL-3.0 | opel_psa |
| https://github.com/meatpiHQ/wican-fw/blob/main/vehicle_profiles/opel/opel.json | open_implementation | GPL-3.0 | gm |
| https://github.com/meatpiHQ/wican-fw/tree/main/vehicle_profiles/ford | open_implementation | GPL-3.0 | ford |
| https://github.com/meatpiHQ/wican-fw/tree/main/vehicle_profiles/ram | open_implementation | GPL-3.0 | fca |
| https://github.com/openvehicles/Open-Vehicle-Monitoring-System-3/tree/master/vehicle/OVMS.V3/components/vehicle_bmwi3 | open_implementation | MIT | bmw |
| https://github.com/openvehicles/Open-Vehicle-Monitoring-System-3/tree/master/vehicle/OVMS.V3/components/vehicle_hyundai_ioniq5 | open_implementation | MIT | hyundai_kia |
| https://github.com/openvehicles/Open-Vehicle-Monitoring-System-3/tree/master/vehicle/OVMS.V3/components/vehicle_kiasoulev | open_implementation | MIT | hyundai_kia |
| https://github.com/openvehicles/Open-Vehicle-Monitoring-System-3/tree/master/vehicle/OVMS.V3/components/vehicle_nissanleaf | open_implementation | MIT | nissan |
| https://github.com/openvehicles/Open-Vehicle-Monitoring-System-3/tree/master/vehicle/OVMS.V3/components/vehicle_vweup | open_implementation | MIT | cupra, seat, skoda, vag |
| https://github.com/projectgus/car_hacking | open_implementation | BSD-3-Clause | mitsubishi |
| https://github.com/rnd-ash/W203-canbus | open_implementation | MIT | mercedes |
| https://github.com/v-cu/dpf-load-monitor-wide | open_implementation | CC-BY-NC-SA-4.0 | vag |
| https://vpic.nhtsa.dot.gov/api/ | oem | public domain (US federal) | nissan, tesla, volvo |
| packages/uds-map/RESEARCH.md#32-the-f4xx-obd-pid-mirror-band | community | MIT | cupra, fca, ford, mercedes, seat, skoda, toyota, vag |
| packages/uds-map/RESEARCH.md#35-two-oem-address-schemes-that-are-not-simple-11-bit-pairs | community | MIT | bmw, gm, honda |
| packages/uds-map/RESEARCH.md#bmw--mini | community | MIT | bmw |
| packages/uds-map/RESEARCH.md#fca--stellantis-north-america | community | MIT | fca |
| packages/uds-map/RESEARCH.md#ford | community | MIT | ford |
| packages/uds-map/RESEARCH.md#honda--acura-mazda-subaru-mitsubishi | community | MIT | honda, mitsubishi, subaru |
| packages/uds-map/RESEARCH.md#hyundai--kia--genesis | community | MIT | hyundai_kia |
| packages/uds-map/RESEARCH.md#job-2-outcome-extension-newer-models | community | MIT | honda |
| packages/uds-map/RESEARCH.md#mercedes-benz--weakest-brand-in-the-file-by-a-wide-margin | community | MIT | mercedes |
| packages/uds-map/RESEARCH.md#nissan--infiniti | community | MIT | nissan |
| packages/uds-map/RESEARCH.md#psa--stellantis-europe--highest-confidence-in-the-file | community | MIT | psa |
| packages/uds-map/RESEARCH.md#toyota--lexus | community | MIT | toyota |
| packages/uds-map/RESEARCH.md#vag-vw-audi--škoda-seat-cupra | community | MIT | vag |
| packages/uds-map/RESEARCH.md | community | MIT | cupra |
