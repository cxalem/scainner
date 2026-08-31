# Research-driven discovery plan

Status: implementation started 2026-08-31

## Goal

Use large manufacturer research packs to decide where to look and how to
verify a value without treating external research as trusted vehicle data.
Keep one generic engine for every brand and manufacturer group.

## Three knowledge layers

1. **Research catalog** — source-backed routes, platform/family scope,
   positive and negative support evidence, proposed meanings/decodes and
   validation recipes. It may prioritize read-only traffic but cannot produce
   an enabled sensor.
2. **Vehicle evidence** — exact route outcomes, raw responses, identity
   fingerprints, discovered DIDs, captures and vehicle-fit decisions.
3. **Trusted map** — reviewed routes, ECU families and decodes reusable by the
   normal runtime. Only a vehicle-matched hypothesis may be enabled.

Research is additive. It never overwrites vehicle evidence or the trusted
map, and a source's confidence in a route does not imply confidence in a DID
meaning or decoder.

## Planner order

For every candidate route:

1. Configure its complete transport tuple in the default session.
2. Read the presence DID and applicable identity block.
3. Stop the route when every discovery read is silent or transport-failed.
4. If an ECU answered or refused, read executable candidate DIDs.
5. Retain proposed semantics, decode formulas and validation recipes only as
   untrusted hypothesis metadata.
6. Never execute records explicitly marked unsupported or unauthorized.

Known/trusted routes run before research routes. Platform-scoped research is
eligible only after an exact platform match. Make-level candidates remain a
late fallback.

## Delivery slices

### Slice 1 — richer safe candidates (implemented)

- Candidate DIDs accept either a legacy hex string or a detailed hypothesis.
- Detailed hypotheses retain semantic, proposed decode and validation recipe.
- Research plans run discovery reads before candidate reads.
- Candidate reads are gated on an answered/refused discovery read.
- Unsupported and non-authorized records remain evidence but do not execute.
- `support_status` uses a closed vocabulary; unknown values fail pack loading
  and also default to non-executable in the candidate helper.
- Research routes and DIDs are validated as hexadecimal at startup; malformed
  routes fail loudly instead of silently disappearing.
- Detailed decode JSON is retained in the research pack but is not yet copied
  into parked observations; only its semantic and validation recipe are
  surfaced. Persisting and pairing the full formula is Slice 5 work.

### Slice 2 — normalize and ingest VAG

- Store the original VAG pack under `docs/product/research/`.
- Resolve every executable source to an immutable revision.
- Import the 86 VAG routes as presence/identity candidates.
- Import broad make-level DIDs as non-executable hypotheses initially.
- Enable MEB/MLB/J1 candidates only when their platform is resolved.
- Import J1 unsupported commands as scoped negative evidence.
- Add fixture tests for MEB, MLB and J1 selection.

### Slice 3 — evidence-based platform classification

Add a small rule/scoring layer; do not add machine learning or a graph
database. Inputs are VIN/VDS, model/year facts, reached routes, gateway ECU
identity and characteristic module inventory. Output:

```text
platform_id · confidence · supporting evidence · alternatives
```

The planner uses the intersection of safe routes while classification remains
ambiguous and replans when stronger identity evidence arrives.

### Slice 4 — resumable prioritized actions

Persist plan actions and attempts. Previously reached routes are not repeated
without cause; silence is retried according to policy; transport failures are
retried after transport/adapter changes; deferred work resumes before lower
value work. Rank actions with a transparent score based on specificity,
source quality, platform/family fit, information gain, user value, traffic
cost and transport uncertainty.

### Slice 5 — validation recipes and promotion

Map common recipes (wheel speed, steering, braking, temperature, voltage,
SOC and charging) to the existing guided-correlation flow. A proposed decoder
stays disabled until its recipe produces `vehicle_fit = matched`. Promotion
into the trusted map remains reviewed and evidence-linked.

## Explicit non-goals

- No manufacturer-specific discovery engines.
- No automatic trust of third-party decode formulas.
- No exhaustive scan because a large catalog exists.
- No graph database, probabilistic framework or workflow service.
- No automatic SFD/security unlock, write, routine or extended-session use.
