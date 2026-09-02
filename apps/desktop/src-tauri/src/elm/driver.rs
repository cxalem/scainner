use super::transport::{self, AdapterProfile, TimingProfile, Transport, TransportInfo};
use std::time::Duration;

#[derive(Debug, thiserror::Error)]
pub enum ElmError {
    #[error("open failed: {0}")]
    Open(String),
    #[error("io: {0}")]
    Io(String),
    #[error("no response from ELM (link down?)")]
    NoResponse,
    #[error("handshake failed: {0}")]
    Handshake(String),
}

pub struct ElmDriver {
    transport: Box<dyn Transport>,
    timing: TimingProfile,
    banner: Option<String>,
    device_kind: Option<String>,
    extended_session_open: bool,
}

impl Drop for ElmDriver {
    fn drop(&mut self) {
        self.transport.close();
    }
}

impl ElmDriver {
    pub fn new(transport: Box<dyn Transport>, timing: TimingProfile) -> Self {
        Self {
            transport,
            timing,
            banner: None,
            device_kind: None,
            extended_session_open: false,
        }
    }

    pub fn open(profile: &AdapterProfile) -> Result<Self, ElmError> {
        Ok(Self::new(transport::open(profile)?, profile.timing))
    }

    pub fn cmd(&mut self, c: &str, timeout: Duration) -> Result<String, ElmError> {
        self.transport.cmd(c, self.timing.scale(timeout))
    }

    pub fn describe(&self) -> TransportInfo {
        let mut info = self.transport.describe();
        info.banner = self.banner.clone();
        info
    }

    pub fn device_kind(&self) -> String {
        self.device_kind
            .clone()
            .unwrap_or_else(|| "elm_unknown".to_string())
    }

    #[cfg(test)]
    pub fn from_replay_json(raw: &str) -> Result<Self, String> {
        let replay = transport::replay::Replay::from_json(raw)?;
        Ok(Self::new(Box::new(replay), TimingProfile::Default))
    }

    #[cfg(test)]
    pub fn assert_replay_complete(&self) {
        self.transport.assert_replay_complete();
    }

    pub(crate) fn extended_session_open(&self) -> bool {
        self.extended_session_open
    }

    pub(crate) fn set_extended_session_open(&mut self, open: bool) {
        self.extended_session_open = open;
    }

    pub fn reset_alive(probe: &Result<String, ElmError>) -> bool {
        match probe {
            Ok(r) => r.contains('>') && !r.to_ascii_uppercase().contains("ERROR"),
            Err(_) => false,
        }
    }

    fn first_line(raw: &str) -> Option<String> {
        raw.split(['\r', '\n'])
            .map(|l| l.trim().trim_end_matches('>').trim())
            .find(|l| !l.is_empty() && *l != "?" && !l.eq_ignore_ascii_case("OK"))
            .map(str::to_string)
    }

    pub fn init(&mut self) -> Result<String, ElmError> {
        let mut reset = None;
        for _ in 0..5 {
            let probe = self.cmd("ATZ", Duration::from_secs(6));
            if Self::reset_alive(&probe) {
                reset = probe.ok();
                break;
            }
            std::thread::sleep(self.timing.scale(Duration::from_millis(800)));
        }
        let reset = reset
            .ok_or_else(|| ElmError::Handshake("no prompt after ATZ (adapter silent)".into()))?;
        self.cmd("ATE0", Duration::from_secs(3))?;
        let ati = self.cmd("ATI", Duration::from_secs(3)).unwrap_or_default();
        let sti = self.cmd("STI", Duration::from_secs(3)).ok();
        let kind = transport::profile::device_kind_from_banner(&ati, sti.as_deref());
        let banner = Self::first_line(&ati)
            .or_else(|| sti.as_deref().and_then(Self::first_line))
            .or_else(|| {
                reset
                    .split(['\r', '\n'])
                    .map(str::trim)
                    .find(|l| l.contains("ELM"))
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "ELM327-compatible (no banner)".to_string());
        log::info!("adapter banner {banner:?} → device_kind {kind}");
        self.banner = Some(banner.clone());
        self.device_kind = Some(kind);
        self.cmd("ATSP0", Duration::from_secs(3))?;
        Ok(banner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TRANSPORT_FAILURES: &str =
        include_str!("../../tests/fixtures/elm/transport-failures.json");

    #[test]
    fn replay_preserves_transport_failure_categories_and_time_requirements() {
        let mut driver = ElmDriver::from_replay_json(TRANSPORT_FAILURES).unwrap();

        assert!(matches!(
            driver.cmd("NO_RESPONSE", Duration::from_secs(1)),
            Err(ElmError::NoResponse)
        ));
        assert!(matches!(
            driver.cmd("IO_FAILURE", Duration::from_secs(1)),
            Err(ElmError::Io(_))
        ));
        assert!(matches!(
            driver.cmd("HANDSHAKE_FAILURE", Duration::from_secs(1)),
            Err(ElmError::Handshake(_))
        ));
        assert!(matches!(
            driver.cmd("SLOW_RESPONSE", Duration::from_millis(999)),
            Err(ElmError::Handshake(_))
        ));
        driver.assert_replay_complete();
    }

    #[test]
    fn replay_rejects_out_of_order_commands() {
        let raw = r#"{
            "schema_version": 1,
            "name": "ordered",
            "contains_vehicle_identifiers": false,
            "steps": [{"command": "0101", "response": "41 01 00 00 00 00\\r>"}]
        }"#;
        let mut driver = ElmDriver::from_replay_json(raw).unwrap();
        let error = driver
            .cmd("03", Duration::from_secs(1))
            .expect_err("the wrong command must fail");
        assert!(error.to_string().contains("expected command"));
    }

    #[test]
    fn replay_rejects_unreviewed_vehicle_identifiers() {
        let raw = r#"{
            "schema_version": 1,
            "name": "unsafe capture",
            "contains_vehicle_identifiers": true,
            "steps": [{"command": "0902", "response": "REDACT ME"}]
        }"#;
        let error = ElmDriver::from_replay_json(raw)
            .err()
            .expect("privacy-marked fixture must be rejected");
        assert!(error.contains("vehicle identifiers"));
    }

    #[test]
    fn init_reads_the_banner_and_derives_device_kind() {
        let raw = r#"{
            "schema_version": 1,
            "name": "handshake",
            "contains_vehicle_identifiers": false,
            "steps": [
                {"command": "ATZ", "response": "\r\rELM327 v2.3\r\r>"},
                {"command": "ATE0", "response": "OK\r>"},
                {"command": "ATI", "response": "ELM327 v2.3\r>"},
                {"command": "STI", "response": "?\r>"},
                {"command": "ATSP0", "response": "OK\r>"}
            ]
        }"#;
        let mut driver = ElmDriver::from_replay_json(raw).unwrap();
        assert_eq!(driver.device_kind(), "elm_unknown", "before the handshake");
        assert_eq!(driver.init().unwrap(), "ELM327 v2.3");
        assert_eq!(driver.device_kind(), "elm327_v2.3");
        let info = driver.describe();
        assert_eq!(info.kind, "replay");
        assert_eq!(info.banner.as_deref(), Some("ELM327 v2.3"));
        driver.assert_replay_complete();
    }

