use std::collections::BTreeMap;

use super::contract::{Correlation, HypothesisInput, InheritedDecode, RefReading};

const LAGS_MS: [i64; 15] = [
    -2000, -1500, -1000, -750, -500, -250, -100, 0, 100, 250, 500, 750, 1000, 1500, 2000,
];
const MAX_ROBUST_POINTS: usize = 128;

pub(crate) fn decode_payload(
    payload: &[u8],
    offset: usize,
    len: usize,
    signed: bool,
) -> Option<f64> {
    if len == 0 || len > 8 || offset.checked_add(len)? > payload.len() {
        return None;
    }
    let raw = payload[offset..offset + len]
        .iter()
        .fold(0_u64, |acc, byte| (acc << 8) | u64::from(*byte));
    if !signed {
        return Some(raw as f64);
    }
    let bits = len * 8;
    if bits == 64 {
        Some((raw as i64) as f64)
    } else if raw & (1_u64 << (bits - 1)) != 0 {
        Some((raw as i128 - (1_i128 << bits)) as f64)
    } else {
        Some(raw as f64)
    }
}

pub(crate) fn decode_with(payload: &[u8], decode: &InheritedDecode) -> Option<f64> {
    decode_payload(
        payload,
        usize::from(decode.offset),
        usize::from(decode.len),
        decode.signed,
    )
    .map(|raw| raw * decode.scale + decode.bias)
}

pub(crate) fn reference_fits(
    input: &HypothesisInput,
    signed: bool,
    derived: &[RefReading],
) -> Vec<Correlation> {
    let observations = input
        .samples
        .iter()
        .filter_map(|sample| {
            decode_payload(&sample.payload, 0, sample.payload.len(), signed)
                .map(|value| (sample.ts_ms, value))
        })
        .collect::<Vec<_>>();
    fits_for_observations(&observations, input, derived)
}

pub(crate) fn decoded_reference_fits(
    input: &HypothesisInput,
    decode: &InheritedDecode,
    derived: &[RefReading],
) -> Vec<Correlation> {
    let observations = input
        .samples
        .iter()
        .filter_map(|sample| decode_with(&sample.payload, decode).map(|v| (sample.ts_ms, v)))
        .collect::<Vec<_>>();
    fits_for_observations(&observations, input, derived)
}

fn fits_for_observations(
    observations: &[(i64, f64)],
    input: &HypothesisInput,
    derived: &[RefReading],
) -> Vec<Correlation> {
    let mut references: BTreeMap<String, Vec<RefReading>> = BTreeMap::new();
    for reading in input
        .samples
        .iter()
        .flat_map(|sample| sample.refs.iter())
        .chain(derived.iter())
    {
        if !reading.value.is_finite() {
            continue;
        }
        references
            .entry(reading.key.clone())
            .or_default()
            .push(reading.clone());
    }
    for readings in references.values_mut() {
        readings.sort_by(|a, b| {
            a.ts_ms
                .cmp(&b.ts_ms)
                .then_with(|| a.value.total_cmp(&b.value))
        });
        readings.dedup_by(|a, b| a.ts_ms == b.ts_ms && a.value == b.value);
    }

    let mut output = Vec::new();
    for (key, readings) in references {
        let mut best: Option<Correlation> = None;
        for lag_ms in LAGS_MS {
            let pairs = align(observations, &readings, lag_ms);
            if pairs.len() < 4 {
                continue;
            }
            let Some(mut candidate) = regression(&pairs) else {
                continue;
            };
            candidate.reference = key.clone();
            candidate.lag_ms = lag_ms;
            let replace = best.as_ref().is_none_or(|current| {
                candidate.r.abs() > current.r.abs() + 1e-9
                    || ((candidate.r.abs() - current.r.abs()).abs() <= 1e-9
                        && (candidate.n > current.n
                            || (candidate.n == current.n
                                && candidate.lag_ms.abs() < current.lag_ms.abs())))
            });
            if replace {
                best = Some(candidate);
            }
        }
        if let Some(best) = best {
            output.push(best);
        }
    }
    output.sort_by(|a, b| a.reference.cmp(&b.reference));
    output
}

fn align(observations: &[(i64, f64)], readings: &[RefReading], lag_ms: i64) -> Vec<(f64, f64)> {
    let tolerance = cadence(readings).clamp(250, 2500);
    observations
        .iter()
        .filter_map(|(ts, observed)| {
            let target = *ts - lag_ms;
            let index = readings.partition_point(|reading| reading.ts_ms < target);
            let nearest = [
                index.checked_sub(1),
                (index < readings.len()).then_some(index),
            ]
            .into_iter()
            .flatten()
            .map(|candidate| &readings[candidate])
            .min_by_key(|reading| (reading.ts_ms - target).abs())?;
            ((nearest.ts_ms - target).abs() <= tolerance).then_some((nearest.value, *observed))
        })
        .collect()
}

