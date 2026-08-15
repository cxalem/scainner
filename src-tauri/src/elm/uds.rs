//! UDS (ISO 14229) access to modules beyond the standard engine ECU.
//!
//! The four built-in modules below use PSA/Stellantis (Peugeot, Citroën, DS,
//! Opel) CAN addresses, sourced from the community-documented
//! [ludwig-v/arduino-psa-diag](https://github.com/ludwig-v/arduino-psa-diag)
//! project. **They will not work on other brands** — every manufacturer
//! assigns its own CAN IDs to its own modules.
//!
//! This is by design generic, not PSA-only: modules are just a name plus two
//! CAN IDs (request/response), and the app lets you add your own through the
//! UI (persisted in `db::UdsModuleDef`, see `db.rs`). If you're on a
//! different brand, look up your ECU's addresses (car-hacking forums, the
//! openxc/commaai/canbus.rocks communities, or a search for
//! "<your car> UDS diagnostic session CAN ID" usually turns something up),
//! add a module, and the same read/scan/probe workflow below applies
//! unchanged. `UDS_INVESTIGATION_LOG.md` in the repo root documents exactly
//! how the built-in PSA addresses were found and verified — the same method
//! (broadcast probe → physical-address probe → session-open check) works for
//! any brand.
//!
//! READ-ONLY by design: this module only ever sends DiagnosticSessionControl
//! (0x10 0x03), ReadDataByIdentifier (0x22) and TesterPresent (0x3E), plus
//! ClearDiagnosticInformation (0x14) when the user explicitly asks to clear
//! codes — the same operation every commercial diagnostic tool performs, and
//! it can only erase stored records. No writes, no routines, no resets.

use super::driver::{ElmDriver, ElmError};
use super::parser;
use serde::Serialize;
use std::time::Duration;

#[derive(Serialize, Clone)]
pub struct UdsModule {
    pub key: String,
    pub label: String,
    pub req: String,
    pub resp: String,
    /// True for the compiled-in PSA defaults; false for user-added modules.
    pub builtin: bool,
}

pub fn builtin_modules() -> Vec<UdsModule> {
    [
        ("bsi", "BSI (body computer)", "752", "652"),
        ("abs", "ABS / ESP", "6AD", "68D"),
        ("cluster", "Instrument cluster", "75F", "65F"),
        ("engine", "Engine ECU", "6A8", "688"),
    ]
    .into_iter()
    .map(|(key, label, req, resp)| UdsModule {
        key: key.into(),
        label: label.into(),
        req: req.into(),
        resp: resp.into(),
        builtin: true,
    })
    .collect()
}

/// Look up a module by key among the built-ins first, then the caller-
/// supplied custom list (from `db::list_uds_modules()` — kept as a plain
/// slice here so this module stays free of any DB dependency).
pub fn resolve<'a>(key: &str, custom: &'a [UdsModule]) -> Option<UdsModule> {
    builtin_modules()
        .into_iter()
        .find(|m| m.key == key)
        .or_else(|| custom.iter().find(|m| m.key == key).cloned())
}

/// Point the ELM at one module: fixed CAN 500k/11-bit, physical addressing.
pub fn setup(drv: &mut ElmDriver, m: &UdsModule) -> Result<(), ElmError> {
    for c in [
        "ATSP6".to_string(),
        "ATCAF1".to_string(),
        "ATH0".to_string(),
        format!("ATSH {}", m.req),
        format!("ATCRA {}", m.resp),
        format!("ATFCSH {}", m.req),
        "ATFCSD 300000".to_string(),
        "ATFCSM 1".to_string(),
    ] {
        drv.cmd(&c, Duration::from_secs(2))?;
    }
    // Extended diagnostic session; many reads work without it, but it never hurts.
    let _ = drv.cmd("1003", Duration::from_secs(2));
    Ok(())
}

/// Restore functional OBD-II addressing so normal PID polling keeps working.
pub fn teardown(drv: &mut ElmDriver) {
    let _ = drv.cmd("ATSH 7DF", Duration::from_secs(2));
    let _ = drv.cmd("ATAR", Duration::from_secs(2));
    let _ = drv.cmd("ATFCSM 0", Duration::from_secs(2));
}

/// ReadDataByIdentifier. Ok(Some(bytes)) on 62-response, Ok(None) on negative
/// response / silence, Err on transport failure. Single-DID reads use a
/// generous 1500ms; range scans pass a shorter timeout (see `read_did_timeout`)
/// since most of a scan's time is spent waiting out silence on unsupported DIDs.
pub fn read_did(drv: &mut ElmDriver, did: u16) -> Result<Option<Vec<u8>>, ElmError> {
    read_did_timeout(drv, did, Duration::from_millis(1500))
}

