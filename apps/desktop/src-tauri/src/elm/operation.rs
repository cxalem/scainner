use super::driver::ElmDriver;
use super::parser;
use std::sync::Mutex;
use std::time::Duration;

/// Enter UDS extended diagnostics and record cleanup responsibility only after
/// the ECU confirms the transition.
pub fn enter_extended_session(driver: &mut ElmDriver) -> bool {
    if driver.extended_session_open() {
        return true;
    }
    let Ok(raw) = driver.cmd("1003", Duration::from_secs(2)) else {
        return false;
    };
    let lines = parser::clean_response(&raw);
    let bytes = parser::payload_bytes(&lines, "");
    let opened = bytes.windows(2).any(|window| window == [0x50, 0x03]);
    driver.set_extended_session_open(opened);
    opened
}

/// The adapter state standard OBD polling runs on, captured once the
/// connection handshake has auto-detected the bus (`ATDPN`): the protocol
/// number and the functional request header that goes with it. Cleanup
/// after every diagnostic operation restores exactly this, never a guessed
/// 11-bit default — on a 29-bit OBD side the functional id is different.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LinkState {
    /// `ATSP` argument: the protocol number as `ATDPN` reported it, with
    /// the `A` (auto) prefix dropped so the restore is deterministic.
    pub protocol: String,
    /// `ATSH` argument: the ISO 15765-4 functional request id of that
    /// protocol (`7DF` for 11-bit CAN, `18DB33F1` for 29-bit CAN).
    pub header: String,
}

impl LinkState {
    /// From an `ATDPN` answer (`A6`, `6`, `A7`, …). None for a non-CAN or
    /// unparseable answer: those buses are not what UDS operations run on,
    /// and restoring `ATSP0` (auto) is the honest fallback.
    pub fn from_atdpn(raw: &str) -> Option<Self> {
        let line = parser::clean_response(raw).into_iter().next()?;
        let protocol = line.trim().trim_start_matches(['A', 'a']).to_string();
        let header = match protocol.as_str() {
            "6" | "8" | "B" | "C" => "7DF",
            "7" | "9" => "18DB33F1",
            _ => return None,
        };
        Some(Self {
            protocol,
            header: header.into(),
        })
    }
}

static LINK_STATE: Mutex<Option<LinkState>> = Mutex::new(None);

/// Ask the adapter which protocol the handshake settled on and remember it
/// for cleanup. Called by the supervisor right after the `0100` wake-up.
pub fn capture_link_state(driver: &mut ElmDriver) -> Option<LinkState> {
    let state = driver
        .cmd("ATDPN", Duration::from_secs(2))
        .ok()
        .and_then(|raw| LinkState::from_atdpn(&raw));
    set_link_state(state.clone());
    state
}

pub fn set_link_state(state: Option<LinkState>) {
    *LINK_STATE.lock().unwrap_or_else(|p| p.into_inner()) = state;
}

pub fn link_state() -> Option<LinkState> {
    LINK_STATE.lock().unwrap_or_else(|p| p.into_inner()).clone()
}

/// Owns access to the ELM for one bounded diagnostic operation.
///
/// All vehicle-facing work goes through `driver()`. When the scope ends, Drop
/// closes an extended session only if we positively opened it, then restores
/// the adapter state captured at connect (or auto-detect when nothing was
/// captured). This makes cleanup survive every `?`, early return,
/// cancellation, and future error branch without duplicating teardown.
pub struct ScannerOperation<'a> {
    driver: &'a mut ElmDriver,
}

impl<'a> ScannerOperation<'a> {
    pub fn new(driver: &'a mut ElmDriver) -> Self {
        Self { driver }
    }

    pub fn driver(&mut self) -> &mut ElmDriver {
        self.driver
    }

    /// Request an extended session once. A refusal or transport failure leaves
    /// the operation in the default session and therefore sends no 10 01 later.
    pub fn enter_extended_session(&mut self) -> bool {
        enter_extended_session(self.driver)
    }

    /// Close the ECU session while its physical address is still selected.
    /// Discovery uses this before moving to another module; Drop remains the
    /// fallback if any branch exits first.
    pub fn close_extended_session(&mut self) {
        if self.driver.extended_session_open() {
            let _ = self.driver.cmd("1001", Duration::from_millis(800));
            self.driver.set_extended_session_open(false);
        }
    }
}

