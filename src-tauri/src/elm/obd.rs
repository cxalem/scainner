//! Standard OBD-II (SAE J1979) operations: DTC scans, freeze frames, ECU
//! identity, readiness monitors, and a full-sensor sweep. Everything here
//! works on any car built since the early 2000s — no manufacturer-specific
//! knowledge required. (Manufacturer-specific access lives in `uds.rs`.)

use super::driver::ElmDriver;
use super::parser;
use serde::Serialize;
use std::time::Duration;

#[derive(Serialize, Clone)]
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

/// Send a mode command, strip the echoed prefix, return the raw payload bytes.
pub fn query(drv: &mut ElmDriver, cmd: &str, prefix: &str, timeout_s: u64) -> Result<Vec<u8>, String> {
    let raw = drv.cmd(cmd, Duration::from_secs(timeout_s)).map_err(|e| e.to_string())?;
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
        .unwrap_or_default(); // NO DATA is fine
    let voltage = drv
        .cmd("ATRV", Duration::from_secs(3))
        .ok()
        .and_then(|r| parser::clean_response(&r).first().and_then(|l| parser::decode_voltage(l)));
    // Freeze frame: only meaningful when something is actually stored.
    let freeze = if stored.is_empty() { None } else { read_freeze_frame(drv) };
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

/// Mode 02 (freeze frame 0): the ECU's sensor snapshot from the moment the
/// fault was stored. Mirrors the live PID set plus PID 02 (the triggering DTC).
fn read_freeze_frame(drv: &mut ElmDriver) -> Option<serde_json::Value> {
    let mut out = serde_json::Map::new();
    // Which DTC caused this freeze frame (PID 02).
    if let Ok(p) = query(drv, "020200", "42 02", 8) {
        // payload: frame no. then 2 DTC bytes
        let dtc_bytes: Vec<u8> = p.into_iter().skip(1).take(2).collect();
        let codes = parser::decode_dtcs(&[&[1u8][..], &dtc_bytes[..]].concat());
        if let Some(c) = codes.first() {
            out.insert("trigger_dtc".into(), serde_json::json!(c));
        }
    }
    for pid in parser::PIDS {
        let cmd = format!("02{}00", &pid.pid[2..]);
        if let Ok(p) = query(drv, &cmd, &format!("42 {}", &pid.pid[2..]), 8) {
            // First payload byte is the frame number; PID data follows.
            let data: Vec<u8> = p.into_iter().skip(1).collect();
            if let Some(v) = (pid.decode)(&data) {
                out.insert(pid.key.into(), serde_json::json!(v));
            }
        }
    }
    if out.is_empty() { None } else { Some(serde_json::Value::Object(out)) }
}

pub fn read_ecu_info(drv: &mut ElmDriver) -> Result<EcuInfo, String> {
    let vin_payload = query(drv, "0902", "49 02 01", 15)?;
    let vin = parser::decode_vin(&vin_payload);
    let protocol_raw = drv.cmd("ATDPN", Duration::from_secs(3)).map_err(|e| e.to_string())?;
    let pn = parser::clean_response(&protocol_raw).first().cloned().unwrap_or_default();
    let protocol = match pn.trim_start_matches('A') {
        "6" => "ISO 15765-4 CAN 11-bit 500k".to_string(),
        "7" => "ISO 15765-4 CAN 29-bit 500k".to_string(),
        other => format!("protocol {other}"),
    };
    Ok(EcuInfo { vin, protocol, elm_version: "ELM327".into() })
}

/// Mode 0101 bytes C/D: which noncontinuous monitors are supported and complete.
pub fn readiness(drv: &mut ElmDriver) -> Result<std::collections::HashMap<String, bool>, String> {
    let p = query(drv, "0101", "41 01", 10)?;
    if p.len() < 4 {
        return Err("short 0101 response".into());
    }
    let (b, c, d) = (p[1], p[2], p[3]);
    let mut out = std::collections::HashMap::new();
    // Continuous monitors (byte B low bits): supported / complete
    let cont = [("misfire", 0), ("fuel_system", 1), ("components", 2)];
    for (name, bit) in cont {
        if b & (1 << bit) != 0 {
            out.insert(name.to_string(), b & (1 << (bit + 4)) == 0);
        }
    }
    // Spark-ignition noncontinuous monitors (bytes C=supported, D=incomplete)
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

/// Discover which PIDs the ECU supports (0100/0120/0140/0160 bitmaps), then
/// read every one we know how to decode. One-shot, ~10-20 s.
pub fn read_all_sensors(drv: &mut ElmDriver) -> Result<Vec<SensorReading>, String> {
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
