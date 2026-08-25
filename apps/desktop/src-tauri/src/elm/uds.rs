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
//! READ-ONLY by default: automatic discovery and ordinary reads only send
//! ReadDataByIdentifier (0x22). Explicit manual operations may additionally
//! request DiagnosticSessionControl (0x10 0x03) and TesterPresent (0x3E), plus
//! ClearDiagnosticInformation (0x14) when the user explicitly asks to clear
//! codes — the same operation every commercial diagnostic tool performs, and
//! it can only erase stored records. No writes, no routines, no resets.
//! Every clear that is actually sent lands in the `writes_log` audit table
//! with the state read before and after (see db.rs and
//! docs/workflows/write-caps/plan.md).

use super::driver::{ElmDriver, ElmError};
use super::parser;
use super::uds_map;
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

/// True when either side of a module's address pair does not fit in 11 bits,
/// i.e. the module is addressed with 29-bit extended CAN identifiers
/// (ISO 15765-2 normal fixed addressing, `18DA<target><source>`).
fn address_pair(m: &UdsModule) -> Result<(u32, u32, bool), ElmError> {
    let invalid = || ElmError::Handshake(format!("invalid CAN address pair {}/{}", m.req, m.resp));
    let req = uds_map::can_address(&m.req).ok_or_else(&invalid)?;
    let resp = uds_map::can_address(&m.resp).ok_or_else(&invalid)?;
    let req_extended = req > 0x7FF;
    if req_extended != (resp > 0x7FF) {
        return Err(ElmError::Handshake(format!(
            "mixed 11-bit/29-bit CAN address pair {}/{}",
            m.req, m.resp
        )));
    }
    Ok((req, resp, req_extended))
}

fn format_can_address(address: u32) -> String {
    if address <= 0x7FF {
        format!("{address:03X}")
    } else {
        format!("{address:08X}")
    }
}

/// Split a 29-bit identifier into the ELM327's two halves. The ELM sets an
/// extended header as a priority byte (`AT CP`) plus the remaining three
/// bytes (`AT SH`) — it does not take one eight-digit value for `AT SH`.
/// For `18DAC7F1` that is priority `18` and header `DAC7F1`.
fn split_extended(addr: u32) -> (u8, u32) {
    (((addr >> 24) & 0xFF) as u8, addr & 0x00FF_FFFF)
}

fn addressing_commands(m: &UdsModule) -> Result<Vec<String>, ElmError> {
    let (req, resp, extended) = address_pair(m)?;

    // 29-bit extended addressing. Needed for whole classes of modules that
    // are simply unreachable over 11-bit: PSA/Stellantis TPMS lives at
    // 18DAC7F1, and the map already records GM's Ultium modules the same
    // way. Protocol 7 is CAN 29-bit 500k; the receive filter and flow
    // control header both take the full eight-digit identifier.
    if extended {
        let (priority, header) = split_extended(req);
        return Ok(vec![
            "ATSP7".to_string(),
            "ATCAF1".to_string(),
            "ATH0".to_string(),
            format!("ATCP {priority:02X}"),
            format!("ATSH {header:06X}"),
            format!("ATCRA {resp:08X}"),
            format!("ATFCSH {req:08X}"),
            "ATFCSD 300000".to_string(),
            "ATFCSM 1".to_string(),
        ]);
    }

    Ok(vec![
        "ATSP6".to_string(),
        "ATCAF1".to_string(),
        "ATH0".to_string(),
        format!("ATSH {req:03X}"),
        format!("ATCRA {resp:03X}"),
        format!("ATFCSH {req:03X}"),
        "ATFCSD 300000".to_string(),
        "ATFCSM 1".to_string(),
    ])
}

/// Point the ELM at one module with physical addressing: CAN 500k, 11-bit or
/// 29-bit depending on the module's recorded address pair.
/// This deliberately does not change the ECU's diagnostic session.
pub fn setup_addressing(drv: &mut ElmDriver, m: &UdsModule) -> Result<(), ElmError> {
    for c in addressing_commands(m)? {
        drv.cmd(&c, Duration::from_secs(2))?;
    }
    Ok(())
}

/// Enter an extended session only for an explicit, bounded user operation.
/// The boolean records whether the ECU positively acknowledged the request,
/// so cleanup never sends a session transition to an ECU we did not open.
pub fn enter_extended_session(drv: &mut ElmDriver) -> bool {
    let Ok(raw) = drv.cmd("1003", Duration::from_secs(2)) else {
        return false;
    };
    let lines = parser::clean_response(&raw);
    let bytes = parser::payload_bytes(&lines, "");
    bytes.windows(2).any(|w| w == [0x50, 0x03])
}

/// Restore functional OBD-II addressing so normal PID polling keeps working.
///
/// The protocol reset is not cosmetic. `setup_addressing` pins the adapter to
/// a specific CAN protocol (6 for 11-bit, 7 for 29-bit), and until this ran
/// `ATSP0` the setting leaked for the rest of the connection: one visit to the
/// Lab left a non-CAN car — the repo has a live ISO 14230-4 K-line Peugeot on
/// record — unable to answer anything afterwards. `ATSP0` puts the adapter
/// back into automatic detection, which is what `connect` uses.
pub fn teardown(drv: &mut ElmDriver) {
    let _ = drv.cmd("ATSP0", Duration::from_secs(2));
    let _ = drv.cmd("ATSH 7DF", Duration::from_secs(2));
    let _ = drv.cmd("ATAR", Duration::from_secs(2));
    let _ = drv.cmd("ATFCSM 0", Duration::from_secs(2));
}

fn finish_operation(drv: &mut ElmDriver, extended_session_open: bool) {
    leave_extended_session(drv, extended_session_open);
    teardown(drv);
}

fn leave_extended_session(drv: &mut ElmDriver, extended_session_open: bool) {
    if extended_session_open {
        let _ = drv.cmd("1001", Duration::from_millis(800));
    }
}

