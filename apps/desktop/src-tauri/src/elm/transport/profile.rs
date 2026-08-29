//! The adapter profile: which transport to open and how, stored in
//! `app_settings` under `adapter.*` keys. The `SCAINNER_OBD_PORT`,
//! `SCAINNER_OBD_MAC` and `SCAINNER_OBD_PIN` environment variables remain a
//! fallback for one release when the corresponding setting is absent.

use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AdapterKind {
    /// A serial port: Bluetooth SPP (`/dev/cu.*`, `rfcomm*`) or USB
    /// (`/dev/ttyUSB*`, `COM*`).
    #[default]
    ElmSerial,
    /// An ELM327 Wi-Fi adapter reachable at `host:port`.
    TcpElm,
}

impl AdapterKind {
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim() {
            "elm_serial" => Some(Self::ElmSerial),
            "tcp_elm" => Some(Self::TcpElm),
            _ => None,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ElmSerial => "elm_serial",
            Self::TcpElm => "tcp_elm",
        }
    }
}

/// Multiplier on the handshake/read timeouts, which were tuned on one
/// dongle. `slow` is for adapters or ECUs that answer late; `fast` for
/// USB adapters on a quick bus.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TimingProfile {
    Fast,
    #[default]
    Default,
    Slow,
}

impl TimingProfile {
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim() {
            "fast" => Some(Self::Fast),
            "default" => Some(Self::Default),
            "slow" => Some(Self::Slow),
            _ => None,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Fast => "fast",
            Self::Default => "default",
            Self::Slow => "slow",
        }
    }
    pub fn multiplier(self) -> f32 {
        match self {
            Self::Fast => 0.5,
            Self::Default => 1.0,
            Self::Slow => 2.0,
        }
    }
    pub fn scale(self, d: Duration) -> Duration {
        match self {
            Self::Default => d,
            other => d.mul_f32(other.multiplier()),
        }
    }
}

/// The JSON field names of `AdapterProfile`, for rejecting unknown keys in
/// a partial `PUT /adapter` body instead of silently dropping them.
pub const FIELDS: [&str; 8] = [
    "kind", "path", "bt_addr", "pin", "host", "port", "baud", "timing",
];

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AdapterProfile {
    pub kind: AdapterKind,
    /// Serial port path (`elm_serial`).
    pub path: Option<String>,
    /// Dashed MAC of the paired dongle, for the Bluetooth revival ladder.
    /// Without it only the "open the port directly" step can run.
    pub bt_addr: Option<String>,
    /// Bluetooth pairing PIN used by the re-pair step.
    pub pin: String,
    /// Host of a Wi-Fi adapter (`tcp_elm`).
    pub host: Option<String>,
    pub port: u16,
    pub baud: u32,
    pub timing: TimingProfile,
}

impl Default for AdapterProfile {
    fn default() -> Self {
        Self {
            kind: AdapterKind::ElmSerial,
            path: None,
            bt_addr: None,
            pin: "1234".into(),
            host: None,
            port: 35000,
            baud: 115_200,
            timing: TimingProfile::Default,
        }
    }
}

