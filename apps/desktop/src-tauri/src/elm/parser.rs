//! Pure parsers for ELM327 / OBD-II responses.
//! Every function here is testable without a car — test vectors are real
//! bytes captured from the Citroën C4 III on 2026-08-14.

/// Strip echo, prompt chars, and blank lines from a raw ELM response.
pub fn clean_response(raw: &str) -> Vec<String> {
    raw.replace('\r', "\n")
        .split('\n')
        .map(|l| l.trim().trim_end_matches('>').trim().to_string())
        .filter(|l| !l.is_empty() && *l != "SEARCHING...")
        .collect()
}

/// Collect the hex payload bytes of a mode response, joining multi-line
/// (ISO-TP) replies like the VIN. Lines may be prefixed with "0:", "1:", ...
pub fn payload_bytes(lines: &[String], expect_prefix: &str) -> Vec<u8> {
    let mut out = Vec::new();
    let mut started = false;
    for line in lines {
        // multi-frame lines look like "0: 49 02 01 56 52 37"
        let body = match line.split_once(':') {
            Some((idx, rest))
                if idx.trim().chars().all(|c| c.is_ascii_hexdigit()) && idx.trim().len() <= 3 =>
            {
                rest
            }
            _ => line.as_str(),
        };
        let bytes: Vec<u8> = body
            .split_whitespace()
            .filter_map(|t| u8::from_str_radix(t, 16).ok())
            .collect();
        if bytes.is_empty() {
            continue;
        }
        if !started {
            // first-frame length line of an ISO-TP reply is just "014" — skip pure length lines
            if bytes.len() == 1 && !line.contains(':') {
                continue;
            }
            started = true;
        }
        out.extend(bytes);
    }
    // Drop everything before (and including) the expected positive-response prefix.
    // If the prefix isn't found — a stale/mismatched response bleeding in from a
    // previous command (driver.rs's cmd() has no input-buffer flush between
    // commands, so a late reply can linger and get read as part of the next
    // one), an error string, a different mode's leftover data, anything —
    // this used to fall through and return `out` unfiltered, letting whatever
    // garbage bytes happened to be present get decoded as if they were a real
    // reading. Caught live on a real Peugeot (2026-08-21): throttle, fuel
    // level, and MAP all reported suspiciously identical values for an entire
    // session, traced to exactly this — the same stray byte pattern getting
    // decoded under three different PID keys. Returning empty here instead
    // means a mismatched response produces no reading at all for that tick
    // (skipped, same as any other decode failure) rather than a wrong one
    // silently recorded as real — "honest absence beats silent absence"
    // (ScanConsole.tsx's empty-state rule), just at the data-integrity layer
    // instead of the UI layer.
    let prefix: Vec<u8> = expect_prefix
        .split_whitespace()
        .filter_map(|t| u8::from_str_radix(t, 16).ok())
        .collect();
    if prefix.is_empty() {
        return out;
    }
    match out
        .windows(prefix.len())
        .position(|w| w == prefix.as_slice())
    {
        Some(pos) => out[pos + prefix.len()..].to_vec(),
        None => Vec::new(),
    }
}

/// Decode DTC bytes (pairs) from a mode 03/07/0A response payload.
/// Payload starts after `43`/`47`/`4A`; first byte may be a count (CAN format).
pub fn decode_dtcs(payload: &[u8]) -> Vec<String> {
    let mut codes = Vec::new();
    // On CAN, first byte after 43 is the number of codes.
    let data = if !payload.is_empty() {
        &payload[1..]
    } else {
        payload
    };
    for pair in data.chunks(2) {
        if pair.len() < 2 || (pair[0] == 0 && pair[1] == 0) {
            continue;
        }
        let sys = match pair[0] >> 6 {
            0 => 'P',
            1 => 'C',
            2 => 'B',
            _ => 'U',
        };
        codes.push(format!(
            "{}{:01X}{:01X}{:02X}",
            sys,
            (pair[0] >> 4) & 0x3,
            pair[0] & 0xF,
            pair[1]
        ));
    }
    codes
}

/// Mode 0101: MIL status + stored-DTC count.
pub struct MilStatus {
    pub mil_on: bool,
    pub dtc_count: u8,
}

