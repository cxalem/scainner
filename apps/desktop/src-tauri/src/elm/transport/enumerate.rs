//! Candidate adapters for the settings UI: serial port nodes on this
//! machine and the paired Bluetooth devices the platform can list. The
//! `likely_obd` flag is a name heuristic, nothing more — the user picks.

use super::bluetooth::{self, PairedDevice};
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct AdapterCandidate {
    /// `serial` (use as `adapter.path`) or `bluetooth` (use as
    /// `adapter.bt_addr`; its serial node appears once connected).
    pub kind: String,
    /// The port path or the dashed MAC.
    pub id: String,
    /// Device name (Bluetooth) or the port's base name.
    pub name: String,
    pub likely_obd: bool,
    /// Bluetooth only: currently connected.
    pub connected: Option<bool>,
}

/// Names that usually belong to an OBD adapter rather than a debug console,
/// a keyboard or a modem. Case-insensitive substring match.
const OBD_HINTS: [&str; 12] = [
    "obd",
    "elm",
    "link",
    "icar",
    "scan",
    "diag",
    "can",
    "carista",
    "konnwei",
    "veepeak",
    "usbserial",
    "wchusb",
];

/// macOS serial nodes that are never an adapter.
const MACOS_NOISE: [&str; 3] = ["Bluetooth-Incoming-Port", "debug-console", "wlan-debug"];

pub fn likely_obd_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    OBD_HINTS.iter().any(|hint| lower.contains(hint))
}

fn serial_glob_matches(name: &str) -> bool {
    if cfg!(target_os = "macos") {
        name.starts_with("cu.") && !MACOS_NOISE.iter().any(|noise| name.contains(noise))
    } else if cfg!(target_os = "linux") {
        name.starts_with("ttyUSB") || name.starts_with("rfcomm") || name.starts_with("ttyACM")
    } else {
        false
    }
}

/// Serial candidates from a directory listing (the `/dev` names on unix).
pub fn serial_candidates_from_names<'a>(
    names: impl Iterator<Item = &'a str>,
) -> Vec<AdapterCandidate> {
    let mut out: Vec<AdapterCandidate> = names
        .filter(|name| serial_glob_matches(name))
        .map(|name| AdapterCandidate {
            kind: "serial".into(),
            id: format!("/dev/{name}"),
            name: name.to_string(),
            likely_obd: likely_obd_name(name),
            connected: None,
        })
        .collect();
    out.sort_by(|a, b| b.likely_obd.cmp(&a.likely_obd).then(a.name.cmp(&b.name)));
    out
}

pub fn bluetooth_candidates(paired: &[PairedDevice]) -> Vec<AdapterCandidate> {
    paired
        .iter()
        .map(|d| AdapterCandidate {
            kind: "bluetooth".into(),
            id: d.addr.clone(),
            name: d.name.clone(),
            likely_obd: likely_obd_name(&d.name),
            connected: Some(d.connected),
        })
        .collect()
}

fn serial_candidates() -> Vec<AdapterCandidate> {
    if cfg!(windows) {
        // `COM1..COM32` that actually open. Not implemented: there is no
        // serial transport on Windows yet (see elm_serial.rs).
        return Vec::new();
    }
    let names: Vec<String> = std::fs::read_dir("/dev")
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    serial_candidates_from_names(names.iter().map(String::as_str))
}

/// Everything the machine can see right now.
pub fn candidates() -> Vec<AdapterCandidate> {
    let mut out = serial_candidates();
    out.extend(bluetooth_candidates(&bluetooth::platform().paired()));
    out
}

/// The one serial port to try when no `adapter.path` is configured: the
/// single `likely_obd` candidate, if exactly one exists.
pub fn guess_serial_path() -> Option<String> {
    let likely: Vec<AdapterCandidate> = serial_candidates()
        .into_iter()
        .filter(|c| c.likely_obd)
        .collect();
    match likely.as_slice() {
        [one] => Some(one.id.clone()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serial_listing_is_filtered_and_flagged() {
        let names = [
            "cu.Bluetooth-Incoming-Port",
            "cu.OBDII-SPPDev",
            "cu.usbserial-1420",
            "cu.debug-console",
            "tty.OBDII-SPPDev",
            "ttyUSB0",
            "rfcomm0",
            "ttyS0",
            "null",
        ];
        let found = serial_candidates_from_names(names.into_iter());
        let ids: Vec<&str> = found.iter().map(|c| c.id.as_str()).collect();
        if cfg!(target_os = "macos") {
            assert_eq!(ids, ["/dev/cu.OBDII-SPPDev", "/dev/cu.usbserial-1420"]);
            assert!(found.iter().all(|c| c.likely_obd));
        } else if cfg!(target_os = "linux") {
            assert_eq!(ids, ["/dev/rfcomm0", "/dev/ttyUSB0"]);
        } else {
            assert!(ids.is_empty());
        }
    }

    #[test]
    fn bluetooth_candidates_carry_the_obd_heuristic() {
        let paired = bluetooth::parse_blueutil_paired(
            "address: aa-bb-cc-dd-ee-01, connected (master, -60 dBm), not favourite, paired, name: \"OBDII\", recent access date: -\n\
             address: aa-bb-cc-dd-ee-02, not connected, not favourite, paired, name: \"Magic Mouse\", recent access date: -\n",
        );
        let found = bluetooth_candidates(&paired);
        assert_eq!(found.len(), 2);
        assert!(found[0].likely_obd);
        assert_eq!(found[0].connected, Some(true));
        assert!(!found[1].likely_obd);
        assert!(likely_obd_name("OBDLink MX+"));
        assert!(!likely_obd_name("AirPods"));
    }
}
