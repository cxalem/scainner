use super::driver::ElmDriver;
use super::operation;
use super::transport::bluetooth::BluetoothControl;
use super::transport::{AdapterKind, AdapterProfile};
use serde::Serialize;
use std::time::{Duration, Instant};

const LINK_SETTLE: Duration = Duration::from_secs(1);

const BUS_WAKE_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Stage {
    Link,
    Open,
    Handshake,
    Bus,
}

impl Stage {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Link => "link",
            Self::Open => "open",
            Self::Handshake => "handshake",
            Self::Bus => "bus",
        }
    }
}

impl std::fmt::Display for Stage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ConnectError {
    pub stage: Stage,
    pub reason: String,
}

impl ConnectError {
    pub fn new(stage: Stage, reason: impl Into<String>) -> Self {
        Self {
            stage,
            reason: reason.into(),
        }
    }
}

impl std::fmt::Display for ConnectError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "could not connect at {}: {}", self.stage, self.reason)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LinkAction {
    None,
    BluetoothConnect(String),
}

pub fn plan_link(
    profile: &AdapterProfile,
    port_exists: bool,
    reported_connected: Option<bool>,
) -> LinkAction {
    if profile.kind != AdapterKind::ElmSerial {
        return LinkAction::None;
    }
    let Some(addr) = profile
        .bt_addr
        .as_deref()
        .map(str::trim)
        .filter(|a| !a.is_empty())
    else {
        return LinkAction::None;
    };
    if reported_connected == Some(false) || !port_exists {
        return LinkAction::BluetoothConnect(addr.to_string());
    }
    LinkAction::None
}

pub fn reported_connected(bt: &dyn BluetoothControl, addr: &str) -> Option<bool> {
    let paired = bt.paired();
    if paired.is_empty() {
        return None;
    }
    Some(
        paired
            .iter()
            .any(|d| d.addr.eq_ignore_ascii_case(addr) && d.connected),
    )
}

fn bluetooth_unavailable(error: &str) -> bool {
    error.contains("not runnable") || error.starts_with("manual pairing required")
}

pub fn connect(
    profile: &AdapterProfile,
    bt: &dyn BluetoothControl,
    emit: &dyn Fn(Stage),
) -> Result<ElmDriver, ConnectError> {
    connect_with(profile, bt, emit, &mut |profile| {
        ElmDriver::open(profile).map_err(|e| e.to_string())
    })
}

pub(crate) fn connect_with(
    profile: &AdapterProfile,
    bt: &dyn BluetoothControl,
    emit: &dyn Fn(Stage),
    open: &mut dyn FnMut(&AdapterProfile) -> Result<ElmDriver, String>,
) -> Result<ElmDriver, ConnectError> {
    let started = stage_start(Stage::Link, emit);
    let port = profile.path.clone().unwrap_or_default();
    let port_exists = !port.is_empty() && std::path::Path::new(&port).exists();
    let reported = profile
        .bt_addr
        .as_deref()
        .and_then(|addr| reported_connected(bt, addr));
    match plan_link(profile, port_exists, reported) {
        LinkAction::None => {
            log::info!("connect stage link: nothing to bring up (port_exists={port_exists}, reported_connected={reported:?})");
        }
        LinkAction::BluetoothConnect(addr) => {
            log::info!("connect stage link: {addr} reports the link down or {port} is missing, bringing it up");
            match bt.connect(&addr, &port) {
                Ok(()) => std::thread::sleep(LINK_SETTLE),
                Err(e) if bluetooth_unavailable(&e) => {
                    log::info!(
                        "connect stage link: skipped, no Bluetooth control on this machine ({e})"
                    );
                }
                Err(e) => return Err(stage_failed(Stage::Link, e, started)),
            }
        }
    }
    stage_done(Stage::Link, started);

    let started = stage_start(Stage::Open, emit);
    let mut driver = match open(profile) {
        Ok(driver) => driver,
        Err(e) => return Err(stage_failed(Stage::Open, e, started)),
    };
    stage_done(Stage::Open, started);

    let started = stage_start(Stage::Handshake, emit);
    if let Err(e) = driver.init() {
        return Err(stage_failed(Stage::Handshake, e.to_string(), started));
    }
    stage_done(Stage::Handshake, started);

    let started = stage_start(Stage::Bus, emit);
    match driver.cmd("0100", BUS_WAKE_TIMEOUT) {
        Ok(raw) => log::info!("connect stage bus: 0100 answered {:?}", raw.trim()),
        Err(e) => return Err(stage_failed(Stage::Bus, e.to_string(), started)),
    }
    match operation::capture_link_state(&mut driver) {
        Some(state) => log::info!(
            "adapter protocol {} (functional header {})",
            state.protocol,
            state.header
        ),
        None => {
            log::warn!("ATDPN did not report a CAN protocol; cleanup falls back to auto-detect")
        }
    }
    stage_done(Stage::Bus, started);
    Ok(driver)
}

