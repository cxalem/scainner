# Hyundai / Kia / Genesis deep research pack v1

Research date: 2026-09-02.

This pack adds generation-scoped E-GMP research for Hyundai IONIQ 5, Kia EV6,
and Genesis GV60. Immutable OBDb signal sets support bounded default-session
reads for IONIQ 5 and EV6. Genesis GV60 is classified by VIN but intentionally
has no executable diagnostic routes because no model-specific immutable signal
corpus was found. Shared E-GMP architecture is not decoder compatibility.

All records are `community_reported`, `untested`, and `disabled`. The VDS
patterns cover narrow published North-American VIN families only; other
markets remain an explicit gap.

## Self-check

- 3 platforms, 6 routes, 6 DID candidates, 5 validation recipes.
- 3 claims, 1 conflict, 4 gaps, 0 project observations.
- No ECU-family hypothesis and no cross-marque decoder inheritance.
- All executable evidence uses immutable OBDb revisions.

## Popular-model extension

This revision adds model-fact-scoped coverage for Kona/Kona Electric, Tucson, Santa Fe, Elantra, Sonata, Sportage, Niro EV, Seltos, IONIQ 6 and EV9, plus classification-only Sorento, Carnival and Genesis G80 entries. The list is a pragmatic high-volume/current-product coverage set, not a claim of a globally stable sales ranking.

### Cross-model reuse rule

Repeated addresses are leads, not inheritance. The public corpora repeatedly use TPMS route `7A0/7A8` DID `C00B`, yet expose multiple byte layouts; legacy EV and E-GMP BMS payloads also reuse `7E4/7EC` DID `0101` without decoder identity. Every candidate therefore remains model-scoped, `community_reported`, `untested` and disabled. Cross-model reuse becomes eligible only after the runtime's existing ECU-family join sees an exact compatible hardware/software fingerprint and the payload validates on project vehicles.

The new platforms intentionally have no VDS regex. A generation-qualified model fact can select them today; VIN-only selection waits for sourced market-specific VDS rules.
