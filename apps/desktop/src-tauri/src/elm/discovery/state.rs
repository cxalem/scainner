//! The four state dimensions of a hypothesis plus identity confidence, with
//! the transition rules as plain functions (protocol §3, §6; plan A3).
//!
//! Every enum round-trips through `as_str`/`parse` so the database stores
//! the protocol's vocabulary verbatim and the API speaks it unchanged.
//! Rules live here, not in SQL or in handlers, so the same check guards a
//! PATCH from an agent, a promotion from the correlation engine and a
//! future UI toggle.

use serde::{Deserialize, Serialize};

/// `app_settings` key holding the learning-state flag ("on" / "off").
pub const LEARNING_STATE_SETTING: &str = "learning_state";

/// What the world knows about a decode — global knowledge, independent of
/// this car (the acquisition protocol's ladder, plus `inherited`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KnowledgeState {
    ResearchCandidate,
    CommunityReported,
    ReachedOnVehicle,
    VerifiedOnVehicle,
    Inherited,
    LocallyConfirmed,
    CommunityVerified,
    OemConfirmed,
    Unknown,
}

impl KnowledgeState {
    pub const ALL: [KnowledgeState; 9] = [
        Self::ResearchCandidate,
        Self::CommunityReported,
        Self::ReachedOnVehicle,
        Self::VerifiedOnVehicle,
        Self::Inherited,
        Self::LocallyConfirmed,
        Self::CommunityVerified,
        Self::OemConfirmed,
        Self::Unknown,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::ResearchCandidate => "research_candidate",
            Self::CommunityReported => "community_reported",
            Self::ReachedOnVehicle => "reached_on_vehicle",
            Self::VerifiedOnVehicle => "verified_on_vehicle",
            Self::Inherited => "inherited",
            Self::LocallyConfirmed => "locally_confirmed",
            Self::CommunityVerified => "community_verified",
            Self::OemConfirmed => "oem_confirmed",
            Self::Unknown => "unknown",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|k| k.as_str() == s.trim())
    }
}

/// What this vehicle has shown about the decode (protocol §6 step 7).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VehicleFit {
    Untested,
    Matched,
    Conflicted,
    Insufficient,
}

impl VehicleFit {
    pub const ALL: [VehicleFit; 4] = [
        Self::Untested,
        Self::Matched,
        Self::Conflicted,
        Self::Insufficient,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Untested => "untested",
            Self::Matched => "matched",
            Self::Conflicted => "conflicted",
            Self::Insufficient => "insufficient",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|k| k.as_str() == s.trim())
    }
}

/// Outcome of the route the hypothesis lives on (protocol §4 S1 taxonomy,
/// never collapsed). `closed` needs a recorded physical explanation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RouteState {
    Reached,
    Refused,
    Silent,
    TransportFailed,
    Closed,
}

impl RouteState {
    pub const ALL: [RouteState; 5] = [
        Self::Reached,
        Self::Refused,
        Self::Silent,
        Self::TransportFailed,
        Self::Closed,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Reached => "reached",
            Self::Refused => "refused",
            Self::Silent => "silent",
            Self::TransportFailed => "transport_failed",
            Self::Closed => "closed",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|k| k.as_str() == s.trim())
    }
}

/// Whether the supervisor may poll the hypothesis and show it as a sensor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Activation {
    /// Registered only; never read.
    Disabled,
    /// Polled during a learning drive to gather samples; never shown.
    Learning,
    /// Polled and shown as a sensor. Requires `VehicleFit::Matched`.
    Enabled,
}

impl Activation {
    pub const ALL: [Activation; 3] = [Self::Disabled, Self::Learning, Self::Enabled];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::Learning => "learning",
            Self::Enabled => "enabled",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|k| k.as_str() == s.trim())
    }
}

/// How much the module's identity can be trusted (protocol S2: "repeat once
/// for byte-identity before trusting").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IdentityFit {
    /// Read once; a join may proceed but is flagged.
    Provisional,
    /// Read at least twice, byte-identical.
    Stable,
    /// Two reads disagreed: the same route answered with different
    /// identity material. Not joined until a human looks.
    Conflicted,
}

impl IdentityFit {
    pub const ALL: [IdentityFit; 3] = [Self::Provisional, Self::Stable, Self::Conflicted];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Provisional => "provisional",
            Self::Stable => "stable",
            Self::Conflicted => "conflicted",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|k| k.as_str() == s.trim())
    }

    /// Whether the S3 join may use this module's fingerprint.
    pub fn joinable(self) -> bool {
        !matches!(self, Self::Conflicted)
    }
}

/// Why a requested transition is refused. Serialised as the 409 body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RuleViolation {
    pub rule: &'static str,
    pub reason: String,
}