/// ReadDataByIdentifier. Ok(Some(bytes)) on 62-response, Ok(None) on negative
/// response / silence, Err on transport failure. Single-DID reads use a
/// generous 1500ms; range scans pass a shorter timeout (see `read_did_timeout`)
/// since most of a scan's time is spent waiting out silence on unsupported DIDs.
pub fn read_did(drv: &mut ElmDriver, did: u16) -> Result<Option<Vec<u8>>, ElmError> {
    read_did_timeout(drv, did, Duration::from_millis(1500))
}

pub fn read_did_timeout(
    drv: &mut ElmDriver,
    did: u16,
    timeout: Duration,
) -> Result<Option<Vec<u8>>, ElmError> {
    let raw = match drv.cmd(&format!("22{did:04X}"), timeout) {
        Ok(r) => r,
        Err(ElmError::NoResponse) => return Ok(None),
        Err(e) => return Err(e),
    };
    let lines = parser::clean_response(&raw);
    let bytes = parser::payload_bytes(&lines, "");
    for i in 0..bytes.len().saturating_sub(2) {
        if bytes[i] == 0x62
            && bytes[i + 1] == (did >> 8) as u8
            && bytes[i + 2] == (did & 0xFF) as u8
        {
            return Ok(Some(bytes[i + 3..].to_vec()));
        }
    }
    Ok(None)
}

/// Keep an explicitly opened extended session alive without asking the ECU
/// to transmit a positive response for every heartbeat.
pub fn tester_present(drv: &mut ElmDriver) {
    let _ = drv.cmd("3E80", Duration::from_millis(800));
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
        hex: data
            .iter()
            .map(|b| format!("{b:02X}"))
            .collect::<Vec<_>>()
            .join(" "),
        ascii: data
            .iter()
            .map(|&b| {
                if (32..127).contains(&b) {
                    b as char
                } else {
                    '.'
                }
            })
            .collect(),
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
        .map(|(key, label, req, resp)| UdsModule {
            key,
            label,
            req,
            resp,
            builtin: false,
        })
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
    setup_addressing(drv, &m).map_err(|e| e.to_string())?;
    let extended_session_open = enter_extended_session(drv);
    let params = serde_json::json!({ "service": "14", "group": "FFFFFF" });
    let codes_json = |v: &Vec<String>| serde_json::json!(v);
    let conn_id = Some(ctx.connection_id);
    let before = match read_dtcs(drv) {
        Ok(b) => b,
        Err(e) => {
            finish_operation(drv, extended_session_open);
            return Err(format!(
                "Could not read the faults before clearing, so nothing was cleared: {e}"
            ));
        }
    };
    let accepted = match clear_dtcs(drv) {
        Ok(ok) => ok,
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
                Some(&e.to_string()),
            );
            finish_operation(drv, extended_session_open);
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
                Some(&format!(
                    "clear sent, but the verification read failed: {e}"
                )),
            );
            finish_operation(drv, extended_session_open);
            return Err(format!(
                "The clear was sent, but the verification read failed: {e}"
            ));
        }
    };
    finish_operation(drv, extended_session_open);
    let outcome = if !accepted {
        "refused"
    } else if after.is_empty() {
        "cleared"
    } else {
        "faults_remain"
    };
    db.log_write(
        conn_id,
        ctx.vehicle_id,
        &m.label,
        "clear_faults",
        &params,
        Some(&codes_json(&before)),
        Some(&codes_json(&after)),
        outcome,
        None,
    );
    Ok(ClearOutcome {
        before,
        accepted,
        after,
    })
}

pub fn module_dtcs(drv: &mut ElmDriver, db: &Db, module: &str) -> Result<Vec<String>, String> {
    let custom = custom_modules(db);
    let m = resolve(module, &custom).ok_or("unknown module")?;
    setup_addressing(drv, &m).map_err(|e| e.to_string())?;
    let res = read_dtcs(drv).map_err(|e| e.to_string());
    teardown(drv);
    res
}

pub fn read_one(
    drv: &mut ElmDriver,
    db: &Db,
    module: &str,
    did: u16,
) -> Result<Option<UdsHit>, String> {
    let custom = custom_modules(db);
    let m = resolve(module, &custom).ok_or("unknown module")?;
    setup_addressing(drv, &m).map_err(|e| e.to_string())?;
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
    log::debug!(
        "scan clamped to {from:04X}-{to:04X} ({} DIDs)",
        to - from + 1
    );
    // A manual range scan can request an extended session, so retain the
    // engine-start protection. Automatic discovery never opens one.
    let baseline_voltage = read_voltage(drv);
    if let Err(e) = setup_addressing(drv, &m) {
        log::warn!("scan setup failed: {e}");
        return Err(e.to_string());
    }
    // This is an explicit Lab operation. Request extended mode, but continue
    // in default mode if the ECU refuses it: many useful DIDs are available
    // there and a refusal must not turn into more session traffic.
    let extended_session_open = enter_extended_session(drv);
    let total = (to - from + 1) as u32;
    let mut hits = Vec::new();
    let mut errors = 0u32;
    for (i, did) in (from..=to).enumerate() {
        if i % 8 == 0 {
            log::trace!(
                "scan progress: DID {did:04X} ({i}/{total}), {} hits, {errors} errors",
                hits.len()
            );
            let _ = app.emit(
                "uds-scan-progress",
                serde_json::json!({
                    "current": i as u32,
                    "total": total,
                    "did": format!("{did:04X}"),
                    "hits": hits.len(),
                }),
            );
        }
        if cancel_scan.swap(false, Ordering::Relaxed) {
            log::debug!("scan cancelled at DID {did:04X}, {} hits kept", hits.len());
            finish_operation(drv, extended_session_open);
            return Err(format!(
                "cancelled at DID {did:04X}; {} hits kept",
                hits.len()
            ));
        }
        if i % 20 == 19
            && matches!(
                (baseline_voltage, read_voltage(drv)),
                (Some(base), Some(now)) if engine_likely_started(now, base)
            )
        {
            log::warn!("scan auto-stopped at DID {did:04X}: engine start detected");
            finish_operation(drv, extended_session_open);
            return Err(format!("engine_started:{did:04X}:{}", hits.len()));
        }
        if extended_session_open && i % 40 == 39 {
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
                    finish_operation(drv, extended_session_open);
                    return Err(format!(
                        "link degraded mid-scan at DID {did:04X}; {} hits so far kept",
                        hits.len()
                    ));
                }
            }
        }
    }
    log::debug!("scan completed: {} hits, {errors} errors", hits.len());
    finish_operation(drv, extended_session_open);
    Ok(hits)
}