fn non_empty(v: Option<String>) -> Option<String> {
    v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

impl AdapterProfile {
    /// Build the profile from a settings lookup plus an environment lookup
    /// (the latter only consulted when the setting is missing).
    pub fn from_lookups(
        setting: impl Fn(&str) -> Option<String>,
        env: impl Fn(&str) -> Option<String>,
    ) -> Self {
        let defaults = Self::default();
        // A stored row — even an empty one — is authoritative; the
        // environment is only consulted when the setting was never written.
        let get = |key: &str, env_key: Option<&str>| match setting(key) {
            Some(stored) => non_empty(Some(stored)),
            None => env_key.and_then(|k| non_empty(env(k))),
        };
        Self {
            kind: get("adapter.kind", None)
                .and_then(|s| AdapterKind::parse(&s))
                .unwrap_or(defaults.kind),
            path: get("adapter.path", Some("SCAINNER_OBD_PORT")),
            bt_addr: get("adapter.bt_addr", Some("SCAINNER_OBD_MAC"))
                .map(|s| s.to_ascii_lowercase()),
            pin: get("adapter.pin", Some("SCAINNER_OBD_PIN")).unwrap_or(defaults.pin),
            host: get("adapter.host", None),
            port: get("adapter.port", None)
                .and_then(|s| s.parse().ok())
                .unwrap_or(defaults.port),
            baud: get("adapter.baud", None)
                .and_then(|s| s.parse().ok())
                .unwrap_or(defaults.baud),
            timing: get("adapter.timing", None)
                .and_then(|s| TimingProfile::parse(&s))
                .unwrap_or(defaults.timing),
        }
    }

    /// From the settings store, with the process environment as fallback.
    pub fn load(setting: impl Fn(&str) -> Option<String>) -> Self {
        Self::from_lookups(setting, |k| std::env::var(k).ok())
    }

    /// The `(key, value)` rows that persist this profile. Optional fields
    /// that are unset are written as empty strings so a cleared value does
    /// not fall back to a stale one.
    pub fn to_settings(&self) -> Vec<(&'static str, String)> {
        vec![
            ("adapter.kind", self.kind.as_str().to_string()),
            ("adapter.path", self.path.clone().unwrap_or_default()),
            ("adapter.bt_addr", self.bt_addr.clone().unwrap_or_default()),
            ("adapter.pin", self.pin.clone()),
            ("adapter.host", self.host.clone().unwrap_or_default()),
            ("adapter.port", self.port.to_string()),
            ("adapter.baud", self.baud.to_string()),
            ("adapter.timing", self.timing.as_str().to_string()),
        ]
    }

    /// What physically identifies this adapter: the Bluetooth address, else
    /// the serial path, else `host:port`. The learned Bluetooth escalation
    /// level is keyed by it so a level learned on one dongle never applies
    /// to a different adapter.
    pub fn identity(&self) -> String {
        match self.kind {
            AdapterKind::ElmSerial => format!(
                "{}:{}",
                self.kind.as_str(),
                self.bt_addr
                    .clone()
                    .or_else(|| self.path.clone())
                    .unwrap_or_default()
            ),
            AdapterKind::TcpElm => format!(
                "{}:{}:{}",
                self.kind.as_str(),
                self.host.clone().unwrap_or_default(),
                self.port
            ),
        }
    }

    /// `app_settings` key of the escalation level last known to work for
    /// this adapter (`bt_connect_level:<identity>`).
    pub fn learned_level_key(&self) -> String {
        format!("bt_connect_level:{}", self.identity())
    }

    /// Where the Bluetooth escalation ladder starts: the stored level for
    /// this adapter, but always 0 when there is no Bluetooth address — the
    /// ladder's steps 1 and 2 cannot run for a USB adapter, so a learned
    /// level would only skip the one step that can succeed.
    pub fn ladder_start(&self, stored: Option<String>) -> u8 {
        if self.bt_addr.is_none() {
            return 0;
        }
        stored
            .and_then(|v| v.parse::<u8>().ok())
            .filter(|&level| level <= 2)
            .unwrap_or(0)
    }

    /// Trim every field and treat blanks as unset (a JSON body with
    /// `"path": ""` means "clear it"); MACs are lower-cased.
    pub fn normalized(mut self) -> Self {
        self.path = non_empty(self.path.take());
        self.bt_addr = non_empty(self.bt_addr.take()).map(|s| s.to_ascii_lowercase());
        self.host = non_empty(self.host.take());
        self.pin = self.pin.trim().to_string();
        self
    }

    /// Reject profiles that cannot possibly connect, with a message the
    /// settings UI can show.
    pub fn validate(&self) -> Result<(), String> {
        match self.kind {
            AdapterKind::ElmSerial => {
                if self.path.is_none() {
                    return Err("adapter.path is required for an elm_serial adapter".into());
                }
            }
            AdapterKind::TcpElm => {
                if self.host.is_none() {
                    return Err("adapter.host is required for a tcp_elm adapter".into());
                }
                if self.port == 0 {
                    return Err("adapter.port must be 1..65535".into());
                }
            }
        }
        if !super::elm_serial::SUPPORTED_BAUDS.contains(&self.baud) {
            return Err(format!(
                "adapter.baud {} is not supported (use one of {:?})",
                self.baud,
                super::elm_serial::SUPPORTED_BAUDS
            ));
        }
        if self.pin.is_empty()
            || self.pin.len() > 16
            || !self.pin.chars().all(|c| c.is_ascii_digit())
        {
            return Err("adapter.pin must be 1-16 digits".into());
        }
        Ok(())
    }
}

/// Map the adapter's `ATI` (and, for STN chips, `STI`) banner to the
/// `connections.device_kind` value: `ELM327 v2.3` → `elm327_v2.3`,
/// `STN1170 v4.0.1` → `stn1170`, an unknown banner → its first word
/// slugified, nothing → `elm_unknown`.
pub fn device_kind_from_banner(ati: &str, sti: Option<&str>) -> String {
    fn clean(raw: &str) -> Option<String> {
        raw.split(['\r', '\n'])
            .map(|l| l.trim().trim_end_matches('>').trim())
            .find(|l| !l.is_empty() && *l != "?" && !l.eq_ignore_ascii_case("OK"))
            .map(str::to_string)
    }
    fn slug(s: &str) -> String {
        s.chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '.' {
                    c.to_ascii_lowercase()
                } else {
                    '_'
                }
            })
            .collect::<String>()
            .trim_matches('_')
            .to_string()
    }
    if let Some(sti) = sti.and_then(clean) {
        let lower = sti.to_ascii_lowercase();
        if lower.starts_with("stn") {
            return slug(lower.split_whitespace().next().unwrap_or("stn"));
        }
    }
    let Some(banner) = clean(ati) else {
        return "elm_unknown".into();
    };
    let lower = banner.to_ascii_lowercase();
    let mut words = lower.split_whitespace();
    let chip = words.next().unwrap_or("elm_unknown");
    if chip.starts_with("elm") {
        let version = words.find(|w| w.starts_with('v') && w.len() > 1);
        match version {
            Some(v) => format!("{}_{}", slug(chip), slug(v)),
            None => slug(chip),
        }
    } else {
        slug(chip)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn lookup<'a>(map: &'a HashMap<&'a str, &'a str>) -> impl Fn(&str) -> Option<String> + 'a {
        move |k| map.get(k).map(|v| v.to_string())
    }

    #[test]
    fn defaults_apply_when_nothing_is_configured() {
        let p = AdapterProfile::from_lookups(|_| None, |_| None);
        assert_eq!(p, AdapterProfile::default());
        assert_eq!(p.kind, AdapterKind::ElmSerial);
        assert!(p.path.is_none(), "no compiled-in port path");
        assert!(p.bt_addr.is_none(), "no compiled-in MAC");
        assert_eq!(p.pin, "1234");
        assert_eq!(p.baud, 115_200);
        assert_eq!(p.port, 35000);
        assert!(
            p.validate().is_err(),
            "an unconfigured serial profile cannot connect"
        );
    }

    #[test]
    fn settings_win_over_the_environment_which_wins_over_defaults() {
        let settings = HashMap::from([
            ("adapter.kind", "tcp_elm"),
            ("adapter.host", "192.168.0.10"),
            ("adapter.port", "35000"),
            ("adapter.timing", "slow"),
            ("adapter.bt_addr", "AA-BB-CC-DD-EE-FF"),
        ]);
        let env = HashMap::from([
            ("SCAINNER_OBD_PORT", "/dev/cu.Example"),
            ("SCAINNER_OBD_MAC", "11-22-33-44-55-66"),
            ("SCAINNER_OBD_PIN", "0000"),
        ]);
        let p = AdapterProfile::from_lookups(lookup(&settings), lookup(&env));
        assert_eq!(p.kind, AdapterKind::TcpElm);
        assert_eq!(p.host.as_deref(), Some("192.168.0.10"));
        assert_eq!(p.timing, TimingProfile::Slow);
        assert_eq!(
            p.bt_addr.as_deref(),
            Some("aa-bb-cc-dd-ee-ff"),
            "setting wins, lower-cased"
        );
        assert_eq!(p.path.as_deref(), Some("/dev/cu.Example"), "env fallback");
        assert_eq!(p.pin, "0000", "env fallback");
        assert!(p.validate().is_ok());
    }

    #[test]
    fn bad_values_fall_back_and_round_trip_is_lossless() {
        let settings = HashMap::from([
            ("adapter.kind", "carrier_pigeon"),
            ("adapter.baud", "fast"),
            ("adapter.timing", "warp"),
            ("adapter.path", "  "),
        ]);
        let p = AdapterProfile::from_lookups(lookup(&settings), |_| None);
        assert_eq!(p.kind, AdapterKind::ElmSerial);
        assert_eq!(p.baud, 115_200);
        assert_eq!(p.timing, TimingProfile::Default);
        assert!(p.path.is_none(), "blank is unset");

        let original = AdapterProfile {
            kind: AdapterKind::ElmSerial,
            path: Some("/dev/ttyUSB0".into()),
            bt_addr: None,
            pin: "6789".into(),
            host: None,
            port: 35000,
            baud: 38400,
            timing: TimingProfile::Fast,
        };
        let rows: HashMap<&str, String> = original.to_settings().into_iter().collect();
        assert_eq!(rows.len(), 8, "one row per adapter.* key");
        let back = AdapterProfile::from_lookups(|k| rows.get(k).cloned(), |_| Some("ENV".into()));
        assert_eq!(
            back, original,
            "empty stored values must not fall back to the environment"
        );
    }

    #[test]
    fn the_learned_ladder_level_is_per_adapter_and_ignored_without_bluetooth() {
        let usb = AdapterProfile {
            path: Some("/dev/ttyUSB0".into()),
            ..Default::default()
        };
        assert_eq!(
            usb.ladder_start(Some("2".into())),
            0,
            "no bt_addr: always attempt 0"
        );
        assert_eq!(usb.identity(), "elm_serial:/dev/ttyUSB0");

        let bt = AdapterProfile {
            path: Some("/dev/cu.OBDII".into()),
            bt_addr: Some("aa-bb-cc-dd-ee-ff".into()),
            ..Default::default()
        };
        assert_eq!(bt.ladder_start(Some("2".into())), 2);
        assert_eq!(bt.ladder_start(Some("7".into())), 0, "out of range → 0");
        assert_eq!(bt.ladder_start(None), 0);
        assert_eq!(
            bt.learned_level_key(),
            "bt_connect_level:elm_serial:aa-bb-cc-dd-ee-ff"
        );
        assert_ne!(usb.learned_level_key(), bt.learned_level_key());

        let wifi = AdapterProfile {
            kind: AdapterKind::TcpElm,
            host: Some("192.168.0.10".into()),
            ..Default::default()
        };
        assert_eq!(wifi.identity(), "tcp_elm:192.168.0.10:35000");
    }

    #[test]
    fn unsupported_baud_rates_are_rejected_by_validate() {
        let p = AdapterProfile {
            path: Some("/dev/ttyUSB0".into()),
            baud: 12345,
            ..Default::default()
        };
        assert!(p.validate().unwrap_err().contains("adapter.baud"));
        let p = AdapterProfile { baud: 38400, ..p };
        assert!(p.validate().is_ok());
    }

    #[test]
    fn timing_profiles_scale_timeouts() {
        let d = Duration::from_secs(2);
        assert_eq!(TimingProfile::Fast.scale(d), Duration::from_secs(1));
        assert_eq!(TimingProfile::Default.scale(d), d);
        assert_eq!(TimingProfile::Slow.scale(d), Duration::from_secs(4));
    }

    #[test]
    fn banner_maps_to_device_kind() {
        assert_eq!(
            device_kind_from_banner("ELM327 v2.3\r\r>", None),
            "elm327_v2.3"
        );
        assert_eq!(
            device_kind_from_banner("ELM327 v1.5\r>", Some("?\r>")),
            "elm327_v1.5"
        );
        assert_eq!(
            device_kind_from_banner("ELM327 v1.3a\r>", Some("STN1170 v4.0.1\r>")),
            "stn1170"
        );
        assert_eq!(
            device_kind_from_banner("\r\rOBDLink MX+\r>", None),
            "obdlink"
        );
        assert_eq!(device_kind_from_banner("ELM327\r>", None), "elm327");
        assert_eq!(device_kind_from_banner("?\r>", None), "elm_unknown");
        assert_eq!(device_kind_from_banner("", None), "elm_unknown");
    }
}
