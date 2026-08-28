//! Knowledge & state layer of the Universal Discovery Protocol: ECU-family
//! compatibility, the four state dimensions, hypotheses, the S3 join and the
//! coverage report (Track A, `docs/product/discovery-implementation-plan.md`),
//! plus the Phase 2 runtime pieces that turn pack data into behaviour
//! (multi-brand plan, `docs/product/multi-brand-implementation-plan.md`).
//! Consumes `elm::correlation::contract` for engine output; never
//! implements the engine.
//!
//! - `family`   — `CompatibilityKey` + `match_family` (protocol §2, L3)
//! - `state`    — the state enums, transition rules and the class filter
//! - `identity` — the identity-block fingerprint builder + confidence write-back
//! - `join`     — S3: families → inherited hypotheses, DIDs → unknown ones
//! - `coverage` — the coverage report (protocol §8) from data
//! - `pack_ext` — pack accessors beyond the frozen `uds_map.rs` contract
//! - `packs`    — overlay packs enumerated from `data/packs.json`
//! - `research` — untrusted research candidates used only to prioritize discovery
//! - `plan`     — the parked-verification plan generator
//! - `auto`     — the automatic census → identity → join → coverage run

pub mod auto;
pub mod coverage;
pub mod family;
pub mod identity;
pub mod join;
pub mod pack_ext;
pub mod packs;
pub mod plan;
pub mod research;
pub mod state;