pub fn decode_mil(payload: &[u8]) -> Option<MilStatus> {
    let a = *payload.first()?;
    Some(MilStatus {
        mil_on: a & 0x80 != 0,
        dtc_count: a & 0x7F,
    })
}

/// Decode VIN from a mode 0902 payload (after 49 02 01).
pub fn decode_vin(payload: &[u8]) -> String {
    payload
        .iter()
        .filter(|b| b.is_ascii_alphanumeric())
        .map(|&b| b as char)
        .collect()
}

/// Battery voltage from ATRV ("13.1V").
pub fn decode_voltage(line: &str) -> Option<f64> {
    line.trim().trim_end_matches(['V', 'v']).parse().ok()
}

/// A live PID we poll. `decode` maps the payload bytes (after 41 XX) to a value.
#[allow(dead_code)] // label/unit are for future UI use
pub struct PidDef {
    pub pid: &'static str,
    pub key: &'static str,
    pub label: &'static str,
    pub unit: &'static str,
    pub decode: fn(&[u8]) -> Option<f64>,
}

pub const PIDS: &[PidDef] = &[
    PidDef {
        pid: "010C",
        key: "rpm",
        label: "Engine RPM",
        unit: "rpm",
        decode: |d| Some(((*d.first()? as f64) * 256.0 + *d.get(1)? as f64) / 4.0),
    },
    PidDef {
        pid: "010D",
        key: "speed",
        label: "Vehicle speed",
        unit: "km/h",
        decode: |d| Some(*d.first()? as f64),
    },
    PidDef {
        pid: "0105",
        key: "coolant",
        label: "Coolant temp",
        unit: "°C",
        decode: |d| Some(*d.first()? as f64 - 40.0),
    },
    PidDef {
        pid: "010F",
        key: "intake_temp",
        label: "Intake air temp",
        unit: "°C",
        decode: |d| Some(*d.first()? as f64 - 40.0),
    },
    PidDef {
        pid: "0104",
        key: "load",
        label: "Engine load",
        unit: "%",
        decode: |d| Some(*d.first()? as f64 * 100.0 / 255.0),
    },
    PidDef {
        pid: "0111",
        key: "throttle",
        label: "Throttle",
        unit: "%",
        decode: |d| Some(*d.first()? as f64 * 100.0 / 255.0),
    },
    PidDef {
        pid: "0106",
        key: "stft",
        label: "Short fuel trim",
        unit: "%",
        decode: |d| Some((*d.first()? as f64 - 128.0) * 100.0 / 128.0),
    },
    PidDef {
        pid: "0107",
        key: "ltft",
        label: "Long fuel trim",
        unit: "%",
        decode: |d| Some((*d.first()? as f64 - 128.0) * 100.0 / 128.0),
    },
    PidDef {
        pid: "010B",
        key: "map",
        label: "Manifold pressure",
        unit: "kPa",
        decode: |d| Some(*d.first()? as f64),
    },
    PidDef {
        pid: "010E",
        key: "timing_adv",
        label: "Timing advance",
        unit: "°",
        decode: |d| Some(*d.first()? as f64 / 2.0 - 64.0),
    },
    PidDef {
        pid: "015E",
        key: "fuel_rate",
        label: "Fuel rate",
        unit: "L/h",
        decode: |d| Some(((*d.first()? as f64) * 256.0 + *d.get(1)? as f64) / 20.0),
    },
    PidDef {
        pid: "012F",
        key: "fuel_level",
        label: "Fuel level",
        unit: "%",
        decode: |d| Some(*d.first()? as f64 * 100.0 / 255.0),
    },
    // In the poll set since polling became bitmap-adaptive (2026-08-21):
    // cars whose ECU declares MAF support (the old Peugeot does) get
    // continuous airflow; cars that don't skip it for free.
    PidDef {
        pid: "0110",
        key: "maf",
        label: "MAF air flow",
        unit: "g/s",
        decode: |d| Some(((*d.first()? as f64) * 256.0 + *d.get(1)? as f64) / 100.0),
    },
];

/// Decode a supported-PID bitmap response (0100/0120/0140/0160 → 4 data bytes).
/// `base` is the PID of the query itself (0x00, 0x20, ...). Returns supported PID numbers.
pub fn decode_supported_bitmap(base: u8, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    for (byte_idx, &b) in payload.iter().take(4).enumerate() {
        for bit in 0..8 {
            if b & (0x80 >> bit) != 0 {
                out.push(base + (byte_idx as u8) * 8 + bit as u8 + 1);
            }
        }
    }
    out
}

