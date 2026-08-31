# SEAT Deep Research v1

Research date: 2026-08-30

This is an **additive research overlay** for the current SEAT entry in `uds-map.json` (map v9).
It does **not** embed or replace the existing SEAT object.

## Main conclusion

SEAT must be discovered by **platform/transport branch**, not by one brand-wide DID table.

The high-value branches are:

- legacy K-line holdovers;
- PQ35 CAN;
- Ibiza 6J mixed KWP2000 / TP2.0 / TP1.6 / UDS;
- Alhambra 7N;
- Mii Electric shared e-Up platform;
- MQB (Leon 5F / Ateca);
- MQB A0 (Ibiza KJ / Arona);
- MQB A+ LWB (Tarraco);
- MQB Evo (Leon KL / GW2020 / SFD).

## Runtime rule

1. VIN/WMI -> SEAT.
2. Determine platform/model generation.
3. Passive transport detection.
4. Probe source-backed known routes.
5. Read ECU identity/fingerprint.
6. Reuse compatible ECU-family knowledge.
7. Query model/platform/family DIDs.
8. Use bounded 11-bit fallback only when UDS-over-CAN is confirmed.
9. Never enable generic 29-bit scanning from the current SEAT evidence.
10. Never let online research overwrite stronger physical/project evidence.

## Important conflict

General VAG UDS evidence uses steering `0x712 -> 0x77C`.
The Mii Electric implementation uses steering `0x712 -> 0x71A`.

Both are retained with platform scope.

## Contents

- `seat-profile-overlay.json`
- `platforms.json`
- `connection-playbook.json`
- `transport-session-safety-policy.json`
- `ecu-routes.json`
- `did-candidates.json`
- `ecu-family-hypotheses.json`
- `observed-module-inventories.json`
- `validation-plan.json`
- `conflicts-and-gaps.json`
- `source-ledger.json`
- `SEAT_Deep_Research_v1.docx`

The JSON is intended as a research/import inbox. Promotion into the main map should occur only after the confidence and validation gates in `validation-plan.json`.
