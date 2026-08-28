# Correlation engine

`analyze(&HypothesisInput) -> HypothesisReport` is pure and deterministic. It
does not access the database, clock, filesystem, network, or random state.
Ordered maps and explicit final sorting make serialized output stable.

## Pipeline

1. **Decode and shape.** Payloads are interpreted as big-endian raw integers.
   Signedness is inferred only when both sign-bit states occur and two's
   complement produces a substantially smaller span. Shape reports length,
   distinct payload count, common value at OBD speed zero, sentinels, and one
   of `Constant`, `Slow`, `Fast`, or `EventLike`. A binary value needs at
   least three transitions to be event-like. Slow values have sparse changes
   or total path length no more than three times their range.
2. **Reference fits.** Every distinct reference key is fitted, including the
   derived `stationary`, `braking`, and `engine_on` references. Lag candidates
   from -2,000 to +2,000 ms are evaluated, with deterministic ties favouring
   more samples and then the smaller lag. Pearson `r` describes association.
   Alignment uses binary search. Slope and intercept use a deterministic
   dominant-line estimator: at most 128 evenly distributed observations are
   retained, widely separated point pairs vote for a slope bin, then medians
   reject stale sequential reads. This caps the robust estimator at 8,128
   pairs rather than quadratic growth with capture length. Residual SD is
   computed against that robust line.
3. **Events.** Speed derivative below -1 m/s² creates the conservative
   braking reference. The target DID and manufacturer probes are never fed
   back as semantic references by the converter. Reports retain transition
   and A→B→A counts.
4. **Arrays.** Consecutive, equal-width sibling DIDs present in at least half
   the rounds are considered. Promotion requires at least three rest rounds,
   equality within two raw counts in at least 90% of them, at least eight
   moving rounds, and correlation >= 0.8 between every member and the group
   mean. For four-member arrays, the pairing with the lowest within-pair
   squared difference during turns is selected. At least six turns and three
   left-turn samples above +45° are required; the faster pair becomes
   `outer_in_left_turn`.
5. **Inherited fit.** The proposed decode is applied first and compared with
   the expected reference inferred from its label/unit. It is `Matched` only
   at |r| >= 0.9 with decoded slope 0.75..1.25; otherwise enough contrary
   samples produce `Conflicted`, and missing evidence produces `Insufficient`.
6. **Ranking and sanity.** Candidate rules use shape, fit, event, and array
   evidence. Physics checks recognize the wheel-speed raw slope around 100
   counts per km/h and steering raw slope around 10 counts per degree.
   Competing interpretations and the cheapest discriminating test are always
   retained.

## Naming ceiling

Correlation alone never gives a semantic candidate confidence above `0.6`.
The ceiling is crossed only when:

- an inherited decode matches its predicted behavior (`0.9`);
- a four-wheel array also has an intrinsic cornering side split (`0.88`); or
- the explicit engine-off repeated-pedal capture shows monotonic depletion
  without recovery, with an explicit engine-off reference present,
  discriminating servo vacuum (`0.82`).

The engine still returns labels below that ceiling because they are ranked
hypotheses, not promoted names. Consumers must preserve that distinction.

## Fixture conversion

From the repository root, regenerate all JSON fixtures with:

```sh
python3 scripts/correlation_replay.py --convert
```

The converter uses only the standard library and stable ordering. Fixture
tests cover the original C4 drive, cornering, vacuum and EPS captures. See
the fixture README for the camera-negative provenance limitation.
