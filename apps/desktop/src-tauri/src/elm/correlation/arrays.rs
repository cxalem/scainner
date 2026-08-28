use std::collections::{BTreeMap, BTreeSet};

use super::contract::{ArrayMembership, HypothesisInput, RefReading, SideSplit};
use super::fit::decode_payload;

struct Round<'a> {
    ts_ms: i64,
    values: BTreeMap<u16, f64>,
    refs: &'a [RefReading],
}

pub(crate) fn detect_array(input: &HypothesisInput) -> Option<ArrayMembership> {
    let len = input.samples.first()?.payload.len();
    if len == 0 || input.siblings.is_empty() {
        return None;
    }
    let own_count = input.samples.len();
    let mut counts = BTreeMap::<u16, usize>::new();
    for snapshot in &input.siblings {
        if snapshot.payload.len() == len {
            *counts.entry(snapshot.did).or_default() += 1;
        }
    }
    let mut candidates = counts
        .into_iter()
        .filter(|(_, count)| *count >= own_count.saturating_div(2).max(3))
        .map(|(did, _)| did)
        .collect::<BTreeSet<_>>();
    candidates.insert(input.did);
    let group = candidates.into_iter().collect::<Vec<_>>();
    let own_index = group.iter().position(|did| *did == input.did)?;
    if group.len() < 3 || !group.windows(2).all(|pair| pair[1] == pair[0] + 1) {
        return None;
    }

    let rounds = aligned_rounds(input, &group);
    if !equal_at_rest(&rounds, &group) || !co_varies(&rounds, &group) {
        return None;
    }
    let side_split = (group.len() == 4)
        .then(|| cornering_split(&rounds, &group))
        .flatten();
    Some(ArrayMembership {
        group,
        index: own_index,
        side_split,
    })
}

fn aligned_rounds<'a>(input: &'a HypothesisInput, group: &[u16]) -> Vec<Round<'a>> {
    input
        .samples
        .iter()
        .filter_map(|sample| {
            let mut values = BTreeMap::new();
            values.insert(
                input.did,
                decode_payload(&sample.payload, 0, sample.payload.len(), false)?,
            );
            for did in group.iter().copied().filter(|did| *did != input.did) {
                let snapshot = input
                    .siblings
                    .iter()
                    .filter(|snapshot| snapshot.did == did)
                    .min_by_key(|snapshot| (snapshot.ts_ms - sample.ts_ms).abs())?;
                if (snapshot.ts_ms - sample.ts_ms).abs() > 1_500 {
                    return None;
                }
                values.insert(
                    did,
                    decode_payload(&snapshot.payload, 0, snapshot.payload.len(), false)?,
                );
            }
            Some(Round {
                ts_ms: sample.ts_ms,
                values,
                refs: &sample.refs,
            })
        })
        .collect()
}

fn equal_at_rest(rounds: &[Round<'_>], group: &[u16]) -> bool {
    let rest = rounds
        .iter()
        .filter(|round| {
            round
                .refs
                .iter()
                .any(|reading| reading.key == "speed" && reading.value.abs() < 0.5)
        })
        .collect::<Vec<_>>();
    let equal = rest
        .iter()
        .filter(|round| {
            let min = group
                .iter()
                .map(|did| round.values[did])
                .fold(f64::INFINITY, f64::min);
            let max = group
                .iter()
                .map(|did| round.values[did])
                .fold(f64::NEG_INFINITY, f64::max);
            max - min <= 2.0
        })
        .count();
    rest.len() >= 3 && equal * 10 >= rest.len() * 9
}

fn co_varies(rounds: &[Round<'_>], group: &[u16]) -> bool {
    let moving = rounds
        .iter()
        .filter(|round| {
            round
                .refs
                .iter()
                .find(|reading| reading.key == "speed")
                .is_some_and(|reading| reading.value > 2.0)
        })
        .collect::<Vec<_>>();
    if moving.len() < 8 {
        return false;
    }
    let means = moving
        .iter()
        .map(|round| group.iter().map(|did| round.values[did]).sum::<f64>() / group.len() as f64)
        .collect::<Vec<_>>();
    group.iter().all(|did| {
        let values = moving
            .iter()
            .map(|round| round.values[did])
            .collect::<Vec<_>>();
        pearson(&values, &means).is_some_and(|r| r >= 0.8)
    })
}

fn pearson(a: &[f64], b: &[f64]) -> Option<f64> {
    if a.len() != b.len() || a.len() < 4 {
        return None;
    }
    let ma = a.iter().sum::<f64>() / a.len() as f64;
    let mb = b.iter().sum::<f64>() / b.len() as f64;
    let saa = a.iter().map(|value| (value - ma).powi(2)).sum::<f64>();
    let sbb = b.iter().map(|value| (value - mb).powi(2)).sum::<f64>();
    if saa == 0.0 || sbb == 0.0 {
        return None;
    }
    Some(
        a.iter()
            .zip(b)
            .map(|(left, right)| (left - ma) * (right - mb))
            .sum::<f64>()
            / (saa * sbb).sqrt(),
    )
}

fn cornering_split(rounds: &[Round<'_>], group: &[u16]) -> Option<SideSplit> {
    let turning_rounds = rounds
        .iter()
        .filter(|round| {
            round.refs.iter().any(|reading| {
                reading.key == "steering_angle"
                    && reading.value.abs() > 45.0
                    && (reading.ts_ms - round.ts_ms).abs() <= 1_000
            })
        })
        .collect::<Vec<_>>();
    let left_rounds = rounds
        .iter()
        .filter(|round| {
            round.refs.iter().any(|reading| {
                reading.key == "steering_angle"
                    && reading.value > 45.0
                    && (reading.ts_ms - round.ts_ms).abs() <= 1_000
            })
        })
        .collect::<Vec<_>>();
    if left_rounds.len() < 3 || turning_rounds.len() < 6 {
        return None;
    }
    let pairings = [
        ([group[0], group[1]], [group[2], group[3]]),
        ([group[0], group[2]], [group[1], group[3]]),
        ([group[0], group[3]], [group[1], group[2]]),
    ];
    let (pair_a, pair_b) = pairings.into_iter().min_by(|a, b| {
        within_pair_cost(&turning_rounds, a).total_cmp(&within_pair_cost(&turning_rounds, b))
    })?;
    let mean = |pair: &[u16; 2]| {
        left_rounds
            .iter()
            .map(|round| (round.values[&pair[0]] + round.values[&pair[1]]) / 2.0)
            .sum::<f64>()
            / left_rounds.len() as f64
    };
    let outer = if mean(&pair_a) > mean(&pair_b) {
        pair_a.to_vec()
    } else {
        pair_b.to_vec()
    };
    Some(SideSplit {
        pair_a: pair_a.to_vec(),
        pair_b: pair_b.to_vec(),
        outer_in_left_turn: outer,
    })
}

fn within_pair_cost(rounds: &[&Round<'_>], pairing: &([u16; 2], [u16; 2])) -> f64 {
    rounds
        .iter()
        .map(|round| {
            (round.values[&pairing.0[0]] - round.values[&pairing.0[1]]).powi(2)
                + (round.values[&pairing.1[0]] - round.values[&pairing.1[1]]).powi(2)
        })
        .sum()
}
