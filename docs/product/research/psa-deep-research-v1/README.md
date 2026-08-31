# PSA research reconciliation

This directory records the deterministic projection of `psa-deep-research-v1`
into Scainner's read-only discovery runtime. The manifest-verified authoring
package is retained under `source/`; it is evidence, not a replacement for
the trusted map.

## Reconciliation rules

The compiler joins routes by brand plus exact request/response address.
Repository-owned captures remain authoritative:

- C41 engine `6A8/688`, ABS/ESP `6AD/68D`, EPS `6B5/695`, and CVM3
  `74A/64A` are already confirmed in `uds-map.json`, so the research pack does
  not emit duplicate runtime routes for them.
- Immutable research sources can support those observations, but cannot
  rename or downgrade them. In particular, the broad catalogue's
  `rain_light_or_roof` label at `74A/64A` remains an alternative hypothesis;
  it does not replace the fingerprint-backed C4 CVM3 identity.
- A research-only address is emitted as an exploration candidate. It becomes
  vehicle evidence only after a physical response is recorded.
- Decoder variants remain hypotheses until the normal project promotion
  rules are satisfied.

## Runtime behavior

The 49 AEE2004/AEE2010 catalogue routes are marked `exploration_only`. They
are available to the explicitly requested parked-verification plan, but not
to normal automatic route selection. Each new route is presence-gated:

1. one read-only request tests whether the route responds;
2. identity reads run only after an answer, refusal, or unsupported response
   proves that an ECU was reached;
3. candidate identifiers run only after the identity stage reaches the ECU.

This makes a large catalogue useful without multiplying every absent address
into a full identity sequence.

The Mitsubishi-derived Peugeot iOn/Citroën C-Zero branch remains isolated by
its exact model platform. It uses service `21`, local identifier `01`; it is
never selected for a mainstream C4.

## Known source correction

The authoring package's C41 physical inventory includes `74A/64A`, but its
`command-support-evidence.json` omits that route. The projection report emits
this mismatch explicitly. The trusted repository evidence still confirms the
route and CVM3 fingerprint.

See `projection-report.json` for projected counts, reconciled confirmed
routes, warnings, deferred records, and the hashes of every archived input.
