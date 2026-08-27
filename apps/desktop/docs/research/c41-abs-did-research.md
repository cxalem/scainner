# Citroën C4 III (C41) ABS/ESP DID research

Date: 2026-08-27
Scope: online research only, no code changes. Vehicle: Citroën C4 III (C41), first registered 2022-04, 1.2 PureTech 130 (EB2ADTS), VIN prefix VR7. ABS/ESP reached at CAN 11-bit `6AD → 68D`, UDS service `22`, default session.

Evidence classes used below: **OEM/standard**, **open implementation (raw requests)**, **diagnostic-tool definition (proprietary-derived)**, **parts catalog**, **community**. "Locally observed" refers to the sessions in `docs/workflows/parked-vehicle-verification.md`.

## 1. Executive summary

1. **D40C = `MP_PRESSION_DE_FREINAGE`, 1 byte, factor 1, unit bar, `FF` = invalid.** Found in Diagbox-derived parameter definitions for the `ESPMK100_UDS` family. Our 1–14 bar (normal) / 28–33 bar (firm pedal) readings are consistent with master-cylinder pressure in bar.
2. **Wheel-speed order is documented: D400 = rear-left, D401 = rear-right, D402 = front-left, D403 = front-right**, 2 bytes, ×0.01 km/h, `FFFF` = invalid. This matches our locally observed pairing (D400/D402 one side, D401/D403 the other): the pairs are left and right, and the first of each pair is the rear wheel.
3. **D479 = `MP_CAPTEUR_DEPRESSION_CIRCUIT_FREINAGE`, 1 byte, factor 5, unit hPa** — the brake-servo (booster) vacuum sensor read by the ESP. 179 → 895 hPa. Whether the value is absolute pressure or depression needs one engine-off test (section 3).
4. **D435–D438 = `MP_ETAT_ROUE_{AVANT_GAUCHE, AVANT_DROITE, ARRIERE_GAUCHE, ARRIERE_DROITE}`**, 3-bit state (mask 7) of the indirect under-inflation detection (DSGi) per wheel. The state label texts are not in any open source; `111` (our `07`) shares its label with the "no value" default, so it most likely means "undetermined / not learned". A whole DSGi group of DIDs exists (D43B, D43C, D407, D412, D42F, D473, D439, D43A, D472, D474, D484, D465) — see section 4.
5. **F0FE (ZI zone) and F080 (ZA zone) layouts are documented** by two open GPL implementations and by the Diagbox-derived definitions, and they agree. Decoded for our ABS: supplier `0D` = Continental/VDO, ECU production date 09.02.2022, factory-flashed, software/calibration reference **9695041580**. **F080 reference 2 (`9820609380`) is a "complementary hardware reference", not a software version** — the current `software_version` write-back assumption is wrong.
6. **U1205-81 (engine ECU) = "Steering wheel angle sensor (CAN)"** with failure type `81` = invalid serial data received; **P17ED-94 = "Stalling of the internal combustion engine"** with failure type `94` = unexpected operation. Both are event/network codes rather than component faults, plausibly from the June-2026 low-battery episode or a clutch stall. No public source says they are permanently unclearable; the likeliest reason for the refusal is the clear being attempted with the engine running and/or in the default session (NRC not recorded — capture it).
7. **The ABS is a Continental/ATE ESP MK100 (46-pin), not Bosch**: `9846124980` cross-references to ATE `10.0220-2524.4` (hydraulic unit) / `10.0917-3951.3` (ECU), F080 supplier code `000D` and ZI supplier byte `0D` both decode to Continental/VDO. `9846124980` is listed for C4, Peugeot 208 II and Opel Mokka; `9820609380` is shared with Peugeot 2008 II units (`9835128780`).
8. **No openly licensed live-data DID table exists.** The only complete table is an unlicensed GitHub dump of Diagbox-derived definitions (`jyseojys/diag-server`); it must be treated as proprietary-derived evidence for on-car verification, not copied into the shared pack.
9. Not found: any documentation of `D619` ("DSG…" ASCII), `F08F` ("ES…" ASCII), and the steering-ECU references `9844551780` / `9834578780`.

## 2. Findings per question

### Q1. D40C brake pressure and wheel-speed order

**Source.** `jyseojys/diag-server`, files `ecu_groups_jsons/ESPMK100_UDS_{P2,P2JO,CP4,D34}_V*.json` (identical definitions across the four platform variants; `ABSMK100_UDS_P2` — the ABS-only variant — has D400–D406 but no D40C/D479/DSGi). Files contain Diagbox-style screen groups (`IDENTIFICATION`, `MESUREPARAMETRE1..10`, `VARCONTEXTE`) with French mnemonics, `req_frame_hex`, `start_byte`, `byte_length`, `factor`, `offset`, `unit`, `bit_mask`, `bit_shift`, and Korean labels (`@Pxxxxx-POLUXDATA` label indices). Repository has no README and no licence; last push 2026-08-25. Evidence class: **diagnostic-tool definition, proprietary-derived, community-published**. URL: https://github.com/jyseojys/diag-server/tree/main/ecu_groups_jsons

Byte convention: Diagbox `start_byte` is 1-based over the whole positive response, i.e. bytes 1–3 are `62 xx xx` and `start_byte 4` is payload byte 0. This was verified by comparing the F080/F0FE offsets against PyPSADiag's 0-based offsets (F080 refs at 0 and 7 ↔ Diagbox 4 and 11; F0FE calibration at 21 ↔ Diagbox 25).

