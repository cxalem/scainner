use super::contract::{
    ArrayMembership, Correlation, HypothesisInput, InheritedDecode, InheritedFit, Interpretation,
    Shape, Variability,
};
use super::events::EventSummary;
use super::fit::{decode_payload, decoded_reference_fits};
use serde::Deserialize;
use std::sync::OnceLock;

const SCALE_CATALOG_RAW: &str =
    include_str!("../../../../../../packages/uds-map/data/scale_catalog.json");

#[derive(Deserialize)]
struct ScaleCatalog {
    quantities: Vec<QuantityScales>,
}

#[derive(Deserialize)]
pub(crate) struct QuantityScales {
    pub quantity: String,
    pub reference: String,
    pub units: Vec<String>,
    pub slope_tolerance: f64,
    pub candidates: Vec<ScaleCandidate>,
}

#[derive(Deserialize)]
pub(crate) struct ScaleCandidate {
    pub scale: f64,
    pub unit: String,
    pub label: String,
    pub widths: Vec<u8>,
}

impl QuantityScales {
    pub fn candidate_for(&self, slope: f64, width: u8) -> Option<&ScaleCandidate> {
        self.candidates.iter().find(|c| {
            let expected = 1.0 / c.scale;
            c.widths.contains(&width)
                && ((slope.abs() - expected) / expected).abs() <= self.slope_tolerance
        })
    }
}

pub(crate) fn scale_catalog() -> &'static [QuantityScales] {
    static CATALOG: OnceLock<ScaleCatalog> = OnceLock::new();
    &CATALOG
        .get_or_init(|| {
            serde_json::from_str(SCALE_CATALOG_RAW).expect("data/scale_catalog.json is malformed")
        })
        .quantities
}

pub(crate) fn quantity_for_unit(unit: &str) -> Option<&'static QuantityScales> {
    let unit = unit.trim();
    if unit.is_empty() {
        return None;
    }
    scale_catalog()
        .iter()
        .find(|q| q.units.iter().any(|u| u.eq_ignore_ascii_case(unit)))
}

fn quantity(name: &str) -> Option<&'static QuantityScales> {
    scale_catalog().iter().find(|q| q.quantity == name)
}

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
    quantity_for_unit(&decode.unit).map(|q| q.reference.as_str())
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

    let speed_quantity = quantity("speed");
    let speed = correlations.iter().find(|fit| fit.reference == "speed");
    if let (Some(speed), Some(array), Some(q)) = (speed, array, speed_quantity) {
        if let Some(candidate) = q
            .candidate_for(speed.slope, shape.len)
            .filter(|_| speed.r >= 0.98 && array.group.len() == 4)
        {
            let discriminated = array.side_split.is_some();
            interpretations.push(Interpretation {
                label: candidate.label.clone(),
                decode: Some(InheritedDecode {
                    label: candidate.label.clone(),
                    offset: 0,
                    len: shape.len,
                    scale: candidate.scale,
                    bias: 0.0,
                    signed: false,
                    unit: candidate.unit.clone(),
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
                competing_with: vec![candidate.label.clone()],
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

    let angle_quantity = quantity("angle");
    let steering = correlations
        .iter()
        .find(|fit| fit.reference == "steering_angle");
    if let Some(fit) = steering.filter(|fit| fit.r.abs() >= 0.85) {
        let candidate = angle_quantity
            .and_then(|q| q.candidate_for(fit.slope, shape.len))
            .filter(|_| shape.len == 2);
        if let Some(candidate) = candidate {
            interpretations.push(Interpretation {
                label: candidate.label.clone(),
                decode: Some(InheritedDecode {
                    label: candidate.label.clone(),
                    offset: 0,
                    len: shape.len,
                    scale: candidate.scale,
                    bias: -fit.bias * candidate.scale,
                    signed: shape.signed_guess,
                    unit: candidate.unit.clone(),
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

#[cfg(test)]
mod catalog_tests {
    use super::*;

    #[test]
    fn the_catalog_parses_and_maps_units_to_references() {
        assert_eq!(quantity_for_unit("km/h").unwrap().reference, "speed");
        assert_eq!(quantity_for_unit("MPH").unwrap().reference, "speed");
        assert_eq!(quantity_for_unit("°").unwrap().reference, "steering_angle");
        assert_eq!(quantity_for_unit("V").unwrap().reference, "voltage");
        assert_eq!(quantity_for_unit("bar").unwrap().reference, "braking");
        assert_eq!(quantity_for_unit("hPa").unwrap().reference, "braking");
        assert_eq!(quantity_for_unit("flag").unwrap().reference, "braking");
        assert!(quantity_for_unit("°C").is_none());
        assert!(quantity_for_unit("").is_none());
    }

    #[test]
    fn candidates_match_slopes_within_tolerance_per_width() {
        let speed = quantity("speed").unwrap();
        assert_eq!(speed.candidate_for(99.0, 2).unwrap().scale, 0.01);
        assert_eq!(speed.candidate_for(16.0, 2).unwrap().scale, 0.0625);
        assert_eq!(speed.candidate_for(1.0, 1).unwrap().scale, 1.0);
        assert!(speed.candidate_for(50.0, 2).is_none(), "no listed scale");
        assert!(
            speed.candidate_for(99.0, 1).is_none(),
            "width not plausible"
        );
        let angle = quantity("angle").unwrap();
        assert_eq!(angle.candidate_for(-10.4, 2).unwrap().scale, 0.1);
        assert!(angle.candidate_for(4.0, 2).is_none());
    }
}
