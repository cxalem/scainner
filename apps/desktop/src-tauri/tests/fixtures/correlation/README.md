Fixtures for the correlation engine (Track B). Regenerate them from the
repository root with `python3 scripts/correlation_replay.py --convert`.

Sources are the C4 evidence captures listed in
`docs/product/discovery-implementation-plan.md` §B1. The requested file
`c41-session3-camera-lights-2026-08-27.json` is not present in the repository.
The ten camera-negative fixtures therefore repeat the payloads from
`c41-session3-camera_74a-sweep-D400-D4FF-2026-08-27-2059.json` across the
light/lens conditions documented as all-constant in
`parked-vehicle-verification.md`. They test constant-negative handling, but
do not pretend to be the missing raw capture.
