# Discovery Protocol — implementation plan (conceptual layer, no UI)

2026-08-28 · implements `universal-discovery-protocol.md` v1.2, steps 1–5 of
its implementation order · two parallel tracks with disjoint file ownership

## Scope of this plan

Everything below is **backend and data**: Rust modules in
`apps/desktop/src-tauri`, SQLite tables, `uds-map` schema, API routes, tests.
No React, no Lab screens, no onboarding. The UI comes after the coverage
report and the hypothesis/state model exist as data.

Both tracks start from the branch `feat/discovery-base` (main + the shared
scaffold: frozen contract, placeholder `analyze`, module stubs, fixtures
directory). They never edit the same file. The single shared
surface is the **frozen contract** in
`src/elm/correlation/contract.rs`, written once in the scaffold and not
modified by either track tonight; changes to it are proposed in the morning
report and merged by hand.

```text
Track A — knowledge & state (Claude, overnight)      Track B — correlation engine (Codex)
────────────────────────────────────────────────      ─────────────────────────────────────
src/elm/discovery/**        (new)                     src/elm/correlation/**  except contract.rs
src/db.rs                   (new tables + queries)    tests/fixtures/correlation/**  (new)
src/api/ops.rs, mod.rs, openapi.rs (new routes only)  src/elm/correlation/README.md
packages/uds-map/data/uds-map.json + src/types.ts     scripts/correlation_replay.py (optional)
  (ecu_families, decodes.state fields)
docs/product/discovery-nightly-report-*.md
scripts/scainner_api.py (new methods only)

Shared, frozen tonight: src/elm/correlation/contract.rs, src/elm/mod.rs
Neither track: supervisor.rs, uds.rs, lib.rs command list, frontend, Cargo.toml deps
```

If a track genuinely needs a change outside its ownership, it writes the
need into its report instead of making the change.

---

## The frozen contract (`src/elm/correlation/contract.rs`)

Plain data, `serde` in/out, no dependencies on the rest of the app, so Track
B can build and test the engine in isolation and Track A can persist and
serve its output without knowing the algorithm.

```rust
/// One raw observation of a hypothesis DID with the nearest reference readings.
pub struct Sample {
    pub ts_ms: i64,                 // when the DID read completed
    pub payload: Vec<u8>,           // complete application payload (after 62 xx xx)
    pub refs: Vec<RefReading>,      // nearest standard-PID / probe readings, each with its own timestamp
}
pub struct RefReading { pub key: String, pub value: f64, pub ts_ms: i64 }

/// What the engine is asked about.
pub struct HypothesisInput {
    pub module: String,             // "6AD/68D"
    pub did: u16,
    pub samples: Vec<Sample>,
    pub siblings: Vec<SiblingSnapshot>,   // same-module DIDs read in the same rounds (for array detection)
    pub inherited: Option<InheritedDecode>, // expected shape/scale when a family match exists
}
pub struct SiblingSnapshot { pub did: u16, pub ts_ms: i64, pub payload: Vec<u8> }
pub struct InheritedDecode { pub label: String, pub offset: u8, pub len: u8, pub scale: f64, pub bias: f64, pub signed: bool, pub unit: String }

/// What the engine returns. Ranks; does not name (see protocol §6).
pub struct HypothesisReport {
    pub module: String,
    pub did: u16,
    pub shape: Shape,
    pub correlations: Vec<Correlation>,           // every reference tried, not only the best
    pub interpretations: Vec<Interpretation>,     // ranked candidates with confidence 0..1
    pub array: Option<ArrayMembership>,
    pub inherited_fit: Option<InheritedFit>,      // Matched | Conflicted | Insufficient
    pub discriminating_test: Option<String>,      // the cheapest guided step that separates the top candidates
    pub samples_used: usize,
    pub notes: Vec<String>,                       // human-readable reasoning, one line each
}
pub struct Shape { pub len: u8, pub signed_guess: bool, pub variability: Variability, pub sentinels: Vec<String>, pub distinct_values: usize, pub rest_value: Option<Vec<u8>> }
pub enum Variability { Constant, Slow, Fast, EventLike }
pub struct Correlation { pub reference: String, pub r: f64, pub slope: f64, pub bias: f64, pub residual_sd: f64, pub lag_ms: i64, pub n: usize }
pub struct Interpretation { pub label: String, pub decode: Option<InheritedDecode>, pub confidence: f64, pub evidence: Vec<String>, pub competing_with: Vec<String> }
pub struct ArrayMembership { pub group: Vec<u16>, pub index: usize, pub side_split: Option<SideSplit> }
pub struct SideSplit { pub pair_a: Vec<u16>, pub pair_b: Vec<u16>, pub outer_in_left_turn: Vec<u16> }
pub enum InheritedFit { Matched { r: f64 }, Conflicted { reason: String }, Insufficient }

pub fn analyze(input: &HypothesisInput) -> HypothesisReport;   // Track B implements; Track A calls
```