| DID | Mnemonic | Bytes | Factor / offset / unit | Notes |
|---|---|---|---|---|
| D40C | `MP_PRESSION_DE_FREINAGE` | 1 | ×1, bar | `FF` = invalid. Group `MESUREPARAMETRE3` ("braking"), alongside D406 pedal switch, D408 fluid-level alert, D40A pump relay, D479 vacuum, D433/D434 rear disc temperatures |
| D400 | `MP_VITESSE_ROUE_ARRIERE_GAUCHE` (rear left) | 2 | ×0.01 km/h | `FFFF` = invalid |
| D401 | `MP_VITESSE_ROUE_ARRIERE_DROITE` (rear right) | 2 | ×0.01 km/h | |
| D402 | `MP_VITESSE_ROUE_AVANT_GAUCHE` (front left) | 2 | ×0.01 km/h | |
| D403 | `MP_VITESSE_ROUE_AVANT_DROIT` (front right) | 2 | ×0.01, unit field says "rpm" — a data-entry error in the source; the other three say km/h | |
| D404 | `MP_VITESSE_VEHICULE` | 2 | ×0.01 km/h | vehicle speed as computed by the ESP |

Cross-checks:
- Our drive log found D400/D402 closest to each other and D401/D403 closest to each other. With the table, D400/D402 = left side and D401/D403 = right side, and the first DID of each pair is the rear wheel. That is consistent with the table; the left/right assignment itself is not yet confirmed on the car (test in section 3).
- Our D40C magnitudes (≤14 bar normal, 28–33 bar firm pedal at standstill) are physically plausible for master-cylinder pressure in bar. The ESP MK100 DTC list for this family contains `C0044/C0046/C05C9 "Braking pressure sensor inside the hydraulic block"` (arduino-psa-diag `dtc/ESPMK100_UDS.md`), confirming the pressure sensor is in the hydraulic unit.
- Diagbox unit/scale for the PSA MK100 family was not found on any OEM page; the only other public evidence is that commercial tools expose "brake pressure" for ESPMK100 (ScanDoc page, not retrievable behind a browser check).

Confidence: **high** for the meaning and unit of D40C and for wheel order (single proprietary-derived source, but internally consistent with all local observations). Promote after the on-car checks in section 3.

### Q2. D479

**D479 = `MP_CAPTEUR_DEPRESSION_CIRCUIT_FREINAGE`** ("braking circuit vacuum sensor"; Korean label "brake line vacuum sensor"), 1 byte, factor 5, unit hPa, `FF` = invalid. Same source and group as D40C.

Interpretation: the PureTech 130 has a mechanical brake-vacuum pump and a vacuum sensor on the servo; the ESP reads that sensor (its DTC list includes `C0047 "Braking vacuum sensor"` and `C1570–C1572 "Brake servo pressure sensor"`). Our readings: 179 → 895 hPa at rest, 160–176 → 800–880 hPa while driving, no correlation with battery voltage, mean under braking ≈ cruising. Two readings are possible:

- **Depression (vacuum relative to ambient):** 895 hPa at rest with the engine idling would mean an almost perfect vacuum (ambient at Teruel ≈ 910 hPa), which is higher than a vane pump normally achieves; but values falling while rolling/braking (vacuum consumed) fits.
- **Absolute pressure in the servo:** 895 hPa would mean almost no vacuum with the engine running, which does not fit a healthy booster.

Neither is proven; a one-minute engine-off test settles it (section 3). Either way the signal is the brake-servo vacuum sensor, which explains why it never tracked pedal pressure or voltage.

Confidence: **high** for identity, **unknown** for sign/offset.

### Q3. D435–D438 = 07 07 07 07 (DSGi per-wheel state)

Same source, group `MESUREPARAMETRE7` (indirect under-inflation detection, "DSGi"):

| DID | Mnemonic | Shape | States seen in definition |
|---|---|---|---|
| D43B | `MP_PRESENCE_FONCTION_DSGI` | bit 0 | 0/1 |
| D43C | `MP_ETAT_GENERAL_DSG` | 3 bits (mask 7) | `000` → label 8038 (the "invalid/none" label used for `FF`/`FFFF` everywhere), `001`, `010`, `100`, `111` (= default label) |
| D435 | `MP_ETAT_ROUE_AVANT_GAUCHE` (front left) | 3 bits | `000` → 8038, `001` → 32245, `100` → 32246, `111` → 32247 (= the empty/default label), `010/011/101/110` → 8038 |
| D436 | `MP_ETAT_ROUE_AVANT_DROITE` (front right) | 3 bits | same |
| D437 | `MP_ETAT_ROUE_ARRIERE_GAUCHE` (rear left) | 3 bits | same |
| D438 | `MP_ETAT_ROUE_ARRIERE_DROITE` (rear right) | 3 bits | same |
| D465 | `MP_DETERMINATION_INCOMPATIBILITE_PNEU_{DSGI,ARG,ARD,AVD,AVG}` | bits 4,3,2,1,0 | tyre-incompatibility flags per wheel |
| D407 | `MP_POURCENTAGE_NIVEAU_DETECTION_DSG` (+ `_2` in high nibble) | low nibble ×10 % | detection level |
| D412 | `MP_DISTANCE_DEPUIS_DERNIERE_RAZ_DSG` | 12 bits, factor 10, km | distance since last reset |
| D42F | `MP_DISTANCE_DEPUIS_DERNIERE_ALERTE_DSG` | 12 bits, factor 10, km | |
| D473 | `MP_DISTANCE_PARCOURUE_PENDANT_DERNIERE_ALERTE_DSG` | 12 bits, factor 10, km | |
| D439 | `MP_TYPE_DERNIERE_ALERTE_DSG` | 3 bits | last alert type |
| D43A | `MP_PROBABILITE_SOUS_GONFLAGE` | low nibble ×10 % | under-inflation probability |
| D472 | `MP_CHARGE_VEHICULE_FONCTION_DSG` | 3 bits | vehicle load estimated by DSG; `111` → 8038 (invalid) |
| D474 | `MP_VITESSE_VEHICULE_ESTIMEE_DSG` | byte 9 | |
| D484 | `MP_UTILISATION_BOUTON_RAZ_FONCTION_DSG` | 1 byte, `00`/`01` | reset button used |

