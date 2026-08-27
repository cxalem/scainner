use super::contract::{HypothesisInput, RefReading};

#[derive(Debug, Default)]
pub(crate) struct EventSummary {
    pub binary: bool,
    pub transitions: usize,
    pub clean_aba: usize,
    pub braking_r: Option<f64>,
    pub active_while_stationary: bool,
}

pub(crate) fn derived_references(input: &HypothesisInput) -> Vec<RefReading> {
    let mut speeds = input
        .samples
        .iter()
        .flat_map(|sample| sample.refs.iter())
        .filter(|reading| reading.key == "speed")
        .cloned()
        .collect::<Vec<_>>();
    speeds.sort_by_key(|reading| reading.ts_ms);
    speeds.dedup_by_key(|reading| reading.ts_ms);
    let mut output = Vec::new();
    for (index, speed) in speeds.iter().enumerate() {
        output.push(RefReading {
            key: "stationary".into(),
            value: f64::from(speed.value.abs() < 0.5),
            ts_ms: speed.ts_ms,
        });
        let braking = if index == 0 {
            false
        } else {
            let previous = &speeds[index - 1];
            let seconds = (speed.ts_ms - previous.ts_ms) as f64 / 1000.0;
            seconds > 0.0 && (speed.value - previous.value) / 3.6 / seconds < -1.0
        };
        output.push(RefReading {
            key: "braking".into(),
            value: f64::from(braking),
            ts_ms: speed.ts_ms,
        });
    }
    let mut rpms = input
        .samples
        .iter()
        .flat_map(|sample| sample.refs.iter())
        .filter(|reading| reading.key == "rpm")
        .cloned()
        .collect::<Vec<_>>();
    rpms.sort_by_key(|reading| reading.ts_ms);
    rpms.dedup_by_key(|reading| reading.ts_ms);
    output.extend(rpms.into_iter().map(|rpm| RefReading {
        key: "engine_on".into(),
        value: f64::from(rpm.value > 100.0),
        ts_ms: rpm.ts_ms,
    }));
    output
}

pub(crate) fn event_summary(
    input: &HypothesisInput,
    values: &[f64],
    derived: &[RefReading],
) -> EventSummary {
    let mut distinct = values.to_vec();
    distinct.sort_by(f64::total_cmp);
    distinct.dedup_by(|a, b| (*a - *b).abs() < f64::EPSILON);
    let transitions = values.windows(2).filter(|p| p[0] != p[1]).count();
    let clean_aba = transitions / 2;
    let braking_r = ["braking", "brake_switch", "brake_pressure"]
        .into_iter()
        .filter_map(|key| {
            let readings = input
                .samples
                .iter()
                .flat_map(|sample| sample.refs.iter())
                .chain(derived.iter())
                .filter(|reading| reading.key == key)
                .collect::<Vec<_>>();
            let pairs = input
                .samples
                .iter()
                .zip(values.iter())
                .filter_map(|(sample, value)| {
                    readings
                        .iter()
                        .min_by_key(|reading| (reading.ts_ms - sample.ts_ms).abs())
                        .map(|reading| (reading.value, *value))
                })
                .collect::<Vec<_>>();
            pearson(&pairs)
        })
        .max_by(f64::total_cmp);
    let active_while_stationary = input.samples.iter().zip(values).any(|(sample, value)| {
        *value != 0.0
            && sample
                .refs
                .iter()
                .any(|reading| reading.key == "speed" && reading.value < 0.5)
    });
    EventSummary {
        binary: distinct.len() == 2,
        transitions,
        clean_aba,
        braking_r,
        active_while_stationary,
    }
}

fn pearson(pairs: &[(f64, f64)]) -> Option<f64> {
    if pairs.len() < 4 {
        return None;
    }
    let mx = pairs.iter().map(|p| p.0).sum::<f64>() / pairs.len() as f64;
    let my = pairs.iter().map(|p| p.1).sum::<f64>() / pairs.len() as f64;
    let sxx = pairs.iter().map(|p| (p.0 - mx).powi(2)).sum::<f64>();
    let syy = pairs.iter().map(|p| (p.1 - my).powi(2)).sum::<f64>();
    (sxx > 0.0 && syy > 0.0)
        .then(|| pairs.iter().map(|p| (p.0 - mx) * (p.1 - my)).sum::<f64>() / (sxx * syy).sqrt())
}

pub(crate) fn monotonic_depletion(values: &[f64]) -> bool {
    if values.len() < 8 {
        return false;
    }
    let decreases = values.windows(2).filter(|p| p[1] < p[0]).count();
    let increases = values.windows(2).filter(|p| p[1] > p[0]).count();
    let span = values[0] - values[values.len() - 1];
    let range = values.iter().copied().fold(f64::NEG_INFINITY, f64::max)
        - values.iter().copied().fold(f64::INFINITY, f64::min);
    span > 0.0 && range > 0.0 && increases == 0 && decreases >= 4 && span >= range * 0.9
}
