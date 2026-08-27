use std::collections::{BTreeMap, BTreeSet};

use super::contract::{ArrayMembership, HypothesisInput, SideSplit};
use super::fit::decode_payload;

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
    let mut group = candidates.into_iter().collect::<Vec<_>>();
    group.sort_unstable();
    let own_index = group.iter().position(|did| *did == input.did)?;
    let consecutive = group.windows(2).all(|pair| pair[1] == pair[0] + 1);
    if group.len() < 3 || !consecutive {
        return None;
    }
    let side_split = (group.len() == 4)
        .then(|| cornering_split(input, &group))
        .flatten();
    Some(ArrayMembership {
        group,
        index: own_index,
        side_split,
    })
}

fn cornering_split(input: &HypothesisInput, group: &[u16]) -> Option<SideSplit> {
    let mut rounds: BTreeMap<i64, BTreeMap<u16, f64>> = BTreeMap::new();
    for snapshot in &input.siblings {
        if group.contains(&snapshot.did) {
            if let Some(value) = decode_payload(&snapshot.payload, 0, snapshot.payload.len(), false)
            {
                rounds
                    .entry(snapshot.ts_ms)
                    .or_default()
                    .insert(snapshot.did, value);
            }
        }
    }
    for sample in &input.samples {
        if let Some(value) = decode_payload(&sample.payload, 0, sample.payload.len(), false) {
            rounds
                .entry(sample.ts_ms)
                .or_default()
                .insert(input.did, value);
        }
    }
    let angle_at = |ts: i64| {
        input
            .samples
            .iter()
            .flat_map(|sample| sample.refs.iter())
            .filter(|reading| reading.key == "steering_angle")
            .min_by_key(|reading| (reading.ts_ms - ts).abs())
            .map(|reading| reading.value)
    };
    let complete = rounds
        .iter()
        .filter(|(_, values)| group.iter().all(|did| values.contains_key(did)))
        .collect::<Vec<_>>();
    if complete.len() < 8 {
        return None;
    }

    let pairings = [
        ([group[0], group[1]], [group[2], group[3]]),
        ([group[0], group[2]], [group[1], group[3]]),
        ([group[0], group[3]], [group[1], group[2]]),
    ];
    let (pair_a, pair_b) = pairings
        .into_iter()
        .min_by(|a, b| within_pair_cost(&complete, a).total_cmp(&within_pair_cost(&complete, b)))?;
    let left_rounds = complete
        .iter()
        .filter(|(ts, _)| angle_at(**ts).is_some_and(|angle| angle > 45.0))
        .collect::<Vec<_>>();
    if left_rounds.len() < 3 {
        return None;
    }
    let mean = |pair: &[u16; 2]| {
        left_rounds
            .iter()
            .map(|(_, values)| (values[&pair[0]] + values[&pair[1]]) / 2.0)
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

fn within_pair_cost(rounds: &[(&i64, &BTreeMap<u16, f64>)], pairing: &([u16; 2], [u16; 2])) -> f64 {
    rounds
        .iter()
        .map(|(_, values)| {
            (values[&pairing.0[0]] - values[&pairing.0[1]]).powi(2)
                + (values[&pairing.1[0]] - values[&pairing.1[1]]).powi(2)
        })
        .sum()
}
