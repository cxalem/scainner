use std::collections::BTreeMap;

use super::contract::{HypothesisInput, Shape, Variability};
use super::events::EventSummary;
use super::fit::{decode_payload, MAX_DECODE_BYTES};

pub(crate) fn normalize_width(input: &HypothesisInput) -> (HypothesisInput, usize) {
    let mut counts = BTreeMap::<usize, usize>::new();
    for sample in &input.samples {
        *counts.entry(sample.payload.len()).or_default() += 1;
    }
    let Some(modal) = counts
        .into_iter()
        .max_by(|a, b| a.1.cmp(&b.1).then_with(|| b.0.cmp(&a.0)))
        .map(|entry| entry.0)
    else {
        return (input.clone(), 0);
    };
    let mut normalized = input.clone();
    normalized
        .samples
        .retain(|sample| sample.payload.len() == modal);
    normalized
        .siblings
        .retain(|snapshot| snapshot.payload.len() == modal);
    let dropped = input.samples.len() - normalized.samples.len();
    (normalized, dropped)
}

fn analysed_width(input: &HypothesisInput) -> usize {
    input
        .samples
        .first()
        .map_or(0, |sample| sample.payload.len().min(MAX_DECODE_BYTES))
}

pub(crate) fn signed_guess(input: &HypothesisInput) -> bool {
    let len = analysed_width(input);
    if len == 0 {
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
    span(input, 0, len, true) < span(input, 0, len, false) * 0.75
}

fn span(input: &HypothesisInput, offset: usize, len: usize, signed: bool) -> f64 {
    let values = input
        .samples
        .iter()
        .filter_map(|sample| decode_payload(&sample.payload, offset, len, signed))
        .collect::<Vec<_>>();
    values.iter().copied().fold(f64::NEG_INFINITY, f64::max)
        - values.iter().copied().fold(f64::INFINITY, f64::min)
}

pub(crate) fn offset_binary_window(input: &HypothesisInput, offset: usize, len: usize) -> bool {
    if len == 0 || len > 4 {
        return false;
    }
    let mut values = input
        .samples
        .iter()
        .filter_map(|sample| decode_payload(&sample.payload, offset, len, false))
        .collect::<Vec<_>>();
    if values.len() < 3 {
        return false;
    }
    values.sort_by(f64::total_cmp);
    values.dedup();
    if values.len() < 3 {
        return false;
    }
    let full_scale = (1_u64 << (len * 8)) as f64;
    let mid = full_scale / 2.0;
    let median = values[values.len() / 2];
    let min = values[0];
    let max = values[values.len() - 1];
    (median - mid).abs() <= full_scale * 0.06
        && min <= mid + full_scale * 0.02
        && max >= mid - full_scale * 0.02
        && (max - min) < full_scale * 0.5
}

pub(crate) fn offset_binary_windows(input: &HypothesisInput) -> Vec<(usize, usize)> {
    let width = analysed_width(input);
    let mut windows = Vec::new();
    if let Some(decode) = &input.inherited {
        let (offset, len) = (usize::from(decode.offset), usize::from(decode.len));
        if !decode.signed && offset_binary_window(input, offset, len) {
            windows.push((offset, len));
        }
    }
    for offset in 0..width.saturating_sub(1) {
        if !windows.contains(&(offset, 2)) && offset_binary_window(input, offset, 2) {
            windows.push((offset, 2));
        }
    }
    windows
}

fn varying_bits(input: &HypothesisInput) -> Vec<u8> {
    let Some(first) = input.samples.first() else {
        return Vec::new();
    };
    let mut mask = vec![0_u8; first.payload.len()];
    for sample in &input.samples {
        for (slot, (a, b)) in mask
            .iter_mut()
            .zip(first.payload.iter().zip(&sample.payload))
        {
            *slot |= a ^ b;
        }
    }
    mask
}

pub(crate) fn ascii_text(input: &HypothesisInput) -> Option<String> {
    let first = input.samples.first()?;
    let printable = |byte: &u8| (0x20..=0x7e).contains(byte);
    let is_text = |payload: &[u8]| {
        payload.iter().all(|byte| *byte == 0 || printable(byte))
            && payload.iter().filter(|byte| printable(byte)).count() >= 4
            && payload.iter().any(|byte| byte.is_ascii_alphanumeric())
    };
    if !input.samples.iter().all(|sample| is_text(&sample.payload)) {
        return None;
    }
    Some(
        first
            .payload
            .iter()
            .filter(|byte| printable(byte))
            .map(|byte| char::from(*byte))
            .collect(),
    )
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
    let variability = if distinct_values <= 1 || ascii_text(input).is_some() {
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

pub(crate) fn shape_notes(input: &HypothesisInput, shape: &Shape) -> Vec<String> {
    let mut notes = Vec::new();
    let Some(first) = input.samples.first() else {
        return notes;
    };
    let width = first.payload.len();
    if let Some(text) = ascii_text(input) {
        notes.push(format!(
            "Payload is printable ASCII ({text:?}): an identification string, not a measurement."
        ));
        return notes;
    }
    if width > MAX_DECODE_BYTES && input.inherited.is_none() {
        notes.push(format!(
            "Payload is {width} bytes; whole-payload analysis used the first {MAX_DECODE_BYTES} bytes only. Provide an inherited decode (offset/len) to test a field inside it."
        ));
    }
    for (offset, len) in offset_binary_windows(input) {
        let bits = len * 8;
        notes.push(format!(
            "Bytes {offset}..{} sit around mid-scale 0x{:X} with a bounded span: offset-binary (raw − {}) is a candidate encoding.",
            offset + len,
            1_u64 << (bits - 1),
            1_u64 << (bits - 1)
        ));
    }
    if shape.distinct_values > 1 {
        let mask = varying_bits(input);
        let changing = mask.iter().map(|byte| byte.count_ones()).sum::<u32>();
        let total = (width * 8) as u32;
        if total >= 8 && changing <= 4.min(total / 4) {
            notes.push(format!(
                "Only {changing} of {total} bits change across samples (mask {}): bit-packed flags are a candidate.",
                hex(&mask)
            ));
        }
    }
    notes
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
