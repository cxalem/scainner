//! Candidate adapters for the connect screen: serial port nodes on this
//! machine and the paired Bluetooth devices the platform can list. The
//! `likely_obd` flag is a name heuristic, nothing more — the user picks.
//!
//! A dongle usually shows up twice: once as a `/dev` node named after the
//! radio (`cu.OBDLinkMX49489`) and once as a paired device with the
//! friendly name the vendor set (`OBDLink MX+ 49489`). Pairing the two is
//! done here rather than in each client, so every client gets the same
//! readable name, the same `bt_addr` to save alongside the path, and one
//! row per physical device instead of two.

use super::bluetooth::{self, PairedDevice};
use super::profile::AdapterProfile;
use serde::Serialize;

/// What the row actually is, for the label the UI builds around the path.
/// Serialised as `bluetooth_serial` / `usb_serial` / `paired_only`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DeviceKind {
    /// A serial node matched to a paired Bluetooth device.
    BluetoothSerial,
    /// A serial node with no paired device behind it.
    UsbSerial,
    /// A paired device the platform has not exposed a serial node for.
    PairedOnly,
}

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
    /// The readable name to show: the paired device's friendly name when
    /// one matches this node, else the node's own name with the platform
    /// prefix stripped, else a generic label for a bare vendor string.
    pub display_name: String,
    /// Which of the three row shapes this is; the UI builds the secondary
    /// line from this plus `path` in its own language.
    pub device_kind: DeviceKind,
    /// The serial node to open, absent on a `paired_only` row.
    pub path: Option<String>,
    /// The dashed MAC to bring up before opening `path`, when known.
    pub bt_addr: Option<String>,
    /// This is the device the saved profile points at.
    pub last_used: bool,
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

/// Bus/driver names a `/dev` node carries when the device told the host
/// nothing about itself. A node whose name is only one of these plus a
/// port number has no product name to show, so it gets a generic label
/// rather than an invented one.
const BARE_VENDOR_TOKENS: [&str; 5] = [
    "usbserial",
    "usbmodem",
    "wchusbserial",
    "slabusbtouart",
    "usbtouart",
];

/// The label for a node that names its driver and nothing else.
const GENERIC_USB_NAME: &str = "USB serial adapter";

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

/// The node name without the platform's prefix: `cu.OBDLinkMX49489` →
/// `OBDLinkMX49489`.
pub fn strip_node_prefix(name: &str) -> &str {
    name.strip_prefix("cu.")
        .or_else(|| name.strip_prefix("tty."))
        .unwrap_or(name)
}

/// Lower-case letters and digits only, so `OBDLink MX+ 49489` and
/// `OBDLinkMX49489` compare equal.
fn identity(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

/// True when the node name is a driver/bus token plus a port number and
/// carries no product name of its own (`usbserial-1410`, `usbmodem14201`).
fn is_bare_vendor_name(base: &str) -> bool {
    let id = identity(base);
    let stem = id.trim_end_matches(|c: char| c.is_ascii_digit());
    !stem.is_empty() && BARE_VENDOR_TOKENS.contains(&stem)
}

/// The paired device behind a serial node, when exactly one name matches.
/// Ambiguity resolves to nothing: a wrong `bt_addr` brings up the wrong
/// radio's link before opening the port.
pub fn paired_match<'a>(node_name: &str, paired: &'a [PairedDevice]) -> Option<&'a PairedDevice> {
    let node = identity(strip_node_prefix(node_name));
    if node.is_empty() {
        return None;
    }
    let mut matches = paired.iter().filter(|device| {
        let other = identity(&device.name);
        !other.is_empty() && (other == node || other.contains(&node) || node.contains(&other))
    });
    let first = matches.next()?;
    matches.next().is_none().then_some(first)
}

