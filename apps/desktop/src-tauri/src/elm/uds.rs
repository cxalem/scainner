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
//! Every clear that is actually sent lands in the `writes_log` audit table
//! with the state read before and after (see db.rs and
//! docs/workflows/write-caps/plan.md).

use super::driver::{ElmDriver, ElmError};
use super::parser;
use crate::db::Db;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::Emitter;

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

// ---------------------------------------------------------------------------
// Orchestration: the higher-level operations built on the primitives above.
// Everything below talks to the DB (for user-added modules and probes) and,
// for scans, emits progress events to the UI.
// ---------------------------------------------------------------------------

/// Everything the UI needs to explain a module-clear honestly: what was
/// there before, whether the module accepted the clear, and what's left.
#[derive(Serialize, Clone)]
pub struct ClearOutcome {
    pub before: Vec<String>,
    pub accepted: bool,
    pub after: Vec<String>,
}

/// Custom modules from the DB, converted to `UdsModule`. A tiny adapter so
/// `db.rs` doesn't need to know about this module's types.
fn custom_modules(db: &Db) -> Vec<UdsModule> {
    db.list_uds_modules()
        .into_iter()
        .map(|(key, label, req, resp)| UdsModule { key, label, req, resp, builtin: false })
        .collect()
}

/// Read → clear → read again, so the UI can show a verified before/after
/// instead of a blind "done". Every attempt that actually sends the clear
/// lands in `writes_log`, success or failure (the write safety rail). A
/// failed before-read aborts WITHOUT clearing: a write whose prior state
/// could not be captured would break the audit trail, so it must not happen.
pub fn clear_module(
    drv: &mut ElmDriver,
    db: &Db,
    module: &str,
    ctx: super::supervisor::ConnCtx,
) -> Result<ClearOutcome, String> {
    let custom = custom_modules(db);
    let m = resolve(module, &custom).ok_or("unknown module")?;
    setup(drv, &m).map_err(|e| e.to_string())?;
    let params = serde_json::json!({ "service": "14", "group": "FFFFFF" });
    let codes_json = |v: &Vec<String>| serde_json::json!(v);
    let conn_id = Some(ctx.connection_id);
    let before = match read_dtcs(drv) {
        Ok(b) => b,
        Err(e) => {
            teardown(drv);
            return Err(format!("Could not read the faults before clearing, so nothing was cleared: {e}"));
        }
    };
    let accepted = match clear_dtcs(drv) {
        Ok(ok) => ok,
        Err(e) => {
            db.log_write(conn_id, ctx.vehicle_id, &m.label, "clear_faults", &params, Some(&codes_json(&before)), None, "error", Some(&e.to_string()));
            teardown(drv);
            return Err(e.to_string());
        }
    };
    let after = match read_dtcs(drv) {
        Ok(a) => a,
        Err(e) => {
            db.log_write(
                conn_id,
                ctx.vehicle_id,
                &m.label,
                "clear_faults",
                &params,
                Some(&codes_json(&before)),
                None,
                "error",
                Some(&format!("clear sent, but the verification read failed: {e}")),
            );
            teardown(drv);
            return Err(format!("The clear was sent, but the verification read failed: {e}"));
        }
    };
    teardown(drv);
    let outcome = if !accepted {
        "refused"
    } else if after.is_empty() {
        "cleared"
    } else {
        "faults_remain"
    };
    db.log_write(conn_id, ctx.vehicle_id, &m.label, "clear_faults", &params, Some(&codes_json(&before)), Some(&codes_json(&after)), outcome, None);
    Ok(ClearOutcome { before, accepted, after })
}

pub fn module_dtcs(drv: &mut ElmDriver, db: &Db, module: &str) -> Result<Vec<String>, String> {
    let custom = custom_modules(db);
    let m = resolve(module, &custom).ok_or("unknown module")?;
    setup(drv, &m).map_err(|e| e.to_string())?;
    let res = read_dtcs(drv).map_err(|e| e.to_string());
    teardown(drv);
    res
}

pub fn read_one(drv: &mut ElmDriver, db: &Db, module: &str, did: u16) -> Result<Option<UdsHit>, String> {
    let custom = custom_modules(db);
    let m = resolve(module, &custom).ok_or("unknown module")?;
    setup(drv, &m).map_err(|e| e.to_string())?;
    let res = read_did(drv, did).map_err(|e| e.to_string());
    teardown(drv);
    res.map(|opt| opt.map(|d| to_hit(did, &d)))
}

