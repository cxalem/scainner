# uds-map.json — provenance, confidence and caveats

Companion to `uds-map.json`. Written 2026-08-23. Covers where each brand's data came
from, how much to trust it, what is missing, and how to extend it.

---

## 1. What is in scope

The map holds **manufacturer-specific UDS data**: per-module CAN request/response
address pairs, and 16-bit Data Identifiers read with service `0x22`
(ReadDataByIdentifier). Three things are deliberately *not* the target:

- **Standardised identification DIDs** (`F180`–`F1FF`) are the same on every
  ISO 14229 ECU. They are listed once here rather than repeated per brand, though
  the band appears in each brand's `did_bands` so the sweeper always probes it.
- **OBD-II mode-01 PIDs** are already handled elsewhere in Scainner. Watch out for
  the overlap described in §3 though — some of what looks manufacturer-specific is
  a standard PID wearing a DID costume.
- **Anything behind SecurityAccess (`0x27`)**. Scainner never performs security
  access. See §6.

### The standard identification block (universal, all brands)

| DID | Meaning |
|---|---|
| `F180` | Boot software identification |
| `F186` | Active diagnostic session |
| `F187` | Vehicle manufacturer spare part number |
| `F188` | Manufacturer ECU software number |
| `F18A` | System supplier identifier |
| `F18B` | ECU manufacturing date |
| `F18C` | ECU serial number |
| `F190` | **VIN** |
| `F191` | Manufacturer ECU hardware number |
| `F194` / `F195` | Supplier software number / version |
| `F197` | System name or engine type |
| `F19E` | ODX file |

`F190` is the single best brand-agnostic first probe for any newly discovered ECU —
confirmed present on PSA, Renault, VAG, BMW and Mercedes independently. Source:
[opendbc `uds.py` `DATA_IDENTIFIER_TYPE`](https://github.com/commaai/opendbc/blob/master/opendbc/car/uds.py),
which mirrors the ISO 14229-1 table.

---

## 2. Decode convention (important — read before implementing)

`offset` is a byte index into the response payload **after the echoed identifier**:

- service `0x22` → skip 3 bytes (`62 HH LL`), then `offset` counts from 0
- service `0x21` → skip 2 bytes (`61 GG`)
- service `0x1A` → skip 2 bytes (`5A GG`)

`value = big_endian(raw[offset .. offset+len]) * scale + bias`

This matches the convention already used by Scainner's own `uds_probes` table (the
`D422` probe is stored as offset 0, len 2, scale 0.01 against raw bytes `05 87`).

Two independent sources were cross-checked to pin this down, and they agree exactly
for Hyundai's `22 01 01`: EVNotiPi's field list (`padding: 7` before `SOC_BMS`, where
the padding covers the 3-byte header → after-header offset 4) and OVMS's
`IncomingBMC_Full()` (offset 4). Renault/CanZE independently confirms it — its
`startBit: 24` for DID `2002` is bit 24 = byte 3 = the first byte after `62 20 02`.

**Since v9 (2026-08-28) every known DID carries `decodes[]`** — offset, length,
`signed`, `encoding` (`be`/`le`/`bcd`/`ascii`/`bitfield`), scale, bias, unit
and a machine-readable `quantity` — so multi-value payloads, two's-complement
values and bit fields are data rather than label text. The legacy
`offset/len/scale/bias` fields mirror `decodes[0]`. Offset-binary values are
kept unsigned with a negative bias, exactly as their sources express them.
See `docs/uds/pack-schema-v9.md`; every fact moved out of this file's prose
is listed in `docs/uds/migration-v9.md`.

---

## 3. Cross-brand structural findings (the genuinely useful part)

These matter more to the discovery engine than any individual DID.

### 3.1 Response-address offset rules

A sweeper that knows the offset rule can derive the response address instead of
probing for it:

| Brand | Rule | Verified on |
|---|---|---|
| PSA, `6xx` block | `resp = req − 0x20` | 6A8/688, 6AD/68D, 6B5/695, 6A9/689, 6AF/68F, 6B4/694 |
| PSA, `7xx` block | `resp = req − 0x100` | 752/652, 744/644, 75F/65F, 764/664, 765/665 |
| VW Group, proprietary modules | `resp = req + 0x6A` | 710/77A, 713/77D, 714/77E, 711/77B, 773/7DD, 715/77F |
| VW Group, generic OBD modules | `resp = req + 0x08` | 7E0/7E8, 7E1/7E9, 7E5/7ED, 7E6/7EE |
| Renault, most modules | `resp = req + 0x20` | 743/763, 742/762, 740/760, 745/765, 79B/7BB |
| Hyundai/Kia | `resp = req + 0x08` (uniform) | 7E4/7EC, 7A0/7A8, 7C6/7CE, 7D6/7DE, 794/79C, 770/778 |
| Toyota | `resp = req + 0x08` | 7E0/7E8, 7D2/7DA, 747/74F, 716/724 |
| GM | `resp = req + 0x400` | `GM_RX_OFFSET` in opendbc; 241/641, 24B/64B |
| FCA | `resp = req − 0x280` | `CHRYSLER_RX_OFFSET` in opendbc |
| Ford | `resp = req + 0x08` | 7E0/7E8, 726/72E, 7D0/7D8 |

**PSA is two rules, not one.** This reconciles the project's own anchors: `6B4/694`
follows the `−0x20` rule while `752/652` and `765/665` follow `−0x100`. A sweeper
should pick the rule from the address block, not apply one offset globally.

Renault's `+0x20` is a majority pattern, not a law — EVC (`7E4/7EC`, +8), DCM
(`7CA/7DA`, +0x10) and BCB (`792/793`, +1) all break it. Do not derive blindly there.

### 3.2 The `F4xx` OBD-PID mirror band

`DID 0xF4nn` returns **mode-01 PID `nn`** on many UDS ECUs (ISO 15031-5 / SAE
J1979-2). Confirmed on VAG (`F405` coolant, `F40C` RPM, `F40D` speed, `F40F` intake
air, `F41F` runtime, `F446` ambient, `F45B` hybrid pack life) and used by Ford in
exactly the same way (`F405`, `F40F`, `F42F`, `F49D`).

Practical consequence: **the `F4xx` band is largely redundant with Scainner's
existing mode-01 support.** Deprioritise it in sweeps — it burns 256 reads to
rediscover data you already have. Its real value is that it works on modules that
do not answer mode-01 at all (a body ECU can expose coolant temp via `F405`).

### 3.3 Not every brand's data is behind service `0x22`

A `0x22`-only sweeper will silently return nothing on several major modules:

- **Nissan Leaf LBC** (`79B/7BB`) uses **service `0x21`** with 1-byte groups
  `01` (pack), `02` (96 cell voltages), `04` (temperatures), `06` (shunts),
  `61` (SOH, ZE1 2018+ only). Both OVMS and the OBDb signalset agree exactly.
- **Renault LBC and UCH** use `0x21` too. Renault's EVC and DCM use `0x22`. So the
  same car needs both services depending on which module you are talking to.