What the state values mean: the definition maps each state to a label index (e.g. 32245/32246/32247) whose text is not in the dump, so the exact wording (e.g. "learning / OK / under-inflated / undetermined") is **not found**. Two structural hints: `111` maps to the same label as "no value", and in the load DID `111` is explicitly the invalid label. So `07 07 07 07` most likely reads as "undetermined / not (yet) learned" rather than "OK". Our car showed `07` in every parked read; a read during a drive after a fresh reinitialisation is the test.

How the system works (OEM, C4 handbook ed01-22, p.108 "Tyre under-inflation detection"): the system "compares the information given by the wheel speed sensors with reference values, which must be reinitialised every time the tyre pressures are adjusted or a wheel changed"; "the alert is raised when the vehicle is moving, not when stationary"; "analysis of the values read by the wheel's speed sensors can take several minutes"; "the alert may be delayed at speeds below 40 km/h or when adopting a sporty driving mode"; reinitialisation is done stationary via the touch screen (MyCitroën Drive: Vehicle menu; Drive Plus: Settings > Vehicle > Safety > Tire Pressure Setup > YES), "confirmed by the display of a message and an audible signal". The system does not detect a wrong pressure at the time of reinitialisation. Malfunction is signalled by the warning lamps and "the tyre under-inflation monitoring function is no longer performed".

Does a documented DID exist for it: yes in the proprietary-derived definitions (above), nothing in OEM/open sources. Related DTCs in the family: `C164A Indirect tyre under-inflation detection`, `C164B Compatibility of the tyres` (arduino-psa-diag). Community forums (forum-peugeot, lesamisdudiag, psa-diag) only discuss enabling/resetting the function via Diagbox/BSI and the CAN speed fault `U1213`; no per-wheel state values are described.

Confidence: **high** that D435–D438 are the per-wheel DSGi states; **not found** for the exact enumeration text.

### Q4. F0FE and the PSA identity DIDs

Three independent sources agree on the layout:

- `Barracuda09/PyPSADiag` `data/IdentUDSECU.json` (GPL-2.0) — 0-based payload offsets.
- `jyseojys/diag-server` `IDENTIFICATION` group (proprietary-derived) — 1-based response offsets.
- `dragouf/PSA-Arduino-NAC-RCC` `protocol.md` and `ludwig-v/arduino-psa-diag` `UDS_FLASH.md` (GPL-3.0) name F080 "ZA zone" and F0FE "ZI zone" (last 6 hex chars = current calibration) and describe writing ZI after a flash.

**F080 (ZA zone), payload offsets:**

| Payload bytes | Field (Diagbox mnemonic) | Our ABS |
|---|---|---|
| 0–4 | `ID_REFERENCE_MATERIEL` — hardware reference, packed BCD | `9846124980` |
| 5–6 | `ID_NOM_DU_FOURNISSEUR` — supplier code (`0003` Bosch, `000D` Continental/VDO, `0013` Delphi, `001A` DAV, …) | expected `000D` — **confirm from the raw F080 bytes** |
| 7–11 | `ID_REFERENCE_COMPLEMENTAIRE_MATERIEL` — complementary hardware reference, BCD | `9820609380` |
| 12–13 | `ID_VERSION_DU_LOGICIEL` — software version | — |
| 19–21 | PyPSADiag "Type" | — |

Consequence: reference 2 is a second hardware reference, **not** a software version. The app currently writes reference 2 into `software_version`; the software reference actually lives in F0FE bytes 21–23.

**F0FE (ZI zone), payload offsets** (24 bytes):

