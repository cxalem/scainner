use super::driver::ElmDriver;
use super::parser;
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

/// Owns access to the ELM for one bounded diagnostic operation.
///
/// All vehicle-facing work goes through `driver()`. When the scope ends, Drop
/// closes an extended session only if we positively opened it, then restores
/// functional OBD addressing. This makes cleanup survive every `?`, early
/// return, cancellation, and future error branch without duplicating teardown.
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
        // harmless when unused and essential after probing a LIN child such
        // as PSA's CDPL rain/light sensor through its CAN gateway.
        let _ = self.driver.cmd("ATCEA", Duration::from_secs(2));
        let _ = self.driver.cmd("ATSP0", Duration::from_secs(2));
        let _ = self.driver.cmd("ATSH 7DF", Duration::from_secs(2));
        let _ = self.driver.cmd("ATAR", Duration::from_secs(2));
        let _ = self.driver.cmd("ATFCSM 0", Duration::from_secs(2));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleanup_runs_after_an_early_error() {
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
}
