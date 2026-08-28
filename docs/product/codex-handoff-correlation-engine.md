# Handoff to Codex — Track B: correlation engine

Paste this whole file as the task. Repo: `cxalem/scainner`. Start from the
branch **`feat/discovery-base`** (it adds the frozen
`apps/desktop/src-tauri/src/elm/correlation/contract.rs`, a placeholder
`analyze`, and the fixtures directory). Create branch `feat/correlation-engine`
from it and open a PR against `main`. Do not push to `main`.

## What you are building

A pure, deterministic Rust module `apps/desktop/src-tauri/src/elm/correlation/`
that implements `pub fn analyze(input: &HypothesisInput) -> HypothesisReport`
exactly as declared in `contract.rs` (do not modify that file). It takes raw
UDS payload samples with timestamps and nearby reference readings and returns
a ranked, evidence-backed set of interpretations. It **ranks; it does not
name**: a semantic label may only get confidence > 0.6 when an inherited
decode predicts the behaviour or an intrinsic discriminator (e.g. a
four-wheel array with a cornering split) separates it from competitors.
Read `docs/product/universal-discovery-protocol.md` §6 (the correlation
engine) and §9 first, and `docs/product/discovery-implementation-plan.md`
Track B for the exact deliverables and expected results.

## Ownership (strict — another agent is working in parallel)

You may create/edit only:
- `apps/desktop/src-tauri/src/elm/correlation/**` except `contract.rs`
- `apps/desktop/src-tauri/tests/fixtures/psa/c41/correlation/**`
- `apps/desktop/src-tauri/src/elm/correlation/README.md`
- optionally `scripts/correlation_replay.py`

Do **not** touch `db.rs`, `api/`, `supervisor.rs`, `uds.rs`, `lib.rs`,
`uds_map.rs`, `packages/uds-map`, `Cargo.toml` (no new dependencies — std
only; `serde` is already available), or anything under `src/` (frontend).
If the contract is insufficient, implement what it allows and describe the
proposed change in the PR description.

## Inputs you already have (fixtures to convert)

All under `apps/desktop/docs/workflows/evidence/psa/c41/`; read
`apps/desktop/docs/workflows/parked-vehicle-verification.md` for what each
one is and what was concluded on the car:

- `citroen-c41-drive-v1-2026-08-27.csv` — 196 cycles, ABS `D400–D403`
  (wheel speeds), `D406` (brake switch), `D40C` (brake pressure), `D464`,
  `D46D`, `D479`, with OBD `speed` (raw hex km/h), `rpm` (raw /4), `volt`
  (raw mV).
- `c41-session2-turn-2026-08-27-2025.json` — 150 samples of the four wheel
  speeds + `D41F` (steering angle, ×0.1 − 1250°) during real corners.
- `c41-session2-vacuum-2026-08-27-2031.json` — `D479` while pumping the
  brake pedal with the engine off (drops 156 → 4 and stays).
- `c41-session3-steering-static-2026-08-27-2107.json` and
  `c41-session3-steering-turn-2026-08-27-2104.json` — EPS `D40D`, `D40E`,
  `D40F`, `D411`, `D404` with ABS `D41F` as reference (static: slope 10.02
  counts/°, bias −0.4; `D40E` same slope, bias −181).
- `c41-session3-camera-lights-2026-08-27.json` — ten camera DIDs across
  lights/lens conditions, all constant (a negative).

Write a small converter (Rust test helper or the optional Python script)
that turns these into `HypothesisInput` JSON fixtures; commit the fixtures.

## Expected results (turn these into tests)

See plan §B3. Key assertions:
- Drive: `D400–D403` form an array of 4; fit vs `speed` slope ≈ 99 (±5) raw
  per km/h, r ≥ 0.98; top interpretation "wheel speed ×0.01 km/h", competing
  with "vehicle speed"; adding the cornering fixture yields a side split with
  `D401`/`D403` outer in left turns.
- `D406`: EventLike; braking event fit with ≥ 3 clean transitions.
- `D40C`: magnitude correlates with braking; interpretations include "brake
  pressure" and "deceleration demand"; no label above 0.6 on the drive alone;
  `discriminating_test` mentions a stationary firm-pedal test.
- `D479`: drive alone → no reference fit above |r| 0.5; vacuum fixture →
  monotonic decrease with no recovery → "servo vacuum" candidate.
- `D46D`: EventLike; `discriminating_test` = reverse.
- Steering: `D40D` vs `D41F` slope 10.0 ± 0.3, bias 0 ± 5 after lag
  handling; `D40E` slope 10.0 ± 0.3, bias −181 ± 10; `D40F`/`D411` sign
  follows direction, low confidence; `D404` Slow.
- Camera: all Constant, `interpretations` empty, `discriminating_test`
  suggests a driving capture.
- Determinism: identical input → identical output (no HashMap iteration
  order leaks, no randomness).

## Quality bar

`cargo test` green, `cargo fmt --check` clean, `cargo clippy` no new
warnings, README documenting each algorithm and its thresholds, PR titled
"Correlation engine: ranked hypothesis analysis with C4 replay fixtures".
Commit messages should end with the repo's trailer lines if your tooling
supports them; otherwise plain messages are fine.