| Payload bytes | Field | Our ABS `FF FF 00 00 0D 56 09 02 16 30 15 11 01 FF FF FF 00 02 00 00 01 95 04 15` |
|---|---|---|
| 0–3 | unknown (always `FFFF0000` in samples) | `FF FF 00 00` |
| 4 | Supplier (PyPSADiag `ECU_SUPPLIERS.json`) | `0D` = Continental / VDO |
| 5 | System code | `56` (same in the PyPSADiag ESPMK100 sample; meaning not decoded) |
| 6–8 | Production date, DD MM YY as hex-as-decimal | `09 02 16` → 09.02.2022 (car registered 04/2022 — consistent) |
| 9 | unknown | `30` (also `30` in the other sample) |
| 10 | Calibration version | `15` |
| 11–12 | `ID_TRACABILITE_INDICE_EVOLUTION_EDITION` — calibration edition | `11 01` |
| 13–15 | `ID_DATE_TELECH` — download (re-flash) date | `FF FF FF` = never re-flashed |
| 16 | Tele-transmission tool type | `00` |
| 17–19 | Tool ID (`020000` = factory) | `02 00 00` = factory |
| 20 | `ID_NOMBRE_DE_TELECHARGEMENT` — download counter | `01` |
| 21–23 | `ID_REFERENCE_LOGICIEL` — software/calibration reference; PyPSADiag renders it as `"96" + hex + "80"` | `95 04 15` → **9695041580** |

The PyPSADiag sample for the same family (`csv/espmk100-uds.csv`, uploaded 2025-01-13, a Peugeot 2008 II unit): F080 = `9835128780 / 000D / 9820609380 / 8000…`, F0FE = `FFFF0000 0D 56 180913 30 05 0901 FFFFFF 00 020000 01 938998` → software 9693899880. The elektroda C41 (2021, automatic) capture lists the ESPMK100_UDS "program number" as `9694534480` — the same `96…80` form. So our ABS software is 9695041580; the two other known calibrations for the family are 9693899880 (2008 II) and 9694534480 (C41 2021 auto).

Other identity DIDs: `F18C` = serial number (ASCII), `F18B` = production date, `2901` = secure traceability value, `2100/2101` = telecoding list/values. **`F08A`, `F08E`, `F08F` are not documented in any source found** (PyPSADiag, Diagbox-derived files and the two Arduino projects do not define them); our `F08F` = "ES…" ASCII and `D619` = "DSG…" ASCII stay unlabeled.

Confidence: **high** for the F080/F0FE layouts (three concordant sources, GPL + proprietary-derived, and our bytes decode to a sensible 2022 date and 96…80 reference).

### Q5. Engine ECU DTCs U1205-81 and P17ED-94

Meanings (PSA engine-ECU DTC tables):
- **U1205** = "Steering wheel angle sensor (CAN)" — PyPSADiag `data/dtc/INJ.json` (GPL-2.0); arduino-psa-diag `dtc/MEVD17_4_4.md` / `dtc/VD46.md` "Communication with the steering wheel angle sensor", `dtc/CMM_VD56.md` "Steering wheel angle sensor (CAN)" (GPL-3.0). Community pages describe it on the ESP side as "absence d'information ou information invalide du capteur d'angle volant" with causes: COM2000/angle sensor, geometry, **weak battery** (automoto-meca.fr, planete-citroen thread "U1205-81 P2074-62").
- **P17ED** = "Stalling of the internal combustion engine" (PyPSADiag INJ.json), "Engine stalling" (arduino-psa-diag CMM_VD56.md). A JustAnswer thread on a Corsa F 1.2 turbo (same EB2 engine) reports Diagbox text "Stalling thermal motor — Unexpected behaviour" for `P17ED 94`, intermittent.
- Failure-type suffixes follow the ISO 14229-1 / SAE J2012-DA failure-type-byte table: **`81` = invalid serial data received**, **`94` = unexpected operation**. (Standard tables; not re-fetched — the public pages found only list the common subset. Treat as standard knowledge, verify against J2012-DA if it matters.)

Reading: U1205-81 says the engine ECU received invalid steering-angle data on the CAN bus; P17ED-94 says the engine stopped when it was not expected to (a stall). On a manual PureTech both are typical after a low-voltage episode (our June-2026 battery failure: hard starts, ADAS faults) or after a clutch stall; neither indicates a failed part by itself.

Are they "config/history" codes that never clear? **Not found** in any source. What is documented: `14 FFFFFF` is what arduino-psa-diag and PSA tools send, normally after `10 03` (its README sequence). Generic UDS practice (and Bosch engine ECUs) commonly answer NRC `22 conditionsNotCorrect` to a clear request while the engine is running. We did not record the NRC. Recommendation in section 3: repeat with engine off / ignition on, extended session, and read the DTC status byte and the snapshot (`19 04 <DTC> FF`) first — the PSA snapshot (`VARCONTEXTE`) carries mileage, time reference and engine state, which would date both events.

Confidence: **high** for the meanings; **unknown** for the clear behaviour.

### Q6. Openly documented PSA ABS/ESP live-data DID tables