/// The activation rules: `enabled` needs a decode this car has matched, and
/// `learning` needs the learning state to be switched on in `app_settings`.
pub fn check_activation(
    activation: Activation,
    vehicle_fit: VehicleFit,
    learning_on: bool,
) -> Result<(), RuleViolation> {
    match activation {
        Activation::Disabled => Ok(()),
        Activation::Learning if learning_on => Ok(()),
        Activation::Learning => Err(RuleViolation {
            rule: "learning_requires_learning_state",
            reason: format!(
                "activation=learning is only allowed while app_settings.{LEARNING_STATE_SETTING} is \"on\""
            ),
        }),
        Activation::Enabled if vehicle_fit == VehicleFit::Matched => Ok(()),
        Activation::Enabled => Err(RuleViolation {
            rule: "enabled_requires_matched",
            reason: format!(
                "activation=enabled requires vehicle_fit=matched (current: {})",
                vehicle_fit.as_str()
            ),
        }),
    }
}

/// The identity-confidence rule. `previous_hash` is what the module last
/// answered (None on the first read); returns the new fit and read count.
pub fn next_identity_fit(
    current: Option<IdentityFit>,
    reads: i64,
    previous_hash: Option<&str>,
    new_hash: &str,
) -> (IdentityFit, i64) {
    let reads = reads.max(0) + 1;
    match (current, previous_hash) {
        // Once conflicted, stays conflicted until a human clears it.
        (Some(IdentityFit::Conflicted), _) => (IdentityFit::Conflicted, reads),
        (_, Some(prev)) if prev == new_hash => (IdentityFit::Stable, reads),
        (_, Some(_)) => (IdentityFit::Conflicted, reads),
        (_, None) => (IdentityFit::Provisional, reads),
    }
}

/// Class filter for hypothesis persistence (protocol §4 S4): which answered
/// DIDs may become hypotheses at all. Identity/configuration material,
/// opaque blobs, serial-like strings and security-like blocks are never
/// sensors, so tracking them would only burn polling budget and invite the
/// correlation engine to fit noise.
///
/// Evidence behind the bands (C4 III, 2026-08-27): `F0xx`/`F1xx` are PSA and
/// ISO identity; the ABS `D6xx`/`D7xx` sweep returned only identifiers,
/// flags and 10–18-byte checksum/key blobs. The engine ECU does keep
/// measurements in `D6xx`; making the bands per-module data is a follow-up.
pub fn is_hypothesis_candidate(did: u16, payload_len: usize, payload_sample: &[u8]) -> bool {
    if payload_len == 0 {
        return false;
    }
    if (0xF000..=0xF1FF).contains(&did) || (0xD600..=0xD7FF).contains(&did) {
        return false;
    }
    // Security/checksum-like material: long blocks are never a live value.
    if payload_len >= 16 {
        return false;
    }
    if payload_sample.is_empty() {
        return payload_len < 10;
    }
    if looks_like_ascii_serial(payload_sample) {
        return false;
    }
    if payload_len >= 10 && is_high_entropy(payload_sample) {
        return false;
    }
    true
}

/// Six or more bytes, all printable ASCII (or NUL padding at the end), with
/// at least one letter or digit: a part number, a software identifier, a
/// serial — never a measurement.
fn looks_like_ascii_serial(bytes: &[u8]) -> bool {
    let trimmed: Vec<u8> = bytes
        .iter()
        .rev()
        .skip_while(|b| **b == 0 || **b == 0x20)
        .copied()
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    trimmed.len() >= 6
        && trimmed.iter().all(|b| (0x20..=0x7E).contains(b))
        && trimmed.iter().any(|b| b.is_ascii_alphanumeric())
}

