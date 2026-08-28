# uds-map v9 migration log

Generated 2026-08-28 by `packages/uds-map/scripts/migrate-v8-to-v9.py` (multi-brand plan, Phase 1, P1.3).
Each row is one fact that lived only as prose in `packages/uds-map/RESEARCH.md` (or in an entry's label/note text)
and now lives in `data/uds-map.json` at the JSON path shown, with the source it carries.
`research:<anchor>` means the fact's only citation is that RESEARCH.md section (`type: community`).
`derived` means the value was derived from what the pack holds (see `docs/uds/pack-schema-v9.md`).

| Fact | JSON path | Source |
|---|---|---|
| DID D40F: 1 decodes from label/note text | `brands[psa].known_dids[D40F].decodes` | project |
| DID D411: 1 decodes from label/note text | `brands[psa].known_dids[D411].decodes` | project |
| identity block: 4 vendor field(s) on top of ISO | `brands[psa].identity_block` | project_abs_research |
| platform c41 (2020-now) | `brands[psa].platforms[c41]` | project |
| gateway behaviour: silence means absent, writes_blocked=False | `brands[psa].gateway_behaviour` | project_hunt |
| profiled_level decodes_verified | `brands[psa].profiled_level` | derived |
| DID D410 bound to 6B4/694 | `brands[opel_psa].known_dids[D410].modules` | wican_600e |
| DID D860 bound to 6B4/694 | `brands[opel_psa].known_dids[D860].modules` | wican_600e |
| DID D815 bound to 6B4/694 | `brands[opel_psa].known_dids[D815].modules` | wican_600e |
| platform stellantis_era (2017-now) | `brands[opel_psa].platforms[stellantis_era]` | wican_astra |
| profiled_level routes_sourced | `brands[opel_psa].profiled_level` | derived |
| F4xx mode-01 mirror band demoted to low | `brands[vag].did_bands[F400]` | research:32-the-f4xx-obd-pid-mirror-band |
| DID 2203 bound to 714/77E | `brands[vag].known_dids[2203].modules` | vag_uds_ids |
| DID 2260 bound to 714/77E | `brands[vag].known_dids[2260].modules` | vag_uds_ids |
| DID 2261 bound to 714/77E | `brands[vag].known_dids[2261].modules` | vag_uds_ids |
| DID 22E0 bound to 714/77E | `brands[vag].known_dids[22E0].modules` | vag_uds_ids |
| DID 22E4 bound to 714/77E | `brands[vag].known_dids[22E4].modules` | vag_uds_ids |
| DID 1821 bound to 713/77D | `brands[vag].known_dids[1821].modules` | vag_uds_ids |
| DID 1E3B bound to 7E5/7ED | `brands[vag].known_dids[1E3B].modules` | obdb_id4 |
| DID 1E3D bound to 7E5/7ED | `brands[vag].known_dids[1E3D].modules` | obdb_id4 |
| DID 028C bound to 7E5/7ED | `brands[vag].known_dids[028C].modules` | obdb_id4 |
| DID 1DD0 bound to 765/7CF | `brands[vag].known_dids[1DD0].modules` | ovms_vweup |
| DID 1E33 bound to 7E5/7ED | `brands[vag].known_dids[1E33].modules` | obdb_id4 |
| DID 1E34 bound to 7E5/7ED | `brands[vag].known_dids[1E34].modules` | obdb_id4 |
| DID 2A0B: 1 decodes from label/note text | `brands[vag].known_dids[2A0B].decodes` | ovms_vweup |
| DID 74CB bound to 7E5/7ED | `brands[vag].known_dids[74CB].modules` | ovms_vweup |
| DID 74CB: 2 decodes from label/note text | `brands[vag].known_dids[74CB].decodes` | ovms_vweup |
| DID 02BD bound to 7E5/7ED | `brands[vag].known_dids[02BD].modules` | ovms_vweup |
| DID 465C bound to 7E6/7EE | `brands[vag].known_dids[465C].modules` | ovms_vweup |
| DID 465B bound to 7E6/7EE | `brands[vag].known_dids[465B].modules` | ovms_vweup |
| DID F45B bound to 7E0/7E8 | `brands[vag].known_dids[F45B].modules` | ovms_vweup |
| DID 11BE bound to 7E0/7E8 | `brands[vag].known_dids[11BE].modules` | dpf_monitor |
| DID 11B2 bound to 7E0/7E8 | `brands[vag].known_dids[11B2].modules` | dpf_monitor |
| DID 10F9 bound to 7E0/7E8 | `brands[vag].known_dids[10F9].modules` | dpf_monitor |
| DID 10FB bound to 7E0/7E8 | `brands[vag].known_dids[10FB].modules` | dpf_monitor |
| DID 1156 bound to 7E0/7E8 | `brands[vag].known_dids[1156].modules` | dpf_monitor |
| DID 115E bound to 7E0/7E8 | `brands[vag].known_dids[115E].modules` | dpf_monitor |
| DID 114F bound to 7E0/7E8 | `brands[vag].known_dids[114F].modules` | dpf_monitor |
| DID F802 bound to 7E0/7E8 | `brands[vag].known_dids[F802].modules` | vag_uds_ids |
| DID 51E0 bound to 7E5/7ED | `brands[vag].known_dids[51E0].modules` | obdb_id4 |
| identity block: 1 vendor field(s) on top of ISO | `brands[vag].identity_block` | vag_uds_ids |
| platform kwp2000_tp20 (?-now) | `brands[vag].platforms[kwp2000_tp20]` | research:4-vag-vw-audi--škoda-seat-cupra |
| platform pre_meb_e_up (2013-2020) | `brands[vag].platforms[pre_meb_e_up]` | ovms_vweup |
| platform meb (2020-now) | `brands[vag].platforms[meb]` | obdb_id4 |
| gateway behaviour: silence means unknown, writes_blocked=False | `brands[vag].gateway_behaviour` | vag_uds_ids |
| profiled_level routes_sourced | `brands[vag].profiled_level` | derived |
| F4xx mode-01 mirror band demoted to low | `brands[skoda].did_bands[F400]` | research:32-the-f4xx-obd-pid-mirror-band |
| DID 2203 bound to 714/77E | `brands[skoda].known_dids[2203].modules` | vag_uds_ids |
| DID 2260 bound to 714/77E | `brands[skoda].known_dids[2260].modules` | vag_uds_ids |
| DID 2261 bound to 714/77E | `brands[skoda].known_dids[2261].modules` | vag_uds_ids |
| DID 1821 bound to 713/77D | `brands[skoda].known_dids[1821].modules` | vag_uds_ids |
| profiled_level routes_sourced | `brands[skoda].profiled_level` | derived |
| F4xx mode-01 mirror band demoted to low | `brands[seat].did_bands[F400]` | research:32-the-f4xx-obd-pid-mirror-band |
| DID 2203 bound to 714/77E | `brands[seat].known_dids[2203].modules` | vag_uds_ids |
| DID 2260 bound to 714/77E | `brands[seat].known_dids[2260].modules` | vag_uds_ids |
| DID 2261 bound to 714/77E | `brands[seat].known_dids[2261].modules` | vag_uds_ids |
| DID 1821 bound to 713/77D | `brands[seat].known_dids[1821].modules` | vag_uds_ids |
| profiled_level routes_sourced | `brands[seat].profiled_level` | derived |
| F4xx mode-01 mirror band demoted to low | `brands[cupra].did_bands[F400]` | research:32-the-f4xx-obd-pid-mirror-band |
| DID 2203 bound to 714/77E | `brands[cupra].known_dids[2203].modules` | vag_uds_ids |
| DID 2260 bound to 714/77E | `brands[cupra].known_dids[2260].modules` | vag_uds_ids |
| DID 1821 bound to 713/77D | `brands[cupra].known_dids[1821].modules` | vag_uds_ids |
| DID 1E33 bound to 7E5/7ED | `brands[cupra].known_dids[1E33].modules` | obdb_born |
| DID 1E34 bound to 7E5/7ED | `brands[cupra].known_dids[1E34].modules` | obdb_born |
| DID 1E3B bound to 7E5/7ED | `brands[cupra].known_dids[1E3B].modules` | obdb_born |
| DID 1E3D bound to 7E5/7ED | `brands[cupra].known_dids[1E3D].modules` | obdb_born |
| DID 028C bound to 7E5/7ED | `brands[cupra].known_dids[028C].modules` | obdb_born |
| DID 51E0 bound to 7E5/7ED | `brands[cupra].known_dids[51E0].modules` | obdb_born |
| platform meb_born (2021-now) | `brands[cupra].platforms[meb_born]` | obdb_born |
| profiled_level routes_sourced | `brands[cupra].profiled_level` | derived |
| D-CAN target byte 12 (request 6F1, response 600+target, ISO-TP extended address) | `brands[bmw].modules[612].route` | ovms_bmwi3 |
| D-CAN target byte 07 (request 6F1, response 600+target, ISO-TP extended address) | `brands[bmw].modules[607].route` | ovms_bmwi3 |
| D-CAN target byte 60 (request 6F1, response 600+target, ISO-TP extended address) | `brands[bmw].modules[660].route` | ovms_bmwi3 |
| D-CAN target byte 10 (request 6F1, response 600+target, ISO-TP extended address) | `brands[bmw].modules[610].route` | ovms_bmwi3 |
| D-CAN target byte 5E (request 6F1, response 600+target, ISO-TP extended address) | `brands[bmw].modules[65E].route` | ovms_bmwi3 |
| D-CAN target byte 29 (request 6F1, response 600+target, ISO-TP extended address) | `brands[bmw].modules[629].route` | ovms_bmwi3 |
| DID DD68 bound to 6F1/607 | `brands[bmw].known_dids[DD68].modules` | ovms_bmwi3 |
| DID DD69 bound to 6F1/607 | `brands[bmw].known_dids[DD69].modules` | ovms_bmwi3 |
| DID DDBC bound to 6F1/607 | `brands[bmw].known_dids[DDBC].modules` | ovms_bmwi3 |
| DID D10D bound to 6F1/660 | `brands[bmw].known_dids[D10D].modules` | ovms_bmwi3 |
| DID D107 bound to 6F1/660 | `brands[bmw].known_dids[D107].modules` | ovms_bmwi3 |
| DID 4300 bound to 6F1/612 | `brands[bmw].known_dids[4300].modules` | rcp_bmw |
| DID 4650 bound to 6F1/612 | `brands[bmw].known_dids[4650].modules` | rcp_bmw |
| DID 5890 bound to 6F1/612 | `brands[bmw].known_dids[5890].modules` | rcp_bmw |
| DID 580F bound to 6F1/612 | `brands[bmw].known_dids[580F].modules` | rcp_bmw |
| DID 586F bound to 6F1/612 | `brands[bmw].known_dids[586F].modules` | rcp_bmw |
| DID 56D7 bound to 6F1/612 | `brands[bmw].known_dids[56D7].modules` | rcp_bmw |
| DID F410 bound to 6F1/610 | `brands[bmw].known_dids[F410].modules` | research:4-bmw--mini |
| scan policy conventional_11bit_and_target_byte_11bit | `brands[bmw].scan_policy` | research:35-two-oem-address-schemes-that-are-not-simple-11-bit-pairs |
| platform i3_ev (2013-2022) | `brands[bmw].platforms[i3_ev]` | ovms_bmwi3 |
| platform d_can_combustion (?-now) | `brands[bmw].platforms[d_can_combustion]` | rcp_bmw |
| platform f_g_series_enet (?-now) | `brands[bmw].platforms[f_g_series_enet]` | research:35-two-oem-address-schemes-that-are-not-simple-11-bit-pairs |
| profiled_level routes_sourced | `brands[bmw].profiled_level` | derived |
| F4xx mode-01 mirror band demoted to low | `brands[mercedes].did_bands[F400]` | research:32-the-f4xx-obd-pid-mirror-band |
| DID 2001 bound to 7E2/7EA | `brands[mercedes].known_dids[2001].modules` | obdb_eqb |
| DID 2001: 4 decodes from label/note text | `brands[mercedes].known_dids[2001].decodes` | obdb_eqb |
| DID 2002 bound to 7E2/7EA | `brands[mercedes].known_dids[2002].modules` | obdb_eqb |
| DID 2005 bound to 7E5/7ED | `brands[mercedes].known_dids[2005].modules` | obdb_eqb |
| DID 2526 bound to 7E5/7ED | `brands[mercedes].known_dids[2526].modules` | obdb_eqb |
| DID 2526: 1 decodes from label/note text | `brands[mercedes].known_dids[2526].decodes` | obdb_eqb |
| DID 6050 bound to 7E5/7ED | `brands[mercedes].known_dids[6050].modules` | obdb_eqb |
| DID 6053 bound to 7E5/7ED | `brands[mercedes].known_dids[6053].modules` | obdb_eqb |
| DID 6053: 1 decodes from label/note text | `brands[mercedes].known_dids[6053].decodes` | obdb_eqb |
| DID 6071 bound to 7E5/7ED | `brands[mercedes].known_dids[6071].modules` | obdb_eqb |
| DID 6075 bound to 7E5/7ED | `brands[mercedes].known_dids[6075].modules` | obdb_eqb |
| DID 6502 bound to 7E5/7ED | `brands[mercedes].known_dids[6502].modules` | obdb_eqb |
| DID 6504 bound to 7E5/7ED | `brands[mercedes].known_dids[6504].modules` | obdb_eqb |
| platform kwp_w203_w211 (2000-2009) | `brands[mercedes].platforms[kwp_w203_w211]` | w203 |
| platform eqb_mfa2 (2023-2025) | `brands[mercedes].platforms[eqb_mfa2]` | obdb_eqb |
| platform eva2_eqe_eqs (2021-now) | `brands[mercedes].platforms[eva2_eqe_eqs]` | obdb_eqb |
| gateway behaviour: silence means filtered, writes_blocked=False | `brands[mercedes].gateway_behaviour` | research:4-mercedes-benz--weakest-brand-in-the-file-by-a-wide-margin |
| profiled_level routes_sourced | `brands[mercedes].profiled_level` | derived |
| module 79B/7BB read service 21 | `brands[renault].modules[79B].read_service` | canze |
| module 745/765 read service 21 | `brands[renault].modules[745].read_service` | canze |
| DID 2002 bound to 7E4/7EC | `brands[renault].known_dids[2002].modules` | canze |
| DID 2005 bound to 7E4/7EC | `brands[renault].known_dids[2005].modules` | canze |
| DID 2006 bound to 7E4/7EC | `brands[renault].known_dids[2006].modules` | canze |
| DID 3206 bound to 7E4/7EC | `brands[renault].known_dids[3206].modules` | canze |
| DID 3451 bound to 7E4/7EC | `brands[renault].known_dids[3451].modules` | canze |
| DID 3444 bound to 7E4/7EC | `brands[renault].known_dids[3444].modules` | canze |
| DID FD1C bound to 7CA/7DA | `brands[renault].known_dids[FD1C].modules` | canze |
| platform zoe (2012-now) | `brands[renault].platforms[zoe]` | canze |
| profiled_level routes_sourced | `brands[renault].profiled_level` | derived |
| module 79B/7BB read service 21 | `brands[nissan].modules[79B].read_service` | ovms_leaf |
| DID 1103 bound to 797/79A | `brands[nissan].known_dids[1103].modules` | obdb_leaf |
| DID 1183 bound to 797/79A | `brands[nissan].known_dids[1183].modules` | obdb_leaf |
| DID 1183: 1 decodes from label/note text | `brands[nissan].known_dids[1183].decodes` | obdb_leaf |
| DID 1146 bound to 797/79A | `brands[nissan].known_dids[1146].modules` | obdb_leaf |
| DID 121A bound to 797/79A | `brands[nissan].known_dids[121A].modules` | obdb_leaf |
| DID 1236 bound to 797/79A | `brands[nissan].known_dids[1236].modules` | obdb_leaf |
| DID 1234 bound to 797/79A | `brands[nissan].known_dids[1234].modules` | obdb_leaf |
| DID 1255 bound to 797/79A | `brands[nissan].known_dids[1255].modules` | obdb_leaf |
| DID 0E2E bound to 743/763 | `brands[nissan].known_dids[0E2E].modules` | obdb_leaf |
| DID 1203 bound to 797/79A | `brands[nissan].known_dids[1203].modules` | ovms_leaf |
| DID 1205 bound to 797/79A | `brands[nissan].known_dids[1205].modules` | ovms_leaf |
| DID 0E01 bound to 743/763 | `brands[nissan].known_dids[0E01].modules` | obdb_leaf |
| platform leaf_ze0 (2011-2017) | `brands[nissan].platforms[leaf_ze0]` | vpic |
| platform leaf_ze1 (2018-now) | `brands[nissan].platforms[leaf_ze1]` | vpic |
| profiled_level routes_sourced | `brands[nissan].profiled_level` | derived |
| module 7D6/7DE read service 21 | `brands[hyundai_kia].modules[7D6].read_service` | ovms_soulev |
| DID 0101 bound to 7E4/7EC | `brands[hyundai_kia].known_dids[0101].modules` | ovms_ioniq5 |
| DID 0101: 5 decodes from label/note text | `brands[hyundai_kia].known_dids[0101].decodes` | ovms_ioniq5 |
| DID 0105 bound to 7E4/7EC | `brands[hyundai_kia].known_dids[0105].modules` | evnotipi |
| DID 0102 bound to 7E4/7EC | `brands[hyundai_kia].known_dids[0102].modules` | evnotipi |
| DID 0102: 32 per-cell voltage decodes (0.02 V/byte) | `brands[hyundai_kia].known_dids[0102].decodes` | evnotipi |
| DID 0103 bound to 7E4/7EC | `brands[hyundai_kia].known_dids[0103].modules` | evnotipi |
| DID 0103: 32 per-cell voltage decodes (0.02 V/byte) | `brands[hyundai_kia].known_dids[0103].decodes` | evnotipi |
| DID 0104 bound to 7E4/7EC | `brands[hyundai_kia].known_dids[0104].modules` | evnotipi |
| DID 0104: 32 per-cell voltage decodes (0.02 V/byte) | `brands[hyundai_kia].known_dids[0104].decodes` | evnotipi |
| DID B002 bound to 7C6/7CE | `brands[hyundai_kia].known_dids[B002].modules` | ovms_ioniq5 |
| DID C00B bound to 7A0/7A8 | `brands[hyundai_kia].known_dids[C00B].modules` | ovms_ioniq5 |
| DID C00B: 4 decodes from label/note text | `brands[hyundai_kia].known_dids[C00B].decodes` | ovms_ioniq5 |
| DID C002 bound to 7A0/7A8 | `brands[hyundai_kia].known_dids[C002].modules` | ovms_ioniq5 |
| DID C002: 4 decodes from label/note text | `brands[hyundai_kia].known_dids[C002].decodes` | ovms_ioniq5 |
| DID E004 bound to 7E2/7EA | `brands[hyundai_kia].known_dids[E004].modules` | ovms_ioniq5 |
| DID E004: 2 decodes from label/note text | `brands[hyundai_kia].known_dids[E004].decodes` | ovms_ioniq5 |
| identity block: 2 vendor field(s) on top of ISO | `brands[hyundai_kia].identity_block` | research:4-hyundai--kia--genesis |
| platform ps_soul_ev (2014-2019) | `brands[hyundai_kia].platforms[ps_soul_ev]` | ovms_soulev |
| platform e_gmp (2021-now) | `brands[hyundai_kia].platforms[e_gmp]` | ovms_ioniq5 |
| profiled_level routes_sourced | `brands[hyundai_kia].profiled_level` | derived |
| F4xx mode-01 mirror band demoted to low | `brands[ford].did_bands[F400]` | research:32-the-f4xx-obd-pid-mirror-band |
| DID 4028 bound to 726/72E | `brands[ford].known_dids[4028].modules` | wican_ford |
| DID 402A bound to 726/72E | `brands[ford].known_dids[402A].modules` | wican_ford |
| DID 402B bound to 726/72E | `brands[ford].known_dids[402B].modules` | wican_ford |
| DID 4029 bound to 726/72E | `brands[ford].known_dids[4029].modules` | wican_ford |
| DID 2813 bound to 726/72E | `brands[ford].known_dids[2813].modules` | wican_ford |
| DID 2814 bound to 726/72E | `brands[ford].known_dids[2814].modules` | wican_ford |
| DID 2815 bound to 726/72E | `brands[ford].known_dids[2815].modules` | wican_ford |
| DID 2816 bound to 726/72E | `brands[ford].known_dids[2816].modules` | wican_ford |
| DID 054B bound to 7E0/7E8 | `brands[ford].known_dids[054B].modules` | wican_ford |
| DID F45C bound to 7E0/7E8 | `brands[ford].known_dids[F45C].modules` | research:4-ford |
| DID F405 bound to 7E0/7E8 | `brands[ford].known_dids[F405].modules` | wican_ford |
| DID F40F bound to 7E0/7E8 | `brands[ford].known_dids[F40F].modules` | wican_ford |
| DID F42F bound to 7E0/7E8 | `brands[ford].known_dids[F42F].modules` | wican_ford |
| DID DD01 bound to 726/72E | `brands[ford].known_dids[DD01].modules` | wican_ford |
| DID DD04 bound to 726/72E | `brands[ford].known_dids[DD04].modules` | wican_ford |
| platform wican_profiled (?-now) | `brands[ford].platforms[wican_profiled]` | wican_ford |
| profiled_level routes_sourced | `brands[ford].profiled_level` | derived |
| module 14DACBF1/142AF1CB route can29_custom | `brands[gm].modules[14DACBF1].route` | research:35-two-oem-address-schemes-that-are-not-simple-11-bit-pairs |
| DID 5005 bound to 241/641 | `brands[gm].known_dids[5005].modules` | wican_sierra |
| DID 27C6 bound to 14DACBF1/142AF1CB | `brands[gm].known_dids[27C6].modules` | research:35-two-oem-address-schemes-that-are-not-simple-11-bit-pairs |
| DID 27AF bound to 14DACBF1/142AF1CB | `brands[gm].known_dids[27AF].modules` | research:35-two-oem-address-schemes-that-are-not-simple-11-bit-pairs |
| platform pre_2017_gmlan (?-2016) | `brands[gm].platforms[pre_2017_gmlan]` | wican_opel |
| platform ultium (2022-now) | `brands[gm].platforms[ultium]` | research:35-two-oem-address-schemes-that-are-not-simple-11-bit-pairs |
| profiled_level routes_sourced | `brands[gm].profiled_level` | derived |
| module 18DA10F1/18DAF110 route can29_normal_fixed | `brands[fca].modules[18DA10F1].route` | wican_ram |
| F4xx mode-01 mirror band demoted to low | `brands[fca].did_bands[F400]` | research:32-the-f4xx-obd-pid-mirror-band |
| DID D410 bound to 6B4/694 | `brands[fca].known_dids[D410].modules` | wican_600e |
| DID D860 bound to 6B4/694 | `brands[fca].known_dids[D860].modules` | wican_600e |
| DID D815 bound to 6B4/694 | `brands[fca].known_dids[D815].modules` | wican_600e |
| identity block: 1 vendor field(s) on top of ISO | `brands[fca].identity_block` | opendbc |
| platform sgw_2018 (2018-now) | `brands[fca].platforms[sgw_2018]` | research:4-fca--stellantis-north-america |
| platform stellantis_ev (2020-now) | `brands[fca].platforms[stellantis_ev]` | wican_600e |
| gateway behaviour: silence means unknown, writes_blocked=True | `brands[fca].gateway_behaviour` | research:4-fca--stellantis-north-america |
| profiled_level routes_sourced | `brands[fca].profiled_level` | derived |
| module 7E2/7EA read service 1A | `brands[toyota].modules[7E2].read_service` | research:33-not-every-brands-data-is-behind-service-0x22 |
| F4xx mode-01 mirror band demoted to low | `brands[toyota].did_bands[F400]` | research:32-the-f4xx-obd-pid-mirror-band |
| DID 1F5B bound to 7D2/7DA | `brands[toyota].known_dids[1F5B].modules` | obdb_toyota |
| DID 1F9A: 2 decodes from label/note text | `brands[toyota].known_dids[1F9A].decodes` | obdb_toyota |
| DID 182E bound to 747/74F | `brands[toyota].known_dids[182E].modules` | obdb_toyota |
| DID 1829 bound to 747/74F | `brands[toyota].known_dids[1829].modules` | obdb_toyota |
| DID 1022 bound to 7C0/7C8 | `brands[toyota].known_dids[1022].modules` | obdb_toyota |
| DID 10A2 bound to 7D2/7DA | `brands[toyota].known_dids[10A2].modules` | obdb_prius |
| DID 10A6 bound to 7D2/7DA | `brands[toyota].known_dids[10A6].modules` | obdb_prius |
| platform legacy_kwp_hybrid (?-2009) | `brands[toyota].platforms[legacy_kwp_hybrid]` | research:4-toyota--lexus |
| platform modern_ths (2010-now) | `brands[toyota].platforms[modern_ths]` | obdb_toyota |
| platform ths5_e_four (2023-now) | `brands[toyota].platforms[ths5_e_four]` | obdb_prius |
| profiled_level routes_sourced | `brands[toyota].profiled_level` | derived |
| module 18DA10F1/18DAF110 route can29_normal_fixed | `brands[honda].modules[18DA10F1].route` | obdb_honda |
| module 18DA1DF1/18DAF11D route can29_normal_fixed | `brands[honda].modules[18DA1DF1].route` | obdb_honda |
| module 18DA60F1/18DAF160 route can29_normal_fixed | `brands[honda].modules[18DA60F1].route` | obdb_honda |
| module 18DA26F1/18DAF126 route can29_normal_fixed | `brands[honda].modules[18DA26F1].route` | obdb_honda |
| module 18DA01F1/18DAF101 route can29_normal_fixed | `brands[honda].modules[18DA01F1].route` | obdb_honda |
| module 18DA1EF1/18DAF11E route can29_normal_fixed | `brands[honda].modules[18DA1EF1].route` | obdb_honda |
| DID 2660 bound to 18DA10F1/18DAF110 | `brands[honda].known_dids[2660].modules` | obdb_honda |
| DID 2610 bound to 18DA10F1/18DAF110 | `brands[honda].known_dids[2610].modules` | obdb_honda |
| DID 2615 bound to 18DA10F1/18DAF110 | `brands[honda].known_dids[2615].modules` | obdb_honda |
| DID 2663 bound to 18DA10F1/18DAF110 | `brands[honda].known_dids[2663].modules` | obdb_honda |
| DID 6001 bound to 18DA26F1/18DAF126 | `brands[honda].known_dids[6001].modules` | obdb_honda |
| DID 7028 bound to 18DA60F1/18DAF160 | `brands[honda].known_dids[7028].modules` | obdb_honda |
| scan policy conventional_11bit_and_normal_fixed_29bit | `brands[honda].scan_policy` | research:35-two-oem-address-schemes-that-are-not-simple-11-bit-pairs |
| identity block: 1 vendor field(s) on top of ISO | `brands[honda].identity_block` | obdb_honda |
| platform 29bit_target_iteration (?-now) | `brands[honda].platforms[29bit_target_iteration]` | obdb_honda |
| platform e_hev_2022 (2022-now) | `brands[honda].platforms[e_hev_2022]` | research:job-2-outcome-extension-newer-models |
| profiled_level routes_sourced | `brands[honda].profiled_level` | derived |
| DID 2A05 bound to 720/728 | `brands[mazda].known_dids[2A05].modules` | obdb_mazda |
| sibling DID 2A06 split out of the 2A05 label | `brands[mazda].known_dids[2A06]` | obdb_mazda |
| sibling DID 2A07 split out of the 2A05 label | `brands[mazda].known_dids[2A07]` | obdb_mazda |
| sibling DID 2A08 split out of the 2A05 label | `brands[mazda].known_dids[2A08]` | obdb_mazda |
| DID 2A0A bound to 720/728 | `brands[mazda].known_dids[2A0A].modules` | obdb_mazda |
| sibling DID 2A0B split out of the 2A0A label | `brands[mazda].known_dids[2A0B]` | obdb_mazda |
| sibling DID 2A0C split out of the 2A0A label | `brands[mazda].known_dids[2A0C]` | obdb_mazda |
| sibling DID 2A0D split out of the 2A0A label | `brands[mazda].known_dids[2A0D]` | obdb_mazda |
| profiled_level routes_sourced | `brands[mazda].profiled_level` | derived |
| module 18DA10F1/18DAF110 route can29_normal_fixed | `brands[volvo].modules[18DA10F1].route` | obdb_polestar2 |
| platform p1_p2_vida (?-2019) | `brands[volvo].platforms[p1_p2_vida]` | volvo_vida |
| platform cma_spa2 (2020-now) | `brands[volvo].platforms[cma_spa2]` | vpic |
| profiled_level routes_sourced | `brands[volvo].profiled_level` | derived |
| identity block: 1 vendor field(s) on top of ISO | `brands[subaru].identity_block` | research:4-honda--acura-mazda-subaru-mitsubishi |
| platform solterra_bz4x (2023-now) | `brands[subaru].platforms[solterra_bz4x]` | research:4-honda--acura-mazda-subaru-mitsubishi |
| profiled_level routes_sourced | `brands[subaru].profiled_level` | derived |
| platform outlander_phev (2013-now) | `brands[mitsubishi].platforms[outlander_phev]` | car_hacking |
| profiled_level standard_only | `brands[mitsubishi].profiled_level` | derived |
| platform model_3_y (2017-now) | `brands[tesla].platforms[model_3_y]` | vpic |
| platform model_s_x (2012-now) | `brands[tesla].platforms[model_s_x]` | vpic |
| profiled_level standard_only | `brands[tesla].profiled_level` | derived |
| overlay 013C: tyre temperature at byte 2 (raw - 50 C) imported | `packs/obdb-citroen.json known_dids[013C].decodes[1]` | obdb_citroen |
| overlay 013D: tyre temperature at byte 2 (raw - 50 C) imported | `packs/obdb-citroen.json known_dids[013D].decodes[1]` | obdb_citroen |
| overlay 013E: tyre temperature at byte 2 (raw - 50 C) imported | `packs/obdb-citroen.json known_dids[013E].decodes[1]` | obdb_citroen |
| overlay 013F: tyre temperature at byte 2 (raw - 50 C) imported | `packs/obdb-citroen.json known_dids[013F].decodes[1]` | obdb_citroen |

## Facts not migrated (and why)

See the list at the end of `docs/uds/pack-schema-v9.md`.
