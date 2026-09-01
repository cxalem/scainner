//! The four state dimensions of a hypothesis plus identity confidence, with
//! the transition rules as plain functions (protocol §3, §6; plan A3).
//!
//! Every enum round-trips through `as_str`/`parse` so the database stores
//! the protocol's vocabulary verbatim and the API speaks it unchanged.
//! Rules live here, not in SQL or in handlers, so the same check guards a
//! PATCH from an agent, a promotion from the correlation engine and a
//! future UI toggle.

use super::pack_ext::BandClasses;
use serde::{Deserialize, Serialize};

/// `app_settings` key holding the learning-state flag ("on" / "off").
pub const LEARNING_STATE_SETTING: &str = "learning_state";

/// `app_settings` key switching the automatic discovery run on connect
/// ("on" unless set to "off").
pub const AUTO_DISCOVERY_SETTING: &str = "auto_discovery";

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

/// What a caller offers in support of a knowledge-state promotion: the
/// verification runs whose discriminating result justifies the claim, and
/// what this vehicle has shown about the decode.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KnowledgeEvidence {
    pub run_ids: Vec<i64>,
    pub vehicle_fit: VehicleFit,
}

/// The knowledge rules (protocol §3, §4 S7). `knowledge_state` says what the
/// world knows, so one car may only raise it as far as that car can prove:
/// `locally_confirmed` needs a discriminating run on a decode this vehicle
/// matched, and the fleet states (`community_verified`, `oem_confirmed`) are
/// never settable from here — they arrive with a pack or through the inherit
/// path. Demotions stay allowed: a human may retract a claim, and the caller
/// then drops the evidence that backed it.
pub fn check_knowledge(
    from: KnowledgeState,
    to: KnowledgeState,
    evidence: &KnowledgeEvidence,
) -> Result<(), RuleViolation> {
    if from == to {
        return Ok(());
    }
    match to {
        KnowledgeState::LocallyConfirmed if evidence.vehicle_fit != VehicleFit::Matched => {
            Err(RuleViolation {
                rule: "locally_confirmed_requires_evidence",
                reason: format!(
                    "knowledge_state=locally_confirmed requires vehicle_fit=matched (current: {})",
                    evidence.vehicle_fit.as_str()
                ),
            })
        }
        KnowledgeState::LocallyConfirmed if evidence.run_ids.is_empty() => Err(RuleViolation {
            rule: "locally_confirmed_requires_evidence",
            reason: "knowledge_state=locally_confirmed requires at least one discriminating \
                     verification run in evidence_run_ids"
                .into(),
        }),
        KnowledgeState::CommunityVerified | KnowledgeState::OemConfirmed => Err(RuleViolation {
            rule: "fleet_state_not_settable_locally",
            reason: format!(
                "knowledge_state={} is fleet knowledge: it arrives with a pack or a second \
                 vehicle, never from a patch on this car",
                to.as_str()
            ),
        }),
        _ => Ok(()),
    }
}

/// The identity-confidence rule. `previous` is what the module last
/// answered and on which connection (None on the first read). Stable needs
/// the same material on an *independent* connection: a repeat inside the
/// same session only proves the ELM buffer, not the ECU.
pub fn next_identity_fit(
    current: Option<IdentityFit>,
    reads: i64,
    previous: Option<(&str, i64)>,
    new_hash: &str,
    connection_id: i64,
) -> (IdentityFit, i64) {
    let reads = reads.max(0) + 1;
    match (current, previous) {
        // Once conflicted, stays conflicted until a human clears it.
        (Some(IdentityFit::Conflicted), _) => (IdentityFit::Conflicted, reads),
        (_, Some((prev, _))) if prev != new_hash => (IdentityFit::Conflicted, reads),
        (Some(IdentityFit::Stable), Some(_)) => (IdentityFit::Stable, reads),
        (_, Some((_, prev_conn))) if prev_conn != connection_id => (IdentityFit::Stable, reads),
        (_, Some(_)) => (IdentityFit::Provisional, reads),
        (_, None) => (IdentityFit::Provisional, reads),
    }
}