    fn handshake(atz: &str, ati: &str, sti: &str) -> String {
        format!(
            r#"{{
            "schema_version": 1,
            "name": "handshake",
            "contains_vehicle_identifiers": false,
            "steps": [
                {{"command": "ATZ", "response": {atz}}},
                {{"command": "ATE0", "response": "OK\r>"}},
                {{"command": "ATI", "response": {ati}}},
                {{"command": "STI", "response": {sti}}},
                {{"command": "ATSP0", "response": "OK\r>"}}
            ]
        }}"#
        )
    }

    #[test]
    fn an_stn_style_banner_connects_and_identifies_the_chip() {
        let raw = handshake(
            r#""\r\rSTN1170 v4.0.1\r\r>""#,
            r#""ELM327 v1.3a\r>""#,
            r#""STN1170 v4.0.1\r>""#,
        );
        let mut driver = ElmDriver::from_replay_json(&raw).unwrap();
        assert_eq!(driver.init().unwrap(), "ELM327 v1.3a");
        assert_eq!(driver.device_kind(), "stn1170");
        driver.assert_replay_complete();
    }

    #[test]
    fn a_prompt_only_reset_is_alive_and_gets_a_generic_label() {
        let raw = handshake(r#""\r\r>""#, r#""?\r>""#, r#""?\r>""#);
        let mut driver = ElmDriver::from_replay_json(&raw).unwrap();
        assert_eq!(driver.init().unwrap(), "ELM327-compatible (no banner)");
        assert_eq!(driver.device_kind(), "elm_unknown");
        driver.assert_replay_complete();
    }

    #[test]
    fn a_reset_without_a_prompt_is_not_alive() {
        assert!(!ElmDriver::reset_alive(&Ok("ELM327 v1.5".into())));
        assert!(!ElmDriver::reset_alive(&Ok("BUS ERROR\r>".into())));
        assert!(!ElmDriver::reset_alive(&Err(ElmError::NoResponse)));
        assert!(ElmDriver::reset_alive(&Ok("\r\r>".into())));
        assert!(ElmDriver::reset_alive(&Ok("STN1170 v4.0.1\r\r>".into())));

        let raw = r#"{
            "schema_version": 1,
            "name": "silent adapter",
            "contains_vehicle_identifiers": false,
            "steps": [
                {"command": "ATZ", "error": "no_response"},
                {"command": "ATZ", "error": "no_response"},
                {"command": "ATZ", "error": "no_response"},
                {"command": "ATZ", "error": "no_response"},
                {"command": "ATZ", "error": "no_response"}
            ]
        }"#;
        let replay = transport::replay::Replay::from_json(raw).unwrap();
        let mut driver = ElmDriver::new(Box::new(replay), TimingProfile::Fast);
        let err = driver.init().unwrap_err();
        assert!(matches!(err, ElmError::Handshake(_)), "{err}");
        driver.assert_replay_complete();
    }

    #[test]
    fn the_slow_timing_profile_scales_every_timeout() {
        let raw = r#"{
            "schema_version": 1,
            "name": "slow timing",
            "contains_vehicle_identifiers": false,
            "steps": [{"command": "0100", "response": "41 00 BE 3E B8 11\r>", "minimum_timeout_ms": 2000}]
        }"#;
        let replay = transport::replay::Replay::from_json(raw).unwrap();
        let mut driver = ElmDriver::new(Box::new(replay), TimingProfile::Slow);
        assert!(driver.cmd("0100", Duration::from_secs(1)).is_ok());
    }
}