| Source | What it holds | Licence | Verdict |
|---|---|---|---|
| `jyseojys/diag-server` (GitHub, 7 000+ JSON files incl. `ESPMK100_UDS_*`, `ABSMK100_UDS_P2`, `DSG_UDS_*`) | Complete Diagbox-style parameter definitions: DID, byte position, factor/offset/unit, bit masks, state codes → label indices; Korean labels; no label text for states | **No licence; clearly derived from proprietary Stellantis/Diagbox data** | Use as hypothesis source for on-car verification only. Do not copy tables into `uds-map`. |
| `Barracuda09/PyPSADiag` | Zone (configuration/identity) definitions per ECU incl. `ESPMK100_UDS.json`; identity DID layouts; supplier table; DTC name tables; one real ESPMK100 zone dump | GPL-2.0 | Identity/zone layouts and DTC names usable with attribution; contains **no live-data DIDs** |
| `ludwig-v/arduino-psa-diag` | ECU address list (`6AD:68D` ESP/ABS, `6AF:68F` DSG/TPMS, `6A8:688` engine), DTC name tables per family (`dtc/ESPMK100_UDS.md`), zone docs, flash procedure (ZA/ZI zones) | GPL-3.0 | Addresses and DTC names; **no live-data DIDs** |
| `dragouf/PSA-Arduino-NAC-RCC` `protocol.md` | F080 = ZA, F0FE = ZI (calibration in last 6 hex chars), F18C serial, F190 VIN | (repo licence not checked) | Identity only |
| `prototux/PSA-RE` | CAN bus frames for AEE2004/2010, KWP/UDS notes; inactive | Apache-2.0 | Older architectures; nothing for MK100 UDS DIDs |
| OBDb (`OBDb/Citroen-C3`, `OBDb/Peugeot-e-208`, `OBDb/Citroen-eC4-X`) | Signalsets per model; search returned no `6AD` ABS signals | (OBDb repos are typically MIT/CC — check per repo) | **Not found** for PSA ABS D4xx |
| ScanDoc ESPMK100 page, Autel/DataDiag coverage lists | Prove that tools expose wheel speeds, pressure, yaw, etc. | Proprietary | Capability evidence only (page blocked by browser check) |
| Car Scanner / Torque PSA PID packs, OVMS | No ABS D4xx PIDs surfaced in searches | — | **Not found** |
| Forums (forum-peugeot, lesamisdudiag, psa-diag, planete-citroen, elektroda) | DSG resets, U1213/U1205 discussions, C41 park-assist telecoding capture with ESPMK100_UDS program number | community | No DID decodes |

Selected decodes from the proprietary-derived table that matter to us (all `start_byte 4` = payload byte 0 unless noted; all unverified on this car unless marked):

| DID | Mnemonic | Scale/unit | Local status |
|---|---|---|---|
| D405 | `MP_TENSION_ALIMENTATION_CALCULATEUR` | ×0.1 V | wobbled ±1 in our parked reads — consistent with supply voltage |
| D40B | `MP_VITESSE_ANGLE_LACET_2` (yaw rate) | ×1 −127 °/s | |
| D40E | `MP_ACCELERATION_TRANSVERSALE` | ×0.1 −12.7 m/s² | our `7E/7D` flicker = −0.1/−0.2 m/s² at rest — consistent |
| D40F | `MP_REGIME_MOTEUR` | ×32 rpm | |
| D410 | `MP_COUPLE_DEMANDE_CONDUCTEUR_AVANT_TRAITEMENT` | ×2 −100 Nm | wobbled ±1 in our reads |
| D411 | `MP_RAPPORT_BOITE_DE_VITESSES_ENGAGE` | low nibble | |
| D415 | `MP_ACCELERATION_LONGITUDINALE_SANS_CORRECTION` | ×0.08 −14 m/s² | |
| D416 | `MP_ETAT_FONCTION_ESP` | bit 0 | |
| D418 | `MP_VOLONTE_CONDUCTEUR` (driver demand) | % | |
| D41B–D41E, D420 | steering-angle sensor status/calibration flags | bit 0 | |
| D41F | `MP_ANGLE_VOLANT` | 2 bytes ×0.1 −1250 ° | our "counts down" note: re-test with a real turn; the value is offset-encoded |
| D425 | `MP_VITESSE_VOLANT_DE_DIRECTION` | ×4 °/s | matches our sporadic movement |
| D426 | `MP_ETAT_FREIN_STATIONNEMENT_A_COMMANDE_ELECTRIQUE` (EPB state) | 3 bits | |
| D427 | `MP_ETAT_ASSISTANCE_DECOLLAGE_COTE` (hill start) | 2 bits | |
| D428 | `MP_ETAT_BOUTON_FREIN_SECONDAIRE_ELECTRIQUE` (EPB switch) | 3 bits | |
| D42E | `MP_POSITION_PEDALE_D_EMBRAYAGE` (clutch pedal) | ×0.5 % | our "event-like counter" is the clutch pedal |
| D433 / D434 | rear-left / rear-right brake disc temperature (model) | 2 bytes °C | |
| D444 | `MP_ETAT_DU_FREINAGE` | 2 bits | changed in our brake-held capture |
| D45A | `MP_ACCELERATION_LONGITUDINALE` | 12 bits ×0.02 −40.96 g | |
| D45B | `MP_TEMPERATURE_AIR_EXTERIEUR` | ×0.5 −40 °C | |
| D459 | `MP_POURCENTAGE_ENFONCEMENT_PEDALE_ACCELERATEUR` | ×0.5 % | |
| D462 | `MP_APPUI_PEDALE_FREIN_RECALCULE` | 2 bits | changed in our brake-held capture |
| D463 | `MP_ETAT_FONCTION_FREINAGE_AUTO_RISQUE_COLLISION` (AEB state) | 3 bits | |
| D464 | `MP_ETAT_DECEL_FARC` (AEB requested-deceleration state) | 2 bits | our "reverse inverse" flag: AEB state changes when reverse is selected — plausible, not a reverse flag per se |
| D46C / D46D | `MP_SENS_ROULAGE_ARD` / `_ARG` — rolling direction of rear-right / rear-left wheel | bit 0 | our `D46D = 1` in reverse = rear-left wheel rolling backwards. Help text: only active with semi-automatic parking |
| D46E / D46F | direction-determination status of rear-right / rear-left wheel-speed sensor | bit 0 | |
| D612 | `MP_ETAT_SERRAGE_AUTOMATIQUE_FSE` (EPB auto-apply) | 1 byte | |
| D618 | `MP_ETAT_FONCTION_ASR_PLUS` | 3 bits | |

