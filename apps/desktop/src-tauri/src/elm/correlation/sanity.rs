use super::contract::{
    ArrayMembership, Correlation, HypothesisInput, InheritedDecode, InheritedFit, Interpretation,
    Shape, Variability,
};
use super::events::EventSummary;
use super::fit::{decode_payload, decoded_reference_fits};

pub(crate) fn inherited_fit(
    input: &HypothesisInput,
    decode: &InheritedDecode,
    derived: &[super::contract::RefReading],
) -> InheritedFit {
    if input.samples.len() < 5
        || usize::from(decode.len) == 0
        || usize::from(decode.offset) + usize::from(decode.len)
            > input.samples.first().map_or(0, |s| s.payload.len())
    {
        return InheritedFit::Insufficient;
    }
    let fits = decoded_reference_fits(input, decode, derived);
    let Some(expected) = expected_reference(decode) else {
        return InheritedFit::Insufficient;
    };
    let fit = fits.iter().find(|fit| fit.reference == expected);
    let Some(fit) = fit else {
        return InheritedFit::Insufficient;
    };
    // A binary event can validate association and polarity, but not the
    // decoded signal's numeric scale. Never create a scale conflict from it.
    if expected == "braking" {
        return if fit.r >= 0.7 {
            InheritedFit::Matched { r: fit.r }
        } else {
            InheritedFit::Insufficient
        };
    }
    if fit.r.abs() >= 0.9 && (0.75..=1.25).contains(&fit.slope.abs()) {
        InheritedFit::Matched { r: fit.r }
    } else if fit.n >= 8 {
        InheritedFit::Conflicted {
            reason: format!(
                "expected decode did not reproduce {} (r={:.3}, slope={:.3}, n={})",
                fit.reference, fit.r, fit.slope, fit.n
            ),
        }
    } else {
        InheritedFit::Insufficient
    }
}