(The scaffold contains the exact Rust with derives and doc comments; the
above is the shape.)

---

## Track A — knowledge & state layer (Claude)

Goal by morning: a fresh install that connects the C4 (or replays its
evidence) can produce a coverage report from data, with the four state
dimensions, inherited hypotheses from `ecu_families`, and identity confidence
— reachable through the API.

### A1. `uds-map` schema: `ecu_families` and decode states
- `packages/uds-map/data/uds-map.json` → add top-level `ecu_families[]`:
  `{ id, supplier, family, hardware_refs[], software_refs[], diagnostic_service, modules_seen_on[{brand, req, resp}], decodes[{did, label, offset, len, scale, bias, signed, unit, knowledge_state, evidence, vehicles_confirmed, discriminating_test}] }`.
- Seed it from what we have: `contMK100_psa` (hw `9846124980`, sw
  `9695041580`; the 12 ABS decodes), `dae_uds2_psa` (hw `9844551780`, sw
  `9695027380`; the 4 EPS decodes), `cvm3_psa` (identity only). Keep the
  existing `known_dids` as-is (backwards compatible); families are the new
  reuse path.
- `packages/uds-map/src/types.ts` mirrors it; `vitest` passes.

### A2. Compatibility matching (`src/elm/discovery/family.rs`)
- `CompatibilityKey { supplier, family, hardware_ref, software_ref, payload_variant, service }` built from a module fingerprint (ISO fields or PSA `F080/F0FE`).
- `match_family(key, map) -> FamilyMatch::{Strong, Weak, NameOnly, None}` per protocol §2.
- Unit tests: C4 ABS → Strong; same hw with unknown sw → Weak; family name only → NameOnly.

### A3. Four state dimensions + identity confidence (`src/db.rs`, `src/elm/discovery/state.rs`)
- New table `hypotheses (id, vehicle_id, module_id, did, knowledge_state, vehicle_fit, route_state?, activation, label, decode_json, shape_json, interpretations_json, confidence, discriminating_test, next_step_id, family_id, created_at, updated_at, cloud_id)`.
- New table `hypothesis_samples (id, hypothesis_id, ts_ms, payload_hex, refs_json)` with the retention rule stubbed (keep last N per hypothesis).
- `discovered_modules`: add `identity_fit` (`provisional|stable|conflicted`), `identity_reads` (count), `route_json`, `family_id`, `family_match` columns (idempotent ALTERs like v7).
- Enums in Rust with `as_str`/`parse`, plus the transition rules as functions with tests (e.g. `activation = enabled` requires `vehicle_fit = matched`; `learning` only inside a learning state flag stored in `app_settings`).
- Class filter for hypothesis persistence (§4 S4): identity/config bands, opaque blobs, serial-like, security-like → never persisted as hypotheses.

### A4. S3 join (`src/elm/discovery/join.rs`)
- `join_vehicle(db, map, vehicle_id)`: for each fingerprinted module with `identity_fit ≥ provisional`, match a family, create inherited hypotheses (`knowledge_state` from the decode, `vehicle_fit = untested`, `activation = disabled`) and set `family_id/family_match` on the module. Idempotent (re-running updates, never duplicates).
- Also creates `unknown` hypotheses for existing `discovered_dids` rows that pass the class filter.
- Test against a test DB seeded with the C4's fingerprints: 12 ABS + 4 EPS inherited hypotheses; a Weak match produces disabled hypotheses only.

### A5. Coverage report (`src/elm/discovery/coverage.rs`)
- `coverage(db, map, vehicle_id) -> CoverageReport` with the lines from protocol §8, every line carrying evidence ids (`run_ids`, `module_ids`, `hypothesis_ids`), and `status: complete|partial` with what remains.
- Serialised as JSON.

### A6. API (`src/api/ops.rs`, `mod.rs`, `openapi.rs`, `scripts/scainner_api.py`)
- `GET /vehicles/{id}/coverage`, `GET /vehicles/{id}/hypotheses`, `POST /vehicles/{id}/join` (runs A4), `PATCH /hypotheses/{id}` (state transitions with rule enforcement), `GET /learning-state`, `PUT /learning-state`. All local reads except `join` (local too). OpenAPI table updated; the route-consistency test must pass.

### A7. Identity confidence in existing write-back (only if it stays within ownership)
- The write-back of fingerprints currently lives in `supervisor.rs` (not owned tonight). Track A therefore exposes `discovery::identity::record_identity(db, module_id, fingerprint)` in `src/elm/discovery/identity.rs` and a DB query, with tests; wiring it into the supervisor is listed in the morning report as a one-line follow-up.