/// Distinct-byte ratio as a cheap entropy proxy: a 10-byte checksum has
/// ~10 distinct values, a 10-byte measurement block repeats bytes.
fn is_high_entropy(bytes: &[u8]) -> bool {
    let mut seen = [false; 256];
    let mut distinct = 0usize;
    for b in bytes {
        if !seen[*b as usize] {
            seen[*b as usize] = true;
            distinct += 1;
        }
    }
    distinct * 10 >= bytes.len() * 7
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_state_round_trips_through_its_string() {
        for k in KnowledgeState::ALL {
            assert_eq!(KnowledgeState::parse(k.as_str()), Some(k));
        }
        for v in VehicleFit::ALL {
            assert_eq!(VehicleFit::parse(v.as_str()), Some(v));
        }
        for r in RouteState::ALL {
            assert_eq!(RouteState::parse(r.as_str()), Some(r));
        }
        for a in Activation::ALL {
            assert_eq!(Activation::parse(a.as_str()), Some(a));
        }
        for i in IdentityFit::ALL {
            assert_eq!(IdentityFit::parse(i.as_str()), Some(i));
        }
        assert_eq!(KnowledgeState::parse("bogus"), None);
        assert_eq!(
            serde_json::to_value(KnowledgeState::LocallyConfirmed).unwrap(),
            "locally_confirmed"
        );
    }

    #[test]
    fn enabled_requires_a_matched_decode() {
        assert!(check_activation(Activation::Enabled, VehicleFit::Matched, false).is_ok());
        for fit in [
            VehicleFit::Untested,
            VehicleFit::Conflicted,
            VehicleFit::Insufficient,
        ] {
            let err = check_activation(Activation::Enabled, fit, true).unwrap_err();
            assert_eq!(err.rule, "enabled_requires_matched");
        }
        assert!(check_activation(Activation::Disabled, VehicleFit::Conflicted, false).is_ok());
    }

    #[test]
    fn learning_only_inside_a_learning_state() {
        assert!(check_activation(Activation::Learning, VehicleFit::Untested, true).is_ok());
        let err = check_activation(Activation::Learning, VehicleFit::Matched, false).unwrap_err();
        assert_eq!(err.rule, "learning_requires_learning_state");
    }

    #[test]
    fn identity_is_provisional_then_stable_on_a_byte_identical_repeat() {
        let (fit, reads) = next_identity_fit(None, 0, None, "h1");
        assert_eq!((fit, reads), (IdentityFit::Provisional, 1));
        let (fit, reads) = next_identity_fit(Some(fit), reads, Some("h1"), "h1");
        assert_eq!((fit, reads), (IdentityFit::Stable, 2));
        let (fit, reads) = next_identity_fit(Some(fit), reads, Some("h1"), "h1");
        assert_eq!((fit, reads), (IdentityFit::Stable, 3));
    }

    #[test]
    fn identity_conflicts_on_a_mismatch_and_stays_conflicted() {
        let (fit, _) = next_identity_fit(Some(IdentityFit::Stable), 2, Some("h1"), "h2");
        assert_eq!(fit, IdentityFit::Conflicted);
        let (fit, reads) = next_identity_fit(Some(fit), 3, Some("h2"), "h2");
        assert_eq!((fit, reads), (IdentityFit::Conflicted, 4));
        assert!(!fit.joinable());
        assert!(IdentityFit::Provisional.joinable());
    }

    #[test]
    fn class_filter_keeps_live_values_and_drops_identity_material() {
        // The C4's ABS live data: wheel speed, a flag, a pressure.
        assert!(is_hypothesis_candidate(0xD400, 2, &[0x00, 0x00]));
        assert!(is_hypothesis_candidate(0xD406, 1, &[0x01]));
        assert!(is_hypothesis_candidate(0xD40C, 1, &[0x2E]));
        // Four-byte engine values (repeating bytes) pass too.
        assert!(is_hypothesis_candidate(
            0xD422,
            4,
            &[0x00, 0x8C, 0x00, 0x8C]
        ));
        // Identity / config bands.
        assert!(!is_hypothesis_candidate(0xF080, 12, &[0x98; 12]));
        assert!(!is_hypothesis_candidate(0xF18C, 8, b"ABCD1234"));
        assert!(!is_hypothesis_candidate(0xD619, 18, b"DSGiRESC00.1170001"));
        assert!(!is_hypothesis_candidate(0xD701, 3, &[0x00, 0x0B, 0x40]));
        // Serial-like ASCII outside the bands.
        assert!(!is_hypothesis_candidate(0xD4F0, 10, b"0000178734"));
        // Opaque high-entropy blob (checksum / key material).
        assert!(!is_hypothesis_candidate(
            0xD4F1,
            12,
            &[0x3A, 0x91, 0xC4, 0x07, 0xEE, 0x52, 0xB8, 0x1D, 0x6F, 0xA0, 0x29, 0xD3]
        ));
        // A 10-byte block that repeats bytes is still a candidate.
        assert!(is_hypothesis_candidate(
            0xD4F2,
            10,
            &[0x00, 0x10, 0x00, 0x10, 0x00, 0x10, 0x00, 0x10, 0x00, 0x11]
        ));
        // Security-like length.
        assert!(!is_hypothesis_candidate(0xD4F3, 16, &[0x11; 16]));
        // Empty answers are not hypotheses.
        assert!(!is_hypothesis_candidate(0xD4F4, 0, &[]));
        // No sample retained: short answers pass, long ones do not.
        assert!(is_hypothesis_candidate(0xD4F5, 2, &[]));
        assert!(!is_hypothesis_candidate(0xD4F6, 12, &[]));
    }
}
