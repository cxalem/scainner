# Renault / Dacia Deep Research v1

**Research date:** 2026-08-31  
**Brand ID:** `renault`  
**Marques:** `renault`, `dacia`  
**Authoring contract:** UDS brand research pack specification v1.0 (2026-08-31)

This is an **additive research pack**. It does not replace the existing Renault/Dacia object in `uds-map.json`.

## Core result

Renault/Dacia must be planned by diagnostic generation rather than by one brand-wide DID table.

High-value branches in this pack:

- Zoe Phase 1 — explicit 11-bit route catalog
- Zoe Phase 2 — explicit 11-bit plus exact normal-fixed 29-bit route catalog
- Twingo III Phase 2 — broad 11-bit catalog plus exact S-GW3 29-bit route
- Twizy — small exact EV route set
- Renault CMF-B — platform known, proprietary-route research incomplete
- Dacia CMF-B — platform known; Duster has a rich but partially unresolved enhanced DID corpus
- Renault Megane / CMF-C/D research branch — executable `740 -> 760` enhanced route candidate
- third-generation CMF-CD — platform known, routes incomplete
- Dacia Spring / CMF-A EV — route gap
- AmpR Medium — OEM-confirmed modern EV platform, routes incomplete
- AmpR Small / SWEET400 — OEM-confirmed new EV architecture, routes incomplete

## Safety-critical finding

Zoe Phase 2 contains exact source-backed 29-bit routes. These authorize **only those exact tuples** after platform classification. They do not authorize generic Renault 29-bit target enumeration.

Duster enhanced OBDb records using request header `748` do not provide a canonical response ID in the imported source. They are preserved as research leads in `conflicts-and-gaps.json` and generate **no traffic**.

## Planner behavior

Research pack → safe projection → route presence/identity → candidate DIDs → physical validation.

Candidate decoders remain disabled until `vehicle_fit = matched`.

## Canonical files

- `renault-profile-overlay.json`
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

`index.json` hashes every canonical file except itself to avoid a recursive self-hash.

## Import rule

Do not promote model/platform claims to broader scope implicitly. Existing vehicle/trusted-map evidence wins over incoming research. Conflicting observations are retained rather than overwritten.
