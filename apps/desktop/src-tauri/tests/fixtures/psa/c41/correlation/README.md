Fixtures for the correlation engine (Track B). Regenerate them from the
repository root with `python3 scripts/correlation_replay.py --convert`.

Sources are the C4 evidence captures listed in
`docs/product/discovery-implementation-plan.md` §B1. The camera fixtures now
come from the real `c41-session3-camera-lights-2026-08-27.json` capture on PR
#53 (pass it to the converter with `--camera-source` until that PR merges).
Nine DIDs are strictly constant. D40A has two isolated `08 00…` samples, so
it is retained as an event-like negative rather than rewritten as constant;
none of the values discriminate the recorded light/lens conditions.
