use std::process::Stdio;
use std::time::Duration;

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct PairedDevice {
    pub addr: String,
    pub name: String,
    pub connected: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct NearbyDevice {
    pub addr: String,
    pub name: Option<String>,
    pub paired: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PairFailure {
    PinRequired(String),
    Other(String),
}

pub const PIN_REQUIRED: &str = "pin_required";

impl PairFailure {
    pub fn message(&self) -> &str {
        match self {
            Self::PinRequired(message) | Self::Other(message) => message,
        }
    }
    pub fn is_pin_required(&self) -> bool {
        matches!(self, Self::PinRequired(_))
    }
}

impl std::fmt::Display for PairFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::PinRequired(message) => write!(f, "{PIN_REQUIRED}: {message}"),
            Self::Other(message) => f.write_str(message),
        }
    }
}

const PIN_WORDINGS: [&str; 3] = ["pin code", "passkey", "authentication failure"];

pub fn classify_pair_failure(detail: &str) -> PairFailure {
    let lower = detail.to_ascii_lowercase();
    if PIN_WORDINGS.iter().any(|wording| lower.contains(wording)) {
        PairFailure::PinRequired(detail.to_string())
    } else {
        PairFailure::Other(detail.to_string())
    }
}

pub const DISCOVER_SECONDS: std::ops::RangeInclusive<u8> = 3..=15;
pub const DEFAULT_DISCOVER_SECONDS: u8 = 8;

pub trait BluetoothControl: Send + Sync {
    fn connect(&self, addr: &str, port_path: &str) -> Result<(), String>;
    fn paired(&self) -> Vec<PairedDevice>;
    fn discover(&self, seconds: u8) -> Result<Vec<NearbyDevice>, String>;
    fn pair(&self, addr: &str, pin: Option<&str>) -> Result<(), PairFailure>;
}

pub fn platform() -> Box<dyn BluetoothControl> {
    #[cfg(test)]
    {
        // Tests never touch the radio because inquiry blocks for seconds and pairing opens a system dialog.
        return Box::new(Unsupported);
    }
    #[cfg(all(target_os = "macos", not(test)))]
    {
        Box::new(MacosBlueutil)
    }
    #[cfg(all(not(target_os = "macos"), not(test)))]
    {
        Box::new(Unsupported)
    }
}

#[cfg_attr(target_os = "macos", allow(dead_code))]
pub const MANUAL_PAIRING_REQUIRED: &str = "manual pairing required: automatic Bluetooth \
reconnection is only implemented on macOS; pair and connect the adapter in the system \
Bluetooth settings, then connect again";

#[cfg_attr(target_os = "macos", allow(dead_code))]
pub struct Unsupported;

impl BluetoothControl for Unsupported {
    fn connect(&self, _addr: &str, _port_path: &str) -> Result<(), String> {
        Err(MANUAL_PAIRING_REQUIRED.into())
    }
    fn paired(&self) -> Vec<PairedDevice> {
        Vec::new()
    }
    fn discover(&self, _seconds: u8) -> Result<Vec<NearbyDevice>, String> {
        Err(MANUAL_PAIRING_REQUIRED.into())
    }
    fn pair(&self, _addr: &str, _pin: Option<&str>) -> Result<(), PairFailure> {
        Err(PairFailure::Other(MANUAL_PAIRING_REQUIRED.into()))
    }
}

#[cfg_attr(test, allow(dead_code))]
pub struct MacosBlueutil;

#[cfg_attr(test, allow(dead_code))]
impl MacosBlueutil {
    fn command() -> std::process::Command {
        let path = if std::path::Path::new("/opt/homebrew/bin/blueutil").exists() {
            "/opt/homebrew/bin/blueutil"
        } else {
            "blueutil"
        };
        std::process::Command::new(path)
    }

    fn wait_for_port(port_path: &str, tries: u32, step: Duration) -> bool {
        for _ in 0..tries {
            if std::path::Path::new(port_path).exists() {
                return true;
            }
            std::thread::sleep(step);
        }
        false
    }
}

