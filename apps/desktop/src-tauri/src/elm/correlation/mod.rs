#![allow(dead_code)]

mod arrays;
pub mod contract;
mod events;
mod fit;
mod sanity;
mod shape;

pub use contract::*;

use arrays::detect_array;
use events::{derived_references, event_summary, monotonic_depletion};
use fit::{decode_payload, reference_fits};
use sanity::{candidate_interpretations, inherited_fit};
use shape::describe_shape;

pub fn analyze(input: &HypothesisInput) -> HypothesisReport {
    let (normalized, dropped_widths) = shape::normalize_width(input);
    let input = &normalized;
    let signed = shape::signed_guess(input);
    let values: Vec<f64> = input
        .samples
        .iter()
        .filter_map(|sample| decode_payload(&sample.payload, 0, sample.payload.len(), signed))
        .collect();
    let derived = derived_references(input);
    let correlations = reference_fits(input, signed, &derived);
    let array = detect_array(input);
    let events = event_summary(input, &values, &derived);
    let depletion = monotonic_depletion(&values);
    let shape = describe_shape(input, signed, &values, &events);
    let inherited_fit = input
        .inherited
        .as_ref()
        .map(|decode| inherited_fit(input, decode, &derived));
    let (mut interpretations, discriminating_test, mut notes) = candidate_interpretations(
        input,
        &shape,
        &correlations,
        array.as_ref(),
        &events,
        depletion,
        inherited_fit.as_ref(),
    );
    if dropped_widths > 0 {
        notes.push(format!(
            "Ignored {dropped_widths} samples whose payload width differed from the modal width."
        ));
    }
    notes.extend(shape::shape_notes(input, &shape));

    interpretations.sort_by(|a, b| {
        b.confidence
            .total_cmp(&a.confidence)
            .then_with(|| a.label.cmp(&b.label))
    });
    for interpretation in &mut interpretations {
        interpretation.evidence.sort();
        interpretation.evidence.dedup();
        interpretation.competing_with.sort();
        interpretation.competing_with.dedup();
    }
    let mut labels = std::collections::BTreeSet::new();
    interpretations.retain(|item| labels.insert(item.label.clone()));
    notes.sort();
    notes.dedup();

    HypothesisReport {
        module: input.module.clone(),
        did: input.did,
        shape,
        correlations,
        interpretations,
        array,
        inherited_fit,
        discriminating_test,
        samples_used: input.samples.len(),
        notes,
    }
}

#[cfg(test)]
mod tests;
