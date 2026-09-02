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