fn cadence(readings: &[RefReading]) -> i64 {
    let mut gaps = readings
        .windows(2)
        .map(|pair| pair[1].ts_ms - pair[0].ts_ms)
        .filter(|gap| *gap > 0)
        .collect::<Vec<_>>();
    gaps.sort_unstable();
    gaps.get(gaps.len() / 2).copied().unwrap_or(500) * 2
}

fn regression(pairs: &[(f64, f64)]) -> Option<Correlation> {
    let n = pairs.len();
    let mean_x = pairs.iter().map(|p| p.0).sum::<f64>() / n as f64;
    let mean_y = pairs.iter().map(|p| p.1).sum::<f64>() / n as f64;
    let sxx = pairs.iter().map(|p| (p.0 - mean_x).powi(2)).sum::<f64>();
    let syy = pairs.iter().map(|p| (p.1 - mean_y).powi(2)).sum::<f64>();
    if sxx <= f64::EPSILON || syy <= f64::EPSILON {
        return None;
    }
    let sxy = pairs
        .iter()
        .map(|p| (p.0 - mean_x) * (p.1 - mean_y))
        .sum::<f64>();
    let (slope, bias) = robust_line(pairs).unwrap_or_else(|| {
        let slope = sxy / sxx;
        (slope, mean_y - slope * mean_x)
    });
    let r = (sxy / (sxx * syy).sqrt()).clamp(-1.0, 1.0);
    let residual_sd = (pairs
        .iter()
        .map(|p| (p.1 - (slope * p.0 + bias)).powi(2))
        .sum::<f64>()
        / n as f64)
        .sqrt();
    Some(Correlation {
        reference: String::new(),
        r,
        slope,
        bias,
        residual_sd,
        lag_ms: 0,
        n,
    })
}

/// Deterministic dominant-line estimate. Widely separated point pairs vote
/// for a slope bin; medians in the winning neighbourhood reject stale
/// sequential reads without knowing the signal's semantic meaning.
fn robust_line(pairs: &[(f64, f64)]) -> Option<(f64, f64)> {
    if pairs.len() < 10 {
        return None;
    }
    let points = if pairs.len() <= MAX_ROBUST_POINTS {
        pairs.to_vec()
    } else {
        (0..MAX_ROBUST_POINTS)
            .map(|index| pairs[index * (pairs.len() - 1) / (MAX_ROBUST_POINTS - 1)])
            .collect::<Vec<_>>()
    };
    let min_x = points.iter().map(|p| p.0).fold(f64::INFINITY, f64::min);
    let max_x = points.iter().map(|p| p.0).fold(f64::NEG_INFINITY, f64::max);
    let min_dx = (max_x - min_x) * 0.1;
    let mut slopes = Vec::new();
    for (index, a) in points.iter().enumerate() {
        for b in &points[index + 1..] {
            let dx = b.0 - a.0;
            if dx.abs() >= min_dx.max(f64::EPSILON) {
                slopes.push((b.1 - a.1) / dx);
            }
        }
    }
    if slopes.len() < 8 {
        return None;
    }
    let mut absolute = slopes.iter().map(|slope| slope.abs()).collect::<Vec<_>>();
    absolute.sort_by(f64::total_cmp);
    let bin_width = (absolute[absolute.len() / 2] * 0.05).clamp(0.5, 5.0);
    let mut votes = BTreeMap::<i64, usize>::new();
    for slope in &slopes {
        *votes.entry((slope / bin_width).round() as i64).or_default() += 1;
    }
    let winning_bin = votes
        .into_iter()
        .max_by(|a, b| a.1.cmp(&b.1).then_with(|| b.0.abs().cmp(&a.0.abs())))?
        .0;
    let centre = winning_bin as f64 * bin_width;
    let mut neighbourhood = slopes
        .into_iter()
        .filter(|slope| (*slope - centre).abs() <= bin_width)
        .collect::<Vec<_>>();
    neighbourhood.sort_by(f64::total_cmp);
    let slope = neighbourhood[neighbourhood.len() / 2];
    let mut intercepts = points
        .iter()
        .map(|pair| pair.1 - slope * pair.0)
        .collect::<Vec<_>>();
    intercepts.sort_by(f64::total_cmp);
    Some((slope, intercepts[intercepts.len() / 2]))
}