pub fn read_did_timeout(drv: &mut ElmDriver, did: u16, timeout: Duration) -> Result<Option<Vec<u8>>, ElmError> {
    let raw = match drv.cmd(&format!("22{did:04X}"), timeout) {
        Ok(r) => r,
        Err(ElmError::NoResponse) => return Ok(None),
        Err(e) => return Err(e),
    };
    let lines = parser::clean_response(&raw);
    let bytes = parser::payload_bytes(&lines, "");
    for i in 0..bytes.len().saturating_sub(2) {
        if bytes[i] == 0x62 && bytes[i + 1] == (did >> 8) as u8 && bytes[i + 2] == (did & 0xFF) as u8 {
            return Ok(Some(bytes[i + 3..].to_vec()));
        }
    }
    Ok(None)
}

/// Keep the extended session alive during long scans.
pub fn tester_present(drv: &mut ElmDriver) {
    let _ = drv.cmd("3E00", Duration::from_millis(800));
}

/// ReadDTCInformation (0x19 0x02): report DTCs by status mask. Read-only.
/// Response: 59 02 <availabilityMask> then 4-byte records — 3 DTC bytes
/// (high/middle/low, where high's top 2 bits encode P/C/B/U) + 1 status byte.
pub fn read_dtcs(drv: &mut ElmDriver) -> Result<Vec<String>, ElmError> {
    // Mask 0xAF = testFailed | confirmed | pending | testNotCompleted bits —
    // the set every workshop tool asks for.
    let raw = drv.cmd("1902AF", Duration::from_secs(6))?;
    let lines = parser::clean_response(&raw);
    let bytes = parser::payload_bytes(&lines, "");
    let mut out = Vec::new();
    // Find the positive-response header 0x59 0x02.
    let Some(start) = bytes.windows(2).position(|w| w == [0x59, 0x02]) else {
        return Ok(out); // negative response or no DTC support
    };
    // Skip header + availability mask, then walk 4-byte records.
    let records = &bytes[start + 3..];
    for rec in records.chunks(4) {
        if rec.len() < 4 {
            break;
        }
        let sys = match rec[0] >> 6 {
            0 => 'P',
            1 => 'C',
            2 => 'B',
            _ => 'U',
        };
        out.push(format!(
            "{}{:01X}{:01X}{:02X}-{:02X}",
            sys,
            (rec[0] >> 4) & 0x3,
            rec[0] & 0xF,
            rec[1],
            rec[2]
        ));
    }
    Ok(out)
}

/// ClearDiagnosticInformation (0x14), group FFFFFF = all DTCs on this module.
/// This is the one write this codebase performs, and it's the standard,
/// universally-safe "clear the fault memory" operation every diagnostic tool
/// does — it cannot damage anything, it only erases stored fault records.
/// Gate this behind an explicit user confirmation in the UI, same as the
/// existing engine-code clear.
pub fn clear_dtcs(drv: &mut ElmDriver) -> Result<bool, ElmError> {
    let raw = drv.cmd("14FFFFFF", Duration::from_secs(5))?;
    let bytes = parser::clean_response(&raw);
    let payload = parser::payload_bytes(&bytes, "");
    // Positive response starts with 0x54; negative with 7F 14 <code>.
    Ok(payload.first() == Some(&0x54))
}

#[derive(Serialize, Clone)]
pub struct UdsHit {
    pub did: u16,
    pub hex: String,
    pub ascii: String,
}

pub fn to_hit(did: u16, data: &[u8]) -> UdsHit {
    UdsHit {
        did,
        hex: data.iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(" "),
        ascii: data.iter().map(|&b| if (32..127).contains(&b) { b as char } else { '.' }).collect(),
    }
}

/// Extract a numeric value out of a DID payload: big-endian integer at
/// `offset`, `len` bytes, then value * scale + bias.
pub fn extract(data: &[u8], offset: usize, len: usize, scale: f64, bias: f64) -> Option<f64> {
    if offset + len > data.len() || len == 0 || len > 4 {
        return None;
    }
    let mut v: u32 = 0;
    for &b in &data[offset..offset + len] {
        v = (v << 8) | b as u32;
    }
    Some(v as f64 * scale + bias)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_single_byte_percent() {
        // e.g. SOC byte 0x50 = 80 %
        assert_eq!(extract(&[0x50], 0, 1, 1.0, 0.0), Some(80.0));
    }

    #[test]
    fn extract_u16_millivolts() {
        // 0x36B0 = 14000 mV * 0.001 = 14.0 V
        assert_eq!(extract(&[0x36, 0xB0], 0, 2, 0.001, 0.0), Some(14.0));
    }

    #[test]
    fn extract_out_of_range() {
        assert_eq!(extract(&[0x01], 1, 1, 1.0, 0.0), None);
    }

    #[test]
    fn resolve_builtin() {
        let m = resolve("engine", &[]).unwrap();
        assert_eq!(m.req, "6A8");
        assert!(m.builtin);
    }

    #[test]
    fn resolve_custom_module() {
        let custom = vec![UdsModule {
            key: "pcm".into(),
            label: "Ford PCM (example)".into(),
            req: "7E0".into(),
            resp: "7E8".into(),
            builtin: false,
        }];
        let m = resolve("pcm", &custom).unwrap();
        assert_eq!(m.req, "7E0");
        assert!(!m.builtin);
        // Built-ins still resolve even when a custom list is supplied.
        assert!(resolve("engine", &custom).is_some());
    }
}
