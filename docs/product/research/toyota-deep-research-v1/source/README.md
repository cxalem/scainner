# Toyota / Lexus deep research pack v1

Research date: 2026-09-02.

This pack extends, rather than replaces, the trusted Toyota/Lexus map. Its
main conclusion is that Toyota diagnostics must be scoped by generation:
older Prius/Lexus evidence uses service `21`, while newer hybrid evidence
uses service `22`; some body/TPMS traffic additionally uses ISO-TP extended
addressing and is deliberately excluded from this first executable pack.

The executable core is restricted to immutable OBDb evidence for Prius,
Camry and Lexus RX generation branches. OEM VDS evidence now makes each
platform proposal VIN-selectable for the explicitly published VIN families;
uncovered markets and powertrains still require a generation-qualified model
fact. No Toyota or Lexus vehicle was available in the local Scainner database,
so every candidate remains `untested`, `disabled`, and requires physical
validation.

Platform branches:

- `toyota_prius_xw30`: Prius 2010–2015 service-21 chassis/cluster evidence.
- `toyota_tnga_hybrid`: Prius/Camry hybrid evidence from 2016 onward.
- `toyota_ths5`: fifth-generation Prius 2023 onward.
- `lexus_rx_al10`: Lexus RX 2010–2015 service-21 engine evidence.
- `lexus_rx_al30`: Lexus RX 2023 onward service-22 hybrid evidence.

The most important unresolved conflict is scope: similar addresses and DIDs
appear across several Toyota/Lexus models, but the sources do not prove a
brand-wide ECU-family identity. Nothing here may be promoted across models
until stable ECU fingerprints reproduce the decoder.

No records were held back because of the caps. Many additional OBDb commands
were intentionally omitted because this pass prioritizes a small set of
high-value, independently testable signals over breadth.

## Self-check

- Record counts: 5 platforms, 8 routes, 9 DID candidates, 0 command-support
  observations, 0 ECU-family hypotheses, 0 module inventories, 9 validation
  recipes, 4 claims, 1 conflict and 6 gaps.
- Executable totals: 8 routes and 9 candidate DIDs; neither exceeds the caps.
- Single-source claims: `toyota.prius.generation_split`,
  `toyota.prius.hybrid_routes`, `toyota.lexus_rx.service_split`, and
  `toyota.opendbc.identity_catalog`.
- Documentation-only records: none in the executable route/DID files.
- Gaps: `toyota_no_project_vehicle` (P0), `toyota_no_stable_fingerprints`
  (P0), `toyota_extended_addressing_projection` (P0),
  `toyota_vds_market_coverage` (P1), `toyota_legacy_kwp_boundary` (P1), and
  `toyota_lexus_cross_model_reuse` (P1).
- Foreign keys: all route, platform, recipe and source references resolve.
- Vocabulary: all closed-vocabulary values conform to the authoring contract.
- Safety: no record authorizes a never-automatic service.
- Budgets: every local limit is at or below the central ceiling.
- Honest gaps: no project vehicle, stable fingerprint, complete global VDS
  coverage, or verified extended-addressing projection was established.
  Physical default-session captures on known model/year vehicles would
  establish the vehicle-specific states.
