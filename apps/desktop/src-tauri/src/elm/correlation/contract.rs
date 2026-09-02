use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Sample {
    pub ts_ms: i64,
    pub payload: Vec<u8>,
    pub refs: Vec<RefReading>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RefReading {
    pub key: String,
    pub value: f64,
    pub ts_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SiblingSnapshot {
    pub did: u16,
    pub ts_ms: i64,
    pub payload: Vec<u8>,
}

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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HypothesisInput {
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
    pub sentinels: Vec<String>,
    pub distinct_values: usize,
    pub rest_value: Option<Vec<u8>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Correlation {
    pub reference: String,
    pub r: f64,
    pub slope: f64,
    pub bias: f64,
    pub residual_sd: f64,
    pub lag_ms: i64,
    pub n: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Interpretation {
    pub label: String,
    pub decode: Option<InheritedDecode>,
    pub confidence: f64,
    pub evidence: Vec<String>,
    pub competing_with: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SideSplit {
    pub pair_a: Vec<u16>,
    pub pair_b: Vec<u16>,
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
    #[serde(default)]
    pub discriminating_test: Option<String>,
    pub samples_used: usize,
    pub notes: Vec<String>,
}
