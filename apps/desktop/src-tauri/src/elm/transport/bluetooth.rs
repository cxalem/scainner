//! Platform Bluetooth control for classic-Bluetooth (SPP) adapters.
//!
//! Empirically established with a real dongle (2026-08-14): the RFCOMM link
//! drops when the port closes; a disconnect/connect cycle revives it and
//! recreates the serial node if it vanished after an unpair. The dongle
//! also periodically stops answering on an existing pairing ("sulk mode")
//! and only a fresh PIN pairing wakes it — the `repair` step.
//!
//! The PIN is **not standardized** across ELM327 clones: `1234` covers most
//! of them, `0000` / `1111` / `6789` the rest. It lives in the adapter
//! profile (`adapter.pin`), never in code.

use std::time::Duration;

/// The paired-device view the settings UI enumerates from.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct PairedDevice {
    /// Dashed lower-case MAC, e.g. `aa-bb-cc-dd-ee-ff`.
    pub addr: String,
    pub name: String,
    pub connected: bool,
}

pub trait BluetoothControl: Send + Sync {
    /// Disconnect/connect cycle; waits for `port_path` to (re)appear.
    fn cycle(&self, addr: &str, port_path: &str) -> Result<(), String>;
    /// unpair → pair with `pin` → connect → wait for `port_path`.
    fn repair(&self, addr: &str, pin: &str, port_path: &str) -> Result<(), String>;
    /// Paired devices, empty where the platform offers no enumeration.
    fn paired(&self) -> Vec<PairedDevice>;
}

/// The control implementation for this build's platform.
pub fn platform() -> Box<dyn BluetoothControl> {
    #[cfg(target_os = "macos")]
    {
        Box::new(MacosBlueutil)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Box::new(Unsupported)
    }
}

#[cfg_attr(target_os = "macos", allow(dead_code))]
pub const MANUAL_PAIRING_REQUIRED: &str = "manual pairing required: automatic Bluetooth \
reconnection is only implemented on macOS; pair and connect the adapter in the system \
Bluetooth settings, then connect again";

/// Platforms without a scripted Bluetooth stack: never shell out, just say
/// what the user has to do by hand.
#[cfg_attr(target_os = "macos", allow(dead_code))]
pub struct Unsupported;

impl BluetoothControl for Unsupported {
    fn cycle(&self, _addr: &str, _port_path: &str) -> Result<(), String> {
        Err(MANUAL_PAIRING_REQUIRED.into())
    }
    fn repair(&self, _addr: &str, _pin: &str, _port_path: &str) -> Result<(), String> {
        Err(MANUAL_PAIRING_REQUIRED.into())
    }
    fn paired(&self) -> Vec<PairedDevice> {
        Vec::new()
    }
}

/// macOS via `blueutil` (Homebrew).
pub struct MacosBlueutil;

impl MacosBlueutil {
    fn command() -> std::process::Command {
        // Homebrew path first; fall back to PATH.
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
    fn cycle(&self, addr: &str, port_path: &str) -> Result<(), String> {
        let disc = Self::command().args(["--disconnect", addr]).output();
        log::trace!(
            "blueutil --disconnect: {:?}",
            disc.as_ref().map(|o| o.status.code())
        );
        std::thread::sleep(Duration::from_secs(1));
        let out = Self::command()
            .args(["--connect", addr])
            .output()
            .map_err(|e| format!("blueutil not runnable (brew install blueutil): {e}"))?;
        log::trace!(
            "blueutil --connect: code={:?} stderr={}",
            out.status.code(),
            String::from_utf8_lossy(&out.stderr).trim()
        );
        if !out.status.success() {
            return Err(format!(
                "blueutil --connect failed: {}",
                String::from_utf8_lossy(&out.stderr)
            ));
        }
        // Give macOS a moment to (re)create the serial node.
        if Self::wait_for_port(port_path, 10, Duration::from_millis(500)) {
            return Ok(());
        }
        Err(format!(
            "serial port {port_path} did not appear after connect"
        ))
    }

    fn repair(&self, addr: &str, pin: &str, port_path: &str) -> Result<(), String> {
        let un = Self::command().args(["--unpair", addr]).output();
        log::debug!("blueutil --unpair: {:?}", un.map(|o| o.status.code()));
        std::thread::sleep(Duration::from_secs(2));
        let pair = Self::command()
            .args(["--pair", addr, pin])
            .output()
            .map_err(|e| format!("blueutil not runnable (brew install blueutil): {e}"))?;
        log::debug!(
            "blueutil --pair: code={:?} stderr={}",
            pair.status.code(),
            String::from_utf8_lossy(&pair.stderr).trim()
        );
        if !pair.status.success() {
            return Err(
                "PIN pairing failed — is the adapter powered, and is adapter.pin right?".into(),
            );
        }
        std::thread::sleep(Duration::from_secs(1));
        let conn = Self::command().args(["--connect", addr]).output();
        log::debug!(
            "blueutil --connect (post-pair): {:?}",
            conn.map(|o| o.status.code())
        );
        if Self::wait_for_port(port_path, 15, Duration::from_secs(1)) {
            return Ok(());
        }
        // Port node sometimes needs one extra cycle after a re-pair.
        self.cycle(addr, port_path)
    }

    fn paired(&self) -> Vec<PairedDevice> {
        match Self::command().arg("--paired").output() {
            Ok(out) if out.status.success() => {
                parse_blueutil_paired(&String::from_utf8_lossy(&out.stdout))
            }
            _ => Vec::new(),
        }
    }
}

/// Parse `blueutil --paired` lines:
/// `address: aa-bb-cc-dd-ee-ff, connected (master, -60 dBm), not favourite, paired, name: "OBDII", recent access date: ...`
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_no_op_control_asks_for_manual_pairing_instead_of_shelling_out() {
        let control = Unsupported;
        let err = control.cycle("aa-bb-cc-dd-ee-ff", "/dev/x").unwrap_err();
        assert!(err.starts_with("manual pairing required"));
        let err = control
            .repair("aa-bb-cc-dd-ee-ff", "1234", "/dev/x")
            .unwrap_err();
        assert!(err.starts_with("manual pairing required"));
        assert!(control.paired().is_empty());
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
