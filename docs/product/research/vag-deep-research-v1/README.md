# Volkswagen / Audi (VAG) Deep Research v1

Research date: 2026-08-31

This pack is an additive overlay for the current `vag` entry in `uds-map.json`.
It does not replace the existing map.

## Architecture rule

Do not treat Volkswagen/Audi as one diagnostic architecture.

Volkswagen branches:
- PQ
- MQB
- MQB A0
- MQB Evo
- MEB Gen1
- MEB Gen2
- commercial branches

Audi branches:
- MQB
- MLB / longitudinal
- adapted MLB evo EV (first e-tron)
- MEB (Q4 e-tron)
- J1 (e-tron GT)
- PPE + E3 1.2
- PPC + E3

## Runtime

VIN/WMI + chassis -> platform -> passive transport -> known routes -> ECU identity -> family match -> scoped DIDs -> bounded fallback.

Generic 29-bit enumeration remains disabled. `FC00/FE00xx` OBDb commands are preserved as unresolved transport evidence and are non-executable.

## Strongest evidence

- openDBC: platform/WMI/chassis classification and VAG multi-DID firmware query F187+F195+F182.
- OBDb ID.4: rich MEB gateway and charger DIDs.
- Audi Q5 2015 support matrix: dense longitudinal engine/transmission evidence.
- Audi RS e-tron GT 2022 matrix: rich J1 positive and negative command evidence.
- Audi OEM: e-tron=adapted MLB evo, Q4=MEB, e-tron GT=J1, Q6/A6 e-tron=PPE/E3 1.2, new A5=PPC/E3.

## Files

- vag-profile-overlay.json
- platforms.json
- connection-playbook.json
- transport-session-safety-policy.json
- ecu-routes.json
- did-candidates.json
- command-support-evidence.json
- ecu-family-hypotheses.json
- validation-plan.json
- conflicts-and-gaps.json
- source-ledger.json
- VAG_Deep_Research_v1.docx