/// Serial candidates from a directory listing (the `/dev` names on unix).
/// Unenriched: `display_name`/`device_kind` assume no paired device until
/// [`enrich`] has seen the paired list.
pub fn serial_candidates_from_names<'a>(
    names: impl Iterator<Item = &'a str>,
) -> Vec<AdapterCandidate> {
    let mut out: Vec<AdapterCandidate> = names
        .filter(|name| serial_glob_matches(name))
        .map(|name| {
            let id = format!("/dev/{name}");
            let base = strip_node_prefix(name);
            AdapterCandidate {
                kind: "serial".into(),
                display_name: if is_bare_vendor_name(base) {
                    GENERIC_USB_NAME.to_string()
                } else {
                    base.to_string()
                },
                device_kind: DeviceKind::UsbSerial,
                path: Some(id.clone()),
                bt_addr: None,
                last_used: false,
                id,
                name: name.to_string(),
                likely_obd: likely_obd_name(name),
                connected: None,
            }
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
            display_name: d.name.clone(),
            device_kind: DeviceKind::PairedOnly,
            path: None,
            bt_addr: Some(d.addr.clone()),
            last_used: false,
        })
        .collect()
}

fn same_addr(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b)
}

/// One row per physical device: every serial node, named after the paired
/// device behind it when there is one, plus the paired devices the
/// platform has not exposed a node for. The saved profile marks one row
/// `last_used` so the UI can preselect it.
pub fn enrich(
    serial: Vec<AdapterCandidate>,
    paired: &[PairedDevice],
    profile: &AdapterProfile,
) -> Vec<AdapterCandidate> {
    let mut claimed: Vec<String> = Vec::new();
    let mut out: Vec<AdapterCandidate> = serial
        .into_iter()
        .map(|mut candidate| {
            if let Some(device) = paired_match(&candidate.name, paired) {
                claimed.push(device.addr.clone());
                candidate.display_name = device.name.clone();
                candidate.device_kind = DeviceKind::BluetoothSerial;
                candidate.bt_addr = Some(device.addr.clone());
                candidate.connected = Some(device.connected);
                candidate.likely_obd = candidate.likely_obd || likely_obd_name(&device.name);
            }
            candidate.last_used = profile
                .path
                .as_deref()
                .is_some_and(|path| path == candidate.id);
            candidate
        })
        .collect();
    out.extend(
        bluetooth_candidates(paired)
            .into_iter()
            .filter(|device| !claimed.iter().any(|addr| same_addr(addr, &device.id)))
            .map(|mut device| {
                device.last_used = profile
                    .bt_addr
                    .as_deref()
                    .is_some_and(|addr| same_addr(addr, &device.id));
                device
            }),
    );
    // Rows the user can act on first, the last-used one at the very top;
    // the paired-but-portless rows are informational and sink to the end.
    out.sort_by(|a, b| {
        let group = |c: &AdapterCandidate| u8::from(c.device_kind == DeviceKind::PairedOnly);
        group(a)
            .cmp(&group(b))
            .then(b.last_used.cmp(&a.last_used))
            .then(b.likely_obd.cmp(&a.likely_obd))
            .then(a.display_name.cmp(&b.display_name))
    });
    out
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

/// Everything the machine can see right now, named and ordered for a
/// picker. `profile` is the saved adapter profile, for the `last_used` tag.
pub fn candidates(profile: &AdapterProfile) -> Vec<AdapterCandidate> {
    enrich(
        serial_candidates(),
        &bluetooth::platform().paired(),
        profile,
    )
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

    fn device(addr: &str, name: &str) -> PairedDevice {
        PairedDevice {
            addr: addr.into(),
            name: name.into(),
            connected: false,
        }
    }

    fn serial(names: &[&str]) -> Vec<AdapterCandidate> {
        serial_candidates_from_names(names.iter().copied())
    }

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

    #[test]
    fn node_names_match_their_paired_device_across_punctuation() {
        let paired = [
            device("aa-bb-cc-dd-ee-01", "OBDLink MX+ 49489"),
            device("aa-bb-cc-dd-ee-02", "V-LINK"),
            device("aa-bb-cc-dd-ee-03", "Magic Mouse"),
        ];
        assert_eq!(
            paired_match("cu.OBDLinkMX49489", &paired).map(|d| d.addr.as_str()),
            Some("aa-bb-cc-dd-ee-01"),
        );
        assert_eq!(
            paired_match("cu.V-LINK", &paired).map(|d| d.addr.as_str()),
            Some("aa-bb-cc-dd-ee-02"),
        );
        assert!(paired_match("cu.usbserial-1410", &paired).is_none());
    }

    #[test]
    fn an_ambiguous_name_matches_nothing() {
        let paired = [
            device("aa-bb-cc-dd-ee-01", "OBD"),
            device("aa-bb-cc-dd-ee-02", "OBDII"),
        ];
        assert!(paired_match("cu.OBD", &paired).is_none());
    }

    #[test]
    fn a_bare_driver_name_gets_a_generic_label() {
        assert!(is_bare_vendor_name("usbserial-1410"));
        assert!(is_bare_vendor_name("usbmodem14201"));
        assert!(!is_bare_vendor_name("OBDLinkMX49489"));
        let node = AdapterCandidate {
            kind: "serial".into(),
            id: "/dev/cu.usbserial-1410".into(),
            name: "cu.usbserial-1410".into(),
            likely_obd: true,
            connected: None,
            display_name: GENERIC_USB_NAME.into(),
            device_kind: DeviceKind::UsbSerial,
            path: Some("/dev/cu.usbserial-1410".into()),
            bt_addr: None,
            last_used: false,
        };
        let rows = enrich(vec![node], &[], &AdapterProfile::default());
        assert_eq!(rows[0].display_name, "USB serial adapter");
        assert_eq!(rows[0].device_kind, DeviceKind::UsbSerial);
        assert_eq!(rows[0].bt_addr, None);
    }

    #[test]
    fn enrich_names_nodes_after_their_radio_and_drops_the_duplicate_row() {
        let paired = [
            device("aa-bb-cc-dd-ee-01", "OBDLink MX+ 49489"),
            device("aa-bb-cc-dd-ee-04", "Headphones"),
        ];
        let nodes = serial(&["cu.OBDLinkMX49489", "cu.usbserial-1410"]);
        if nodes.is_empty() {
            return; // no serial globs on this platform
        }
        let rows = enrich(nodes, &paired, &AdapterProfile::default());
        let matched = rows
            .iter()
            .find(|r| r.id == "/dev/cu.OBDLinkMX49489")
            .expect("the node stays in the list");
        assert_eq!(matched.display_name, "OBDLink MX+ 49489");
        assert_eq!(matched.device_kind, DeviceKind::BluetoothSerial);
        assert_eq!(matched.bt_addr.as_deref(), Some("aa-bb-cc-dd-ee-01"));
        // The radio is already represented by its node: one row, not two.
        assert!(!rows.iter().any(|r| r.id == "aa-bb-cc-dd-ee-01"));
        let generic = rows
            .iter()
            .find(|r| r.id == "/dev/cu.usbserial-1410")
            .expect("the unmatched node stays too");
        assert_eq!(generic.display_name, "USB serial adapter");
        // A paired device with no node of its own is still offered, last.
        let leftover = rows.last().expect("non-empty");
        assert_eq!(leftover.display_name, "Headphones");
        assert_eq!(leftover.device_kind, DeviceKind::PairedOnly);
        assert_eq!(leftover.path, None);
    }

    #[test]
    fn last_used_follows_the_saved_profile() {
        let paired = [device("aa-bb-cc-dd-ee-02", "V-LINK")];
        let nodes = serial(&["cu.OBDLinkMX49489", "cu.V-LINK"]);
        if nodes.is_empty() {
            return; // no serial globs on this platform
        }
        let profile = AdapterProfile {
            path: Some("/dev/cu.V-LINK".into()),
            ..AdapterProfile::default()
        };
        let rows = enrich(nodes, &paired, &profile);
        assert!(rows[0].last_used, "the saved path sorts to the top");
        assert_eq!(rows[0].id, "/dev/cu.V-LINK");
        assert_eq!(rows[0].display_name, "V-LINK");
        assert_eq!(rows.iter().filter(|r| r.last_used).count(), 1);
    }

    #[test]
    fn a_paired_only_row_is_last_used_by_address() {
        let paired = [device("aa-bb-cc-dd-ee-09", "Dongle")];
        let profile = AdapterProfile {
            bt_addr: Some("AA-BB-CC-DD-EE-09".into()),
            ..AdapterProfile::default()
        };
        let rows = enrich(Vec::new(), &paired, &profile);
        assert_eq!(rows.len(), 1);
        assert!(rows[0].last_used);
        assert_eq!(rows[0].device_kind, DeviceKind::PairedOnly);
    }
}