/// Poll all enabled user-defined UDS probes once; record + return values.
pub fn poll_probes(
    drv: &mut ElmDriver,
    db: &Db,
    ctx: super::supervisor::ConnCtx,
) -> HashMap<String, f64> {
    let mut out = HashMap::new();
    // Discovery is read-only inventory, not standing telemetry. Repeatedly
    // opening diagnostic sessions on every discovered ECU while the app was
    // merely connected caused the exact dashboard communication warnings
    // discovery itself warns about. Only probes a user explicitly created
    // in the advanced Lab remain eligible for periodic polling.
    let probes: Vec<_> = db
        .list_probes(ctx.vehicle_id)
        .into_iter()
        .filter(should_poll_probe)
        .collect();
    if probes.is_empty() {
        return out;
    }
    let mut by_module: HashMap<String, Vec<&crate::db::UdsProbe>> = HashMap::new();
    for p in &probes {
        by_module.entry(p.module.clone()).or_default().push(p);
    }
    let custom = custom_modules(db);
    for (mkey, group) in by_module {
        let Some(m) = resolve(&mkey, &custom) else {
            continue;
        };
        if setup_addressing(drv, &m).is_err() {
            teardown(drv);
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
        // Close each module's session while it is still addressed. A final
        // teardown after the loop only ever reached the last module and left
        // every earlier ECU waiting for its session timeout.
        teardown(drv);
    }
    out
}

fn should_poll_probe(probe: &crate::db::UdsProbe) -> bool {
    probe.enabled && probe.origin == "manual"
}

// ---------- auto-discovery (the "no ranges, one button" engine) ----------
// Owner call 2026-08-23: nobody knows DID ranges, so ranges must not be a
// user concept. Three read-only phases: enumerate module addresses → read
// each module's STANDARD identification block (ISO 14229 F18x/F19x — the
// one corner of UDS that is as universal as OBD PIDs) → sweep
// brand-prioritized "hot bands" where manufacturers actually cluster their
// data DIDs. Every finding persists to discovered_modules/discovered_dids,
// so a pass runs once per car, ever.

#[derive(Serialize, Clone)]
pub struct DiscoveryReport {
    pub modules_found: u32,
    pub dids_found: u32,
    /// Of `dids_found`, how many the knowledge map had a FULL decode
    /// formula for (offset+len+scale+bias, not just a label) — those are
    /// promoted into `uds_probes` during the same pass so their definitions
    /// are available to the Live view. Discovery-owned probes remain off
    /// background polling; reading them requires an explicit user action.
    /// Everything else in `dids_found` is
    /// unlabeled or label-only — real data, saved, but the map doesn't yet
    /// know how to turn its bytes into a number, so it stays browsable in
    /// the Lab rather than pretending to be a live value.
    pub sensors_added: u32,
    /// True when the scan didn't finish — findings so far are still
    /// saved either way. `auto_stopped_reason` says why: user-pressed-
    /// cancel vs the safety auto-stop below have very different UI
    /// treatments.
    pub cancelled: bool,
    /// Some("engine_started") when the scan aborted ITSELF because
    /// engine start was detected mid-scan (a voltage jump — see
    /// `engine_likely_started`) — never a guess the user has to notice.
    /// Distinct from a plain user cancel so the UI can explain why and
    /// point at the real risk: changing vehicle state during a broad
    /// diagnostic sweep makes bus behavior less predictable. Automatic
    /// discovery itself stays in the default diagnostic session.
    pub auto_stopped_reason: Option<String>,
    /// True when this pass re-probed only what a PRIOR discovery already
    /// found on this car, instead of the full blind sweep — "a re-scan
    /// shouldn't take that long" (owner, 2026-08-24). The UI can show a
    /// quieter "refreshed" summary instead of the full-discovery one.
    pub was_fast_refresh: bool,
}

/// Find (or register) a custom module key for this request/response pair,
/// so an auto-promoted probe has something to hand `uds::setup` — probes
/// are addressed by module KEY (built-in or custom), never raw hex,
/// matching the manual save-as-probe path exactly.
fn ensure_module_key(db: &Db, req: u32, resp: u32, name: Option<&str>) -> String {
    let req_hex = format_can_address(req);
    let resp_hex = format_can_address(resp);
    if let Some(m) = builtin_modules()
        .into_iter()
        .find(|m| m.req == req_hex && m.resp == resp_hex)
    {
        return m.key;
    }
    if let Some(m) = custom_modules(db)
        .into_iter()
        .find(|m| m.req == req_hex && m.resp == resp_hex)
    {
        return m.key;
    }
    let key = format!(
        "auto_{}_{}",
        req_hex.to_lowercase(),
        resp_hex.to_lowercase()
    );
    let label = name
        .map(str::to_string)
        .unwrap_or_else(|| format!("Discovered module {req_hex}"));
    // A concurrent discovery pass racing to register the same key is not a
    // realistic scenario (one connection, one scan at a time) — if it ever
    // fails on a duplicate, the key is already usable regardless.
    let _ = db.add_uds_module(&key, &label, &req_hex, &resp_hex);
    key
}

/// Point physical addressing at one request/response pair without the full
/// per-module session dance — used while enumerating many addresses.
#[derive(Default)]
struct AddressingState {
    extended: Option<bool>,
}

fn point_at(
    drv: &mut ElmDriver,
    req: u32,
    resp: u32,
    state: &mut AddressingState,
) -> Result<(), ElmError> {
    let module = UdsModule {
        key: String::new(),
        label: String::new(),
        req: format_can_address(req),
        resp: format_can_address(resp),
        builtin: false,
    };
    let (_, _, extended) = address_pair(&module)?;
    if state.extended != Some(extended) {
        for command in if extended {
            ["ATSP7", "ATCAF1", "ATH0", "ATFCSD 300000", "ATFCSM 1"]
        } else {
            ["ATSP6", "ATCAF1", "ATH0", "ATFCSD 300000", "ATFCSM 1"]
        } {
            drv.cmd(command, Duration::from_secs(2))?;
        }
        state.extended = Some(extended);
    }
    if extended {
        let (priority, header) = split_extended(req);
        drv.cmd(&format!("ATCP {priority:02X}"), Duration::from_secs(2))?;
        drv.cmd(&format!("ATSH {header:06X}"), Duration::from_secs(2))?;
        drv.cmd(&format!("ATCRA {resp:08X}"), Duration::from_secs(2))?;
        drv.cmd(&format!("ATFCSH {req:08X}"), Duration::from_secs(2))?;
    } else {
        drv.cmd(&format!("ATSH {req:03X}"), Duration::from_secs(2))?;
        drv.cmd(&format!("ATCRA {resp:03X}"), Duration::from_secs(2))?;
        drv.cmd(&format!("ATFCSH {req:03X}"), Duration::from_secs(2))?;
    }
    Ok(())
}

/// Is anything at this address? A positive (62…) OR a negative (7F 22 …)
/// reply both prove presence — read_did can't tell those apart from
/// silence (it maps both non-answers to None), so classify the raw bytes.
fn probe_addr(drv: &mut ElmDriver, timeout: Duration) -> bool {
    let did = uds_map::presence_probe_did();
    match drv.cmd(&format!("22{did:04X}"), timeout) {
        Err(_) => false,
        Ok(raw) => {
            let lines = parser::clean_response(&raw);
            let bytes = parser::payload_bytes(&lines, "");
            bytes
                .windows(2)
                .any(|w| w[0] == 0x62 || (w[0] == 0x7F && w[1] == 0x22))
        }
    }
}

fn printable(data: &[u8]) -> Option<String> {
    let s: String = data
        .iter()
        .map(|&b| {
            if (32..127).contains(&b) {
                b as char
            } else {
                '.'
            }
        })
        .collect();
    let clean = s.trim_matches('.').to_string();
    if clean.len() >= 4 && clean.chars().filter(|c| c.is_ascii_alphanumeric()).count() >= 3 {
        Some(clean)
    } else {
        None
    }
}

fn hex_string(data: &[u8]) -> String {
    data.iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}

/// The adapter's own battery voltage (ATRV) — a local command, answered
/// regardless of the scan's current UDS addressing/session state, which
/// is exactly why it's the cheap way to notice the engine started mid-scan
/// without disturbing the scan itself.
fn parse_voltage_response(raw: &str) -> Option<f64> {
    // `cmd` returns the complete ELM frame, normally `12.6V\r\r>`. Parsing
    // that string directly left the CR between the value and prompt, so the
    // engine-start safety guard silently returned None on a real adapter.
    parser::clean_response(raw)
        .first()
        .and_then(|line| parser::decode_voltage(line))
}

fn read_voltage(drv: &mut ElmDriver) -> Option<f64> {
    let raw = drv.cmd("ATRV", Duration::from_millis(400)).ok()?;
    parse_voltage_response(&raw)
}

/// True once voltage climbs enough above THIS scan's own starting
/// baseline to mean the engine started (alternator now charging) — not
/// just normal resting-battery drift. Both a floor and a relative jump
/// are required so a healthy 12.6V-resting battery never false-triggers.
fn engine_likely_started(current: f64, baseline: f64) -> bool {
    current > 13.2 && current > baseline + 0.6
}

/// Parses a "REQ/RESP" module_address string back into addresses — the
/// exact format `discover()` writes via `upsert_discovered_module`.
fn parse_module_address(addr: &str) -> Option<(u32, u32)> {
    let (req, resp) = addr.split_once('/')?;
    Some((uds_map::can_address(req)?, uds_map::can_address(resp)?))
}

/// Reconcile only probes discovery owns against the current knowledge map.
/// This is independent of whether today's car scan happens to get a reply,
/// so a transient timeout cannot delete a valid sensor. A probe is stale
/// only when its module/DID no longer has a complete mapped formula.
fn prune_stale_discovery_probes(db: &Db, vehicle_id: i64, vin: Option<&str>) {
    let custom = custom_modules(db);
    for probe in db
        .list_probes(Some(vehicle_id))
        .into_iter()
        .filter(|p| p.vehicle_id == Some(vehicle_id) && p.origin == "discovery")
    {
        let still_known = resolve(&probe.module, &custom)
            .and_then(|m| {
                Some((
                    uds_map::can_address(&m.req)?,
                    uds_map::can_address(&m.resp)?,
                ))
            })
            .and_then(|(req, resp)| uds_map::known_did(vin, req, resp, probe.did))
            .is_some_and(|k| {
                k.offset.is_some() && k.len.is_some() && k.scale.is_some() && k.bias.is_some()
            });
        if !still_known {
            log::info!(
                "discovery: removing stale auto probe {} / {:04X}",
                probe.module,
                probe.did
            );
            db.delete_discovery_probe(probe.id);
        }
    }
}

pub fn discover(
    drv: &mut ElmDriver,
    db: &Db,
    vehicle_id: i64,
    vin: Option<String>,
    cancel_scan: &AtomicBool,
    app: &tauri::AppHandle,
    full: bool,
) -> Result<DiscoveryReport, String> {
    let emit = |phase: &str, current: u32, total: u32, detail: &str, modules: u32, dids: u32| {
        let _ = app.emit(
            "discovery-progress",
            serde_json::json!({
                "phase": phase, "current": current, "total": total,
                "detail": detail, "modulesFound": modules, "didsFound": dids,
            }),
        );
    };

    prune_stale_discovery_probes(db, vehicle_id, vin.as_deref());

    let baseline_voltage = {
        for c in ["ATSP6", "ATCAF1", "ATH0", "ATFCSD 300000", "ATFCSM 1"] {
            drv.cmd(c, Duration::from_secs(2))
                .map_err(|e| e.to_string())?;
        }
        read_voltage(drv)
    };
    let mut addressing = AddressingState {
        extended: Some(false),
    };
    let engine_started = |drv: &mut ElmDriver| -> bool {
        match (baseline_voltage, read_voltage(drv)) {
            (Some(base), Some(now)) => engine_likely_started(now, base),
            _ => false, // couldn't read voltage this tick — never false-abort on a read hiccup
        }
    };

    // Fast re-scan (owner, 2026-08-24): a car already discovered doesn't
    // need the full blind sweep again — re-probe exactly what was found
    // last time. Fresh discovery (full=true, or a car with no prior data)
    // still runs the complete three-phase pass below.
    let known = db.discovered_addresses_and_dids(vehicle_id);
    if !full && !known.is_empty() {
        return fast_refresh(
            drv,
            db,
            vehicle_id,
            vin.as_deref(),
            &known,
            baseline_voltage,
            cancel_scan,
            &emit,
            &engine_started,
            &mut addressing,
        );
    }

    // Phase 1 — who's on the bus? Addresses come from the map: this
    // brand's documented modules first (a recognized car finds its real
    // modules in seconds), then the conventional range behind them.
    let timings = &uds_map::map().standard.timings_ms;
    let addrs = uds_map::addresses_to_probe(vin.as_deref());
    let total_addrs = addrs.len() as u32;
    let mut present: Vec<(u32, u32, Option<String>)> = Vec::new();
    for (i, (req, resp, known_name)) in addrs.iter().enumerate() {
        if cancel_scan.swap(false, Ordering::Relaxed) {
            teardown(drv);
            return Ok(DiscoveryReport {
                modules_found: present.len() as u32,
                dids_found: 0,
                sensors_added: 0,
                cancelled: true,
                auto_stopped_reason: None,
                was_fast_refresh: false,
            });
        }
        if i % 20 == 19 && engine_started(drv) {
            log::warn!("discovery: engine start detected (voltage jump) — stopping to avoid a module mid-session when it starts");
            teardown(drv);
            return Ok(DiscoveryReport {
                modules_found: present.len() as u32,
                dids_found: 0,
                sensors_added: 0,
                cancelled: true,
                auto_stopped_reason: Some("engine_started".into()),
                was_fast_refresh: false,
            });
        }
        if i % 4 == 0 {
            emit(
                "modules",
                i as u32,
                total_addrs,
                &format_can_address(*req),
                present.len() as u32,
                0,
            );
        }
        if point_at(drv, *req, *resp, &mut addressing).is_err() {
            continue;
        }
        if probe_addr(drv, Duration::from_millis(timings.presence_probe)) {
            log::info!(
                "discovery: module answering at {}/{}",
                format_can_address(*req),
                format_can_address(*resp)
            );
            present.push((*req, *resp, known_name.clone()));
        }
    }

    // Phase 2 — the standard identification block per present module.
    let ident_dids = uds_map::ident_dids();
    let name_dids = uds_map::name_dids();
    let mut dids_found = 0u32;
    let mut module_rows: Vec<(i64, u32, u32)> = Vec::new();
    let total_ident = (present.len() * ident_dids.len()) as u32;
    for (mi, (req, resp, known_name)) in present.iter().enumerate() {
        if point_at(drv, *req, *resp, &mut addressing).is_err() {
            continue;
        }
        // A name the map already documents beats anything read off the bus.
        let mut name: Option<String> = known_name.clone();
        let mut best_name_rank = usize::MAX;
        let mut ident_hits: Vec<(u16, Vec<u8>)> = Vec::new();
        for (di, did) in ident_dids.iter().enumerate() {
            if cancel_scan.swap(false, Ordering::Relaxed) {
                teardown(drv);
                // Phase 2 (identification) never promotes probes — that
                // only happens in phase 3's data sweep — so 0 is exact
                // here, not a placeholder.
                return Ok(DiscoveryReport {
                    modules_found: present.len() as u32,
                    dids_found,
                    sensors_added: 0,
                    cancelled: true,
                    auto_stopped_reason: None,
                    was_fast_refresh: false,
                });
            }
            if di % 3 == 2 && engine_started(drv) {
                log::warn!("discovery: engine start detected mid-identification — stopping");
                teardown(drv);
                return Ok(DiscoveryReport {
                    modules_found: present.len() as u32,
                    dids_found,
                    sensors_added: 0,
                    cancelled: true,
                    auto_stopped_reason: Some("engine_started".into()),
                    was_fast_refresh: false,
                });
            }
            emit(
                "ident",
                (mi * ident_dids.len() + di) as u32,
                total_ident,
                &format!("{}:{did:04X}", format_can_address(*req)),
                present.len() as u32,
                dids_found,
            );
            if let Ok(Some(data)) =
                read_did_timeout(drv, *did, Duration::from_millis(timings.ident_read))
            {
                if known_name.is_none() {
                    if let Some(rank) = name_dids.iter().position(|n| n == did) {
                        if rank < best_name_rank {
                            if let Some(p) = printable(&data) {
                                name = Some(p);
                                best_name_rank = rank;
                            }
                        }
                    }
                }
                ident_hits.push((*did, data));
            }
        }
        let module_id = db.upsert_discovered_module(
            vehicle_id,
            &format!("{}/{}", format_can_address(*req), format_can_address(*resp)),
            name.as_deref(),
        );
        for (did, data) in &ident_hits {
            let label = uds_map::map()
                .standard
                .ident_dids
                .iter()
                .find(|d| uds_map::hex16(&d.did) == Some(*did))
                .map(|d| d.label.clone())
                .or_else(|| printable(data));
            db.upsert_discovered_did(
                module_id,
                *did,
                &hex_string(data),
                data.len() as i64,
                label.as_deref(),
            );
            dids_found += 1;
        }
        module_rows.push((module_id, *req, *resp));
    }

    // Phase 3 — the brand's data neighborhoods, from the map.
    let bands = uds_map::bands_for_vin(vin.as_deref());
    let module_plans: Vec<_> = module_rows
        .into_iter()
        .map(|(module_id, req, resp)| {
            let mut dids: Vec<u16> = bands.iter().flat_map(|(from, to)| *from..=*to).collect();
            dids.extend(uds_map::known_dids_for_module(vin.as_deref(), req, resp));
            dids.sort_unstable();
            dids.dedup();
            (module_id, req, resp, dids)
        })
        .collect();
    let total_sweep = module_plans
        .iter()
        .map(|(_, _, _, dids)| dids.len() as u32)
        .sum();
    let mut sweep_i = 0u32;
    let mut sensors_added = 0u32;
    for (module_id, req, resp, dids) in &module_plans {
        if point_at(drv, *req, *resp, &mut addressing).is_err() {
            continue;
        }
        // Identification and module enumeration above always run in the
        // default session. Only an exact VIN + module profile may deepen
        // the data-band sweep automatically.
        let extended_session_open = matches!(
            uds_map::discovery_session_for_module(vin.as_deref(), *req, *resp),
            uds_map::DiscoverySession::DefaultThenExtended
        ) && enter_extended_session(drv);
        let mut consecutive_errors = 0u32;
        'dids: for did in dids.iter().copied() {
            sweep_i += 1;
            if cancel_scan.swap(false, Ordering::Relaxed) {
                finish_operation(drv, extended_session_open);
                return Ok(DiscoveryReport {
                    modules_found: present.len() as u32,
                    dids_found,
                    sensors_added,
                    cancelled: true,
                    auto_stopped_reason: None,
                    was_fast_refresh: false,
                });
            }
            if sweep_i % 20 == 19 && engine_started(drv) {
                log::warn!(
                        "discovery: engine start detected mid-sweep — stopping broad diagnostic traffic on {}",
                        format_can_address(*req)
                    );
                finish_operation(drv, extended_session_open);
                return Ok(DiscoveryReport {
                    modules_found: present.len() as u32,
                    dids_found,
                    sensors_added,
                    cancelled: true,
                    auto_stopped_reason: Some("engine_started".into()),
                    was_fast_refresh: false,
                });
            }
            if sweep_i % 8 == 0 {
                emit(
                    "sweep",
                    sweep_i,
                    total_sweep,
                    &format!("{}:{did:04X}", format_can_address(*req)),
                    present.len() as u32,
                    dids_found,
                );
            }
            if extended_session_open && sweep_i % 40 == 39 {
                tester_present(drv);
            }
            match read_did_timeout(drv, did, Duration::from_millis(timings.sweep_read)) {
                Ok(Some(data)) => {
                    consecutive_errors = 0;
                    // A hit the map already documents arrives named —
                    // that is the whole point of researching the map:
                    // discovery on a known brand yields labeled
                    // sensors, not anonymous hex.
                    let known = uds_map::known_did(vin.as_deref(), *req, *resp, did);
                    // Module-aware lookup above is the primary guard;
                    // payload shape is the independent second guard.
                    // Never label or promote a formula that cannot
                    // read the bytes this ECU returned, even if the
                    // map's address binding itself is correct.
                    let known = known.filter(|k| match (k.offset, k.len) {
                        (Some(offset), Some(len)) => (offset as usize)
                            .checked_add(len as usize)
                            .is_some_and(|end| end <= data.len()),
                        // Label-only knowledge has no byte shape to
                        // validate, so retain its browsable label. It
                        // can never be auto-promoted below.
                        _ => true,
                    });
                    let label = known.map(|k| k.label.clone());
                    db.upsert_discovered_did(
                        *module_id,
                        did,
                        &hex_string(&data),
                        data.len() as i64,
                        label.as_deref(),
                    );
                    dids_found += 1;
                    // A FULL decode formula (not just a label) means
                    // this isn't just "found," it's a real sensor —
                    // persist its decode definition for explicit live
                    // reads. Discovery never opts it into background
                    // polling merely because a formula matched.
                    if let Some(k) = known {
                        if let (Some(offset), Some(len), Some(scale), Some(bias)) =
                            (k.offset, k.len, k.scale, k.bias)
                        {
                            let module_key = ensure_module_key(db, *req, *resp, None);
                            let added = db.upsert_probe_from_discovery(
                                vehicle_id,
                                &module_key,
                                did,
                                &k.label,
                                k.unit.as_deref().unwrap_or(""),
                                offset as usize,
                                len as usize,
                                scale,
                                bias,
                            );
                            if added {
                                sensors_added += 1;
                            }
                        }
                    }
                }
                Ok(None) => consecutive_errors = 0,
                Err(_) => {
                    consecutive_errors += 1;
                    // A module that stops responding entirely isn't worth
                    // grinding through — move to the next one.
                    if consecutive_errors > 10 {
                        log::warn!(
                            "discovery: link degraded on {}, skipping its remaining DIDs",
                            format_can_address(*req)
                        );
                        break 'dids;
                    }
                }
            }
        }
        // Keep the adapter's discovery addressing/flow-control setup for the
        // next module; only return this ECU to default here.
        leave_extended_session(drv, extended_session_open);
    }

    teardown(drv);
    emit(
        "done",
        total_sweep,
        total_sweep,
        "",
        present.len() as u32,
        dids_found,
    );
    log::info!(
        "discovery complete: {} modules, {dids_found} DIDs persisted",
        present.len()
    );
    Ok(DiscoveryReport {
        modules_found: present.len() as u32,
        dids_found,
        sensors_added,
        cancelled: false,
        auto_stopped_reason: None,
        was_fast_refresh: false,
    })
}