impl Drop for ScannerOperation<'_> {
    fn drop(&mut self) {
        self.close_extended_session();
        // Restore the adapter state expected by standard OBD polling. Cleanup
        // is best-effort: the original operation result must remain intact if
        // a disconnected adapter cannot acknowledge one of these commands.
        // ATCEA with no argument disables ISO-TP extended addressing. It is
        // harmless when unused and essential after probing a LIN child
        // through its CAN gateway.
        let _ = self.driver.cmd("ATCEA", Duration::from_secs(2));
        let (protocol, header) = match link_state() {
            Some(state) => (
                format!("ATSP{}", state.protocol),
                format!("ATSH {}", state.header),
            ),
            // Nothing captured (an operation before the handshake finished):
            // fall back to auto-detect and the 11-bit functional id.
            None => ("ATSP0".to_string(), "ATSH 7DF".to_string()),
        };
        let _ = self.driver.cmd(&protocol, Duration::from_secs(2));
        let _ = self.driver.cmd(&header, Duration::from_secs(2));
        let _ = self.driver.cmd("ATAR", Duration::from_secs(2));
        let _ = self.driver.cmd("ATFCSM 0", Duration::from_secs(2));
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// The link state is process-global; tests that touch it serialise here.
    pub(crate) static LINK_TEST_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn cleanup_runs_after_an_early_error() {
        let _guard = LINK_TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        set_link_state(None);
        let raw = r#"{
          "schema_version": 1,
          "name": "operation cleanup after error",
          "contains_vehicle_identifiers": false,
          "steps": [
            { "command": "22F190", "error": "io" },
            { "command": "ATCEA", "response": "OK\r>" },
            { "command": "ATSP0", "response": "OK\r>" },
            { "command": "ATSH 7DF", "response": "OK\r>" },
            { "command": "ATAR", "response": "OK\r>" },
            { "command": "ATFCSM 0", "response": "OK\r>" }
          ]
        }"#;
        let mut driver = ElmDriver::from_replay_json(raw).unwrap();
        {
            let mut operation = ScannerOperation::new(&mut driver);
            assert!(operation
                .driver()
                .cmd("22F190", Duration::from_secs(2))
                .is_err());
        }
        driver.assert_replay_complete();
    }

    #[test]
    fn only_a_confirmed_extended_session_is_closed() {
        let _guard = LINK_TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        set_link_state(None);
        let raw = r#"{
          "schema_version": 1,
          "name": "extended session cleanup",
          "contains_vehicle_identifiers": false,
          "steps": [
            { "command": "1003", "response": "50 03\r>" },
            { "command": "1001", "response": "50 01\r>" },
            { "command": "ATCEA", "response": "OK\r>" },
            { "command": "ATSP0", "response": "OK\r>" },
            { "command": "ATSH 7DF", "response": "OK\r>" },
            { "command": "ATAR", "response": "OK\r>" },
            { "command": "ATFCSM 0", "response": "OK\r>" }
          ]
        }"#;
        let mut driver = ElmDriver::from_replay_json(raw).unwrap();
        {
            let mut operation = ScannerOperation::new(&mut driver);
            assert!(operation.enter_extended_session());
        }
        driver.assert_replay_complete();
    }

    #[test]
    fn a_refused_session_is_not_closed() {
        let _guard = LINK_TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        set_link_state(None);
        let raw = r#"{
          "schema_version": 1,
          "name": "refused session cleanup",
          "contains_vehicle_identifiers": false,
          "steps": [
            { "command": "1003", "response": "7F 10 12\r>" },
            { "command": "ATCEA", "response": "OK\r>" },
            { "command": "ATSP0", "response": "OK\r>" },
            { "command": "ATSH 7DF", "response": "OK\r>" },
            { "command": "ATAR", "response": "OK\r>" },
            { "command": "ATFCSM 0", "response": "OK\r>" }
          ]
        }"#;
        let mut driver = ElmDriver::from_replay_json(raw).unwrap();
        {
            let mut operation = ScannerOperation::new(&mut driver);
            assert!(!operation.enter_extended_session());
        }
        driver.assert_replay_complete();
    }

    #[test]
    fn cleanup_restores_the_protocol_and_header_captured_at_connect() {
        let _guard = LINK_TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        // A 29-bit OBD side: the handshake settled on protocol 7 (auto), so
        // cleanup must restore ATSP7 and the 29-bit functional id, never
        // an 11-bit 7DF.
        let raw = r#"{
          "schema_version": 1,
          "name": "captured link state restore",
          "contains_vehicle_identifiers": false,
          "steps": [
            { "command": "ATDPN", "response": "A7\r>" },
            { "command": "ATCEA", "response": "OK\r>" },
            { "command": "ATSP7", "response": "OK\r>" },
            { "command": "ATSH 18DB33F1", "response": "OK\r>" },
            { "command": "ATAR", "response": "OK\r>" },
            { "command": "ATFCSM 0", "response": "OK\r>" }
          ]
        }"#;
        let mut driver = ElmDriver::from_replay_json(raw).unwrap();
        let captured = capture_link_state(&mut driver).expect("CAN protocol");
        assert_eq!(captured.protocol, "7");
        assert_eq!(captured.header, "18DB33F1");
        {
            let _operation = ScannerOperation::new(&mut driver);
        }
        driver.assert_replay_complete();
        set_link_state(None);
        assert_eq!(LinkState::from_atdpn("A6\r>").unwrap().header, "7DF");
        assert_eq!(LinkState::from_atdpn("8\r>").unwrap().protocol, "8");
        assert!(
            LinkState::from_atdpn("A3\r>").is_none(),
            "ISO 9141 is not a UDS side"
        );
        assert!(LinkState::from_atdpn("?\r>").is_none());
    }
}