- **Kia Soul EV (older PS platform)** uses `0x21` local IDs, while the newer E-GMP
  platform on the same brand uses `0x22`. Generation matters more than brand.
- **GM pre-2017 (including GM-era Opel)** uses **service `0x1A`** for odometer
  (`DF`) and oil life (`6D`) — a KWP2000-era identification service, not UDS at all.
- **Toyota** older hybrids answer KWP `1A 88 01` for version data.

The auto-discovery engine should treat "which service" as a per-module probe
dimension, not a per-brand constant.

### 3.4 Two brands are not UDS-sweepable at all

- **Tesla**: Model 3/Y expose periodic broadcast CAN frames, not a request/response
  diagnostic server on standard addresses. Two independent DBC projects
  ([joshwardell/model3dbc](https://github.com/joshwardell/model3dbc),
  [opendbc](https://github.com/commaai/opendbc)) contain only cyclic broadcast
  signals — no `7E0`-range addressing anywhere. Internal firmware strings prove the
  ECUs speak UDS, but nothing documents an unauthenticated path from the OBD port.
  **Do not sweep Tesla.** If Tesla support is ever wanted, parse broadcast frames.
- **Volvo (P1/P2-era)**: uses "VIDA", which is UDS-flavoured but not ISO 14229 over
  standard addressing. Requests go out on a fixed 29-bit ID (`0x000FFFFE`) with the
  *ECU address as a payload byte* and a proprietary command set (`A6` ≈ read data,
  `A3` ≈ security access, `B1` ≈ IO control). Sources:
  [Alfaa123/Volvo-CAN-Gauge](https://github.com/Alfaa123/Volvo-CAN-Gauge),
  [Tigo2000/Volvo-VIDA](https://github.com/Tigo2000/Volvo-VIDA). Whether modern
  SPA/SPA2/CMA cars moved to standard UDS is **unknown** — no source found either
  way. Volvo therefore ships with an empty `modules` list rather than a guessed
  `7E0/7E8`.

### 3.5 Two OEM address schemes that are not simple 11-bit pairs

- **BMW D-CAN**: requests always go out on CAN ID `6F1`; **payload byte 0 is the
  target module address**. The response arrives on `0x600 + target` with payload
  byte 0 = `F1` (the tester). The `req`/`resp` fields in the JSON encode the
  *response* ID so the pair stays machine-usable, but the engine must implement the
  extended-addressing byte. On F/G-series over ENET the tester address changes to
  `F4` and the gateway is `10`.
- **Honda**: 29-bit normal fixed addressing, `18DA<target>F1` request →
  `18DAF1<target>` response. Targets: `10` PCM, `1D` TCM, `60` meter/HVAC, `26`
  TPMS, `01` body. The sweeper must iterate target bytes, not just DIDs.
- **GM Ultium EVs** use 29-bit `14DACBF1` → `142AF1CB`, different again from both.

---

## 4. Per-brand provenance and confidence

### PSA / Stellantis Europe — **highest confidence in the file**

This is the only brand with first-party empirical data. Sources:

1. **This project's own live sweep** of a 2023 Citroën C4 1.2 PureTech, recorded in
   `~/projects/scainner/UDS_INVESTIGATION_LOG.md` and `docs/uds/hunt_results.txt`.
   430 identifiers answered across two modules. The per-prefix hit counts drove the
   `did_bands` entries directly:

   | Band | Engine (6A8) | ABS (6AD) |
   |---|---|---|
   | `D4xx` | 150 | 62 |
   | `D6xx` | 84 | 13 |
   | `D7xx` | 71 | 1 |
   | `D9xx` | 25 | 0 |
   | `DAxx` | 3 | 0 |
   | `21xx` | 3 | 4 |
   | `F0xx`/`F1xx` | 8 | 6 |

2. [ludwig-v/arduino-psa-diag `ECU_LIST.md`](https://github.com/ludwig-v/arduino-psa-diag/blob/master/ECU_LIST.md)
   for the module table (~200 rows), and `zones/BMF.md` for the BSI zone list.
3. [meatpiHQ/wican-fw](https://github.com/meatpiHQ/wican-fw) `vehicle_profiles/fiat/600e.json`
   for the Stellantis EV battery DIDs on `6B4/694`.

4. **ABS/ESP live-data decodes (v6, 2026-08-27).** Twelve `known_dids` on `6AD/68D`
   from the C4 III evidence sessions #2–#49 (parked verification v2/v3, guided
   correlation, a 200 m drive logged against OBD speed, and session 2 through the
   agent API). Every entry carries an `evidence` note. `confirmed` means verified on
   this one vehicle by physical correlation (wheel speeds by regression and
   cornering, steering angle by lock and cornering, servo vacuum by pumping the pedal
   engine-off, clutch by selecting reverse, brake switch across 196 drive cycles);
   `high` means the shape/magnitude is verified but the unit or wheel position comes
   from a Diagbox-derived table; `low` is table-only. The ABS is a Continental/ATE
   ESP MK100 (`9846124980`, software `9695041580`), so these decodes should transfer
   to 208 II / 2008 II / Corsa F / Mokka units with the same part — that is the
   pending second-vehicle check before any of them is called community-verified.
   Provenance and licence caveats for the table: `apps/desktop/docs/research/c41-abs-did-research.md`
   (the `jyseojys/diag-server` definitions are unlicensed and were used only as
   hypotheses; nothing was copied from them beyond the hypothesis being tested).

**Correction to the task brief.** The brief states the C4's battery *state of
charge* lives at `D422`. The project's own log disagrees and the log is right:
`D422` is the engine ECU's **battery voltage** sensor, confirmed by a live
correlation read against mode-01 PID `0142` across two rounds three seconds apart
(14.10 V / 14.13 V vs 14.17 V, and the value *moved* between reads). It is encoded
here as voltage. No PSA state-of-charge DID has been confirmed on this car — SOC
most likely lives on the BSI, which is unreachable (see below).

**Two honest negatives from the same log:**

- The commonly cited **`D0xx`** band produced **zero** answers across 512 DIDs on
  this car, and does not appear in arduino-psa-diag's BSI zone table either. It is
  kept in the map at `confidence: low` rather than dropped, but it should be swept
  last.
- **BSI (`752/652`) is unreachable from the OBD-II port on this vehicle** — confirmed
  dead across two independent sessions plus a 29-bit extended-addressing probe. PSA
  routes body-network traffic on different OBD connector pins; professional tools
  contain a multiplexer, an ELM327-class dongle is hardwired to pins 6/14. The BSI
  entries in the map are from the community list and may simply be unreachable on
  your hardware. Treat a silent BSI as normal, not as a bug.

**Structural note:** PSA's BSI does not expose a flat DID table — it exposes
paired *list* and *values* zones (`2100`/`2101` gauging, `2102`/`2103` maintenance,
`D400`/`D401`/`D402` present-groups and user-visibility). On PSA the efficient
strategy is to read the list zone to enumerate what this specific vehicle populates,
then read the paired values zone, rather than brute-forcing.

### VAG (VW, Audi) + Škoda, SEAT, Cupra

Sources: [OVMS `vehicle_vweup`](https://github.com/openvehicles/Open-Vehicle-Monitoring-System-3)
(`vweup_obd.h` — a full `#define` table of module IDs and DIDs, ground-truthed by a
sub-agent with `curl`+`grep` rather than a summarising fetch),
[opendbc `volkswagen/values.py` and `fingerprints.py`](https://github.com/commaai/opendbc),
[ConnorHowell/vag-uds-ids](https://github.com/ConnorHowell/vag-uds-ids) (extracted
from VW's ODIS database), and
[v-cu/dpf-load-monitor-wide](https://github.com/v-cu/dpf-load-monitor-wide) — a
shipping, physically tested product, which is where the diesel DPF/oil DIDs and
formulas come from.

**Caveats:**

- The `1xxx`-band DPF/oil DIDs (`10F9`, `10FB`, `114E/F`, `1156`, `115E`, `11B2`,
  `11BE`) are validated on the **EDC17 diesel family**. That project's README
  explicitly warns they do not generalise across engine codes. Marked `high` for the
  engines they cover, but expect misses elsewhere.
- The battery DIDs and formulas are validated on the **e-Up** (pre-MEB platform).
  MEB cars (ID.3, ID.4, Cupra Born, Enyaq) are a newer, higher-cell-count BMS
  architecture. **No MEB-specific DID source was found** — OVMS has no MEB module
  and nothing else surfaced. MEB battery entries are inherited convention, flagged
  `low` on Cupra. Treat as needing field verification.
- **Do not confuse VCDS/Ross-Tech 2-digit module numbers with CAN addresses.** They
  are a separate legacy KWP2000/TP2.0 address space. The JSON labels say
  "VCDS module 01" purely as a human cross-reference; the `req`/`resp` fields are the
  real CAN IDs. The tempting `CAN = 0x700 + module_hex` pattern (`715` ↔ airbag 15)
  could not be verified across enough modules to be trusted as a rule.
- Older VAG cars predating UDS use KWP2000/TP2.0 entirely and will not answer `0x22`.

**SEAT and Cupra are modelled as their own brand entries** rather than folded into
VAG, per the project owner's request, with the VAG values duplicated. That they are
genuinely platform-shared is well supported: opendbc handles VW, Audi, SEAT, Škoda,
Cupra and Porsche in **one** `volkswagen` module with no per-marque offsets, and
grep confirms SEAT Ateca uses `0x7e0` and Cupra Born uses `0x715`/`0x757` — byte for
byte identical to the VW/Audi entries in the same file.

**SEAT/Cupra WMI is the weakest part of this section, and it is flagged honestly:**

- `VSS` for SEAT is well-established community knowledge but could **not** be
  re-verified live this session. NHTSA's vPIC database returned nothing — by design,
  since it only covers manufacturers selling in the US, and SEAT never has. What was
  confirmed live is that Wikipedia assigns Spain the WMI range `VS`–`VW`, which is
  consistent. Marked `medium`.
- **Cupra's WMI is genuinely unknown.** No source could be reached. Cupra became a
  standalone brand on 2018-01-31; Formentor and León are built in Martorell
  (alongside SEAT, so plausibly `VSS`), but the **Born is built at VW Zwickau in
  Germany** and may well carry a German VW-family code instead. The map lists
  `VSS`, but that specific claim has no independent confirmation — the brand's
  overall `confidence` field reflects the diagnostic-route evidence (several
  modules confirmed/high), not the WMI, and is not a substitute for one. Because
  `seat` and `cupra` both claim `VSS`, `wmi-table.ts` resolves the badge to `seat`
  (documented at its tie-break site and in `cupra`'s own `sources[]` note) until
  this is settled. **Get a real Cupra Born VIN and a real Cupra Formentor VIN
  before trusting Cupra routing** — this is the single cheapest high-value fix
  available.

### BMW / Mini

Sources: [OVMS `vehicle_bmwi3`](https://github.com/openvehicles/Open-Vehicle-Monitoring-System-3)
for the `Dxxx` band, [jcevanco/rcp_bmw_service_0x22](https://github.com/jcevanco/rcp_bmw_service_0x22)
(real shipped Lua) for the `42xx`–`59xx` band, and a worked D-CAN example with raw
hex (`6F1` → `612`, DID `4300`, bytes `0D BA`, formula `raw×0.1 − 273.15`).

The two DID bands come from different vehicle generations — `Dxxx` from the i3/EV
side, `42xx`–`59xx` from combustion DMEs. Both are in the map; sweep `42xx`–`59xx`
first on an engine ECU and `Dxxx` first on an EV.

**Unresolved:** target byte `0x60` is documented as KOMBI by one source and DSC by
another. Marked `low`. Not found at all: CBS (Condition Based Service) DIDs — the
obvious "service interval" target — despite direct search; TPMS/RDC DIDs; IBS 12V
SOC DID; EGS transmission address (transmission fluid temp is read via the DME
instead).

**Architectural note worth acting on:** the i3's HV battery SOC/SOH appear to be
more reliably obtained from **periodic CAN broadcasts** (SME, CAN IDs 1164/1165
decimal) than from UDS polling. If BMW EV battery data matters, passive sniffing may
beat sweeping.

### Mercedes-Benz — **weakest brand in the file, by a wide margin**

Module addresses for the **pre-UDS/KWP2000 generation** (W203/W209/W211/W219, roughly
2000–2009) come from [rnd-ash/W203-canbus](https://github.com/rnd-ash/W203-canbus),
decoded from real Xentry/DAS databases. Those are in the map at `medium`.

**The entire UDS-era (W204 onward) address table is missing, and so are all
Mercedes manufacturer DIDs.** `known_dids` is empty and that is the correct answer.
This is not for lack of trying: the data exists inside Xentry's proprietary CBF
files, and the two projects that can parse them —
[rnd-ash/OpenVehicleDiag](https://github.com/rnd-ash/OpenVehicleDiag) and
[jglim/CaesarSuite](https://github.com/jglim/CaesarSuite) — ship no example data.
OpenVehicleDiag's SMR parser was **removed under a DMCA takedown**, which is a clear
signal that Daimler actively polices this. Assume no free public source will appear.

Also note: Mercedes's OBD-port gateway passively allows reads but silently drops
traffic for unrecognised diagnostic CAN IDs. **A non-response on Mercedes may mean
"filtered", not "module absent"** — the discovery engine should not conclude absence.

### Renault / Dacia

Source: [fesch/CanZE](https://github.com/fesch/CanZE) — `assets/ZOE/_Ecus.csv` and
`_Fields.csv`, a real field database powering a working community app, with per-field
start bit, length, resolution, offset and unit.

Note the CSV column order is (response, request), so the IDs are swapped relative to
the JSON. This was verified rather than assumed: CanZE lists the LBC as `7bb / 79b`,
and the Nissan Leaf's LBC is independently known to be request `79B` / response
`7BB` from OVMS. Same module, two projects, exact agreement — a strong cross-check
that also confirms the Renault-Nissan alliance shares this controller outright.

Gaps: no TPMS module is documented for the Zoe. No AdBlue or Eolys/FAP additive level
DID was found for Renault or PSA — only a PSA *presence flag* (`23D0`).

### Nissan / Infiniti

Two fully independent primary sources agree byte for byte: OVMS's
`vehicle_nissanleaf.cpp` (production firmware) and the OBDb `Nissan-Leaf` signalset.
This is the best-documented brand in the whole file after PSA. `79B/7BB` LBC on
service `0x21`, `797/79A` charger, `743/763` for everything else on `0x22`.

### Hyundai / Kia / Genesis

Sources: [EVNotify/EVNotiPi](https://github.com/EVNotify/EVNotiPi) car configs
(Ioniq BEV / Kona EV / Niro EV), OVMS `vehicle_hyundai_ioniq5` (E-GMP) and
`vehicle_kiasoulev` (older PS platform),
[JejuSoul/OBD-PIDs-for-HKMC-EVs](https://github.com/JejuSoul/OBD-PIDs-for-HKMC-EVs),
and opendbc for the ADAS/cluster extras.

**Both project anchors are independently confirmed.** TPMS at `7A0/7A8` and the
`C0xx` data band are exactly what OVMS's Ioniq 5 poll table uses (`22 C0 02` sensor
IDs, `22 C0 0B` pressures and temperatures). The `7B3/7BB` HVAC address is confirmed
by EVNotiPi too.

Byte offsets for `22 01 01` were cross-validated between EVNotiPi and OVMS and match
exactly (SOC at 4, current at 10, voltage at 12, max/min temps at 14/15). That is why
those entries carry `confirmed`.

Generation caveat: the older PS platform (Soul EV) uses **service `0x21`** and TPMS
at `7D6/7DE`; E-GMP uses `0x22` and `7A0/7A8`. Both addresses are in the map.
Genesis WMI attribution (`KMT`, `KMU`) is community consensus — NHTSA files them
under "Hyundai" — so treat Genesis routing as approximate.

### Ford

Best source was [meatpiHQ/wican-fw](https://github.com/meatpiHQ/wican-fw)
`vehicle_profiles/ford/*` — real community-submitted working configs with formulas —
plus opendbc for the AS-Built DID and core addresses. The BCM at `726/72E` is the
valuable one: battery SOC/voltage/current/temperature (`4028`–`402B`), tyre pressures
(`2813`–`2816`) and odometer (`DD01`) all live there.

wican's `B4` byte notation maps to after-header offset 0 (its `B0` is the ISO-TP PCI
byte, `B1` the `62`, `B2`/`B3` the DID) — that mapping was used to convert its
formulas into the schema's offset/scale/bias form.

Unverified: ABS (`760/768`) and RCM (`737/73F`) are widely repeated in the
ForScan/ELMconfig community but every primary forum source was behind a login or
returned 403. They are in the map at `low`. Tyre-pressure scaling varies by platform
(some profiles report kPa, others PSI) — marked `medium` for that reason.

### GM / Opel pre-2017 — **and the Opel split, which is real and confirmed**

The Opel pre/post-2017 split is not an assumption. wican-fw's
`vehicle_profiles/opel/opel.json` (the GM-era profile) uses **service `0x1A`** with
DIDs `DF` (odometer) and `6D` (oil life) — identical to the genuine US GM
`gmc/sierra.json` profile. Meanwhile `vehicle_profiles/opel/astra.json` (Astra K,
post-2017) contains essentially nothing but `"extends": "fiat/600e.json"` — it
**literally inherits the Fiat/Stellantis PID set**, service `0x22`, request `6B4`,
response `694`.

So the map carries two Opel entries keyed on WMI:

- `W0L` (Adam Opel AG, GM era) → the `gm` brand entry
- `W0V` (Opel Automobile GmbH, Stellantis era) → the `opel_psa` brand entry

That WMI split is the cleanest available routing signal. Where a VIN is ambiguous,
probe both patterns.

GM itself is low confidence. opendbc gave the `+0x400` RX offset and the camera
address; the GMLAN `241/641` group and its tyre-pressure DIDs came from wican. Not
found: any classic-GM BCM/IPC/gateway address pair, and any confirmation of
single-wire vs high-speed GMLAN address differences.

### FCA / Stellantis North America

opendbc supplied the `−0x280` RX offset and the `F132` version DID; wican supplied
the RAM Promaster DIDs (whose own issue tracker flags the scaling as
community-approximate, hence `low`) and the Fiat 600e EV battery DIDs.

**Security Gateway correction, and it matters.** The common belief that FCA's SGW
(fitted to nearly all 2018+ US-market vehicles) blocks everything is wrong in a way
that helps us: the SGW blocks **writes** — clearing DTCs, bidirectional tests,
actuator control, relearns — while **reads work**, including DTC reads, live data
and VIN. Since Scainner's sweep is read-only `0x22`, it should function on
SGW-equipped FCA vehicles. Confidence `medium-high`, not absolute — some reports
describe specific modules going silent depending on gateway firmware.

Also flagged, because it is an easy trap: the Chrysler Pacifica Hybrid and Chevrolet
Volt community profiles read SOC via `01 5B` — that is **mode-01 PID 0x5B**, a
standard J1979 PID, not a manufacturer DID. It is deliberately excluded from the map.

### Toyota / Lexus

Sources: opendbc plus the [OBDb](https://github.com/OBDb) per-model signalsets
(`Toyota-Prius`, `Toyota-Prius-Prime`, `Toyota-RAV4-Hybrid`), which agree with each
other on addressing.

**Correction to a common assumption:** `7E2/7EA` for the hybrid ECU is real but it is
the **legacy KWP address** used on older Prius generations. Modern (2010s+) Toyota
hybrids put the hybrid vehicle control ECU at **`7D2/7DA`**, with cell-level battery
data on a separate module at **`747/74F`**. The map carries all three.

Toyota concentrates data in `1000`–`10FF` and `1800`–`1FFF` — sweep those before
anything else. A scattering of 1-byte legacy local IDs also exists on `750`/`7B0`/
`7C0`, which look like KWP local identifiers reused as short DIDs.

### Honda / Acura, Mazda, Subaru, Mitsubishi

Honda and Mazda come from OBDb signalsets. Honda's 29-bit target-byte scheme was
cross-validated across two models (Civic and TLX use the same `DA10`/`DA1D`/`DA60`
targets). **Honda bit offsets were deliberately omitted from the JSON** — the
signalsets give bit positions but the base point (whether the header is included)
could not be confirmed, and the brief says omit rather than guess. Honda's hybrid
battery is a genuine gap: the Accord Hybrid, Insight and CR-V Hybrid OBDb repos are
all unpopulated stubs.

Mazda is unusually conventional — plain 11-bit, `+8` offset, TPMS on its own module
at `720/728`. Amusing detail: Mazda and Ford both use `1E1C` for transmission fluid
temperature, almost certainly a shared-heritage artefact.

**Subaru and Mitsubishi: nothing credible found.** The obvious candidates
(`OBDb/Subaru-Solterra`, `OBDb/Mitsubishi-Outlander-PHEV`) are empty stubs, OVMS has
no module for either, and nothing else surfaced. They ship as near-empty entries with
WMI only. The Solterra shares Toyota's bZ4X platform so Toyota-style addressing is
*plausible*, but that is speculation and is not encoded.

---

## 5. Confidence semantics as used here

- `confirmed` — a source demonstrates an actual read (raw bytes and a decoded value),
  or this project read it directly off a car.
- `high` — production code that polls it live, or two independent sources agreeing.
- `medium` — one credible source, or a value extrapolated across a platform family.
- `low` — inferred, anecdotal, contradicted by another source, or explicitly failed
  to reproduce (PSA `D0xx`).

Counts as shipped: 21 brands, 197 `known_dids`, 112 of which are fully
decodable (offset + len + scale + bias), 34 marked `confirmed`, 251 WMI
prefixes, 3 `ecu_families` with 16 decodes. From Phase 1 of the multi-brand
plan these numbers are generated from the pack by `pnpm coverage`.

---

## 6. SecurityAccess

Scainner never sends `0x27`. Everything in this map was sourced from tools that read
without authentication — OVMS firmware, EVNotify dongles, CanZE, wican, Torque-style
signalsets — so the map should be usable as-is.

Known or suspected gating:

- **PSA**: the BSI zone group `2104`–`2106` is named "Secured configuration settings",
  which implies gating even for reads. Excluded from the map.
- **VAG**: Component Protection removal needs `0x27` **plus** a signed token from
  VW's online GEKO/GRP server. Entirely out of scope.
- **Mercedes**: whether ordinary read DIDs need `0x27` is **unknown** — no source
  either way. Probe unauthenticated and treat NRC `0x33` (securityAccessDenied) as
  the signal.
- **FCA**: the SGW gates writes, not reads (see above).

General rule for the engine: never escalate. Treat NRC `0x33` as "skip this DID",
NRC `0x31` (requestOutOfRange) as "DID not supported here", and `0x78`
(responsePending) as "wait, do not retry as a new request".

---

## 7. Operational warnings from this project's own testing

Both learned the hard way and recorded in `UDS_INVESTIGATION_LOG.md`:

1. **Holding extended diagnostic sessions for 15–20 minutes on ABS and engine caused
   other modules to lose contact with them**, lighting up dashboard warnings mid-scan.
   Everything was read-only and the lights self-cleared on an ignition cycle — but a
   long sweep is not invisible to the car. Keep sessions short, or drop back to the
   default session between chunks.
2. **A fully silent module looks exactly like a frozen app.** BSI answered nothing
   across 512 DIDs, and each DID has to individually time out. The engine must emit
   progress events during a sweep and must support cancellation, or users will
   force-quit a perfectly healthy scan.

---

## 8. How to extend this file

Highest value first:

1. **Get real VINs for Cupra** (a Born and a Formentor). The single cheapest fix for
   the weakest routing data in the file.
2. **Re-verify SEAT `VSS`** against any authoritative non-US WMI registry.
3. **Fill the Mercedes UDS-era gap.** Realistically this needs a legitimate Xentry
   CBF file run through OpenVehicleDiag's CBFParser. Do not expect a free public
   dump to appear.
4. **Validate the MEB battery DIDs** on an ID.3/ID.4/Born/Enyaq. Currently inherited
   e-Up convention, flagged `low`.
5. **Resolve BMW target byte `0x60`** (KOMBI vs DSC) and hunt the CBS service-interval
   DID, which is the most commercially interesting BMW value still missing.
6. **Confirm Ford ABS `760/768` and RCM `737/73F`** — needs a ForScan forum account
   or a live car.
7. **Decide whether Volvo is worth supporting at all.** If yes, implement the VIDA
   scheme rather than sweeping addresses, and establish whether SPA/SPA2 moved to
   standard UDS.

When adding entries, keep the honesty discipline: a wrong `high` costs more than an
honest `low`, and an empty `known_dids` is a perfectly good answer. Record the source
URL here at the same time — an unsourced DID cannot be re-verified later.

### Source types that actually paid off

Ranked by yield in this round, for whoever does the next pass:

1. **OVMS-3 vehicle modules** — production firmware, per-brand poll tables with
   module IDs, DIDs and decode functions. Best single source overall.
2. **wican-fw vehicle profiles** — community JSON with real formulas, excellent
   coverage of Ford, Opel, Fiat, GM, RAM.
3. **OBDb signalsets** — per-model crowd-sourced signal databases with bit offsets.
4. **CanZE assets** — the best Renault data anywhere.
5. **EVNotiPi car configs** — the best Hyundai/Kia EV data.
6. **opendbc car ports** — reliable for addresses and RX offsets, thin on live-data
   DIDs (it only fingerprints).
7. **NHTSA vPIC API** — authoritative for WMI, but **US-market only**, so European
   brands (SEAT, Cupra, Škoda) return nothing. That is a coverage limit, not a
   negative result.

Forums (ForScan, BimmerForums, planète-citroën) were consistently unreachable —
403s, logins and CAPTCHAs. Do not budget research time on them without a plan for
authentication.

---

## Verification and 2026-08-23 extension pass

This pass had two jobs: independently re-derive a sample of the prior pass's
high-confidence entries against primary sources (not just re-read the prior
pass's own summary of them), and extend coverage toward newer/EV models. Six
research passes ran in parallel, each fetching primary sources directly
(`raw.githubusercontent.com`, `gh api`, not WebFetch summaries, which lose
exact hex values). `uds-map.json` is now at version 3.

### Method note on this pass's own limits

Every sub-pass exhausted its WebSearch budget partway through and fell back to
direct `curl`/`WebFetch`/`gh api` calls against GitHub. This turned out to be
a strength, not a weakness, for the kind of verification this needed (raw
source files beat search-engine summaries for exact hex values), but it does
mean a few items that would normally get a forum/community cross-check (BMW
F-series ZGW/GWS, Ford ABS/RCM, general "is there an OBD-II port on Tesla"
corroboration) stayed unconfirmed rather than getting a second opinion. Flagged
per-item below.

### Job 1 outcome: verification

**PSA.** Both response-offset rules (6xx block -0x20, 7xx block -0x100)
verified exactly against `arduino-psa-diag`'s `ECU_LIST.md` for every pair
listed. All the BSI zone DIDs (D400/D401/D402, 2101, 2103, 2201, 220A, 2333,
232D, 23D0) verified exactly against `zones/BMF.md`. The Stellantis EV DIDs
(D410, D860, D815) verified byte-exact against `wican-fw`'s
`fiat/600e.json`, a second independent confirmation of the same formula found
last pass, so those three are now `high` confidence in psa, opel_psa and fca
(they share the identical Stellantis EV DID block). D422, D4B1, F08F and D619
could not be found in any of the external repos checked this pass, which
looked concerning until checking `~/projects/scainner/UDS_INVESTIGATION_LOG.md`
and `docs/uds/hunt_results.txt` directly: all four are this project's own live
reads off the real Citroen C4 (raw bytes recorded, correlation reads against
PID 0142 for D422/D4B1), a source outside what the verification sub-agents
were pointed at. No change needed, no external confirmation exists because
none is expected to for a hardware-anchored find.

**VAG.** Both response-offset rules (+0x6A proprietary, +0x08 generic OBD)
verified exactly against `ConnorHowell/vag-uds-ids` and cross-confirmed via
OVMS `vweup_obd.h`. Every battery/DCDC/EDC17 DID checked (1E3B, 1E3D, 028C,
1DD0, 1E33, 1E34, 2A0B, 74CB, 465C, 465B, 10F9, 10FB, 11B2, 11BE) verified
exact, formula for formula, against the OVMS source and
`dpf-load-monitor-wide`. One real contradiction found: **F45B was attributed
to the wrong module.** The map had it on 7E5/7ED (battery management) labeled
"hybrid pack life". OVMS's actual constant is `VWUP_MOT_ELEC_SOC_ABS` on
`VWUP_MOT_ELEC_TX/RX = 0x7E0/0x7E8` (the motor-electronics/engine ECU). Scale
(0.392156863) was already correct, only the module and the meaning were wrong.
Corrected in the map, confidence raised to `confirmed` since the OVMS source
is production firmware and the formula now matches it exactly, module and all.

**BMW.** The D-CAN extended-addressing scheme (request 6F1, target byte as
payload 0, response 0x600+target) verified exactly against both OVMS
`vehicle_bmwi3` and `jcevanco/rcp_bmw_service_0x22`. Two real problems found:

1. **SME's target byte was wrong.** The map had SME (HV battery management)
   at target 0x62 (response 0x662). OVMS's `ecu_sme_defines.h` defines
   `I3_ECU_SME_TX = 0x06F107`, i.e. target byte 0x07, response 0x607. No
   module in the source uses target byte 0x62 at all (grepped for it, zero
   hits). Corrected in the map.
2. **The DID 4300 "confirmed" coolant-temperature formula was wrong.** The map
   had it as a 2-byte, decikelvin formula (scale 0.1, bias -273.15), backed by
   a supposed worked example "raw hex 0D BA" that could not be traced to any
   source this pass checked. The actual source
   (`rcp_bmw_service_0x22/src/inc/pid_debug.lua`) defines `0x4300` as
   `Engine_Temp`, 1-byte, Fahrenheit, `multiply=1.35, add=-54.4`, the exact
   same formula family already correctly documented for 4650/5890/580F/586F.
   Corrected in the map; confidence dropped from `confirmed` to `high` since
   this pass didn't produce its own raw-byte worked example, only matched the
   production Lua source's formula.

The 0x60 = KOM vs DSC ambiguity flagged last pass turned out not to be a real
conflict within the OVMS i3 source: KOM (cluster) is unambiguously target
0x60, and DSC lives at a completely different target byte, 0x29 (response
0x629), previously undocumented. Added as a new module entry, confidence
`high`. (Whether some other BMW platform genuinely puts DSC at 0x60 instead
remains an open question this pass didn't have a source to check, flagged as
still-possible, not ruled out, for a future F-series-specific source.)
4650/5890/580F/586F/56D7 all verified formula-exact and are now `high`
confidence (were `medium`). ZGW (target 10) and GWS (target 5E, F-series
gear selector) and F410 (odometer via gateway) could not be reproduced from
either listed source this pass (the i3 doesn't poll ZGW or GWS, and reads
odometer via D10D on KOM instead), downgraded (ZGW high to medium, GWS
medium to low, F410 medium to low) per the confidence discipline rule: an
entry that can no longer be independently reproduced should not keep its old
confidence just because nobody actively disproved it.

**Ford.** The +0x08 rule and the entire BCM DID set (4028, 402A, 402B, 4029,
2813-2816, DD01, DD04) plus 054B/1E1C/1E12/F405/F40F/F42F verified formula-exact
against `wican-fw`'s `transit.json` and `focus_rs_mk3.json`, including the "B4
byte = after-header offset 0" convention. F45C (oil temperature) is not
present in either of the only two published Ford profiles, so it could not be
re-verified. Downgraded from `high` to `medium` (it may still be correct on a
Ford model not covered by wican-fw's currently published set, but this pass
could not confirm it).

**Hyundai/Kia.** The uniform +0x08 rule verified exhaustively against both the
E-GMP poll table (`vehicle_hyundai_ioniq5.cpp`) and the older PS-platform
table (`vehicle_kiasoulev.cpp`), every pair, no exceptions. The BMS byte
offsets for `22 01 01` (SOC@4, current@10, voltage@12, max/min temp@14/15)
verified byte-exact straight from `hif_can_poll.cpp`, as were B002 (odometer,
confirmed independently by both OVMS and EVNotiPi), C00B/C002 (TPMS) and E004
(VMCU drive status). F100/F110 (firmware description strings) could not be
found in `vehicle_hyundai_ioniq5`, `vehicle_kiasoulev`, or the JejuSoul CSVs
checked. Downgraded from `high` to `low`.

**Nissan.** This is the pass's most consequential correction. `79B/7BB`
(LBC, service 0x21) and `797/79A` (PDM/charger) verified exactly against
`vehicle_nissanleaf.cpp`. But cross-checking the `743/763` DID list against
OBDb's actively test-covered `Nissan-Leaf` signalset (whose test fixtures
literally name the module in the filename, e.g.
`797.79A.221103|...yaml`) found that **7 of the 8 DIDs the map attributed to
743/763 (1103, 1183, 1146, 121A, 1236, 1234, 1255) actually live on 797/79A,
the PDM/charger module, not the body module.** Only 0E2E genuinely belongs to
743/763. This is exactly the class of error the verification pass exists to
catch: the scale/offset/bias formula for every one of those 7 DIDs was
already correct, only the CAN address they'd be read from was wrong. An
implementation trusting the old attribution would query the body ECU and get
nothing, or worse, misinterpret whatever that ECU happens to answer at the
same DID number. Corrected: all 7 relabeled to 797/79A and bumped to `high`
confidence (matched exactly against test-covered production data); 0E2E
bumped to `high` (module confirmed correct); added 0E01 (odometer, genuinely
on 743/763, confirmed); the `1100-131F` did_band note and the 743/763 module
description both corrected to reflect the real scope (743/763 carries only
odometer, tyre pressure and range; the dense 11xx/12xx vehicle-data block is
on 797/79A).

### Job 2 outcome: extension, newer models

**Mercedes EQB, real data, the first non-empty Mercedes entry in the map.**
OBDb's `Mercedes-Benz-EQB` repo has genuine, test-verified data: its
`tests/test_cases/{2023,2024,2025}/commands/*.yaml` fixtures pair raw captured
CAN responses with expected decoded values, checked by hand this pass (DID
6050 raw `1B83` -> 7043/100 = 70.43%, matching the fixture exactly). Added
module 7E2/7EA (chassis/ESP: wheel speeds, vehicle dynamics) and 7E5/7ED (HV
battery), and ten known_dids (2001, 2002, 2005, 2526, 6050, 6053, 6071, 6075,
6502, 6504) at `high`/`confirmed` confidence, applicable to EQB 2023-2025.
Mercedes brand confidence raised low to medium.

Three important negatives, kept as negatives rather than silently omitted:

- **EQA** has an identical-looking DID set in OBDb's repo, but the repo has
  zero test fixtures and the originating commit is literally titled "Add a
  bunch of potential EV pids." Read as templated from EQB (same MFA2
  platform, plausible but not independently verified), not confirmed. Not
  added to the map. If someone gets a real EQA to test against, this is the
  first thing to check.
- **EQE and EQS (EVA2 platform, 2021+)** were actively tested against these
  exact DIDs in OBDb's own test fixtures and explicitly listed under
  `unsupported_commands_by_ecu`, someone polled a real EQE/EQS and got no
  usable response. **The EQB/MFA2 DID pattern does not carry over to EVA2.**
  No working DIDs exist anywhere in the checked sources for EVA2 Mercedes
  EVs (EQE, EQS, presumably EQC). This is a tested, not merely absent, gap.
- **Smart EQ (chassis 453, ~2017-2020)** has a mature, actively maintained
  OVMS component (`vehicle_smarteq`) with extensive real BMS/charger DIDs on
  `79B/7BB` and `7EC`. This is the Renault-Nissan-Daimler alliance platform,
  architecturally unrelated to the EVA2/MFA2 Mercedes EQ lineup despite the
  shared badge, and was deliberately not folded into the `mercedes` brand
  entry (it would misrepresent the platform relationship). Worth a dedicated
  brand entry if Smart 453 support is ever wanted; a real safety note came
  with it: `openvehicles/Open-Vehicle-Monitoring-System-3` issue #1405
  documents third-party OBD polling potentially glitching the HV
  contactor-cycle counter on this specific chassis and bricking the HV
  contactors, which matters given Scainner's always-on recording model.

**Tesla, mechanism now understood, still correctly empty.** Prior pass
concluded "not UDS-sweepable, ships broadcast frames only." This pass found
that's the right practical conclusion but not quite the right mechanism.
`opendbc`'s own Tesla fingerprinting code (`opendbc/car/tesla/values.py`)
performs a real UDS transaction (TesterPresent + ReadDataByIdentifier for
standard DID F18, supplier software version) against Model 3/Y to distinguish
HW3/HW4. **Tesla ECUs do run a UDS server and do answer it.** The reason
nothing is sweepable from an OBD-II-class dongle is bus topology, not absence
of UDS: that request targets `bus=0` ("Party" bus), and the only way
documented anywhere to reach it is tapping the Autopilot computer's own
harness inline, per comma's own hardware install instructions, which needs
interior teardown. The one semi-accessible connector documented for Model 3/Y
(the A-pillar X179 connector, reachable only after removing three trim
panels) exposes a different segment, "Vehicle bus" (`bus=1`), characterized
in every source checked as broadcast infotainment/body traffic only, no UDS
activity documented there. No source confirms a standard dashboard J1962
OBD-II port exists on Model 3/Y at all; the one page that describes one is
Model S/X-era content misfiled in a generic docs section, not Model-3/Y-specific,
and was not treated as evidence for 3/Y. Net effect for Scainner: still
correctly empty (nothing is sweepable through a plug-in dongle), but the
`known_dids`/`modules` emptiness is now a confirmed structural fact rather
than an unresolved guess, so brand confidence raised low to high, matching
the file's confidence semantics ("high confidence" describing how much to
trust what's documented, and what's documented here is a firm negative).

**Volvo/Polestar, real data on the CMA/SPA2 platform, a genuine structural
shift from the legacy VIDA scheme.** OBDb's `Polestar-2` and
`Volvo-XC40-Recharge` repos (identical DID sets, confirming the platform-share
hypothesis) have byte-tested data: standard OBD-II Mode 01 access confirmed
over standard 29-bit extended addressing (response
`18DAF11003410D00` decodes to Mode 01 PID 0x0D, vehicle speed), and two
manufacturer DIDs, EE6F (accelerator pedal position, byte-verified: raw `02`
-> 0.78%, matching a test fixture) and 4028 (HV battery SOC, present in the
default signalset, scale confirmed but no byte-level test fixture found for
it specifically). Added module `18DA10F1`/`18DAF110` at `high` confidence
(the standard-PID pattern is solidly confirmed) and both known_dids at
`medium` (the DID and scale are real, but the exact request-frame CAN ID for
the two manufacturer DIDs, derivable in principle from OBDb's
`hdr`/`pri`/`tst` schema fields, wasn't independently reconstructed and
doesn't obviously match the captured response ID by a simple offset, so it
needs hardware confirmation before being trusted for addressing). Brand
confidence raised low to medium. This is a real finding worth restating
plainly: **the older P1/P2-era VIDA scheme documented last pass is not what
current CMA/SPA2 Volvos and Polestars speak**, at least for standard PIDs.
Whether the pre-2020 VIDA-only cars are still on the road in numbers worth
supporting separately is a product question, not a research one.

**Mitsubishi, still genuinely empty, but now a researched gap instead of an
untried one.** OBDb has nothing (all 12 Mitsubishi-family repos checked are
empty `{"commands": []}` stubs). PHEV Watchdog/MyPHEV, the well-known
closed-source Android apps for Outlander PHEV monitoring, have no published
open-source protocol documentation. What does exist: `projectgus/car_hacking`
(a known EV/car-hacking reverse-engineering effort) has working code for
reading DTCs off the Outlander PHEV, but it (a) requires a brute-force scan
of the full 11-bit address range per vehicle, no stable published address
table exists even in this best source, and (b) uses Mitsubishi-proprietary
KWP2000-flavored session commands (`10 92`/`50 92` to enter a custom
diagnostic session type, `18 00 FF 00` for DTC reads using SID 0x18, not the
standard UDS 0x19) riding on ISO-TP, not clean ISO 14229 DID reads, and has no
DID list for SOC/SOH at all. The SOC/SOH-bearing CMU/BMS protocol that does
exist (documented by `Tom-evnut/OutlanderPHEVBMS` and
`damienmaguire/Outlander-PHEV`) lives on a separate internal EV/BMU CAN bus
that is generally not exposed at the OBD2 connector on this platform, similar
in spirit to the PSA BSI and Mitsubishi CMU access limitations already
documented elsewhere in this file. Left the map entry empty, as instructed:
an honest gap beats a fabricated address table, and this one is now backed by
an actual search rather than an assumption. `projectgus/car_hacking` is the
one source worth returning to first if Mitsubishi coverage ever becomes a
priority.

**VAG MEB (ID.3/ID.4/ID.5, Cupra Born), the flagged low-confidence gap is
now real confirmed data, at least partially.** Last pass had no MEB-specific
source and flagged the inherited e-Up battery DIDs as needing field
verification. This pass found OBDb has genuinely populated (not stub)
`Volkswagen-ID.4` and `Cupra-Born` repos, both with real test fixtures. Key
result: **the legacy 11-bit module 0x7E5/0x7ED is still alive on MEB**, and
carries the same DIDs already documented for e-Up: 1E33 (max cell voltage),
1E34 (min cell voltage), 1E3B (pack voltage) and 1E3D (pack current) all
confirmed present and matching on both ID.4 and Cupra Born test fixtures.
Bumped these to `confirmed` in both `vag` and `cupra` (which mirrors VAG's
values per the existing convention). One real correction alongside the
confirmation: **74CB (SOH) does not appear anywhere in either real dataset.**
Instead both show DID **51E0** explicitly named `HVBAT_SOH`. Added 51E0 to
both brands at `high` confidence; left 74CB in place for e-Up but added a
caveat that it is not confirmed on MEB. Also found, and added as new
did_bands (label-only, no per-DID scale extracted yet, so band-level rather
than individual known_dids): a cluster of individual cell voltage DIDs
(1850-1870) and cell/module temperature DIDs (1821-1841), plus dynamic
charge/discharge current-limit DIDs (5170-5175), all confirmed present on the
same legacy 7E5/7ED module.

One deliberately unencoded finding: MEB cars also expose a second, richer
diagnostic surface using 29-bit functional addressing (a `FC00` header
combined with a target-address byte, e.g. `ta=7B`/`7C`/`76`/`B9` in OBDb's
notation) that carries much more data (108 individual cell voltages, 24
module temperatures, motor/inverter data) than the legacy surface. This
pass did not encode it into the map: the request-ID construction from
OBDb's `hdr`/`pri`/`tst` fields into an actual CAN ID this engine could send
was not confirmed (same caveat as the Volvo/Polestar manufacturer DIDs
above), and guessing would risk exactly the kind of wrong-high-confidence
entry the confidence discipline exists to prevent. Flagged here as the
single highest-value follow-up for VAG MEB: if someone nails down that
addressing scheme, it unlocks a much larger DID set than what's in the map
today.

**Renault EVC/DCM/BCB, and a new fourth exception, PEB, a real behavioral
fix.** Last pass documented these three modules as "breaking the +0x20
majority rule" without recording individual deltas, meaning
`response_addr()` in the Rust engine actually fell through to the wrong
majority-rule default for them (e.g. req 0x7E4 + 0x20 = 0x804, clamped to
0x7FF, nowhere near the real 0x7EC). This pass confirmed the individual
deltas directly against CanZE's `_Ecus.csv` (verifying column semantics
against `Ecu.java`/`Frame.java` first, since the CSV's from/to column order
isn't self-evident): EVC +0x08, DCM +0x10, BCB +0x01, all exactly matching
what the doc's footnote had already guessed. A fourth module, **PEB (power
electronics block, 75A/77E)**, was found to break the rule too, with delta
+0x24, previously undocumented. All four are now explicit per-module ranges
in `resp_offsets`, listed before the general +0x20 range so the engine
resolves them correctly instead of silently falling through. This is a real
bug fix, not just a documentation upgrade: before this pass, an
implementation querying EVC/DCM/BCB/PEB on a real Renault would have computed
the wrong response address for all four.

**Toyota 5th-gen THS (2023+, e-Four dual-motor AWD).** OBDb's `Toyota-Prius`
repo explicitly covers the fifth-generation redesign (XW60, 2023+) on the
same existing module (7D2/7DA). Two DIDs flagged with `dbgfilter: {to: 2023}`
that aren't present on earlier generations: 10A2 (rear motor torque,
requested and actual) and 10A6 (rear motor inverter coolant/max temperature),
consistent with the redesign's added rear motor for AWD. Added at `medium`
confidence (single source, not yet cross-checked against a second).

**Honda e:HEV (2022+ CR-V/Civic hybrid) and newer ADAS modules.** Both
remain confirmed gaps, not just unexplored ones. `OBDb/Honda-CR-V-Hybrid`
exists and explicitly targets the current CR-V generation, but is a
completely empty stub, zero commands, zero test fixtures. Same for
Honda-Accord-Hybrid's current generation. No radar/camera/lane module
signals were found in any Toyota, Honda or VAG-MEB signalset checked this
pass; VAG's MEB radar fuses onto a plain CAN broadcast message rather than a
diagnostic-session read, per opendbc's `radar_interface.py`, which may be
the more general pattern for newer ADAS data (broadcast, not UDS) rather than
a gap this map can close by finding the right DID.

### Updated totals

21 brands (unchanged), 197 `known_dids` at the time of writing (112 fully
decodable), 180 module address pairs. From Phase 1 of the multi-brand plan
these numbers are generated from the pack by `pnpm coverage`. The overall shape hasn't changed, most brands were already
well-covered, but two structural bugs (Nissan's module misattribution,
Renault's silent resp_offset fallthrough) are fixed, one wrong-but-labeled-confirmed
BMW formula is corrected, and five brands that were essentially empty
placeholders (Mercedes, Volvo, and Tesla's justification) now carry either
real data or a properly-documented reason for staying empty.

### Remaining gaps worth flagging for the next pass

1. **The VAG MEB `FC00` extended-addressing surface** (above), highest
   value: unlocks 100+ additional confirmed DIDs per model if the addressing
   scheme gets nailed down.
2. **Mercedes EVA2 (EQE/EQS/EQC)** has zero working DIDs found in any
   checked source, confirmed tested-negative rather than merely unexplored.
   Whatever DID scheme EVA2 uses hasn't been cracked by anyone whose work is
   public.
3. **Mercedes EQA** needs a real car to confirm or refute the EQB-shaped
   guess currently sitting unconfirmed in OBDb (and deliberately not copied
   into this map).
4. **BMW F-series** ZGW/GWS/DSC-vs-KOM-at-0x60 all remain open questions
   for anything past the i3 generation this pass's sources cover.
5. **Ford ABS (760/768) and RCM (737/73F)**, and now also **F45C oil
   temperature**, still need either a ForScan account or a live car; wican-fw
   currently only publishes two Ford profiles.
6. **Mitsubishi and Subaru** remain honest empty gaps, now backed by an
   actual documented search rather than an assumption; `projectgus/car_hacking`
   is the concrete next step for Mitsubishi if it becomes a priority.
7. **Volvo/Polestar manufacturer DID request-frame construction** (EE6F,
   4028) needs a live car to confirm before the engine can address them with
   confidence, the DID and scale are solid, the CAN request ID is a guess.
