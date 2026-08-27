use std::collections::BTreeMap;

use super::contract::{HypothesisInput, Shape, Variability};
use super::events::EventSummary;
use super::fit::decode_payload;

pub(crate) fn signed_guess(input: &HypothesisInput) -> bool {
    let Some(len) = input.samples.first().map(|sample| sample.payload.len()) else {
        return false;
    };
    if len == 0 || len > 8 {
        return false;
    }
    let has_negative_encoding = input
        .samples
        .iter()
        .any(|sample| sample.payload.first().is_some_and(|byte| byte & 0x80 != 0));
    let has_positive_encoding = input
        .samples
        .iter()
        .any(|sample| sample.payload.first().is_some_and(|byte| byte & 0x80 == 0));
    if !(has_negative_encoding && has_positive_encoding) {
        return false;
    }
    span(input, len, true) < span(input, len, false) * 0.75
}

fn span(input: &HypothesisInput, len: usize, signed: bool) -> f64 {
    let values = input
        .samples
        .iter()
        .filter_map(|sample| decode_payload(&sample.payload, 0, len, signed))
        .collect::<Vec<_>>();
    values.iter().copied().fold(f64::NEG_INFINITY, f64::max)
        - values.iter().copied().fold(f64::INFINITY, f64::min)
}

pub(crate) fn describe_shape(
    input: &HypothesisInput,
    signed_guess: bool,
    values: &[f64],
    events: &EventSummary,
) -> Shape {
    let len = input
        .samples
        .first()
        .map(|sample| sample.payload.len().min(usize::from(u8::MAX)) as u8)
        .unwrap_or(0);
    let mut counts: BTreeMap<Vec<u8>, usize> = BTreeMap::new();
    for sample in &input.samples {
        *counts.entry(sample.payload.clone()).or_default() += 1;
    }
    let distinct_values = counts.len();
    let variability = if distinct_values <= 1 {
        Variability::Constant
    } else if events.binary && events.transitions >= 3 {
        Variability::EventLike
    } else if is_slow(values) {
        Variability::Slow
    } else {
        Variability::Fast
    };
    let rest_value = input
        .samples
        .iter()
        .filter(|sample| {
            sample
                .refs
                .iter()
                .any(|reading| reading.key == "speed" && reading.value < 0.5)
        })
        .fold(BTreeMap::<Vec<u8>, usize>::new(), |mut acc, sample| {
            *acc.entry(sample.payload.clone()).or_default() += 1;
            acc
        })
        .into_iter()
        .max_by(|a, b| a.1.cmp(&b.1).then_with(|| b.0.cmp(&a.0)))
        .map(|entry| entry.0);
    let mut sentinels = counts
        .keys()
        .filter(|payload| is_sentinel(payload))
        .map(|payload| hex(payload))
        .collect::<Vec<_>>();
    sentinels.sort();
    Shape {
        len,
        signed_guess,
        variability,
        sentinels,
        distinct_values,
        rest_value,
    }
}

fn is_slow(values: &[f64]) -> bool {
    if values.len() < 5 {
        return false;
    }
    let changes = values
        .windows(2)
        .map(|pair| (pair[1] - pair[0]).abs())
        .collect::<Vec<_>>();
    let nonzero = changes.iter().filter(|change| **change > 0.0).count();
    let range = values.iter().copied().fold(f64::NEG_INFINITY, f64::max)
        - values.iter().copied().fold(f64::INFINITY, f64::min);
    let path = changes.iter().sum::<f64>();
    nonzero <= values.len() / 3 || (range > 0.0 && path <= range * 3.0)
}

fn is_sentinel(payload: &[u8]) -> bool {
    (!payload.is_empty() && payload.iter().all(|byte| *byte == 0xff)) || payload == [0x0f, 0xfe]
}

fn hex(payload: &[u8]) -> String {
    payload
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join("")
}
