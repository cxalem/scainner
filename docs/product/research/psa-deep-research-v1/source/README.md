# PSA (Peugeot / Citroën / DS) Deep Research v1

**Research date:** 2026-08-31  
**Brand ID:** `psa`  
**Marques:** `peugeot`, `citroen`, `ds`  
**Authoring contract:** revised UDS brand research specification supplied by the user.

This pack is an **additive research overlay**. It does not replace the existing `psa` object in `uds-map.json`.

## Main result

PSA discovery needs two independent classifiers:

1. **diagnostic/electrical generation** — AEE2001, AEE2004, AEE2010, or a newer unresolved architecture;
2. **vehicle/model/ECU-family scope** — e.g. C41, e-208, or iOn/C-Zero.

A mechanical/model platform alone must never authorize a DID decoder.

## Strong route grammar

The immutable `arduino-psa-diag` catalogue supplies a large non-exhaustive PSA route grammar, including:

- ABS/ESP `6AD -> 68D`
- BSI/body family `752 -> 652`
- EPS `6B5 -> 695`
- engine `6A8 -> 688`
- transmission `6A9 -> 689`
- cluster `75F -> 65F`
- HVAC `76D -> 66D`
- telematics `764 -> 664`
- traction-battery MSB/TBMU/BMU family `6B4 -> 694`
- VCU `6A2 -> 682`
- electric MCU/HCU2 `6A6 -> 686`
- OBC/DC-DC `590 -> 58F`
- electric brake booster `5D0 -> 5CF`

These are bounded presence/identity candidates, not evidence that every PSA vehicle contains each module.

## Exact e-208 evidence

The immutable WiCAN e-208 profile supports:

- `6B4 -> 694`: `D410` SOC, `D860` SOH, `D815` HV voltage
- `6A6 -> 686`: `D49C` odometer-related source value
- `6A2 -> 682`: `D8EF` battery-temperature-related value and `D434` temperature-A source value

Only the first three have normalized decoder variants enabled as authoring hypotheses; all remain `activation=disabled` until project vehicle validation.

## iOn / C-Zero exception

Peugeot iOn and Citroën C-Zero are isolated as a Mitsubishi-derived branch:

`761 -> 762`, service `21`, local identifier `01`, SOC `(raw / 2) - 5`.

Do not reuse this route on e-208/e-C4/etc.

## Safety

PyPSADiag is a valuable evidence source but contains write-zone, routine, DTC-clearing, flashing and key-bruteforce functionality. None of those capabilities is projected into automatic discovery.

`F080` on `752 -> 652` is retained only as a PSA identity research lead until its default-session behavior and payload semantics are physically normalized.

## Canonical files

- `psa-profile-overlay.json`
- `platforms.json`
- `connection-playbook.json`
- `transport-session-safety-policy.json`
- `ecu-routes.json`
- `did-candidates.json`
- `command-support-evidence.json`
- `ecu-family-hypotheses.json`
- `observed-module-inventories.json`
- `validation-plan.json`
- `conflicts-and-gaps.json`
- `source-ledger.json`
- `index.json`

The manifest hashes every canonical file except itself.