fn stage_start(stage: Stage, emit: &dyn Fn(Stage)) -> Instant {
    log::info!("connect stage {stage}: start");
    emit(stage);
    Instant::now()
}

fn stage_done(stage: Stage, started: Instant) {
    log::info!(
        "connect stage {stage}: ok in {} ms",
        started.elapsed().as_millis()
    );
}

fn stage_failed(stage: Stage, reason: impl Into<String>, started: Instant) -> ConnectError {
    let error = ConnectError::new(stage, reason);
    log::info!(
        "connect stage {stage}: failed after {} ms — {}",
        started.elapsed().as_millis(),
        error.reason
    );
    error
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::elm::transport::bluetooth::{NearbyDevice, PairFailure, PairedDevice};
    use std::sync::Mutex;

    #[derive(Default)]
    struct FakeBluetooth {
        paired: Vec<PairedDevice>,
        fail: Option<String>,
        calls: Mutex<Vec<String>>,
    }

    impl FakeBluetooth {
        fn with(addr: &str, connected: bool) -> Self {
            Self {
                paired: vec![PairedDevice {
                    addr: addr.into(),
                    name: "OBDII".into(),
                    connected,
                }],
                fail: None,
                calls: Mutex::new(Vec::new()),
            }
        }
        fn failing(addr: &str, error: &str) -> Self {
            Self {
                fail: Some(error.into()),
                ..Self::with(addr, false)
            }
        }
        fn calls(&self) -> Vec<String> {
            self.calls.lock().unwrap().clone()
        }
    }

    impl BluetoothControl for FakeBluetooth {
        fn connect(&self, addr: &str, _port_path: &str) -> Result<(), String> {
            self.calls.lock().unwrap().push(format!("connect {addr}"));
            match &self.fail {
                Some(error) => Err(error.clone()),
                None => Ok(()),
            }
        }
        fn paired(&self) -> Vec<PairedDevice> {
            self.paired.clone()
        }
        fn discover(&self, _seconds: u8) -> Result<Vec<NearbyDevice>, String> {
            self.calls.lock().unwrap().push("discover".into());
            Err("the connect pipeline must not scan".into())
        }
        fn pair(&self, addr: &str, _pin: Option<&str>) -> Result<(), PairFailure> {
            self.calls.lock().unwrap().push(format!("pair {addr}"));
            Err(PairFailure::Other(
                "the connect pipeline must not pair".into(),
            ))
        }
    }

    const ADDR: &str = "aa-bb-cc-dd-ee-ff";
    const EXISTING_PORT: &str = "/dev/null";
    const MISSING_PORT: &str = "/dev/scainner-no-such-port";

    fn bluetooth_profile() -> AdapterProfile {
        AdapterProfile {
            path: Some(EXISTING_PORT.into()),
            bt_addr: Some(ADDR.into()),
            ..Default::default()
        }
    }

    fn script(bus: &str) -> String {
        format!(
            r#"{{
            "schema_version": 1,
            "name": "connect pipeline",
            "contains_vehicle_identifiers": false,
            "steps": [
                {{"command": "ATZ", "response": "\r\rELM327 v2.3\r\r>"}},
                {{"command": "ATE0", "response": "OK\r>"}},
                {{"command": "ATI", "response": "ELM327 v2.3\r>"}},
                {{"command": "STI", "response": "?\r>"}},
                {{"command": "ATSP0", "response": "OK\r>"}},
                {bus}
            ]
        }}"#
        )
    }

    const ANSWERING_BUS: &str = r#"{"command": "0100", "response": "41 00 BE 3E B8 11\r>"},
                {"command": "ATDPN", "response": "A6\r>"}"#;

    fn run(
        profile: &AdapterProfile,
        bt: &FakeBluetooth,
        fixture: Option<&str>,
    ) -> (Vec<Stage>, Result<ElmDriver, ConnectError>, usize) {
        let stages = Mutex::new(Vec::new());
        let mut opens = 0usize;
        let result = {
            let mut open = |_: &AdapterProfile| match fixture {
                Some(raw) => {
                    opens += 1;
                    ElmDriver::from_replay_json(raw)
                }
                None => {
                    opens += 1;
                    Err("open /dev/cu.OBDII: Resource busy (os error 16)".to_string())
                }
            };
            connect_with(
                profile,
                bt,
                &|stage| stages.lock().unwrap().push(stage),
                &mut open,
            )
        };
        (stages.into_inner().unwrap(), result, opens)
    }

    #[test]
    fn plan_link_only_wakes_a_link_the_platform_reports_as_down() {
        let profile = bluetooth_profile();
        assert_eq!(plan_link(&profile, true, None), LinkAction::None);
        assert_eq!(plan_link(&profile, true, Some(true)), LinkAction::None);
        let wired = AdapterProfile {
            path: Some("/dev/ttyUSB0".into()),
            bt_addr: None,
            ..Default::default()
        };
        assert_eq!(plan_link(&wired, true, Some(false)), LinkAction::None);
        assert_eq!(plan_link(&wired, false, Some(false)), LinkAction::None);
        let network = AdapterProfile {
            kind: AdapterKind::TcpElm,
            host: Some("192.168.0.10".into()),
            bt_addr: Some(ADDR.into()),
            ..Default::default()
        };
        assert_eq!(plan_link(&network, false, Some(false)), LinkAction::None);

        assert_eq!(
            plan_link(&profile, true, Some(false)),
            LinkAction::BluetoothConnect(ADDR.into())
        );
        assert_eq!(
            plan_link(&profile, false, Some(true)),
            LinkAction::BluetoothConnect(ADDR.into())
        );
        assert_eq!(
            plan_link(&profile, false, None),
            LinkAction::BluetoothConnect(ADDR.into())
        );
    }

    #[test]
    fn a_clean_run_walks_the_four_stages_once_and_wakes_the_radio_once() {
        let _guard = operation::tests::LINK_TEST_LOCK
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        operation::set_link_state(None);
        let bt = FakeBluetooth::with(ADDR, false);
        let (stages, result, opens) = run(&bluetooth_profile(), &bt, Some(&script(ANSWERING_BUS)));
        let driver = result.expect("the recorded link answers every step");
        assert_eq!(
            stages,
            vec![Stage::Link, Stage::Open, Stage::Handshake, Stage::Bus]
        );
        assert_eq!(
            bt.calls(),
            vec![format!("connect {ADDR}")],
            "one wake, no ladder"
        );
        assert_eq!(opens, 1, "one open, no retries");
        assert_eq!(driver.describe().banner.as_deref(), Some("ELM327 v2.3"));
        assert_eq!(
            operation::link_state().map(|s| s.protocol),
            Some("6".to_string()),
            "the bus stage captures the protocol cleanup restores"
        );
        driver.assert_replay_complete();
        operation::set_link_state(None);
    }

    #[test]
    fn an_already_connected_link_is_left_alone() {
        let _guard = operation::tests::LINK_TEST_LOCK
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        operation::set_link_state(None);
        let bt = FakeBluetooth::with(ADDR, true);
        let (stages, result, opens) = run(&bluetooth_profile(), &bt, Some(&script(ANSWERING_BUS)));
        assert!(result.is_ok());
        assert_eq!(stages.len(), 4);
        assert!(bt.calls().is_empty(), "a live link must not be touched");
        assert_eq!(opens, 1);
        operation::set_link_state(None);
    }

    #[test]
    fn a_vanished_port_node_is_brought_back_even_when_the_link_reads_as_up() {
        let _guard = operation::tests::LINK_TEST_LOCK
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        operation::set_link_state(None);
        let profile = AdapterProfile {
            path: Some(MISSING_PORT.into()),
            ..bluetooth_profile()
        };
        let bt = FakeBluetooth::with(ADDR, true);
        let (_, result, _) = run(&profile, &bt, Some(&script(ANSWERING_BUS)));
        assert!(result.is_ok());
        assert_eq!(bt.calls(), vec![format!("connect {ADDR}")]);
        operation::set_link_state(None);
    }

    #[test]
    fn a_link_failure_stops_before_the_port_is_opened() {
        let bt = FakeBluetooth::failing(ADDR, "blueutil --connect failed: device not found");
        let (stages, result, opens) = run(&bluetooth_profile(), &bt, Some(&script(ANSWERING_BUS)));
        let error = result.err().expect("a dead radio cannot connect");
        assert_eq!(error.stage, Stage::Link);
        assert!(error.reason.contains("device not found"), "{error}");
        assert_eq!(stages, vec![Stage::Link], "no later stage may start");
        assert_eq!(opens, 0, "the port must not be opened after a link failure");
        assert_eq!(bt.calls().len(), 1, "one radio call, no retries");
    }

    #[test]
    fn a_machine_without_bluetooth_control_skips_the_link_stage_instead_of_failing() {
        let _guard = operation::tests::LINK_TEST_LOCK
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        operation::set_link_state(None);
        let bt = FakeBluetooth::failing(ADDR, "blueutil not runnable (brew install blueutil): x");
        let (stages, result, opens) = run(&bluetooth_profile(), &bt, Some(&script(ANSWERING_BUS)));
        assert!(result.is_ok(), "the port node may still be there");
        assert_eq!(stages.len(), 4);
        assert_eq!(opens, 1);
        operation::set_link_state(None);
    }

    #[test]
    fn an_open_failure_stops_before_the_handshake() {
        let bt = FakeBluetooth::with(ADDR, true);
        let (stages, result, opens) = run(&bluetooth_profile(), &bt, None);
        let error = result.err().expect("a busy port cannot be opened");
        assert_eq!(error.stage, Stage::Open);
        assert!(error.reason.contains("Resource busy"), "{error}");
        assert_eq!(stages, vec![Stage::Link, Stage::Open]);
        assert_eq!(opens, 1, "one open attempt, no ladder");
        assert!(bt.calls().is_empty());
    }

    #[test]
    fn a_handshake_failure_reports_the_adapters_own_silence() {
        let bt = FakeBluetooth::with(ADDR, true);
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
        let (stages, result, opens) = run(&bluetooth_profile(), &bt, Some(raw));
        let error = result.err().expect("a silent adapter cannot hand shake");
        assert_eq!(error.stage, Stage::Handshake);
        assert!(error.reason.contains("no prompt after ATZ"), "{error}");
        assert_eq!(stages, vec![Stage::Link, Stage::Open, Stage::Handshake]);
        assert_eq!(opens, 1, "a failed handshake must not reopen the port");
    }

    #[test]
    fn an_ignition_off_bus_connects_but_a_silent_one_does_not() {
        let _guard = operation::tests::LINK_TEST_LOCK
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        operation::set_link_state(None);
        let bt = FakeBluetooth::with(ADDR, true);

        let ignition_off = script(
            r#"{"command": "0100", "response": "UNABLE TO CONNECT\r>"},
                {"command": "ATDPN", "response": "?\r>"}"#,
        );
        let (stages, result, _) = run(&bluetooth_profile(), &bt, Some(&ignition_off));
        assert!(result.is_ok(), "ignition off is a normal state");
        assert_eq!(stages.len(), 4);

        let silent = script(r#"{"command": "0100", "error": "no_response"}"#);
        let (stages, result, _) = run(&bluetooth_profile(), &bt, Some(&silent));
        let error = result.err().expect("silence means the link is gone");
        assert_eq!(error.stage, Stage::Bus);
        assert_eq!(stages.len(), 4, "the bus stage started before it failed");
        operation::set_link_state(None);
    }

    #[test]
    fn the_crate_never_unpairs_or_re_pairs_a_radio() {
        let unpair = format!("--un{}", "pair");
        let pair = format!("\"--{}\"", "pair");
        fn walk(dir: &std::path::Path, hit: &mut impl FnMut(&std::path::Path, &str)) {
            for entry in std::fs::read_dir(dir).expect("the crate's own source") {
                let path = entry.expect("readable entry").path();
                if path.is_dir() {
                    walk(&path, hit);
                } else if path.extension().is_some_and(|e| e == "rs") {
                    let text = std::fs::read_to_string(&path).expect("readable source");
                    hit(&path, &text);
                }
            }
        }
        let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let (mut unpairs, mut pairs) = (Vec::new(), Vec::new());
        walk(&src, &mut |path, text| {
            if text.contains(&unpair) {
                unpairs.push(path.display().to_string());
            }
            if text.contains(&pair) {
                pairs.push(path.display().to_string());
            }
        });
        assert!(unpairs.is_empty(), "unpairing is back in {unpairs:?}");
        let stray: Vec<&String> = pairs
            .iter()
            .filter(|p| !p.ends_with("transport/bluetooth.rs"))
            .collect();
        assert!(
            stray.is_empty(),
            "pairing belongs to the user's Pair button only, not to {stray:?}"
        );
    }
}
