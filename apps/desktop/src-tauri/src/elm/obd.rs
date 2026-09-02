use super::driver::ElmDriver;
use super::outcome::DiagnosticOutcome;
use super::parser;
use serde::Serialize;
use std::time::Duration;

#[derive(Debug, Serialize, Clone)]
pub struct DtcResult {
    pub mil_on: bool,
    pub dtc_count: u8,
    pub stored: Vec<String>,
    pub pending: Vec<String>,
    pub permanent: Vec<String>,
    pub voltage: Option<f64>,
    pub freeze: Option<serde_json::Value>,
}

#[derive(Serialize, Clone)]
pub struct ObdClearOutcome {
    pub before: DtcResult,
    pub after: DtcResult,
    pub outcome: DiagnosticOutcome,
}

#[derive(Debug)]
pub enum ClearError {
    BeforeScanFailed(String),
    ClearFailed { before: DtcResult, error: String },
    VerifyFailed { before: DtcResult, error: String },
}

pub fn clear_and_verify(drv: &mut ElmDriver) -> Result<ObdClearOutcome, ClearError> {
    let before = scan_dtcs(drv).map_err(ClearError::BeforeScanFailed)?;
    if let Err(error) = clear_mode04(drv) {
        return Err(ClearError::ClearFailed { before, error });
    }
    settle_after_clear();
    let first_verification = scan_dtcs(drv);
    let verification = match first_verification {
        Ok(scan) => Ok(scan),
        Err(_) => {
            settle_after_clear();
            scan_dtcs(drv)
        }
    };
    match verification {
        Ok(after) => Ok(ObdClearOutcome {
            before,
            after,
            outcome: DiagnosticOutcome::answered("04"),
        }),
        Err(e) => Err(ClearError::VerifyFailed { before, error: e }),
    }
}

fn clear_mode04(drv: &mut ElmDriver) -> Result<(), String> {
    let raw = drv
        .cmd("04", Duration::from_secs(10))
        .map_err(|error| error.to_string())?;
    match parser::diagnostic_response(&raw, 0x04, 0x44) {
        parser::DiagnosticResponse::Positive => Ok(()),
        parser::DiagnosticResponse::Negative(code) => Err(format!(
            "ECU refused service 04: {} (0x{code:02X})",
            parser::negative_response_name(code)
        )),
        parser::DiagnosticResponse::Pending => {
            Err("ECU left service 04 pending without a final response".into())
        }
        parser::DiagnosticResponse::NoData => Err("ELM returned NO DATA for service 04".into()),
        parser::DiagnosticResponse::Malformed => {
            Err("service 04 returned no valid 44 acknowledgement".into())
        }
    }
}

#[cfg(not(test))]
fn settle_after_clear() {
    std::thread::sleep(Duration::from_millis(750));
}

#[cfg(test)]
fn settle_after_clear() {}

#[derive(Serialize, Clone)]
pub struct EcuInfo {
    pub vin: String,
    pub protocol: String,
    pub elm_version: String,
}

#[derive(Serialize, Clone)]
pub struct SensorReading {
    pub pid: String,
    pub key: String,
    pub label: String,
    pub unit: String,
    pub value: f64,
}

pub fn query(
    drv: &mut ElmDriver,
    cmd: &str,
    prefix: &str,
    timeout_s: u64,
) -> Result<Vec<u8>, String> {
    let raw = drv
        .cmd(cmd, Duration::from_secs(timeout_s))
        .map_err(|e| e.to_string())?;
    let lines = parser::clean_response(&raw);
    Ok(parser::payload_bytes(&lines, prefix))
}

pub fn scan_dtcs(drv: &mut ElmDriver) -> Result<DtcResult, String> {
    let mil_payload = query(drv, "0101", "41 01", 10)?;
    let mil = parser::decode_mil(&mil_payload).ok_or("bad 0101 response")?;
    let stored = parser::decode_dtcs(&query(drv, "03", "43", 15)?);
    let pending = parser::decode_dtcs(&query(drv, "07", "47", 15)?);
    let permanent = query(drv, "0A", "4A", 15)
        .map(|p| parser::decode_dtcs(&p))
        .unwrap_or_default();
    let voltage = drv.cmd("ATRV", Duration::from_secs(3)).ok().and_then(|r| {
        parser::clean_response(&r)
            .first()
            .and_then(|l| parser::decode_voltage(l))
    });
    let freeze = if stored.is_empty() {
        None
    } else {
        read_freeze_frame(drv)
    };
    Ok(DtcResult {
        mil_on: mil.mil_on,
        dtc_count: mil.dtc_count,
        stored,
        pending,
        permanent,
        voltage,
        freeze,
    })
}