/// Scan a DID range on one module. Capped at 256 DIDs per call to bound wall-
/// clock time to well under the ask() timeout (see lib.rs); the UI chunks
/// bigger ranges into repeated calls, updating its results after each one.
///
/// Bug fixed 2026-08-14: this used to cap at 512 DIDs with a 1500ms per-DID
/// timeout (worst case ~13 min for one call) against a hardcoded 60s ask()
/// timeout — a scan running long enough would blow past that ceiling, the
/// frontend would show a "timed out" error while this function kept running
/// to completion (or the ELM's response landed after the caller had already
/// dropped the reply channel), and the WHOLE supervisor thread — including
/// live gauge polling and Disconnect — was unresponsive for the entire scan,
/// which reads as "the app crashed". Fixed by: a much shorter per-DID
/// timeout for scans, a smaller chunk cap, a matching longer ask() ceiling
/// (a safety net now, not the everyday UX timer), and real cancellation via
/// `cancel_scan` so a stuck scan releases within one DID's timeout instead of
/// running to completion regardless.
pub fn scan_range(
    drv: &mut ElmDriver,
    db: &Db,
    module: &str,
    from: u16,
    to: u16,
    cancel_scan: &AtomicBool,
    app: &tauri::AppHandle,
) -> Result<Vec<UdsHit>, String> {
    log::debug!("scan request: module={module} from={from:04X} to={to:04X}");
    let custom = custom_modules(db);
    let m = match resolve(module, &custom) {
        Some(m) => m,
        None => {
            log::warn!("scan aborted: unknown module {module:?}");
            return Err("unknown module".into());
        }
    };
    let to = to.min(from.saturating_add(255));
    log::debug!("scan clamped to {from:04X}-{to:04X} ({} DIDs)", to - from + 1);
    if let Err(e) = setup(drv, &m) {
        log::warn!("scan setup failed: {e}");
        return Err(e.to_string());
    }
    let total = (to - from + 1) as u32;
    let mut hits = Vec::new();
    let mut errors = 0u32;
    for (i, did) in (from..=to).enumerate() {
        if i % 8 == 0 {
            log::trace!("scan progress: DID {did:04X} ({i}/{total}), {} hits, {errors} errors", hits.len());
            let _ = app.emit("uds-scan-progress", serde_json::json!({
                "current": i as u32,
                "total": total,
                "did": format!("{did:04X}"),
                "hits": hits.len(),
            }));
        }
        if cancel_scan.swap(false, Ordering::Relaxed) {
            log::debug!("scan cancelled at DID {did:04X}, {} hits kept", hits.len());
            teardown(drv);
            return Err(format!("cancelled at DID {did:04X}; {} hits kept", hits.len()));
        }
        if i % 40 == 39 {
            tester_present(drv);
        }
        match read_did_timeout(drv, did, Duration::from_millis(600)) {
            Ok(Some(d)) => hits.push(to_hit(did, &d)),
            Ok(None) => {}
            Err(ref e) => {
                log::debug!("scan read error at DID {did:04X}: {e}");
                errors += 1;
                if errors > 10 {
                    log::warn!("scan aborted: too many link errors ({errors}) at DID {did:04X}");
                    teardown(drv);
                    return Err(format!("link degraded mid-scan at DID {did:04X}; {} hits so far kept", hits.len()));
                }
            }
        }
    }
    log::debug!("scan completed: {} hits, {errors} errors", hits.len());
    teardown(drv);
    Ok(hits)
}

/// Poll all enabled user-defined UDS probes once; record + return values.
pub fn poll_probes(drv: &mut ElmDriver, db: &Db, ctx: super::supervisor::ConnCtx) -> HashMap<String, f64> {
    let mut out = HashMap::new();
    let probes: Vec<_> = db.list_probes().into_iter().filter(|p| p.enabled).collect();
    if probes.is_empty() {
        return out;
    }
    let mut by_module: HashMap<String, Vec<&crate::db::UdsProbe>> = HashMap::new();
    for p in &probes {
        by_module.entry(p.module.clone()).or_default().push(p);
    }
    let custom = custom_modules(db);
    for (mkey, group) in by_module {
        let Some(m) = resolve(&mkey, &custom) else { continue };
        if setup(drv, &m).is_err() {
            continue;
        }
        for p in group {
            if let Ok(Some(data)) = read_did(drv, p.did) {
                if let Some(v) = extract(&data, p.offset, p.len, p.scale, p.bias) {
                    let key = format!("uds_{}", p.label.to_lowercase().replace(' ', "_"));
                    db.insert_reading(ctx.connection_id, ctx.vehicle_id, &key, v);
                    out.insert(key, v);
                }
            }
        }
    }
    teardown(drv);
    out
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