/// Class filter for hypothesis persistence (protocol §4 S4): which answered
/// DIDs may become hypotheses at all. Identity/configuration material,
/// opaque blobs, serial-like strings and security-like blocks are never
/// sensors, so tracking them would only burn polling budget and invite the
/// correlation engine to fit noise.
///
/// The bands come from data (`pack_ext::band_classes_for_module`): the
/// brand's and the family's `hypothesis_exclude_bands` when declared, the
/// bands that hold the identity block's DIDs, and the bands in which the
/// pack binds only undecoded (configuration) material. In a config band
/// only short answers may become hypotheses — a module can keep 1–2-byte
/// measurements next to its configuration strings — while 3+-byte or
/// text answers are configuration-shaped and stay out.
pub fn is_hypothesis_candidate(
    did: u16,
    payload_len: usize,
    payload_sample: &[u8],
    classes: &BandClasses,
) -> bool {
    if payload_len == 0 {
        return false;
    }
    if classes.is_excluded(did) {
        return false;
    }
    if classes.is_config(did) && (payload_len >= 3 || looks_like_ascii_serial(payload_sample)) {
        return false;
    }
    // Security/checksum-like material: long blocks are never a live value.
    if payload_len >= 32 {
        return false;
    }
    if looks_like_ascii_serial(payload_sample) {
        return false;
    }
    // Opaque blobs: 16–31 bytes with (almost) every byte different. Shorter
    // blocks are left alone — six 2-byte measurements look "random" too.
    if (16..32).contains(&payload_len) && is_high_entropy(payload_sample) {
        return false;
    }
    true
}

/// Ten or more printable-ASCII bytes (NUL/space padding trimmed) of which at
/// least half are letters: a software identifier, a system name — never a
/// measurement. Digit-only strings are left to the band rules, because a
/// block of small 2-byte values sits in the printable range by accident.
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
    let letters = trimmed.iter().filter(|b| b.is_ascii_alphabetic()).count();
    trimmed.len() >= 10
        && trimmed.iter().all(|b| (0x20..=0x7E).contains(b))
        && letters * 2 >= trimmed.len()
}