fn read_freeze_frame(drv: &mut ElmDriver) -> Option<serde_json::Value> {
    let mut out = serde_json::Map::new();
    if let Ok(p) = query(drv, "020200", "42 02", 8) {
        let dtc_bytes: Vec<u8> = p.into_iter().skip(1).take(2).collect();
        let codes = parser::decode_dtcs(&[&[1u8][..], &dtc_bytes[..]].concat());
        if let Some(c) = codes.first() {
            out.insert("trigger_dtc".into(), serde_json::json!(c));
        }
    }
    for pid in parser::PIDS {
        let cmd = format!("02{}00", &pid.pid[2..]);
        if let Ok(p) = query(drv, &cmd, &format!("42 {}", &pid.pid[2..]), 8) {
            let data: Vec<u8> = p.into_iter().skip(1).collect();
            if let Some(v) = (pid.decode)(&data) {
                out.insert(pid.key.into(), serde_json::json!(v));
            }
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(serde_json::Value::Object(out))
    }
}

pub fn read_ecu_info(drv: &mut ElmDriver) -> Result<EcuInfo, String> {
    let vin_payload = query(drv, "0902", "49 02 01", 15)?;
    let vin = parser::decode_vin(&vin_payload);
    let protocol_raw = drv
        .cmd("ATDPN", Duration::from_secs(3))
        .map_err(|e| e.to_string())?;
    let pn = parser::clean_response(&protocol_raw)
        .first()
        .cloned()
        .unwrap_or_default();
    let protocol = match pn.trim_start_matches('A') {
        "1" => "SAE J1850 PWM".to_string(),
        "2" => "SAE J1850 VPW".to_string(),
        "3" => "ISO 9141-2".to_string(),
        "4" => "ISO 14230-4 KWP (5-baud init)".to_string(),
        "5" => "ISO 14230-4 KWP (fast init)".to_string(),
        "6" => "ISO 15765-4 CAN 11-bit 500k".to_string(),
        "7" => "ISO 15765-4 CAN 29-bit 500k".to_string(),
        "8" => "ISO 15765-4 CAN 11-bit 250k".to_string(),
        "9" => "ISO 15765-4 CAN 29-bit 250k".to_string(),
        "A" => "SAE J1939 CAN 29-bit".to_string(),
        "B" => "USER1 CAN 11-bit".to_string(),
        "C" => "USER2 CAN 11-bit".to_string(),
        other => format!("protocol {other}"),
    };
    Ok(EcuInfo {
        vin,
        protocol,
        elm_version: "ELM327".into(),
    })
}

pub fn readiness(drv: &mut ElmDriver) -> Result<std::collections::HashMap<String, bool>, String> {
    let p = query(drv, "0101", "41 01", 10)?;
    if p.len() < 4 {
        return Err("short 0101 response".into());
    }
    let (b, c, d) = (p[1], p[2], p[3]);
    let mut out = std::collections::HashMap::new();
    let cont = [("misfire", 0), ("fuel_system", 1), ("components", 2)];
    for (name, bit) in cont {
        if b & (1 << bit) != 0 {
            out.insert(name.to_string(), b & (1 << (bit + 4)) == 0);
        }
    }
    let noncont = [
        ("catalyst", 0),
        ("heated_catalyst", 1),
        ("evap", 2),
        ("secondary_air", 3),
        ("o2_sensor", 5),
        ("o2_heater", 6),
        ("egr_vvt", 7),
    ];
    for (name, bit) in noncont {
        if c & (1 << bit) != 0 {
            out.insert(name.to_string(), d & (1 << bit) == 0);
        }
    }
    Ok(out)
}

pub fn supported_pids(drv: &mut ElmDriver) -> Vec<u8> {
    let mut supported: Vec<u8> = Vec::new();
    for base in [0x00u8, 0x20, 0x40, 0x60] {
        let cmd = format!("01{base:02X}");
        let prefix = format!("41 {base:02X}");
        match query(drv, &cmd, &prefix, 8) {
            Ok(p) if !p.is_empty() => {
                let pids = parser::decode_supported_bitmap(base, &p);
                let has_next = pids.contains(&(base + 0x20));
                supported.extend(pids);
                if !has_next {
                    break;
                }
            }
            _ => break,
        }
    }
    supported
}

pub fn read_all_sensors(drv: &mut ElmDriver) -> Result<Vec<SensorReading>, String> {
    let supported = supported_pids(drv);
    if supported.is_empty() {
        return Err("ECU did not report supported PIDs".into());
    }
    let mut out = Vec::new();
    for def in parser::FULL_PIDS {
        let pid_num = u8::from_str_radix(&def.pid[2..], 16).unwrap_or(0);
        if !supported.contains(&pid_num) {
            continue;
        }
        if let Ok(p) = query(drv, def.pid, &format!("41 {}", &def.pid[2..]), 5) {
            if let Some(v) = (def.decode)(&p) {
                out.push(SensorReading {
                    pid: def.pid.into(),
                    key: def.key.into(),
                    label: def.label.into(),
                    unit: def.unit.into(),
                    value: v,
                });
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replays_a_complete_redacted_citroen_scan() {
        let raw = include_str!("../../tests/fixtures/psa/c41/elm/citroen-clean-redacted.json");
        let mut driver = ElmDriver::from_replay_json(raw).unwrap();

        let scan = scan_dtcs(&mut driver).expect("captured scan should decode");

        assert!(!scan.mil_on);
        assert_eq!(scan.dtc_count, 0);
        assert!(scan.stored.is_empty());
        assert!(scan.pending.is_empty());
        assert!(scan.permanent.is_empty());
        assert_eq!(scan.voltage, Some(12.6));
        assert!(scan.freeze.is_none());
        driver.assert_replay_complete();
    }

    #[test]
    fn missing_vin_still_returns_the_detected_kline_protocol() {
        let raw = include_str!(
            "../../tests/fixtures/psa/unknown-platform/elm/peugeot-no-vin-redacted.json"
        );
        let mut driver = ElmDriver::from_replay_json(raw).unwrap();

        let info = read_ecu_info(&mut driver).expect("missing VIN is not a transport failure");

        assert!(info.vin.is_empty());
        assert_eq!(info.protocol, "ISO 14230-4 KWP (fast init)");
        driver.assert_replay_complete();
    }

    #[test]
    fn malformed_mil_capture_fails_the_scan_honestly() {
        let raw = include_str!("../../tests/fixtures/elm/malformed-mil-redacted.json");
        let mut driver = ElmDriver::from_replay_json(raw).unwrap();

        let error = match scan_dtcs(&mut driver) {
            Ok(_) => panic!("short MIL payload must fail"),
            Err(error) => error,
        };

        assert_eq!(error, "bad 0101 response");
        driver.assert_replay_complete();
    }

    #[test]
    fn mode04_requires_a_real_acknowledgement_and_verifies_afterward() {
        let raw = include_str!("../../tests/fixtures/elm/mode04-clear-success.json");
        let mut driver = ElmDriver::from_replay_json(raw).unwrap();

        let outcome = clear_and_verify(&mut driver).expect("44 must be accepted");

        assert!(outcome.after.stored.is_empty());
        assert!(outcome.after.pending.is_empty());
        driver.assert_replay_complete();
    }

    #[test]
    fn mode04_decodes_an_ecu_refusal() {
        let raw = include_str!("../../tests/fixtures/elm/mode04-clear-refused.json");
        let mut driver = ElmDriver::from_replay_json(raw).unwrap();

        let error = clear_mode04(&mut driver).expect_err("7F 04 22 is a refusal");

        assert!(error.contains("conditionsNotCorrect"), "{error}");
        assert!(error.contains("0x22"), "{error}");
        driver.assert_replay_complete();
    }

    #[test]
    fn mode04_no_data_is_not_success() {
        let raw = include_str!("../../tests/fixtures/elm/mode04-clear-no-data.json");
        let mut driver = ElmDriver::from_replay_json(raw).unwrap();

        let error = clear_mode04(&mut driver).expect_err("NO DATA is not an acknowledgement");

        assert!(error.contains("NO DATA"), "{error}");
        driver.assert_replay_complete();
    }

    #[test]
    fn mode04_silence_is_not_success() {
        let raw = include_str!("../../tests/fixtures/elm/mode04-clear-silence.json");
        let mut driver = ElmDriver::from_replay_json(raw).unwrap();

        let error = clear_mode04(&mut driver).expect_err("silence is not an acknowledgement");

        assert!(error.contains("no response"), "{error}");
        driver.assert_replay_complete();
    }
}