### Q7. Part references

| Reference | Found as | Family / reuse | Source class |
|---|---|---|---|
| `9846124980` | "bomba ABS Citroën C4 9846124980 10022025244 10091739513" (stylautorecambios.es); "ABS Peugeot 208 P2 Allure 9846124980" (desguacesmelli.com, page 403 on fetch); Opel Mokka ABS listings (autoparts24.eu) | ATE/Continental `10.0220-2524.4` hydraulic unit + `10.0917-3951.3` ECU → **Continental ATE ESP MK100**, 46-pin; used on C4 III, 208 II (P2), Mokka B — i.e. shared across CMP and EMP2 small platforms | parts catalog |
| `9820609380` | Only in PyPSADiag's ESPMK100 zone dump as complementary reference of `9835128780` (Peugeot 2008 II ABS, xdalys.lt) | family-level complementary hardware reference shared by several MK100 part numbers | open implementation + parts catalog |
| `9835128780` | Peugeot 2008 II brake-pump controller (xdalys.lt) | same family, different hardware ref | parts catalog |
| `9844551780` / `9834578780` (DAE) | **Not found** | — | — |
| `9842725080` (CVM3) | reparlab.com CVM G3 repair list for DS/DS7 Crossback (and forum-peugeot Diagbox report already cited in the playbook) | CVM G3 (camera) family across PSA | repair service / community |
| `9817137180` (CVM3) | **Not found** | — | — |
| ATE MK100 repair pages (ap-reman, essexrecons, controlunits) | Peugeot 208 / Corsa F ATE MK100 ESP 46-pin with `10.0917-39xx.3` ECU numbers | confirms the ATE ECU numbering family | vendor |

Peugeot 308 III / DS4 / Astra L reuse: no listing of `9846124980` against those models was found; the diag-server variant names (`P2`, `P2JO`, `CP4`, `D34`) show the same definition set serves several platforms, but the C41 variant name is not among them (the four are identical for our DIDs anyway).

## 3. Recommended on-car tests (all read-only, service 22 unless stated)

1. **Wheel sides.** Roll slowly and make a tight left turn: outer (right) wheels D401/D403 must read higher than D400/D402. Confirms left = D400/D402, and rear = D400/D401 from the front/rear speed difference in a turn (fronts trace a larger radius).
2. **D40C unit.** Hold a firm stationary pedal and compare with D444/D462 changes; a value in the 30–40 range is consistent with bar. Optional: log D40C against deceleration from D415/D45A during a repeatable stop — brake pressure vs deceleration should be roughly linear.
3. **D479 sign.** Ignition on, engine off: pump the pedal until hard. If D479 falls towards 0 the DID is depression (vacuum); if it rises towards ≈182 (910 hPa ambient at Teruel) it is absolute pressure. Then start the engine and watch it move the other way within seconds. Record ambient altitude.
4. **DSGi states.** Read D43B, D43C, D435–D438, D407, D412, D42F, D43A, D472, D484 (a) before, (b) immediately after the touchscreen reinitialisation (stationary), (c) during and after a 10–20 minute drive above 40 km/h. Expect D484 to flip, D412 to reset, and D435–D438 to leave `07` once learning completes. This yields the enumeration without any label text.
5. **F080 supplier bytes.** Re-read the ABS F080 and confirm payload bytes 5–6 = `00 0D`; then change the write-back so reference 2 goes to a `hardware_reference_2` field and F0FE bytes 21–23 (`96xxxxxx80`) go to `software_version`.
6. **Engine DTCs.** With engine off, ignition on: `19 02 09` (status), `19 04 <DTC> FF` snapshots — U1205-81 encodes as `19 04 D2 05 81 FF`, P17ED-94 as `19 04 17 ED 94 FF` — to get mileage/time/engine-state context, then `10 03` → `14 FF FF FF` and record the exact NRC. This is the first write-class action; keep it out of the automated plan and do it manually.
7. **D41F steering angle.** Turn lock to lock while polling; expect ≈ (raw×0.1 − 1250) to sweep roughly −500…+500°.
8. **D42E clutch and D411 gear.** Press the clutch and select gears at standstill to confirm the two decodes cheaply.

## 4. DID table