/// At least 90 % distinct bytes — checksum or key material. An empty sample
/// (no payload retained) is never high-entropy: unknown is not excluded.
fn is_high_entropy(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return false;
    }
    let mut seen = [false; 256];
    let mut distinct = 0usize;
    for b in bytes {
        if !seen[*b as usize] {
            seen[*b as usize] = true;
            distinct += 1;
        }
    }
    distinct * 10 >= bytes.len() * 9
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

    /// Evidence helper for the knowledge rules: what a caller would send
    /// with the patch.
    fn evidence(run_ids: &[i64], vehicle_fit: VehicleFit) -> KnowledgeEvidence {
        KnowledgeEvidence {
            run_ids: run_ids.to_vec(),
            vehicle_fit,
        }
    }

    #[test]
    fn a_state_that_does_not_move_never_needs_evidence() {
        for state in KnowledgeState::ALL {
            assert!(
                check_knowledge(state, state, &evidence(&[], VehicleFit::Untested)).is_ok(),
                "{} should be allowed to stay put",
                state.as_str()
            );
        }
    }

    #[test]
    fn candidate_and_reported_states_need_no_evidence() {
        for to in [
            KnowledgeState::ResearchCandidate,
            KnowledgeState::CommunityReported,
            KnowledgeState::Inherited,
            KnowledgeState::ReachedOnVehicle,
            KnowledgeState::VerifiedOnVehicle,
        ] {
            assert!(
                check_knowledge(
                    KnowledgeState::Unknown,
                    to,
                    &evidence(&[], VehicleFit::Untested)
                )
                .is_ok(),
                "{} is not a confirmation",
                to.as_str()
            );
        }
    }

    #[test]
    fn locally_confirmed_needs_a_matched_fit_and_a_discriminating_run() {
        let from = KnowledgeState::Inherited;
        let to = KnowledgeState::LocallyConfirmed;
        // Nothing at all.
        let err = check_knowledge(from, to, &evidence(&[], VehicleFit::Untested)).unwrap_err();
        assert_eq!(err.rule, "locally_confirmed_requires_evidence");
        // A run, but this car never matched the decode.
        for fit in [
            VehicleFit::Untested,
            VehicleFit::Conflicted,
            VehicleFit::Insufficient,
        ] {
            let err = check_knowledge(from, to, &evidence(&[7], fit)).unwrap_err();
            assert_eq!(err.rule, "locally_confirmed_requires_evidence");
        }
        // Matched, but no run to point at.
        let err = check_knowledge(from, to, &evidence(&[], VehicleFit::Matched)).unwrap_err();
        assert_eq!(err.rule, "locally_confirmed_requires_evidence");
        // Both: the only way up.
        assert!(check_knowledge(from, to, &evidence(&[7], VehicleFit::Matched)).is_ok());
    }

    #[test]
    fn fleet_states_are_never_set_from_one_car() {
        for to in [
            KnowledgeState::CommunityVerified,
            KnowledgeState::OemConfirmed,
        ] {
            for from in [
                KnowledgeState::Unknown,
                KnowledgeState::Inherited,
                KnowledgeState::LocallyConfirmed,
            ] {
                let err =
                    check_knowledge(from, to, &evidence(&[7, 8], VehicleFit::Matched)).unwrap_err();
                assert_eq!(err.rule, "fleet_state_not_settable_locally");
            }
        }
    }

    #[test]
    fn a_demotion_is_always_allowed() {
        for to in [
            KnowledgeState::Unknown,
            KnowledgeState::ResearchCandidate,
            KnowledgeState::CommunityReported,
            KnowledgeState::Inherited,
        ] {
            assert!(check_knowledge(
                KnowledgeState::LocallyConfirmed,
                to,
                &evidence(&[], VehicleFit::Conflicted)
            )
            .is_ok());
        }
    }

    #[test]
    fn identity_is_provisional_until_an_independent_connection_repeats_it() {
        let (fit, reads) = next_identity_fit(None, 0, None, "h1", 1);
        assert_eq!((fit, reads), (IdentityFit::Provisional, 1));
        // Same connection: still provisional.
        let (fit, reads) = next_identity_fit(Some(fit), reads, Some(("h1", 1)), "h1", 1);
        assert_eq!((fit, reads), (IdentityFit::Provisional, 2));
        // A different connection with the same bytes: stable.
        let (fit, reads) = next_identity_fit(Some(fit), reads, Some(("h1", 1)), "h1", 2);
        assert_eq!((fit, reads), (IdentityFit::Stable, 3));
        // Stable stays stable on the same connection again.
        let (fit, reads) = next_identity_fit(Some(fit), reads, Some(("h1", 2)), "h1", 2);
        assert_eq!((fit, reads), (IdentityFit::Stable, 4));
    }

    #[test]
    fn identity_conflicts_on_a_mismatch_and_stays_conflicted() {
        let (fit, _) = next_identity_fit(Some(IdentityFit::Stable), 2, Some(("h1", 1)), "h2", 2);
        assert_eq!(fit, IdentityFit::Conflicted);
        let (fit, _) =
            next_identity_fit(Some(IdentityFit::Provisional), 1, Some(("h1", 1)), "h2", 1);
        assert_eq!(fit, IdentityFit::Conflicted);
        let (fit, reads) = next_identity_fit(Some(fit), 3, Some(("h2", 1)), "h2", 4);
        assert_eq!((fit, reads), (IdentityFit::Conflicted, 4));
        assert!(!fit.joinable());
        assert!(IdentityFit::Provisional.joinable());
    }

    #[test]
    fn class_filter_keeps_live_values_and_drops_identity_material() {
        // Band classes as data: an identity class and a config class
        // (what `pack_ext::band_classes_for_module` derives for a brand
        // whose pack binds only strings in `D6xx`/`D7xx`).
        let classes = BandClasses {
            exclude: Vec::new(),
            identity: vec![(0xF000, 0xF1FF)],
            config: vec![(0xD600, 0xD7FF)],
        };
        let candidate =
            |did, len, sample: &[u8]| is_hypothesis_candidate(did, len, sample, &classes);
        // Live data in a data band: wheel speed, a flag, a pressure.
        assert!(candidate(0xD400, 2, &[0x00, 0x00]));
        assert!(candidate(0xD406, 1, &[0x01]));
        assert!(candidate(0xD40C, 1, &[0x2E]));
        // Four-byte engine values (repeating bytes) pass too.
        assert!(candidate(0xD422, 4, &[0x00, 0x8C, 0x00, 0x8C]));
        // Identity band, always.
        assert!(!candidate(0xF080, 12, &[0x98; 12]));
        assert!(!candidate(0xF18C, 8, b"ABCD1234"));
        assert!(!candidate(0xF190, 2, &[0x00, 0x01]));
        // Config band: config-shaped answers out, short values in (a module
        // may keep 2-byte measurements there).
        assert!(!candidate(0xD619, 18, b"DSGiRESC00.1170001"));
        assert!(!candidate(0xD611, 10, b"0000178734"));
        assert!(!candidate(0xD701, 3, &[0x00, 0x0B, 0x40]));
        assert!(candidate(0xD622, 2, &[0x00, 0x07]));
        assert!(candidate(0xD612, 1, &[0x01]));
        assert!(candidate(0xD640, 2, &[]));
        // Serial-like ASCII outside the bands: ten+ printable with half letters.
        assert!(!candidate(0xD4F0, 14, b"DSGiRESCv1.170"));
        // Printable-range bytes that are really 2-byte values must pass.
        assert!(candidate(0xD4F1, 6, &[0x30, 0x41, 0x30, 0x42, 0x31, 0x43]));
        assert!(candidate(0xD4F2, 8, b"0102ABCD"));
        // Six 2-byte measurements are not a blob, whatever their entropy.
        assert!(candidate(
            0xD4F3,
            12,
            &[0x3A, 0x91, 0xC4, 0x07, 0xEE, 0x52, 0xB8, 0x1D, 0x6F, 0xA0, 0x29, 0xD3]
        ));
        // 18-byte blobs, every byte different. Out of band the entropy rule
        // catches them; in a config band the length does.
        let blob = [
            0x3A, 0x91, 0xC4, 0x07, 0xEE, 0x52, 0xB8, 0x1D, 0x6F, 0xA0, 0x29, 0xD3, 0x44, 0x5F,
            0x81, 0x9C, 0x02, 0xE7,
        ];
        assert!(!candidate(0xD636, 18, &blob));
        assert!(!candidate(0xD4F4, 18, &blob));
        // 16–31 bytes with repeats is not a blob.
        assert!(candidate(0xD4F5, 16, &[0x11; 16]));
        // 32+ bytes is security-like regardless of content.
        assert!(!candidate(0xD4F6, 32, &[0x11; 32]));
        // Empty answers are not hypotheses.
        assert!(!candidate(0xD4F7, 0, &[]));
        // No sample retained: unknown is not excluded on entropy.
        assert!(candidate(0xD4F8, 2, &[]));
        assert!(candidate(0xD4F9, 18, &[]));
        // A declared exclusion band (brand or family data) wins outright.
        let declared = BandClasses {
            exclude: vec![(0xD700, 0xD7FF)],
            ..BandClasses::default()
        };
        assert!(!is_hypothesis_candidate(0xD701, 1, &[0x01], &declared));
        assert!(is_hypothesis_candidate(0xD622, 3, &[0, 1, 2], &declared));
    }

    #[test]
    fn the_verified_brand_derives_the_same_classes_from_its_pack_bindings() {
        // The pack binds identity strings in the vendor identity band and
        // undecoded strings in the D6xx band of the verified brand, so the
        // derived classes reproduce the filter the vehicle evidence asked for.
        let vin = super::super::pack_ext::tests::verified_brand_vin();
        let classes = super::super::pack_ext::band_classes_for_module(
            crate::elm::uds_map::map(),
            Some(&vin),
            None,
        );
        assert!(!is_hypothesis_candidate(0xF080, 12, &[0x98; 12], &classes));
        assert!(!is_hypothesis_candidate(
            0xD619,
            18,
            b"DSGiRESC00.1170001",
            &classes
        ));
        assert!(!is_hypothesis_candidate(
            0xD636,
            12,
            &[0x3A, 0x91, 0xC4, 0x07, 0xEE, 0x52, 0xB8, 0x1D, 0x6F, 0xA0, 0x29, 0xD3],
            &classes
        ));
        assert!(is_hypothesis_candidate(0xD622, 2, &[0x00, 0x07], &classes));
        assert!(is_hypothesis_candidate(
            0xD4A0,
            3,
            &[0x12, 0x34, 0x00],
            &classes
        ));
    }
}