impl BluetoothControl for MacosBlueutil {
    fn connect(&self, addr: &str, port_path: &str) -> Result<(), String> {
        let out = Self::command()
            .args(["--connect", addr])
            .output()
            .map_err(|e| format!("blueutil not runnable (brew install blueutil): {e}"))?;
        log::info!(
            "blueutil --connect {addr}: code={:?} stderr={}",
            out.status.code(),
            String::from_utf8_lossy(&out.stderr).trim()
        );
        if !out.status.success() {
            return Err(format!(
                "blueutil --connect failed: {}",
                String::from_utf8_lossy(&out.stderr)
            ));
        }
        if Self::wait_for_port(port_path, 10, Duration::from_millis(500)) {
            return Ok(());
        }
        Err(format!(
            "serial port {port_path} did not appear after connect"
        ))
    }

    fn paired(&self) -> Vec<PairedDevice> {
        match Self::command().arg("--paired").output() {
            Ok(out) if out.status.success() => {
                parse_blueutil_paired(&String::from_utf8_lossy(&out.stdout))
            }
            other => {
                log::warn!(
                    "blueutil --paired unusable, treating this machine as having no paired devices: {}",
                    match other {
                        Ok(out) => String::from_utf8_lossy(&out.stderr).trim().to_string(),
                        Err(e) => e.to_string(),
                    }
                );
                Vec::new()
            }
        }
    }

