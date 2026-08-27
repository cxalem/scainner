//! Correlation engine (Universal Discovery Protocol §6): turns raw hypothesis
//! samples into ranked, evidence-backed interpretations. Pure and
//! deterministic; owned by Track B (see
//! `docs/product/discovery-implementation-plan.md`). `contract.rs` is
//! frozen and shared with `elm::discovery`.

pub mod contract;

pub use contract::*;

/// Placeholder until the engine lands: reports the shape as unknown and no
/// interpretations, so callers can be wired and tested against the
/// contract before the algorithms exist.
pub fn analyze(input: &HypothesisInput) -> HypothesisReport {
    let len = input
        .samples
        .first()
        .map(|s| s.payload.len().min(u8::MAX as usize) as u8)
        .unwrap_or(0);
    HypothesisReport {
        module: input.module.clone(),
        did: input.did,
        shape: Shape {
            len,
            signed_guess: false,
            variability: Variability::Constant,
            sentinels: Vec::new(),
            distinct_values: 0,
            rest_value: None,
        },
        correlations: Vec::new(),
        interpretations: Vec::new(),
        array: None,
        inherited_fit: None,
        discriminating_test: None,
        samples_used: input.samples.len(),
        notes: vec!["correlation engine not implemented yet (scaffold)".into()],
    }
}