/// The full standard mode-01 catalog (sensors only — bitmap/status PIDs excluded).
/// Formulas per SAE J1979.
pub const FULL_PIDS: &[PidDef] = &[
    PidDef {
        pid: "0104",
        key: "load",
        label: "Engine load",
        unit: "%",
        decode: |d| Some(*d.first()? as f64 * 100.0 / 255.0),
    },
    PidDef {
        pid: "0105",
        key: "coolant",
        label: "Coolant temp",
        unit: "°C",
        decode: |d| Some(*d.first()? as f64 - 40.0),
    },
    PidDef {
        pid: "0106",
        key: "stft",
        label: "Short fuel trim B1",
        unit: "%",
        decode: |d| Some((*d.first()? as f64 - 128.0) * 100.0 / 128.0),
    },
    PidDef {
        pid: "0107",
        key: "ltft",
        label: "Long fuel trim B1",
        unit: "%",
        decode: |d| Some((*d.first()? as f64 - 128.0) * 100.0 / 128.0),
    },
    PidDef {
        pid: "010A",
        key: "fuel_pressure",
        label: "Fuel pressure (gauge)",
        unit: "kPa",
        decode: |d| Some(*d.first()? as f64 * 3.0),
    },
    PidDef {
        pid: "010B",
        key: "map",
        label: "Manifold pressure",
        unit: "kPa",
        decode: |d| Some(*d.first()? as f64),
    },
    PidDef {
        pid: "010C",
        key: "rpm",
        label: "Engine RPM",
        unit: "rpm",
        decode: |d| Some(((*d.first()? as f64) * 256.0 + *d.get(1)? as f64) / 4.0),
    },
    PidDef {
        pid: "010D",
        key: "speed",
        label: "Vehicle speed",
        unit: "km/h",
        decode: |d| Some(*d.first()? as f64),
    },
    PidDef {
        pid: "010E",
        key: "timing_adv",
        label: "Timing advance",
        unit: "°",
        decode: |d| Some(*d.first()? as f64 / 2.0 - 64.0),
    },
    PidDef {
        pid: "010F",
        key: "intake_temp",
        label: "Intake air temp",
        unit: "°C",
        decode: |d| Some(*d.first()? as f64 - 40.0),
    },
    PidDef {
        pid: "0110",
        key: "maf",
        label: "MAF air flow",
        unit: "g/s",
        decode: |d| Some(((*d.first()? as f64) * 256.0 + *d.get(1)? as f64) / 100.0),
    },
    PidDef {
        pid: "0111",
        key: "throttle",
        label: "Throttle position",
        unit: "%",
        decode: |d| Some(*d.first()? as f64 * 100.0 / 255.0),
    },
    PidDef {
        pid: "0114",
        key: "o2_b1s1",
        label: "O₂ B1S1 voltage",
        unit: "V",
        decode: |d| Some(*d.first()? as f64 / 200.0),
    },
    PidDef {
        pid: "0115",
        key: "o2_b1s2",
        label: "O₂ B1S2 voltage",
        unit: "V",
        decode: |d| Some(*d.first()? as f64 / 200.0),
    },
    PidDef {
        pid: "011F",
        key: "run_time",
        label: "Run time since start",
        unit: "s",
        decode: |d| Some((*d.first()? as f64) * 256.0 + *d.get(1)? as f64),
    },
    PidDef {
        pid: "0121",
        key: "dist_mil",
        label: "Distance with MIL on",
        unit: "km",
        decode: |d| Some((*d.first()? as f64) * 256.0 + *d.get(1)? as f64),
    },
    PidDef {
        pid: "0123",
        key: "rail_pressure",
        label: "Fuel rail pressure",
        unit: "kPa",
        decode: |d| Some(((*d.first()? as f64) * 256.0 + *d.get(1)? as f64) * 10.0),
    },
    PidDef {
        pid: "012E",
        key: "evap_purge",
        label: "EVAP purge",
        unit: "%",
        decode: |d| Some(*d.first()? as f64 * 100.0 / 255.0),
    },
    PidDef {
        pid: "012F",
        key: "fuel_level",
        label: "Fuel level",
        unit: "%",
        decode: |d| Some(*d.first()? as f64 * 100.0 / 255.0),
    },
    PidDef {
        pid: "0130",
        key: "warmups",
        label: "Warm-ups since clear",
        unit: "",
        decode: |d| Some(*d.first()? as f64),
    },
    PidDef {
        pid: "0131",
        key: "dist_clear",
        label: "Distance since clear",
        unit: "km",
        decode: |d| Some((*d.first()? as f64) * 256.0 + *d.get(1)? as f64),
    },
    PidDef {
        pid: "0133",
        key: "baro",
        label: "Barometric pressure",
        unit: "kPa",
        decode: |d| Some(*d.first()? as f64),
    },
    PidDef {
        pid: "0134",
        key: "lambda_b1s1",
        label: "Lambda B1S1",
        unit: "λ",
        decode: |d| Some(((*d.first()? as f64) * 256.0 + *d.get(1)? as f64) / 32768.0),
    },
    PidDef {
        pid: "013C",
        key: "cat_temp_b1s1",
        label: "Catalyst temp B1S1",
        unit: "°C",
        decode: |d| Some(((*d.first()? as f64) * 256.0 + *d.get(1)? as f64) / 10.0 - 40.0),
    },
    PidDef {
        pid: "013E",
        key: "cat_temp_b1s2",
        label: "Catalyst temp B1S2",
        unit: "°C",
        decode: |d| Some(((*d.first()? as f64) * 256.0 + *d.get(1)? as f64) / 10.0 - 40.0),
    },
    PidDef {
        pid: "0142",
        key: "ecu_voltage",
        label: "Control module voltage",
        unit: "V",
        decode: |d| Some(((*d.first()? as f64) * 256.0 + *d.get(1)? as f64) / 1000.0),
    },
    PidDef {
        pid: "0143",
        key: "abs_load",
        label: "Absolute load",
        unit: "%",
        decode: |d| Some(((*d.first()? as f64) * 256.0 + *d.get(1)? as f64) * 100.0 / 255.0),
    },
    PidDef {
        pid: "0144",
        key: "lambda_cmd",
        label: "Commanded lambda",
        unit: "λ",
        decode: |d| Some(((*d.first()? as f64) * 256.0 + *d.get(1)? as f64) / 32768.0),
    },
    PidDef {
        pid: "0145",
        key: "rel_throttle",
        label: "Relative throttle",
        unit: "%",
        decode: |d| Some(*d.first()? as f64 * 100.0 / 255.0),
    },
    PidDef {
        pid: "0146",
        key: "ambient_temp",
        label: "Ambient air temp",
        unit: "°C",
        decode: |d| Some(*d.first()? as f64 - 40.0),
    },
    PidDef {
        pid: "0147",
        key: "throttle_b",
        label: "Abs throttle B",
        unit: "%",
        decode: |d| Some(*d.first()? as f64 * 100.0 / 255.0),
    },
    PidDef {
        pid: "0149",
        key: "pedal_d",
        label: "Accel pedal D",
        unit: "%",
        decode: |d| Some(*d.first()? as f64 * 100.0 / 255.0),
    },
    PidDef {
        pid: "014A",
        key: "pedal_e",
        label: "Accel pedal E",
        unit: "%",
        decode: |d| Some(*d.first()? as f64 * 100.0 / 255.0),
    },
    PidDef {
        pid: "014C",
        key: "cmd_throttle",
        label: "Commanded throttle",
        unit: "%",
        decode: |d| Some(*d.first()? as f64 * 100.0 / 255.0),
    },
    PidDef {
        pid: "014D",
        key: "time_mil",
        label: "Time with MIL on",
        unit: "min",
        decode: |d| Some((*d.first()? as f64) * 256.0 + *d.get(1)? as f64),
    },
    PidDef {
        pid: "014E",
        key: "time_clear",
        label: "Time since clear",
        unit: "min",
        decode: |d| Some((*d.first()? as f64) * 256.0 + *d.get(1)? as f64),
    },
    PidDef {
        pid: "0152",
        key: "ethanol",
        label: "Ethanol fuel",
        unit: "%",
        decode: |d| Some(*d.first()? as f64 * 100.0 / 255.0),
    },
    PidDef {
        pid: "015C",
        key: "oil_temp",
        label: "Engine oil temp",
        unit: "°C",
        decode: |d| Some(*d.first()? as f64 - 40.0),
    },
    PidDef {
        pid: "015E",
        key: "fuel_rate",
        label: "Fuel rate",
        unit: "L/h",
        decode: |d| Some(((*d.first()? as f64) * 256.0 + *d.get(1)? as f64) / 20.0),
    },
    PidDef {
        pid: "0161",
        key: "demand_torque",
        label: "Demanded torque",
        unit: "%",
        decode: |d| Some(*d.first()? as f64 - 125.0),
    },
    PidDef {
        pid: "0162",
        key: "actual_torque",
        label: "Actual torque",
        unit: "%",
        decode: |d| Some(*d.first()? as f64 - 125.0),
    },
    PidDef {
        pid: "0163",
        key: "ref_torque",
        label: "Reference torque",
        unit: "Nm",
        decode: |d| Some((*d.first()? as f64) * 256.0 + *d.get(1)? as f64),
    },
];

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(raw: &str) -> Vec<String> {
        clean_response(raw)
    }

    // ---- Real captures from the C4 III, 2026-08-14 ----

    #[test]
    fn no_stored_dtcs() {
        let p = payload_bytes(&lines("43 00"), "43");
        assert!(decode_dtcs(&p).is_empty());
    }

    #[test]
    fn no_pending_dtcs() {
        let p = payload_bytes(&lines("47 00"), "47");
        assert!(decode_dtcs(&p).is_empty());
    }

    #[test]
    fn mil_off_zero_codes() {
        let p = payload_bytes(&lines("41 01 00 07 E1 00"), "41 01");
        let m = decode_mil(&p).unwrap();
        assert!(!m.mil_on);
        assert_eq!(m.dtc_count, 0);
    }

    #[test]
    fn vin_multiframe() {
        // Placeholder VIN (not a real vehicle) — the multi-frame chunking
        // shape (3/7/7 bytes across ISO-TP frames) mirrors a real capture.
        let raw = "014\n0: 49 02 01 52 45 44\n1: 41 43 54 45 44 56 49\n2: 4E 4E 55 4D 42 45 52";
        let p = payload_bytes(&lines(raw), "49 02 01");
        assert_eq!(decode_vin(&p), "REDACTEDVINNUMBER");
    }

    #[test]
    fn coolant_85c() {
        let p = payload_bytes(&lines("41 05 7D"), "41 05");
        let pid = PIDS.iter().find(|p| p.key == "coolant").unwrap();
        assert_eq!((pid.decode)(&p), Some(85.0));
    }

    #[test]
    fn rpm_842() {
        let p = payload_bytes(&lines("41 0C 0D 28"), "41 0C");
        let pid = PIDS.iter().find(|p| p.key == "rpm").unwrap();
        assert_eq!((pid.decode)(&p), Some(842.0));
    }

    #[test]
    fn voltage() {
        assert_eq!(decode_voltage("13.1V"), Some(13.1));
    }

    // ---- Synthetic: cars with actual codes ----

    #[test]
    fn decodes_p0301_and_p1032() {
        // 43 02 = two codes: 03 01 -> P0301, 10 32 -> P1032
        let p = payload_bytes(&lines("43 02 03 01 10 32"), "43");
        assert_eq!(decode_dtcs(&p), vec!["P0301", "P1032"]);
    }

    #[test]
    fn supported_bitmap_real_capture() {
        // Real 0100 answer from the C4 III: 41 00 BE 3E A8 13
        let p = payload_bytes(&lines("41 00 BE 3E A8 13"), "41 00");
        let pids = decode_supported_bitmap(0x00, &p);
        // BE = PIDs 01,03,04,05,06,07 · 3E = 0B,0C,0D,0E,0F · A8 = 11,13,15 · 13 = 1C,1F,20
        assert_eq!(
            pids,
            vec![
                0x01, 0x03, 0x04, 0x05, 0x06, 0x07, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x11, 0x13, 0x15,
                0x1C, 0x1F, 0x20
            ]
        );
    }

    #[test]
    fn decodes_chassis_code() {
        // C1560 EPB code: 0x55 0x60 -> C1560
        let p = payload_bytes(&lines("43 01 55 60"), "43");
        assert_eq!(decode_dtcs(&p), vec!["C1560"]);
    }
}