fn expected_reference(decode: &InheritedDecode) -> Option<&'static str> {
    let label = decode.label.to_ascii_lowercase();
    if label.contains("wheel speed") || label == "vehicle speed" {
        Some("speed")
    } else if label.contains("steering") || label.contains("pinion") {
        Some("steering_angle")
    } else if label.contains("voltage") || decode.unit.eq_ignore_ascii_case("v") {
        Some("voltage")
    } else if label.contains("brake pressure")
        || label.contains("brake pedal")
        || label.contains("brake switch")
    {
        Some("braking")
    } else {
        None
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn candidate_interpretations(
    input: &HypothesisInput,
    shape: &Shape,
    correlations: &[Correlation],
    array: Option<&ArrayMembership>,
    events: &EventSummary,
    depletion: bool,
    inherited_fit: Option<&InheritedFit>,
) -> (Vec<Interpretation>, Option<String>, Vec<String>) {
    let mut interpretations = Vec::new();
    let mut test = None;
    let mut notes = vec![format!(
        "{} samples, {} distinct payloads, {:?} variability",
        input.samples.len(),
        shape.distinct_values,
        shape.variability
    )];
    if shape.variability == Variability::Constant {
        return (
            interpretations,
            Some(
                "Capture while driving with varied speed, turns, braking, and lighting conditions."
                    .into(),
            ),
            vec!["No change was observed, so correlation cannot rank a semantic meaning.".into()],
        );
    }

    if let (Some(inherited), Some(fit)) = (&input.inherited, inherited_fit) {
        match fit {
            InheritedFit::Matched { r } => interpretations.push(Interpretation {
                label: inherited.label.clone(),
                decode: Some(inherited.clone()),
                confidence: 0.9,
                evidence: vec![format!(
                    "Inherited decode reproduced its expected reference (|r|={:.3}).",
                    r.abs()
                )],
                competing_with: Vec::new(),
            }),
            InheritedFit::Conflicted { reason } => notes.push(reason.clone()),
            InheritedFit::Insufficient => {
                notes.push("Inherited decode could not be tested with these references.".into())
            }
        }
    }

    let speed = correlations.iter().find(|fit| fit.reference == "speed");
    if let (Some(speed), Some(array)) = (speed, array) {
        if speed.r >= 0.98 && (94.0..=104.0).contains(&speed.slope) && array.group.len() == 4 {
            let discriminated = array.side_split.is_some();
            interpretations.push(Interpretation {
                label: "wheel speed ×0.01 km/h".into(),
                decode: Some(InheritedDecode {
                    label: "wheel speed ×0.01 km/h".into(),
                    offset: 0,
                    len: shape.len,
                    scale: 0.01,
                    bias: 0.0,
                    signed: false,
                    unit: "km/h".into(),
                }),
                confidence: if discriminated { 0.88 } else { 0.6 },
                evidence: vec![format!(
                    "Four consecutive equal-width DIDs track speed at slope {:.2} raw/km/h (r={:.3}).",
                    speed.slope, speed.r
                )],
                competing_with: vec!["vehicle speed".into()],
            });
            interpretations.push(Interpretation {
                label: "vehicle speed".into(),
                decode: None,
                confidence: 0.42,
                evidence: vec![format!("Tracks OBD speed strongly (r={:.3}).", speed.r)],
                competing_with: vec!["wheel speed ×0.01 km/h".into()],
            });
            if let Some(split) = &array.side_split {
                notes.push(format!(
                    "Cornering split: {:?} are outer/faster in left turns.",
                    split.outer_in_left_turn
                ));
            } else {
                test = Some("Capture sustained left and right turns with steering angle to separate wheel positions.".into());
            }
        }
    }

    let steering = correlations
        .iter()
        .find(|fit| fit.reference == "steering_angle");
    if let Some(fit) = steering.filter(|fit| fit.r.abs() >= 0.85) {
        if (9.0..=11.0).contains(&fit.slope.abs()) && shape.len == 2 {
            interpretations.push(Interpretation {
                label: "steering or pinion angle ×0.1°".into(),
                decode: Some(InheritedDecode {
                    label: "steering or pinion angle ×0.1°".into(),
                    offset: 0,
                    len: shape.len,
                    scale: 0.1,
                    bias: -fit.bias * 0.1,
                    signed: shape.signed_guess,
                    unit: "°".into(),
                }),
                confidence: 0.6,
                evidence: vec![format!(
                    "Raw value follows steering angle with slope {:.2}, bias {:.1}, r={:.3}.",
                    fit.slope, fit.bias, fit.r
                )],
                competing_with: vec!["steering wheel angle".into(), "pinion angle".into()],
            });
            test = Some("Hold both steering locks and compare zero/offset against a confirmed steering-angle reference.".into());
        } else if shape.len == 1 {
            interpretations.push(Interpretation {
                label: "steering torque or motor current".into(),
                decode: None,
                confidence: 0.45,
                evidence: vec![format!(
                    "Signed value follows steering direction (r={:.3}).",
                    fit.r
                )],
                competing_with: vec!["steering rate".into()],
            });
            test = Some("Hold the wheel against each lock, then release it, to separate torque/current from angle or rate.".into());
        }
    }
    if shape.len == 1 && shape.signed_guess {
        let (agree, compared) = input
            .samples
            .iter()
            .fold((0_usize, 0_usize), |acc, sample| {
                let angle = sample
                    .refs
                    .iter()
                    .find(|reading| reading.key == "steering_angle")
                    .map(|reading| reading.value);
                let value = decode_payload(&sample.payload, 0, 1, true);
                match (angle, value) {
                    (Some(angle), Some(value)) if angle.abs() > 10.0 && value != 0.0 => (
                        acc.0 + usize::from((angle > 0.0) == (value > 0.0)),
                        acc.1 + 1,
                    ),
                    _ => acc,
                }
            });
        if compared >= 8 && agree as f64 / compared as f64 >= 0.6 {
            interpretations.push(Interpretation {
                label: "steering torque or motor current".into(),
                decode: None,
                confidence: 0.45,
                evidence: vec![format!(
                    "Signed direction agrees with steering direction in {agree}/{compared} informative samples."
                )],
                competing_with: vec!["steering rate".into()],
            });
            test = Some("Hold the wheel against each lock, then release it, to separate torque/current from angle or rate.".into());
        }
    }

    if events.binary && events.transitions >= 3 {
        notes.push(format!(
            "Binary event has {} transitions and {} A→B→A cycles.",
            events.transitions, events.clean_aba
        ));
        if events.braking_r.is_some_and(|r| r >= 0.5) {
            interpretations.push(Interpretation {
                label: "brake pedal switch".into(),
                decode: None,
                confidence: 0.6,
                evidence: vec![format!(
                    "Binary state aligns with derived braking events (r={:.3}).",
                    events.braking_r.unwrap_or_default()
                )],
                competing_with: vec!["braking state".into()],
            });
            test = Some("Press and release the brake repeatedly while stationary (A→B→A).".into());
        } else {
            test = Some("Repeat candidate physical states in labelled A→B→A captures.".into());
        }
    }

    if !events.binary
        && events.braking_r.is_some_and(|r| r.abs() >= 0.35)
        && events.active_while_stationary
    {
        let r = events.braking_r.unwrap_or_default();
        interpretations.push(Interpretation {
            label: "brake pressure".into(),
            decode: None,
            confidence: 0.58,
            evidence: vec![format!(
                "Magnitude rises around braking (r={r:.3}) and is non-zero while stationary."
            )],
            competing_with: vec!["deceleration demand".into()],
        });
        interpretations.push(Interpretation {
            label: "deceleration demand".into(),
            decode: None,
            confidence: 0.5,
            evidence: vec!["Magnitude changes during braking phases.".into()],
            competing_with: vec!["brake pressure".into()],
        });
        test = Some("Apply and release the brake at several pressures while stationary, including one firm-pedal hold.".into());
    } else if !events.binary && interpretations.is_empty() && events.active_while_stationary {
        test = Some(
            "Capture a labelled stationary A→B→A intervention, then repeat while moving if safe."
                .into(),
        );
    }

    let engine_states = input
        .samples
        .iter()
        .flat_map(|sample| sample.refs.iter())
        .filter(|reading| reading.key == "engine_on" && reading.value.is_finite())
        .map(|reading| reading.value)
        .collect::<Vec<_>>();
    let rpm_values = input
        .samples
        .iter()
        .flat_map(|sample| sample.refs.iter())
        .filter(|reading| reading.key == "rpm" && reading.value.is_finite())
        .map(|reading| reading.value)
        .collect::<Vec<_>>();
    let explicit_off = !engine_states.is_empty() && engine_states.iter().all(|value| *value == 0.0);
    let rpm_off = !rpm_values.is_empty() && rpm_values.iter().all(|value| *value <= 100.0);
    let contradicts_off = engine_states.iter().any(|value| *value > 0.0)
        || rpm_values.iter().any(|value| *value > 100.0);
    let engine_off = (explicit_off || rpm_off) && !contradicts_off;
    let has_pedal = input.samples.iter().any(|sample| {
        sample
            .refs
            .iter()
            .any(|reading| reading.key == "brake_pedal" && reading.value > 0.0)
    });
    if depletion && engine_off && has_pedal {
        interpretations.push(Interpretation {
            label: "servo vacuum".into(),
            decode: None,
            confidence: 0.82,
            evidence: vec![
                "Value decreases monotonically during repeated engine-off pedal pumps and does not recover.".into(),
            ],
            competing_with: Vec::new(),
        });
        test = None;
    } else if interpretations.is_empty()
        && shape.len == 1
        && input.samples.iter().any(|sample| {
            sample
                .refs
                .iter()
                .any(|reading| reading.key == "steering_angle")
        })
    {
        test = Some(
            "Hold sustained left and right steering inputs, then release, and capture the recovery."
                .into(),
        );
    }

    (interpretations, test, notes)
}