| DID | Claimed meaning | Unit / scale | Source class | URL | Licence |
|---|---|---|---|---|---|
| D400 | Rear-left wheel speed | ×0.01 km/h, 2 B | diag-tool definition (proprietary-derived) | https://github.com/jyseojys/diag-server/blob/main/ecu_groups_jsons/ESPMK100_UDS_P2_V66.json | none |
| D401 | Rear-right wheel speed | ×0.01 km/h | same | same | none |
| D402 | Front-left wheel speed | ×0.01 km/h | same | same | none |
| D403 | Front-right wheel speed | ×0.01 (unit typo "rpm") | same | same | none |
| D404 | Vehicle speed (ESP) | ×0.01 km/h | same | same | none |
| D405 | ECU supply voltage | ×0.1 V | same | same | none |
| D406 | Brake pedal switch | bit 0 | same (+ locally confirmed) | same | none |
| D407 | DSG detection level (low nibble; `_2` high nibble) | ×10 % | same | same | none |
| D408 | Brake-fluid minimum-level alert | bit 0 | same | same | none |
| D40A | Recirculation pump relay state | bit 0 | same | same | none |
| D40B | Yaw rate 2 | ×1 −127 °/s | same | same | none |
| D40C | Braking pressure (master cylinder) | ×1 bar, `FF` invalid | same | same | none |
| D40E | Lateral acceleration | ×0.1 −12.7 m/s² | same | same | none |
| D40F | Engine speed | ×32 rpm | same | same | none |
| D410 | Driver torque demand before processing | ×2 −100 Nm | same | same | none |
| D411 | Gear engaged | low nibble | same | same | none |
| D412 | Distance since last DSG reset | 12 bit, ×10 km | same | same | none |
| D413 | ABS/ESP inhibit switch | bit 0 | same | same | none |
| D415 | Longitudinal accel. (uncorrected) | ×0.08 −14 m/s² | same | same | none |
| D416 | ESP function state | bit 0 | same | same | none |
| D418 | Driver demand | % | same | same | none |
| D41B–D41E, D420 | Steering-angle sensor state / calibration / adjustment / checks | bit 0 | same | same | none |
| D41F | Steering wheel angle | 2 B ×0.1 −1250 ° | same | same | none |
| D421 | Cruise-control inhibit request | bit 0 | same | same | none |
| D425 | Steering wheel speed | ×4 °/s | same | same | none |
| D426 | Electric parking brake state | 3 bit | same | same | none |
| D427 | Hill-start assist state | 2 bit | same | same | none |
| D428 | EPB switch state | 3 bit | same | same | none |
| D42E | Clutch pedal position | ×0.5 % | same | same | none |
| D42F | Distance since last DSG alert | 12 bit ×10 km | same | same | none |
| D433 / D434 | Rear-left / rear-right brake disc temperature | 2 B °C | same | same | none |
| D435–D438 | DSGi wheel state FL / FR / RL / RR | 3 bit enum (labels unknown) | same | same | none |
| D439 | Type of last DSG alert | 3 bit | same | same | none |
| D43A | Under-inflation probability | ×10 % | same | same | none |
| D43B | DSGi function present | bit 0 | same | same | none |
| D43C | DSG general state | 3 bit | same | same | none |
| D444 | Braking state | 2 bit | same | same | none |
| D459 | Accelerator pedal | ×0.5 % | same | same | none |
| D45A | Longitudinal acceleration | 12 bit ×0.02 −40.96 g | same | same | none |
| D45B | Outside air temperature | ×0.5 −40 °C | same | same | none |
| D462 | Recalculated brake-pedal press | 2 bit | same | same | none |
| D463 | AEB (FARC) function state | 3 bit | same | same | none |
| D464 | AEB requested-deceleration state | 2 bit | same | same | none |
| D465 | Tyre-incompatibility flags (DSGi, RL, RR, FR, FL) | bits 4..0 | same | same | none |
| D46C / D46D | Rolling direction rear-right / rear-left wheel | bit 0 | same (+ local: D46D=1 in reverse) | same | none |
| D46E / D46F | Direction-determination status RR / RL sensor | bit 0 | same | same | none |
| D472 | Vehicle load estimated by DSG | 3 bit | same | same | none |
| D473 | Distance driven during last DSG alert | 12 bit ×10 km | same | same | none |
| D474 | DSG estimated vehicle speed | byte 9 | same | same | none |
| D479 | Brake-circuit vacuum sensor | ×5 hPa, `FF` invalid | same | same | none |
| D484 | DSG reset button used | `00`/`01` | same | same | none |
| D612 | EPB automatic apply state | 1 B | same | same | none |
| D618 | ASR+ function state | 3 bit | same | same | none |
| D619 | (our "DSG…" ASCII) | — | **not found** | — | — |
| F080 | ZA zone: hw ref [0–4], supplier [5–6], complementary hw ref [7–11], sw version [12–13] | BCD | open impl. (GPL-2.0) + diag-tool def. | https://github.com/Barracuda09/PyPSADiag/blob/master/data/IdentUDSECU.json | GPL-2.0 / none |
| F0FE | ZI zone: supplier [4], system [5], prod. date [6–8], cal. version [10], edition [11–12], download date [13–15], tool [16–19], download count [20], software ref [21–23] as 96xxxxxx80 | mixed | same + arduino-psa-diag UDS_FLASH.md | https://github.com/ludwig-v/arduino-psa-diag/blob/master/UDS_FLASH.md | GPL-2.0 / GPL-3.0 / none |
| F18B | Production date | DD MM YY | PyPSADiag | same | GPL-2.0 |
| F18C | Serial number | ASCII | PyPSADiag + diag-tool def. | same | GPL-2.0 |
| F08A / F08E / F08F | — | — | **not found** | — | — |
| 2100 / 2101 | Telecoding list / values (incl. `CFG_000_FREIN_UDS_UCPR_DSG` bits) | bitfields | PyPSADiag zones + diag-tool def. | https://github.com/Barracuda09/PyPSADiag/blob/master/json/ABRASR/ESPMK100_UDS.json | GPL-2.0 |