    fn discover(&self, seconds: u8) -> Result<Vec<NearbyDevice>, String> {
        let seconds = seconds.clamp(*DISCOVER_SECONDS.start(), *DISCOVER_SECONDS.end());
        let out = Self::command()
            .args(["--inquiry", &seconds.to_string()])
            .output()
            .map_err(|e| format!("blueutil not runnable (brew install blueutil): {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "blueutil --inquiry failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
        let found = parse_inquiry(&String::from_utf8_lossy(&out.stdout));
        log::info!("blueutil --inquiry {seconds}: {} device(s)", found.len());
        Ok(found)
    }

    fn pair(&self, addr: &str, pin: Option<&str>) -> Result<(), PairFailure> {
        let mut command = Self::command();
        command.args(["--pair", addr]);
        if let Some(pin) = pin.map(str::trim).filter(|p| !p.is_empty()) {
            command.arg(pin);
        }
        // Closing stdin makes blueutil's interactive PIN prompt fail instead of hanging.
        let out = command.stdin(Stdio::null()).output().map_err(|e| {
            PairFailure::Other(format!(
                "blueutil not runnable (brew install blueutil): {e}"
            ))
        })?;
        log::info!(
            "blueutil pair {addr} (with pin: {}): code={:?}",
            pin.is_some(),
            out.status.code()
        );
        if out.status.success() {
            return Ok(());
        }
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let detail = if stderr.is_empty() { stdout } else { stderr };
        Err(classify_pair_failure(&if detail.is_empty() {
            format!("pairing {addr} failed")
        } else {
            format!("pairing {addr} failed: {detail}")
        }))
    }
}

pub fn parse_blueutil_paired(text: &str) -> Vec<PairedDevice> {
    text.lines()
        .filter_map(|line| {
            let addr = line
                .split(',')
                .next()?
                .trim()
                .strip_prefix("address:")?
                .trim()
                .to_ascii_lowercase();
            if addr.is_empty() {
                return None;
            }
            let name = line
                .split_once("name: \"")
                .and_then(|(_, rest)| rest.split('"').next())
                .unwrap_or("")
                .to_string();
            let connected = line
                .split(',')
                .any(|part| part.trim().starts_with("connected"));
            Some(PairedDevice {
                addr,
                name,
                connected,
            })
        })
        .collect()
}

pub fn parse_inquiry(text: &str) -> Vec<NearbyDevice> {
    text.lines()
        .filter_map(|line| {
            let addr = line
                .split(',')
                .next()?
                .trim()
                .strip_prefix("address:")?
                .trim()
                .to_ascii_lowercase();
            if addr.is_empty() {
                return None;
            }
            let name = line
                .split_once("name: \"")
                .and_then(|(_, rest)| rest.split('"').next())
                .map(str::trim)
                .filter(|n| !n.is_empty())
                .map(str::to_string);
            let paired = line.split(',').any(|part| part.trim() == "paired");
            Some(NearbyDevice { addr, name, paired })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_no_op_control_asks_for_manual_pairing_instead_of_shelling_out() {
        let control = Unsupported;
        let err = control.connect("aa-bb-cc-dd-ee-ff", "/dev/x").unwrap_err();
        assert!(err.starts_with("manual pairing required"));
        assert!(control.paired().is_empty());
    }

    #[test]
    fn the_no_op_control_refuses_to_scan_or_pair() {
        let control = Unsupported;
        assert!(control
            .discover(8)
            .unwrap_err()
            .starts_with("manual pairing required"));
        let failure = control.pair("aa-bb-cc-dd-ee-ff", Some("1234")).unwrap_err();
        assert!(failure.message().starts_with("manual pairing required"));
        assert!(
            !failure.is_pin_required(),
            "no scriptable stack is not a PIN prompt"
        );
    }

    #[test]
    fn blueutil_pin_prompts_are_told_apart_from_real_failures() {
        let prompt = "pairing aa-bb-cc-dd-ee-01 failed: Type pin code (up to 16 characters) \
                      for \"OBDII\" (aa-bb-cc-dd-ee-01) and press Enter:";
        assert_eq!(
            classify_pair_failure(prompt),
            PairFailure::PinRequired(prompt.to_string())
        );
        assert!(classify_pair_failure(
            "pairing aa-bb-cc-dd-ee-01 failed: Failed to pair \"OBDII\" with error 0x05 (Authentication Failure)"
        )
        .is_pin_required());
        assert!(classify_pair_failure("Input passkey 123456 on \"OBDII\"").is_pin_required());

        for detail in [
            "pairing aa-bb-cc-dd-ee-01 failed",
            "pairing aa-bb-cc-dd-ee-01 failed: Failed to start pairing with \"OBDII\"",
            "pairing aa-bb-cc-dd-ee-01 failed: Failed to pair \"OBDII\" with error 0x04 (Page Timeout)",
            "blueutil not runnable (brew install blueutil): No such file or directory",
        ] {
            assert!(
                !classify_pair_failure(detail).is_pin_required(),
                "{detail} is not a PIN request"
            );
        }
    }

    #[test]
    fn a_pin_request_carries_its_marker_into_the_error_string() {
        let failure = PairFailure::PinRequired("wants a pin code".into());
        assert_eq!(failure.to_string(), "pin_required: wants a pin code");
        assert!(failure.to_string().starts_with(PIN_REQUIRED));
        assert_eq!(
            PairFailure::Other("out of range".into()).to_string(),
            "out of range",
            "an ordinary failure is just its message"
        );
    }

    #[test]
    fn the_test_build_never_gets_a_control_that_shells_out() {
        assert!(platform().discover(3).is_err());
        assert!(platform().paired().is_empty());
    }

    #[test]
    fn blueutil_inquiry_output_is_parsed() {
        let text = "address: 00-04-3E-84-65-14, not connected, not favourite, not paired, name: \"Reader 49489\", recent access date: -\n\
                    address: aa-bb-cc-dd-ee-07, not connected, not favourite, not paired, recent access date: -\n\
                    address: aa-bb-cc-dd-ee-08, not connected, not favourite, paired, name: \"Headphones\", recent access date: 2026-08-31\n\
                    \n\
                    garbage line\n";
        let found = parse_inquiry(text);
        assert_eq!(found.len(), 3);

        assert_eq!(
            found[0].addr, "00-04-3e-84-65-14",
            "addresses are lowercased"
        );
        assert_eq!(found[0].name.as_deref(), Some("Reader 49489"));
        assert!(!found[0].paired);

        assert_eq!(found[1].name, None, "a radio with no name keeps none");
        assert!(!found[1].paired);

        assert!(found[2].paired, "`paired` is told apart from `not paired`");
        assert_eq!(found[2].name.as_deref(), Some("Headphones"));
    }

    #[test]
    fn blueutil_paired_output_is_parsed() {
        let text = "address: AA-BB-CC-DD-EE-01, connected (master, -60 dBm), not favourite, paired, name: \"OBDII\", recent access date: 2026-08-28\n\
                    address: aa-bb-cc-dd-ee-02, not connected, not favourite, paired, name: \"Keyboard\", recent access date: -\n\
                    garbage line\n";
        let devices = parse_blueutil_paired(text);
        assert_eq!(devices.len(), 2);
        assert_eq!(devices[0].addr, "aa-bb-cc-dd-ee-01");
        assert_eq!(devices[0].name, "OBDII");
        assert!(devices[0].connected);
        assert_eq!(devices[1].name, "Keyboard");
        assert!(!devices[1].connected);
    }
}