/// Re-probe exactly what a prior discovery already found on this car —
/// no blind bus enumeration, no full band sweep. "If we already have data
/// from a car, a re-scan shouldn't take that long" (owner, 2026-08-24):
/// this turns a multi-minute pass into a few seconds for a car already on
/// file, which also directly shrinks the window the engine-start safety
/// check above has to protect. Same voltage-based abort applies.
#[allow(clippy::too_many_arguments)]
fn fast_refresh(
    drv: &mut ElmDriver,
    db: &Db,
    vehicle_id: i64,
    vin: Option<&str>,
    known: &[(String, u16)],
    baseline_voltage: Option<f64>,
    cancel_scan: &AtomicBool,
    emit: &dyn Fn(&str, u32, u32, &str, u32, u32),
    engine_started: &dyn Fn(&mut ElmDriver) -> bool,
    addressing: &mut AddressingState,
) -> Result<DiscoveryReport, String> {
    let mut by_module: HashMap<String, Vec<u16>> = HashMap::new();
    for (addr, did) in known {
        by_module.entry(addr.clone()).or_default().push(*did);
    }
    let total: u32 = known.len() as u32;
    let mut sweep_i = 0u32;
    let mut dids_found = 0u32;
    let mut sensors_added = 0u32;
    let mut modules_seen = 0u32;

    for (addr, dids) in &by_module {
        let Some((req, resp)) = parse_module_address(addr) else {
            continue;
        };
        if point_at(drv, req, resp, addressing).is_err() {
            continue;
        }
        let module_id = db.upsert_discovered_module(vehicle_id, addr, None);
        modules_seen += 1;
        let extended_session_open = matches!(
            uds_map::discovery_session_for_module(vin, req, resp),
            uds_map::DiscoverySession::DefaultThenExtended
        ) && enter_extended_session(drv);
        for did in dids {
            sweep_i += 1;
            if cancel_scan.swap(false, Ordering::Relaxed) {
                finish_operation(drv, extended_session_open);
                return Ok(DiscoveryReport {
                    modules_found: modules_seen,
                    dids_found,
                    sensors_added,
                    cancelled: true,
                    auto_stopped_reason: None,
                    was_fast_refresh: true,
                });
            }
            if sweep_i % 15 == 14 && baseline_voltage.is_some() && engine_started(drv) {
                log::warn!("fast refresh: engine start detected — stopping");
                finish_operation(drv, extended_session_open);
                return Ok(DiscoveryReport {
                    modules_found: modules_seen,
                    dids_found,
                    sensors_added,
                    cancelled: true,
                    auto_stopped_reason: Some("engine_started".into()),
                    was_fast_refresh: true,
                });
            }
            emit(
                "sweep",
                sweep_i,
                total,
                &format!("{}:{did:04X}", format_can_address(req)),
                modules_seen,
                dids_found,
            );
            if extended_session_open && sweep_i % 40 == 39 {
                tester_present(drv);
            }
            if let Ok(Some(data)) = read_did_timeout(drv, *did, Duration::from_millis(500)) {
                let known_entry =
                    uds_map::known_did(vin, req, resp, *did).filter(|k| match (k.offset, k.len) {
                        (Some(offset), Some(len)) => (offset as usize)
                            .checked_add(len as usize)
                            .is_some_and(|end| end <= data.len()),
                        _ => true,
                    });
                let label = known_entry.map(|k| k.label.clone());
                db.upsert_discovered_did(
                    module_id,
                    *did,
                    &hex_string(&data),
                    data.len() as i64,
                    label.as_deref(),
                );
                dids_found += 1;
                if let Some(k) = known_entry {
                    if let (Some(offset), Some(len), Some(scale), Some(bias)) =
                        (k.offset, k.len, k.scale, k.bias)
                    {
                        let module_key = ensure_module_key(db, req, resp, None);
                        if db.upsert_probe_from_discovery(
                            vehicle_id,
                            &module_key,
                            *did,
                            &k.label,
                            k.unit.as_deref().unwrap_or(""),
                            offset as usize,
                            len as usize,
                            scale,
                            bias,
                        ) {
                            sensors_added += 1;
                        }
                    }
                }
            }
        }
        leave_extended_session(drv, extended_session_open);
    }

    teardown(drv);
    emit("done", total, total, "", modules_seen, dids_found);
    log::info!("fast refresh complete: {modules_seen} modules, {dids_found} DIDs re-verified");
    Ok(DiscoveryReport {
        modules_found: modules_seen,
        dids_found,
        sensors_added,
        cancelled: false,
        auto_stopped_reason: None,
        was_fast_refresh: true,
    })
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
    fn addressing_setup_never_changes_the_diagnostic_session() {
        let module = &builtin_modules()[0];
        let commands = addressing_commands(module).expect("valid built-in addresses");
        assert!(!commands.iter().any(|command| command == "1003"));
        assert!(!commands.iter().any(|command| command == "1001"));
        assert!(commands.iter().any(|command| command == "ATSH 752"));
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

    #[test]
    fn engine_start_detection_needs_both_a_floor_and_a_jump() {
        // A healthy resting battery (12.6V) must never false-trigger just
        // for sitting near the floor without an actual alternator jump.
        assert!(!engine_likely_started(12.6, 12.6));
        // Real engine start: idle-off baseline -> alternator charging.
        assert!(engine_likely_started(14.1, 12.4));
        // A tiny fluctuation (surface charge, adapter noise) must not
        // trigger — the relative-jump requirement exists for exactly this.
        assert!(!engine_likely_started(12.9, 12.6));
        // Below the absolute floor, even a big relative jump from a very
        // low baseline (near-dead battery) must not read as "running."
        assert!(!engine_likely_started(13.0, 11.0));
    }

    #[test]
    fn voltage_safety_parses_a_complete_elm_frame() {
        assert_eq!(parse_voltage_response("12.6V\r\r>"), Some(12.6));
        assert_eq!(parse_voltage_response("14.1v\r>"), Some(14.1));
    }

    #[test]
    fn discovered_probes_never_become_background_bus_traffic() {
        let probe = crate::db::UdsProbe {
            id: 1,
            vehicle_id: Some(1),
            module: "engine".into(),
            did: 0xD422,
            label: "Battery voltage".into(),
            unit: "V".into(),
            offset: 0,
            len: 2,
            scale: 0.01,
            bias: 0.0,
            enabled: true,
            origin: "discovery".into(),
        };
        assert!(!should_poll_probe(&probe));
        assert!(should_poll_probe(&crate::db::UdsProbe {
            origin: "manual".into(),
            ..probe
        }));
    }

    #[test]
    fn parses_the_exact_module_address_format_discover_writes() {
        assert_eq!(parse_module_address("6B4/694"), Some((0x6B4, 0x694)));
        assert_eq!(parse_module_address("garbage"), None);
        assert_eq!(parse_module_address("ZZZ/694"), None);
    }

    fn module(req: &str, resp: &str) -> UdsModule {
        UdsModule {
            key: "t".into(),
            label: "t".into(),
            req: req.into(),
            resp: resp.into(),
            builtin: false,
        }
    }

    #[test]
    fn eleven_bit_modules_keep_the_original_setup() {
        let cmds = addressing_commands(&module("6A8", "688")).unwrap();
        assert_eq!(cmds[0], "ATSP6");
        assert!(cmds.iter().any(|c| c == "ATSH 6A8"));
        assert!(cmds.iter().any(|c| c == "ATCRA 688"));
        assert!(!cmds.iter().any(|c| c.starts_with("ATCP")));
    }

    #[test]
    fn twenty_nine_bit_modules_switch_protocol_and_split_the_header() {
        // PSA/Stellantis TPMS: ISO 15765-2 normal fixed addressing.
        let cmds = addressing_commands(&module("18DAC7F1", "18DAF1C7")).unwrap();
        assert_eq!(cmds[0], "ATSP7");
        // The ELM takes a 29-bit header as priority byte + three bytes,
        // never as one eight-digit value.
        assert!(cmds.iter().any(|c| c == "ATCP 18"), "{cmds:?}");
        assert!(cmds.iter().any(|c| c == "ATSH DAC7F1"), "{cmds:?}");
        // Receive filter and flow-control header do take the full identifier.
        assert!(cmds.iter().any(|c| c == "ATCRA 18DAF1C7"), "{cmds:?}");
        assert!(cmds.iter().any(|c| c == "ATFCSH 18DAC7F1"), "{cmds:?}");
    }

    #[test]
    fn address_pairs_must_be_valid_and_use_one_can_width() {
        assert_eq!(address_pair(&module("6AD", "68D")).unwrap().2, false);
        assert_eq!(
            address_pair(&module("18DAC7F1", "18DAF1C7")).unwrap().2,
            true
        );
        assert!(address_pair(&module("6AD", "18DAF1C7")).is_err());
        assert!(address_pair(&module("20000000", "18DAF1C7")).is_err());
        assert!(address_pair(&module("not-hex", "68D")).is_err());
    }

    #[test]
    fn split_extended_separates_priority_from_header() {
        assert_eq!(split_extended(0x18DAC7F1), (0x18, 0xDAC7F1));
        assert_eq!(split_extended(0x14DACBF1), (0x14, 0xDACBF1));
    }

    #[test]
    fn psa_tpms_is_in_the_map_and_addressable() {
        // A Citroen VIN must resolve the 29-bit TPMS module and its DIDs.
        let vin = Some("VR7EXAMPLE0000001");
        let tpms = uds_map::known_modules_for_vin(vin)
            .into_iter()
            .find(|(req, _, _)| *req == 0x18DAC7F1)
            .expect("TPMS module present");
        assert_eq!(tpms.1, 0x18DAF1C7);
        assert!(address_pair(&module("18DAC7F1", "18DAF1C7")).unwrap().2);
        assert!(uds_map::known_dids_for_module(vin, tpms.0, tpms.1).contains(&0x013C));

        // Pressure DID decodes bar from a 16-bit big-endian value / 1000.
        let did = uds_map::known_did(vin, 0x18DAC7F1, 0x18DAF1C7, 0x013C)
            .expect("front-left pressure DID present");
        assert_eq!(did.unit.as_deref(), Some("bar"));
        // 0x08CA = 2250 -> 2.250 bar, a normal cold front tyre pressure.
        let v = extract(
            &[0x08, 0xCA, 0x1E],
            did.offset.expect("offset") as usize,
            did.len.expect("len") as usize,
            did.scale.expect("scale"),
            did.bias.unwrap_or(0.0),
        )
        .expect("decodes");
        assert!((v - 2.25).abs() < 0.001, "got {v}");
    }
}