### A8. Nightly report
- `docs/product/discovery-nightly-report-2026-08-28.md`: what was built, tests, how to exercise it (API calls on the C4 DB), decisions taken, open questions, proposed contract changes, and the exact follow-ups outside ownership.

Definition of done for Track A: `cargo test` green including new tests; `cargo fmt --check` and `npx tsc --noEmit` clean; `vitest` green; branch `feat/discovery-knowledge-layer` pushed and a PR opened against `main` (not merged).

---

## Track B — correlation engine (Codex)

Goal: `src/elm/correlation/` implements `contract::analyze` as a pure,
deterministic module, replay-tested against the C4 evidence already in the
repo, producing ranked interpretations — never names without discriminating
evidence (protocol §6).

### B1. Fixtures (`apps/desktop/src-tauri/tests/fixtures/correlation/`)
Convert the existing evidence into `HypothesisInput` JSON:
- `docs/workflows/evidence/citroen-c41-drive-v1-2026-08-27.csv` → ABS `D400–D403`, `D406`, `D40C`, `D464`, `D46D`, `D479` with `speed/rpm/volt` references (196 cycles).
- `c41-session2-turn-2026-08-27-2025.json` → wheel speeds + `D41F` during cornering (150 samples).
- `c41-session2-vacuum-2026-08-27-2031.json` → `D479` engine-off pedal pumping.
- `c41-session3-steering-static-*.json` and `steering-turn-*.json` → EPS `D40D/D40E/D40F/D411/D404` vs ABS `D41F`.
- `c41-session3-camera-lights-2026-08-27.json` → the all-static negative.
- The `verification_runs` JSON for runs #4–#16 is in the local DB only; do not depend on it.

### B2. Engine (`src/elm/correlation/{shape,arrays,fit,events,cornering,sanity,mod}.rs`)
1. Shape (len, signedness guess, variability, sentinels, rest value).
2. Array detection over `siblings` (consecutive DIDs, equal length, equal at rest, co-varying while moving).
3. Reference fits: linear regression against each reference with lag search (−2 s … +2 s); report r, slope, bias, residual, lag, n for every reference.
4. Event fits: binary/step values vs derived events (braking = decel < −1 m/s² from `speed`; stationary; engine on/off from `rpm`), ≥ 3 clean A→B→A transitions.
5. Cornering split for arrays when a steering-angle reference is present.
6. Physics sanity for candidate units.
7. Inherited fit: test the expected decode first → Matched/Conflicted/Insufficient.
8. Ranking → `interpretations[]` with confidence and `competing_with`; `discriminating_test` chosen from a small catalogue (brake pedal, steering lock, reverse, engine-off pedal pump, tyre deflation, lights).

### B3. Expected results (the tests)
- Drive fixture: `D400–D403` → array of 4, slope ≈ 99 raw/km/h against `speed` (r ≥ 0.98), top interpretation "wheel speed ×0.01 km/h" competing with "vehicle speed"; with the cornering fixture the side split resolves `D401/D403` as outer-in-left-turn. `D406` → EventLike, braking fit; `D40C` → braking-correlated magnitude, top interpretations "brake pressure" vs "deceleration demand", `discriminating_test` = stationary firm pedal. `D479` → no strong reference fit on the drive; with the vacuum fixture → monotonic decrease under pumping, interpretation "servo vacuum". `D46D` → EventLike, not derivable from speed → discriminating test "reverse".
- Steering fixtures: `D40D` vs `D41F` slope ≈ 10.0 counts/°, bias ≈ 0; `D40E` same slope, bias ≈ −181; `D40F/D411` sign follows direction, low confidence; `D404` Slow.
- Camera fixture: everything Constant; no interpretations; `discriminating_test` = driving capture.
- Determinism: same input → identical report.
- No naming without evidence: on the drive fixture alone, `D40C` must not reach confidence > 0.6 for any single label.

### B4. Deliverables
`cargo test` green (engine tests + fixtures), `cargo fmt --check` clean, no new warnings, `src/elm/correlation/README.md` describing the algorithms and thresholds, branch `feat/correlation-engine`, PR against `main`. Optional: `scripts/correlation_replay.py` that loads a fixture and prints the report for manual inspection.

Track B does not touch `db.rs`, `api/`, `supervisor.rs`, `uds.rs`, `uds-map`, or `contract.rs`. If the contract is insufficient, note the proposed change in the PR description.

---

## Morning merge order

1. Track B PR (pure module, no schema) → `main`.
2. Track A PR → `main` (rebase if the scaffold moved).
3. Follow-ups listed in both reports: wire `record_identity` into the supervisor write-back; call `correlation::analyze` from a new `discovery::learn` step over stored `hypothesis_samples`; then the learning-drive cohort (protocol step 6) as the next plan.