## 5. Sources

Open implementations
- ludwig-v/arduino-psa-diag (GPL-3.0): README (UDS sequence incl. `1003`, `14FFFFFF`), `ECU_LIST.md` (`6AD:68D` ESP family incl. ESPMK100; `6AF:68F` DSG/TPMS; `6A8:688` engine), `UDS_FLASH.md` (ZI = F0FE), `dtc/ESPMK100_UDS.md` (C0044/C0046/C05C9 pressure sensor, C0047 vacuum sensor, C1570–C1572 servo pressure sensor, C164A/C164B DSGi, U1205), `dtc/CMM_VD56.md`, `dtc/MEVD17_4_4.md`, `dtc/VD46.md`. https://github.com/ludwig-v/arduino-psa-diag — fetched 2026-08-27.
- Barracuda09/PyPSADiag (GPL-2.0): `data/IdentUDSECU.json`, `data/ECU_SUPPLIERS.json` (`0D` = Continental/VDO, `03` = Bosch), `EcuZoneLineEdit.py` (date and `zi_cal` "96…80" rendering), `csv/espmk100-uds.csv` (real ESPMK100 dump, uploaded 2025-01-13), `data/dtc/INJ.json` (U1205, P17ED). https://github.com/Barracuda09/PyPSADiag — fetched 2026-08-27.
- jyseojys/diag-server (no licence, proprietary-derived): `ecu_groups_jsons/ESPMK100_UDS_{P2,P2JO,CP4,D34}_V*.json`, `ABSMK100_UDS_P2_V1.json`, `DSG_UDS_*.json`, `sw_mapping.json`, `version.txt` (20260826_v5). https://github.com/jyseojys/diag-server — fetched 2026-08-27.
- dragouf/PSA-Arduino-NAC-RCC `protocol.md` (F080 ZA, F0FE ZI, F18C, F190). https://github.com/dragouf/PSA-Arduino-NAC-RCC/blob/master/protocol.md
- prototux/PSA-RE (Apache-2.0, inactive). https://github.com/prototux/PSA-RE

OEM
- Citroën C4 handbook ed01-22 en-GB, p.108–109 "Tyre under-inflation detection" (fetched PDF, text-extracted). https://service.citroen.com/ACddb/modeles/c4.c41/eGuide_c41_ed01-22_dag/pdfs/9999_9999_450_en-GB.pdf
- ISO 14229-1 / SAE J2012-DA failure-type-byte table (0x81 invalid serial data received; 0x94 unexpected operation) — standard, not re-fetched; public summary of the FTB concept: https://autodtcs.com/what-is-a-failure-type-byte-ftb/

Parts / suppliers
- https://www.stylautorecambios.es/producto/bomba-abs-citroen-c4-9846124980-10022025244-10091739513/
- https://desguacesmelli.com/abs-peugeot-208-p2-allure-9150883/ (title only; page returned 403)
- https://www.autoparts24.eu/opel-mokka/abs-pumpe/1/
- https://www.xdalys.lt/en/catalog/peugeot-2008/car-parts/abs-and-esp-systems/1/ (9835128780)
- ATE MK100 repair pages: https://ap-reman.com/product/peugeot-208-ate-mk100-abs-pump-repair-service/ , https://www.essexrecons.com/shop/abs-units/ate-mk100/peugeot-abs-pump-ecu-module-combined-ate-mk100-esp-46-pins-repair-service/ , https://controlunits.com/vauxhall-corsa-f-abs-pump-repair-ate-mk100/
- https://reparlab.com/en/all-kind-of-repairs/cvm-g3-22/ (9842725080 in CVM G3 list)

Community
- https://www.elektroda.com/rtvforum/topic3965033.html — C41 2021 capture: ESPMK100_UDS `6AD:68D` program 9694534480, DAE_UDS2 `6B5:695` cal 9694679680, AAS_UDS_G6 cal 9694705980 (address quoted there as 6D5:65D, the playbook has 75D/65D — recheck).
- https://www.planete-citroen.com/topic/145651-code-default-u1205-81-p2074-62/ (403 on fetch; title only)
- https://automoto-meca.fr/code-defaut-u1205-citroen-peugeot-signification-solution/
- https://www.justanswer.co.uk/car/oy32g-it-s-coming-stalling-thermal-motor-doesn-t-stall.html (Corsa F 1.2, "P17ED 94 stalling thermal motor — unexpected behaviour")
- https://www.forum-peugeot.com/Forum/threads/p17ed.130038/ (403 on fetch)
- https://www.lesamisdudiag.com/forum/les-logiciels-et-interfaces-auto/peugeot-citro%C3%ABn/diagbox/17745-dsg-d%C3%A9tection-de-sous-gonflage-u1213 (older direct-DSG Diagbox screen; not this generation)
- https://seventrumpet.com/reset-citroen-c4-tyre-pressure-warning-light/ (reset steps, consistent with the handbook)

Searches that returned nothing useful (recorded to avoid repetition): `"9820609380"`, `"9844551780" OR "9834578780"`, `"9817137180"`, `"22D40C"` outside diag-server, `"F0FE" psa` code search, OBDb `6AD`, Car Scanner / Torque PSA ABS PIDs, Diagbox "pression maître-cylindre" MK100 values, ScanDoc ESPMK100 page (browser check), Autel coverage PDF (image-only).
