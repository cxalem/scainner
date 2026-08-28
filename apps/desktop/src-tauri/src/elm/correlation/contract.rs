//! Frozen contract between the knowledge/state layer (`elm::discovery`) and
//! the correlation engine (`elm::correlation`). Plain data with serde in/out
//! and no dependency on the rest of the app, so the engine can be built and
//! replay-tested in isolation while the state layer persists and serves its
//! output. See `docs/product/universal-discovery-protocol.md` §6 and
//! `docs/product/discovery-implementation-plan.md`.
//!
//! Do not modify this file inside a track; propose changes in the track's
//! report.

use serde::{Deserialize, Serialize};

/// One raw observation of a hypothesis DID with the nearest reference
/// readings. Every reading carries its own timestamp because sequential
/// ELM reads are not synchronous; the engine models the lag.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Sample {
    /// When the DID read completed, milliseconds (monotonic within a fixture).
    pub ts_ms: i64,
    /// Complete application payload after the echoed identifier (`62 xx xx`).
    pub payload: Vec<u8>,
    /// Nearest standard-PID / probe readings around this sample.
    pub refs: Vec<RefReading>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RefReading {
    /// e.g. "speed" (km/h), "rpm", "coolant" (°C), "voltage" (V),
    /// "steering_angle" (°, + = left) — decoded values, not raw.
    pub key: String,
    pub value: f64,
    pub ts_ms: i64,
}

/// Same-module DIDs read in the same rounds, for array detection.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SiblingSnapshot {
    pub did: u16,
    pub ts_ms: i64,
    pub payload: Vec<u8>,
}

/// Expected decode when a compatible ECU family already taught us this DID.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InheritedDecode {
    pub label: String,
    pub offset: u8,
    pub len: u8,
    pub scale: f64,
    pub bias: f64,
    pub signed: bool,
    pub unit: String,
}

/// What the engine is asked about.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HypothesisInput {
    /// Route as "req/resp", e.g. "6AD/68D".
    pub module: String,
    pub did: u16,
    pub samples: Vec<Sample>,
    #[serde(default)]
    pub siblings: Vec<SiblingSnapshot>,
    #[serde(default)]
    pub inherited: Option<InheritedDecode>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Variability {
    Constant,
    Slow,
    Fast,
    EventLike,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Shape {
    pub len: u8,
    pub signed_guess: bool,
    pub variability: Variability,
    /// Sentinel values seen (e.g. "FF", "FFFF", "0FFE").
    pub sentinels: Vec<String>,
    pub distinct_values: usize,
    /// Most common payload while references say the car is at rest.
    pub rest_value: Option<Vec<u8>>,
}

/// One reference tried. Reported for every reference, not only the best.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Correlation {
    pub reference: String,
    pub r: f64,
    pub slope: f64,
    pub bias: f64,
    pub residual_sd: f64,
    /// Lag applied to the reference to maximise |r| (positive = DID lags reference).
    pub lag_ms: i64,
    pub n: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Interpretation {
    /// Candidate meaning, e.g. "wheel speed ×0.01 km/h".
    pub label: String,
    /// Proposed decode when the interpretation implies one.
    pub decode: Option<InheritedDecode>,
    /// 0..1. Above 0.6 only with discriminating evidence (protocol §6).
    pub confidence: f64,
    pub evidence: Vec<String>,
    /// Labels this one cannot be separated from with the data at hand.
    pub competing_with: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SideSplit {
    pub pair_a: Vec<u16>,
    pub pair_b: Vec<u16>,
    /// Which pair reads faster in left turns (outer side).
    pub outer_in_left_turn: Vec<u16>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ArrayMembership {
    pub group: Vec<u16>,
    pub index: usize,
    #[serde(default)]
    pub side_split: Option<SideSplit>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum InheritedFit {
    Matched { r: f64 },
    Conflicted { reason: String },
    Insufficient,
}

/// What the engine returns. Ranks; does not name (protocol §6).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HypothesisReport {
    pub module: String,
    pub did: u16,
    pub shape: Shape,
    pub correlations: Vec<Correlation>,
    pub interpretations: Vec<Interpretation>,
    #[serde(default)]
    pub array: Option<ArrayMembership>,
    #[serde(default)]
    pub inherited_fit: Option<InheritedFit>,
    /// The cheapest guided step that separates the top candidates.
    #[serde(default)]
    pub discriminating_test: Option<String>,
    pub samples_used: usize,
    /// Human-readable reasoning, one line each.
    pub notes: Vec<String>,
}
