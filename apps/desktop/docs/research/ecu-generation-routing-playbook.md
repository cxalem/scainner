# Verifying ECU generation, routing, and sensor data

Date: 2026-08-25  
Audience: Scainner product and scanner-engineering team  
Scope: findings from the connected 2020+ Citroën C4 C41, plus a reusable method for other brands. The vehicle VIN is intentionally excluded.

## Direct answer

Yes: most of the previously uncertain **ECU-generation and addressing layer is verifiable online**. What is not generally public is the final byte-exact mapping from manufacturer-specific DIDs to live values and formulas.

The most consequential finding is that our earlier `NO DATA` result for the dedicated rain/light sensor was not a valid absence test. Public PSA topology identifies the C4-generation rain/light path as `730/710` with LIN child address `0x70`. We sent normal ISO-TP to `730/710` without the child-address byte.

The [official ELM327 command reference](https://elmelectronics.com/wp-content/uploads/2020/05/ELM327DSL.pdf) supports this transport using CAN extended addressing (`AT CEA 70`). Our route model currently represents request/response IDs but not this address-extension dimension.

## What is verifiable for this C4

| System | What online evidence verifies | What local evidence verifies | Still missing | Verdict |
|---|---|---|---|---|
| Windscreen camera | CVM3 family; PSA maps CVM/CPL families to `74A/64A`; Diagbox associates `9842725080` with CVM3 | `74A/64A` answers; full `F080` contained `9842725080` | A CVM-specific positive identity field; live camera DIDs | High-confidence CVM3 candidate |
| Rain/light | C4 C41 uses CDPL UDS Hella; PSA route `730/710`, LIN child `0x70`; diagnostics expose ambient light, forward light and two rain cells | Physical sensor reacted during the cover test; normal `730/710` request did not answer | Retry with correct extended addressing; exact live DIDs/formulas | Generation and route verified; prior reachability test invalid |
| ABS/wheels | C41 uses ESPMK100_UDS; exact C41 captures use `6AD/68D`; tools expose four wheel speeds, brake pressure, steering angle, yaw and acceleration | `6AD/68D` answers and stores default-session evidence | Full fingerprint and exact live DIDs/formulas | Family, address and capability verified |
| Power steering | Exact C41 capture identifies DAE_UDS2 at `6B5/695` | `6B5/695` answers | Exact live steering/torque DIDs | Family and address verified |
| Parking | Exact C41 capture identifies AAS_UDS_G6 at `75D/65D`; later C41 lists also contain AVP/EPLU variants | We tested a different candidate, `74B/64B`, which did not answer | Probe `75D/65D`; determine which optional family is fitted | Correct candidate address found online |
| Climate | C41 coverage names BCC and CCE; diagnostic tools expose temperatures, sunlight, blower/flaps, recirculation and compressor state | Legacy/general climate route `76D/66D` did not answer | Exact C41 route/extension and decoder | Generation/capability verified; route unresolved |
| BSI/body | C41 coverage names BSI2010, BSM2010, FMUX and steering-control families | Generic `752/652` did not answer | Exact C41 gateway route and fingerprint | Family/capability verified; route unresolved |
| Lights/wipers | C41 coverage names CDPL Hella, CVM3, FMUX and steering-control families; PSA ecosystems also identify ESV wiper families | Physical auto-wiper reaction; no dedicated ECU reached yet | Determine whether state is BSI-aggregated, LIN-routed or broadcast-only | Topology candidates verified, exact route unresolved |

### Evidence behind the camera identification

The complete live `F080` reply from `74A/64A` contained two PSA-style references:

- `9817137180`
- `9842725080`

An independent Diagbox user reports `9842725080` for a CVM3 camera, while its physical camera label carries another hardware number. Combined with the PSA source mapping `74A/64A` to the CVM family, that is substantially stronger than classifying the module from its address alone. It remains community-correlated rather than OEM-confirmed. [CVM3/Diagbox evidence](https://www.forum-peugeot.com/Forum/threads/tuto-t%C3%A9l%C3%A9codage-et-calibration-dun-nac-rcc-cirocco-cmb_num-sans-diagbox-via-arduino.121767/page-159)

### Exact-platform evidence for ABS, EPS, and parking

A 2021 C4 C41 vehicle capture reports:

- `AAS_UDS_G6` at `75D/65D`
- `DAE_UDS2` at `6B5/695`
- `ESPMK100_UDS` at `6AD/68D`

The latter two exactly match the modules our Citroën answered. This is anecdotal/community evidence, but it is exact-platform, includes raw responses and calibration references, and agrees with independent PSA address tables. [C4 C41 capture](https://www.elektroda.com/rtvforum/topic3965033.html)

### Why the rain/light request failed

The [PSA ECU list](https://github.com/ludwig-v/arduino-psa-diag/blob/master/ECU_LIST.md) records the dedicated rain/light ECU as `730/710 | L70`. Its implementation prepends the LIN child byte before the ISO-TP payload and removes that encapsulation on replies. The [ELM327 documentation](https://elmelectronics.com/wp-content/uploads/2020/05/ELM327DSL.pdf) describes exactly this first-data-byte addressing model and exposes it as `CEA hh`.

Therefore:

```text
What we tested:  request ID 730 → normal ISO-TP 22 F186
What evidence says: request ID 730 → address extension 70 → ISO-TP 22 F186
```

`NO DATA` from the first request cannot be interpreted as “sensor absent.”

## What exists but is not openly decoded

Commercial diagnostic evidence demonstrates that these values are readable:

- Rain/light: ambient intensity, forward intensity, two rain-cell values. [ScanDoc example](https://scandoc.online/last/0/18/36/36?lng=EN)
- ABS/ESP: per-wheel speed, pressure, steering angle, yaw and acceleration. [ScanDoc ESPMK100 example](https://scandoc.online/last/0/18/40/6?lng=EN)
- Climate: evaporator and vent temperatures, sunlight, blower/flap positions, recirculation and compressor requests. [ScanDoc climate example](https://scandoc.online/last/0/18/10/27?lng=en)
- Parking: system state, individual sensor faults and diagnostic sensor checks. [ScanDoc parking example](https://scandoc.online/last/0/18/40/23)

The C4 C41 system list independently includes BCC/CCE climate, CDPL UDS Hella, CVM3, ESPMK100, BSI2010, BSM2010 and parking variants. [DataDiag C41 coverage](https://www.eos.pr.it/2022/06/nuovo-aggiornamento-datadiag-4-4-0/)

These sources prove capability, not the underlying DID or formula. Public searches for the exact families and calibration numbers converged on coverage lists, DTC reports and configuration zones. They did not expose a reproducible live decoder.

## Immediate data-quality finding

Our database stores only the leading fragment of multi-frame identity samples. For example, the complete `74A/64A F080` response contained both ten-digit references, while SQLite retained only `98 17 13`.

That blocks the ECU-fingerprint strategy at its foundation. Full transport payload preservation must precede more fingerprint research.

The earlier cross-module label problem has the same root discipline issue: a DID label must be scoped to an ECU fingerprint/route. The same number on another module is not the same signal.

## Reproducible cross-brand workflow

### 1. Define four different questions

Never collapse these into “supported”:

1. Which ECU family can this platform use?
2. Which ECU is fitted to this vehicle?
3. What complete route reaches it?
4. How is each returned value decoded?

Evidence for one does not prove the others.

### 2. Preserve complete local evidence

For every response, store:

- full raw transport payload;
- request and response IDs;
- 11/29-bit protocol;
- addressing mode and address extension;
- session state;
- positive response, NRC, timeout or transport failure;
- timestamp, connection and private vehicle ID.

Identity truncation must fail tests before hardware use.

### 3. Build the full route tuple

Represent reachability as:

```text
(protocol, CAN bit width, request ID, response ID,
 address extension, gateway/LIN child, session policy)
```

Request/response IDs alone were insufficient for CDPL.

### 4. Search in decreasing specificity

1. Full OEM part/calibration/reference number.
2. Supplier plus ECU family.
3. ECU family plus platform code and year.
4. Platform/powertrain/equipment combination.
5. Make/model/year only as a discovery query.

Shared supplier modules make fingerprint search more reusable than brand search.

### 5. Triangulate source classes

Use, in order:

1. OEM service/build information and standards.
2. First-party or open diagnostic implementations with raw requests.
3. Diagnostic coverage and live-data screens.
4. Parts catalogs and supplier references.
5. Forum captures only as labeled community evidence.

Record scope, publication date, URL, evidence type, contradictions and license for every claim.

### 6. Verify read-only on the vehicle

1. Default-session presence/identity using the complete route.
2. Preserve negative responses rather than converting them to “not supported.”
3. Test known read candidates only.
4. Use A/B/A physical correlation for unknown live values.
5. Never promote an automatically discovered signal to continuous polling.

### 7. Promote cautiously

A decode becomes shared knowledge only after:

- response shape validation;
- repeated physical correlation;
- agreement across vehicles with the same fingerprint;
- license/provenance review;
- human approval.

## Architecture changes this research requires

1. Add `address_extension` and gateway/LIN-child routing to module profiles.
2. Fix full multi-frame payload persistence and parse complete PSA references.
3. Scope known DIDs to an ECU fingerprint/route, never just a DID number.
4. Store negative and transport outcomes in observation sessions.
5. Keep confidence states distinct: candidate, community-correlated, verified-on-vehicle and OEM-documented.
6. Guarantee `AT CEA` and protocol/filter cleanup through the operation guard.

## Recommended next verification sequence

1. Fix identity persistence before collecting more fingerprints.
2. Implement ELM extended-address routing with replay tests and cleanup.
3. Add `730/710 + address extension 0x70` as a community-reported CDPL route.
4. While parked, read only standard identity/presence and safe known candidates through that route.
5. Probe `75D/65D` in default session for parking-module presence.
6. Extract the full ESPMK100 identity and search licensed/open sources by its exact reference.
7. Use bounded passive correlation only where exact diagnostic decodes remain unavailable.

## Provenance and licensing

- The PSA address/routing repository is GPL-3.0. It is appropriate as attributed research evidence and a guide for vehicle verification; do not copy its tables wholesale into a closed-source knowledge pack. [Repository](https://github.com/ludwig-v/arduino-psa-diag)
- Commercial tool pages prove that a capability exists but do not provide permission or enough detail to reproduce proprietary decoder tables.
- Forum evidence remains community-reported until reproduced on the connected vehicle.

## Research boundary

Searches covered C41 platform matrices, exact ECU families and addresses, local PSA references, reported calibration numbers, LIN routing, ELM extended addressing, diagnostic live-data labels and public DID/formula candidates. Further variants returned redundant coverage/configuration evidence. The remaining byte-exact live decodes require licensed OEM data, an openly licensed implementation that has not surfaced, or controlled reproduction on vehicles.
