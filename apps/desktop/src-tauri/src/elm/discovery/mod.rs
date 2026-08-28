//! Knowledge & state layer of the Universal Discovery Protocol: ECU-family
//! compatibility, the four state dimensions, hypotheses, the S3 join and the
//! coverage report. Owned by Track A (see
//! `docs/product/discovery-implementation-plan.md`). Consumes
//! `elm::correlation::contract` for engine output; never implements the
//! engine.
//!
//! - `family`   — `CompatibilityKey` + `match_family` (protocol §2, L3)
//! - `state`    — the state enums, transition rules and the class filter
//! - `identity` — identity confidence write-back (`record_identity`)
//! - `join`     — S3: families → inherited hypotheses, DIDs → unknown ones
//! - `coverage` — the coverage report (protocol §8) from data

pub mod coverage;
pub mod family;
pub mod identity;
pub mod join;
pub mod state;
