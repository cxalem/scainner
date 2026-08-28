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
use super::operation::{enter_extended_session, ScannerOperation};
use super::outcome::{DiagnosticOutcome, DiagnosticStatus};
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

#[derive(Serialize, Clone)]
pub struct VerificationObservation {
    pub did: String,
    pub purpose: String,
    pub outcome: DiagnosticOutcome,
    /// Complete application payload after `62 <DID>`, never a three-byte
    /// preview. This is the evidence needed to develop and validate decoders.
    pub payload_hex: Option<String>,
    pub printable: Option<String>,
    /// Exact adapter response, including `NO DATA`, headers and framing.
    /// Kept privately with the vehicle run so parser changes can be replayed.
    pub raw_response: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct VerificationTargetResult {
    pub key: String,
    pub label: String,
    pub expected_family: String,
    pub route: String,
    pub evidence_source: String,
    pub observations: Vec<VerificationObservation>,
    /// For sweep targets: how many identifiers were tried and how each
    /// outcome class was distributed. Individual observations only record
    /// answered identifiers so a 768-DID sweep stays reviewable.
    pub summary: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct ParkedVerificationReport {
    pub run_id: Option<i64>,
    pub plan_version: String,
    pub safety: String,
    pub targets: Vec<VerificationTargetResult>,
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

fn addressing_commands_for_route(
    m: &UdsModule,
    address_extension: Option<u8>,
) -> Result<Vec<String>, ElmError> {
    let (req, resp, extended) = address_pair(m)?;

    // 29-bit extended addressing. Needed for whole classes of modules that
    // are simply unreachable over 11-bit: PSA/Stellantis TPMS lives at
    // 18DAC7F1, and the map already records GM's Ultium modules the same
    // way. Protocol 7 is CAN 29-bit 500k; the receive filter and flow
    // control header both take the full eight-digit identifier.
    if extended {
        if address_extension.is_some() {
            return Err(ElmError::Handshake(
                "ISO-TP address extension is only supported on 11-bit routes".into(),
            ));
        }
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

    let mut commands = vec![
        "ATSP6".to_string(),
        "ATCAF1".to_string(),
        "ATH0".to_string(),
        format!("ATSH {req:03X}"),
        format!("ATCRA {resp:03X}"),
        format!("ATFCSH {req:03X}"),
        match address_extension {
            Some(extension) => format!("ATFCSD {extension:02X} 30 00 00"),
            None => "ATFCSD 300000".to_string(),
        },
        "ATFCSM 1".to_string(),
    ];
    if let Some(extension) = address_extension {
        commands.push(format!("ATCEA {extension:02X}"));
    }
    Ok(commands)
}

fn addressing_commands(m: &UdsModule) -> Result<Vec<String>, ElmError> {
    addressing_commands_for_route(m, None)
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

fn setup_addressing_with_extension(
    drv: &mut ElmDriver,
    m: &UdsModule,
    address_extension: Option<u8>,
) -> Result<(), ElmError> {
    // A prior target may have enabled extended addressing. Disable it before
    // configuring every route so state can never leak between candidates.
    drv.cmd("ATCEA", Duration::from_secs(2))?;
    for command in addressing_commands_for_route(m, address_extension)? {
        drv.cmd(&command, Duration::from_secs(2))?;
    }
    Ok(())
}

fn leave_extended_session(drv: &mut ElmDriver, extended_session_open: bool) {
    if extended_session_open {
        let _ = drv.cmd("1001", Duration::from_millis(800));
        drv.set_extended_session_open(false);
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
    observe_did(drv, did, timeout).map(|(_, data)| data)
}

fn observe_did(
    drv: &mut ElmDriver,
    did: u16,
    timeout: Duration,
) -> Result<(DiagnosticOutcome, Option<Vec<u8>>), ElmError> {
    observe_did_evidence(drv, did, timeout).map(|evidence| (evidence.outcome, evidence.data))
}

struct DidEvidence {
    outcome: DiagnosticOutcome,
    data: Option<Vec<u8>>,
    raw_response: Option<String>,
}

fn observe_did_evidence(
    drv: &mut ElmDriver,
    did: u16,
    timeout: Duration,
) -> Result<DidEvidence, ElmError> {
    let raw = match drv.cmd(&format!("22{did:04X}"), timeout) {
        Ok(raw) => raw,
        Err(ElmError::NoResponse) => {
            return Ok(DidEvidence {
                outcome: DiagnosticOutcome::timed_out("22"),
                data: None,
                raw_response: None,
            });
        }
        Err(error) => return Err(error),
    };
    let lines = parser::clean_response(&raw);
    let bytes = parser::payload_bytes(&lines, "");
    for i in 0..bytes.len().saturating_sub(2) {
        if bytes[i] == 0x62
            && bytes[i + 1] == (did >> 8) as u8
            && bytes[i + 2] == (did & 0xFF) as u8
        {
            return Ok(DidEvidence {
                outcome: DiagnosticOutcome::answered("22"),
                data: Some(bytes[i + 3..].to_vec()),
                raw_response: Some(raw),
            });
        }
    }
    if let Some(response) = bytes
        .windows(3)
        .find(|window| window[0] == 0x7F && window[1] == 0x22)
    {
        return Ok(DidEvidence {
            outcome: DiagnosticOutcome::refused(
                "22",
                response[2],
                parser::negative_response_name(response[2]),
            ),
            data: None,
            raw_response: Some(raw),
        });
    }
    if raw.to_ascii_uppercase().contains("NO DATA") || raw.trim().is_empty() {
        Ok(DidEvidence {
            outcome: DiagnosticOutcome::timed_out("22"),
            data: None,
            raw_response: Some(raw),
        })
    } else {
        Ok(DidEvidence {
            outcome: DiagnosticOutcome::malformed("22", "unexpected ReadDataByIdentifier response"),
            data: None,
            raw_response: Some(raw),
        })
    }
}

/// A reproducible, parked-car evidence pass for the unresolved Citroen C4
/// C41 candidates. Every vehicle-facing request is ReadDataByIdentifier
/// (0x22) in the ECU's default session. The plan never opens 10 03, controls
/// an actuator, starts a routine, clears a fault, or writes configuration.
pub fn parked_verification(drv: &mut ElmDriver) -> ParkedVerificationReport {
    struct Target {
        key: &'static str,
        label: &'static str,
        family: &'static str,
        req: &'static str,
        resp: &'static str,
        extension: Option<u8>,
        dids: &'static [(u16, &'static str)],
        /// Inclusive identifier ranges read one by one after `dids`. Only
        /// answered identifiers become observations; the counts go in
        /// `summary`.
        sweep: &'static [(u16, u16)],
        source: &'static str,
    }

    // v3: v2 proved F080 and F0FE answer on every reachable ECU and that
    // F08A/F08E are either empty (camera) or absent (ABS, steering). Repeat
    // only the identity reads that carry information, so each run keeps
    // refreshing the part-number evidence the fingerprint columns are built
    // from.
    const PSA_IDENTITY: &[(u16, &str)] = &[
        (0xF186, "active diagnostic session"),
        (0xF18C, "ECU serial number"),
        (0xF080, "PSA identity payload (BCD part references)"),
        (0xF0FE, "PSA identity candidate F0FE"),
    ];
    // Four TPMS address hypotheses (29-bit, DSG 6AF, legacy 740, legacy 742)
    // were silent in v1/v2 and the BSI is unreachable from the OBD pins. The
    // remaining evidence-based route for tyre pressure is the ABS/ESP itself,
    // so sweep the PSA data ranges where this car's engine ECU already keeps
    // its live values (D4xx) and the range the earlier BSI hunt targeted.
    const ABS_SWEEP: &[(u16, u16)] = &[(0xD000, 0xD1FF), (0xD400, 0xD4FF)];
    let targets = [
        Target {
            key: "cvm3",
            label: "Windscreen camera",
            family: "CVM3",
            req: "74A",
            resp: "64A",
            extension: None,
            dids: PSA_IDENTITY,
            sweep: &[],
            source: "verified_on_vehicle route; PSA identity DIDs answered in v2",
        },
        Target {
            key: "abs",
            label: "ABS / ESP",
            family: "ESPMK100_UDS",
            req: "6AD",
            resp: "68D",
            extension: None,
            dids: PSA_IDENTITY,
            sweep: &[],
            source: "verified_on_vehicle route; exact-platform community family; PSA identity DIDs answered in v2",
        },
        Target {
            key: "steering",
            label: "Power steering",
            family: "DAE_UDS2",
            req: "6B5",
            resp: "695",
            extension: None,
            dids: PSA_IDENTITY,
            sweep: &[],
            source: "verified_on_vehicle route; exact-platform community family; PSA identity DIDs answered in v2",
        },
        Target {
            key: "abs_sweep",
            label: "ABS / ESP data sweep (tyre pressure search)",
            family: "ESPMK100_UDS",
            req: "6AD",
            resp: "68D",
            extension: None,
            dids: &[],
            sweep: ABS_SWEEP,
            source: "hypothesis: TPMS values served by ABS/ESP after four silent TPMS routes; bounded 0x22 sweep, default session",
        },
    ];

    let mut operation = ScannerOperation::new(drv);
    let mut results = Vec::new();
    for target in targets {
        let module = UdsModule {
            key: target.key.into(),
            label: target.label.into(),
            req: target.req.into(),
            resp: target.resp.into(),
            builtin: false,
        };
        let route = match target.extension {
            Some(ext) => format!("{}→{} + {:02X}", target.req, target.resp, ext),
            None => format!("{}→{}", target.req, target.resp),
        };
        let mut observations = Vec::new();
        let mut summary = None;
        if let Err(error) =
            setup_addressing_with_extension(operation.driver(), &module, target.extension)
        {
            observations.push(VerificationObservation {
                did: "route".into(),
                purpose: "configure diagnostic route".into(),
                outcome: DiagnosticOutcome::from_elm_error("route", &error),
                payload_hex: None,
                printable: None,
                raw_response: None,
            });
        } else {
            for (did, purpose) in target.dids {
                let evidence =
                    observe_did_evidence(operation.driver(), *did, Duration::from_millis(1800));
                let (outcome, data, raw_response) = match evidence {
                    Ok(value) => (value.outcome, value.data, value.raw_response),
                    Err(error) => (DiagnosticOutcome::from_elm_error("22", &error), None, None),
                };
                observations.push(VerificationObservation {
                    did: format!("{did:04X}"),
                    purpose: (*purpose).into(),
                    payload_hex: data.as_deref().map(hex_string),
                    printable: data.as_deref().and_then(printable),
                    raw_response,
                    outcome,
                });
            }
            if !target.sweep.is_empty() {
                summary = Some(sweep_identifiers(
                    operation.driver(),
                    target.sweep,
                    &mut observations,
                ));
            }
        }
        results.push(VerificationTargetResult {
            key: target.key.into(),
            label: target.label.into(),
            expected_family: target.family.into(),
            route,
            evidence_source: target.source.into(),
            observations,
            summary,
        });
    }
    ParkedVerificationReport {
        run_id: None,
        plan_version: "citroen-c41-v3".into(),
        safety: "parked, read-only 0x22 requests, default diagnostic session".into(),
        targets: results,
    }
}

/// Read every identifier in the given inclusive ranges once, in the current
/// (default) session. Answered identifiers are appended as observations with
/// their complete payload; refusals and silence are only counted, because a
/// 768-row table of `7F 22 31` is not evidence anyone can review. Stops early
/// when the link itself degrades so a dead adapter cannot masquerade as 700
/// silent identifiers.
fn sweep_identifiers(
    drv: &mut ElmDriver,
    ranges: &[(u16, u16)],
    observations: &mut Vec<VerificationObservation>,
) -> String {
    let (mut tried, mut answered, mut refused, mut silent, mut link_errors) =
        (0u32, 0u32, 0u32, 0u32, 0u32);
    let mut aborted_at = None;
    'ranges: for (from, to) in ranges {
        for did in *from..=*to {
            tried += 1;
            match observe_did_evidence(drv, did, Duration::from_millis(600)) {
                Ok(evidence) => match evidence.outcome.status {
                    DiagnosticStatus::Answered => {
                        answered += 1;
                        observations.push(VerificationObservation {
                            did: format!("{did:04X}"),
                            purpose: "sweep hit; meaning unknown until correlated".into(),
                            payload_hex: evidence.data.as_deref().map(hex_string),
                            printable: evidence.data.as_deref().and_then(printable),
                            raw_response: evidence.raw_response,
                            outcome: evidence.outcome,
                        });
                    }
                    DiagnosticStatus::Refused => refused += 1,
                    _ => silent += 1,
                },
                Err(_) => {
                    link_errors += 1;
                    if link_errors > 10 {
                        aborted_at = Some(did);
                        break 'ranges;
                    }
                }
            }
        }
    }
    let ranges = ranges
        .iter()
        .map(|(from, to)| format!("{from:04X}–{to:04X}"))
        .collect::<Vec<_>>()
        .join(", ");
    let mut summary = format!(
        "swept {ranges}: {tried} identifiers tried, {answered} answered, {refused} refused, {silent} silent, {link_errors} link errors"
    );
    if let Some(did) = aborted_at {
        summary.push_str(&format!("; aborted at {did:04X} because the link degraded"));
    }
    summary
}

#[derive(Serialize, Clone)]
pub struct CorrelationReading {
    pub did: String,
    /// One complete payload per repeat, `None` when that repeat did not
    /// answer. Round-robin order (all identifiers once, then again) so a
    /// value that drifts between repeats shows up as noise instead of being
    /// hidden by three back-to-back reads.
    pub payloads: Vec<Option<String>>,
    /// True when every repeat answered with the same payload.
    pub stable: bool,
    /// Outcome of the last repeat, for refusals and timeouts.
    pub outcome: DiagnosticOutcome,
}

#[derive(Serialize, Clone)]
pub struct CorrelationCapture {
    pub run_id: Option<i64>,
    pub plan_version: String,
    pub route: String,
    pub step: String,
    pub condition: String,
    pub repeats: u8,
    pub safety: String,
    pub readings: Vec<CorrelationReading>,
}

/// One guided-correlation capture: read every identifier `repeats` times in
/// the default session while the operator holds one physical condition. The
/// meaning of a byte is never inferred here; this only produces the samples a
/// diff against the baseline capture can be made from.
pub fn correlation_capture(
    drv: &mut ElmDriver,
    req: &str,
    resp: &str,
    dids: &[u16],
    repeats: u8,
) -> Result<Vec<CorrelationReading>, String> {
    let module = UdsModule {
        key: format!("corr_{}", req.to_ascii_lowercase()),
        label: format!("Correlation {req}"),
        req: req.into(),
        resp: resp.into(),
        builtin: false,
    };
    let mut operation = ScannerOperation::new(drv);
    setup_addressing_with_extension(operation.driver(), &module, None)
        .map_err(|error| format!("could not configure route {req}→{resp}: {error}"))?;
    let repeats = repeats.clamp(1, 10);
    let mut payloads: Vec<Vec<Option<String>>> = vec![Vec::new(); dids.len()];
    let mut outcomes: Vec<DiagnosticOutcome> = vec![DiagnosticOutcome::timed_out("22"); dids.len()];
    let mut link_errors = 0u32;
    for _ in 0..repeats {
        for (index, did) in dids.iter().enumerate() {
            match observe_did_evidence(operation.driver(), *did, Duration::from_millis(800)) {
                Ok(evidence) => {
                    payloads[index].push(evidence.data.as_deref().map(hex_string));
                    outcomes[index] = evidence.outcome;
                }
                Err(error) => {
                    link_errors += 1;
                    payloads[index].push(None);
                    outcomes[index] = DiagnosticOutcome::from_elm_error("22", &error);
                    if link_errors > 10 {
                        return Err(format!(
                            "link degraded during capture at {did:04X}; nothing was saved"
                        ));
                    }
                }
            }
        }
    }
    Ok(dids
        .iter()
        .enumerate()
        .map(|(index, did)| {
            let samples = std::mem::take(&mut payloads[index]);
            let stable = samples.iter().all(|sample| sample.is_some())
                && samples.windows(2).all(|pair| pair[0] == pair[1]);
            CorrelationReading {
                did: format!("{did:04X}"),
                payloads: samples,
                stable,
                outcome: outcomes[index].clone(),
            }
        })
        .collect())
}

/// PSA/Stellantis `F080` identity payloads carry the module's references as
/// packed BCD, five bytes per ten-digit number (`98 17 13 71 80` is the part
/// reference `9817137180` printed on the ECU label). The first reference
/// starts at byte 0 and the second at byte 7, with two bytes between them.
/// Returns only groups whose every nibble is a decimal digit, so `FF`
/// padding or a differently laid out payload yields nothing instead of a
/// fabricated number.
pub fn decode_psa_references(payload: &[u8]) -> Vec<String> {
    const GROUP_OFFSETS: [usize; 2] = [0, 7];
    GROUP_OFFSETS
        .iter()
        .filter_map(|&offset| {
            let group = payload.get(offset..offset + 5)?;
            let mut digits = String::with_capacity(10);
            for byte in group {
                let (high, low) = (byte >> 4, byte & 0x0F);
                if high > 9 || low > 9 {
                    return None;
                }
                digits.push(char::from(b'0' + high));
                digits.push(char::from(b'0' + low));
            }
            Some(digits)
        })
        .collect()
}

/// PSA `F0FE` ("ZI zone") payloads end with the current software /
/// calibration reference as three packed-BCD bytes at offsets 21–23,
/// printed as `96xxxxxx80` (e.g. `95 04 15` → `9695041580`). Byte 4 is the
/// supplier code (`0D` = Continental/VDO). Layout per the arduino-psa-diag
/// `UDS_FLASH.md` and PyPSADiag `IdentUDSECU.json` descriptions, which agree
/// with each other and with the three ECUs captured on the C4 (research
/// note `docs/research/c41-abs-did-research.md`, 2026-08-27).
pub fn decode_psa_software_reference(payload: &[u8]) -> Option<String> {
    let group = payload.get(21..24)?;
    let mut digits = String::from("96");
    for byte in group {
        let (high, low) = (byte >> 4, byte & 0x0F);
        if high > 9 || low > 9 {
            return None;
        }
        digits.push(char::from(b'0' + high));
        digits.push(char::from(b'0' + low));
    }
    digits.push_str("80");
    Some(digits)
}

fn payload_bytes(observation: &VerificationObservation) -> Vec<u8> {
    observation
        .payload_hex
        .as_deref()
        .unwrap_or("")
        .split_whitespace()
        .filter_map(|pair| u8::from_str_radix(pair, 16).ok())
        .collect()
}

/// Build a comparable fingerprint for a verification target from the PSA
/// identity evidence it answered. Returns None when the target did not yield
/// a decodable `F080` reference, so nothing is written for silent routes.
///
/// Field mapping (corrected 2026-08-27 after research): `F080` reference 1 is
/// the hardware/spare-part reference → `spare_part_number`; `F080` reference
/// 2 is a *complementary hardware reference* → `hardware_version`; the
/// software/calibration reference comes from `F0FE` bytes 21–23 →
/// `software_version`. The evidence entries name the source DID of every
/// field.
pub fn psa_identity_fingerprint(target: &VerificationTargetResult) -> Option<EcuFingerprint> {
    let (req, resp) = target.route.split_once('→')?;
    let answered = |did: &str| {
        target
            .observations
            .iter()
            .find(|item| item.did == did && item.outcome.status == DiagnosticStatus::Answered)
    };
    let f080 = answered("F080")?;
    let references = decode_psa_references(&payload_bytes(f080));
    let spare_part_number = references.first().cloned()?;
    let hardware_version = references.get(1).cloned();
    let mut evidence = vec![EcuIdentityEvidence {
        did: 0xF080,
        label: "PSA ZA zone: reference 1 = hardware/spare part, reference 2 = complementary hardware reference".into(),
        outcome: f080.outcome.clone(),
        raw_value: f080.payload_hex.clone(),
        decoded_value: Some(references.join(" / ")),
    }];
    let software_version =
        answered("F0FE").and_then(|f0fe| {
            let bytes = payload_bytes(f0fe);
            let software = decode_psa_software_reference(&bytes);
            evidence.push(EcuIdentityEvidence {
                did: 0xF0FE,
                label: format!(
                "PSA ZI zone: software/calibration reference from bytes 21–23; supplier code {}",
                bytes.get(4).map(|b| format!("{b:02X}")).unwrap_or_else(|| "?".into())
            ),
                outcome: f0fe.outcome.clone(),
                raw_value: f0fe.payload_hex.clone(),
                decoded_value: software.clone(),
            });
            software
        });
    if let Some(serial) = answered("F18C") {
        evidence.push(EcuIdentityEvidence {
            did: 0xF18C,
            label: "ECU serial number (excluded from the match key)".into(),
            outcome: serial.outcome.clone(),
            raw_value: serial.payload_hex.clone(),
            decoded_value: serial.printable.clone(),
        });
    }
    let mut key = format!("part={spare_part_number}");
    if let Some(hardware) = &hardware_version {
        key.push_str(&format!("|hw={hardware}"));
    }
    if let Some(software) = &software_version {
        key.push_str(&format!("|sw={software}"));
    }
    let fields_answered =
        1 + u8::from(hardware_version.is_some()) + u8::from(software_version.is_some());
    Some(EcuFingerprint {
        request_address: req.trim().into(),
        response_address: resp.split(" + ").next().unwrap_or(resp).trim().into(),
        spare_part_number: Some(spare_part_number),
        hardware_version,
        software_version,
        system_name: None,
        match_key: Some(key),
        fields_answered,
        fields_total: 4,
        evidence,
    })
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
#[derive(Debug, Clone, Copy)]
enum ClearDecision {
    Accepted,
    Refused(u8),
}

fn clear_dtcs(drv: &mut ElmDriver) -> Result<ClearDecision, ElmError> {
    let raw = drv.cmd("14FFFFFF", Duration::from_secs(5))?;
    match parser::diagnostic_response(&raw, 0x14, 0x54) {
        parser::DiagnosticResponse::Positive => Ok(ClearDecision::Accepted),
        parser::DiagnosticResponse::Negative(code) => Ok(ClearDecision::Refused(code)),
        parser::DiagnosticResponse::Pending => Err(ElmError::Handshake(
            "ECU left service 14 pending without a final response".into(),
        )),
        parser::DiagnosticResponse::NoData => Err(ElmError::Handshake(
            "ELM returned NO DATA for service 14".into(),
        )),
        parser::DiagnosticResponse::Malformed => Err(ElmError::Handshake(
            "service 14 returned no valid 54 acknowledgement".into(),
        )),
    }
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
    pub refusal_reason: Option<String>,
    pub after: Vec<String>,
    pub outcome: DiagnosticOutcome,
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
    let mut operation = ScannerOperation::new(drv);
    setup_addressing(operation.driver(), &m).map_err(|e| e.to_string())?;
    let extended_session_open = operation.enter_extended_session();
    let params = serde_json::json!({ "service": "14", "group": "FFFFFF" });
    let codes_json = |v: &Vec<String>| serde_json::json!(v);
    let conn_id = Some(ctx.connection_id);
    let before = match read_dtcs(operation.driver()) {
        Ok(b) => b,
        Err(e) => {
            return Err(format!(
                "Could not read the faults before clearing, so nothing was cleared: {e}"
            ));
        }
    };
    if extended_session_open {
        tester_present(operation.driver());
    }
    let decision = match clear_dtcs(operation.driver()) {
        Ok(decision) => decision,
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
            return Err(e.to_string());
        }
    };
    let (accepted, refusal_reason) = match decision {
        ClearDecision::Accepted => (true, None),
        ClearDecision::Refused(code) => (
            false,
            Some(format!(
                "{} (0x{code:02X})",
                parser::negative_response_name(code)
            )),
        ),
    };
    if accepted {
        settle_after_clear();
    }
    let first_verification = read_dtcs(operation.driver());
    let verification = match first_verification {
        Ok(after) => Ok(after),
        Err(_) if accepted => {
            if extended_session_open {
                tester_present(operation.driver());
            }
            settle_after_clear();
            read_dtcs(operation.driver())
        }
        Err(error) => Err(error),
    };
    let after = match verification {
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
            return Err(format!(
                "The clear was sent, but the verification read failed: {e}"
            ));
        }
    };
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
    let outcome = match decision {
        ClearDecision::Accepted => DiagnosticOutcome::answered("14"),
        ClearDecision::Refused(code) => {
            DiagnosticOutcome::refused("14", code, parser::negative_response_name(code))
        }
    };
    Ok(ClearOutcome {
        before,
        accepted,
        refusal_reason,
        after,
        outcome,
    })
}

#[cfg(not(test))]
fn settle_after_clear() {
    std::thread::sleep(Duration::from_millis(750));
}

#[cfg(test)]
fn settle_after_clear() {}

pub fn module_dtcs(drv: &mut ElmDriver, db: &Db, module: &str) -> Result<Vec<String>, String> {
    let custom = custom_modules(db);
    let m = resolve(module, &custom).ok_or("unknown module")?;
    let mut operation = ScannerOperation::new(drv);
    setup_addressing(operation.driver(), &m).map_err(|e| e.to_string())?;
    read_dtcs(operation.driver()).map_err(|e| e.to_string())
}

/// Read several DIDs from one module with the route configured once. A
/// single `read_one` costs ~1.3 s through the API because addressing is
/// set up per call; a physical test (steering, pedals, wheels) needs the
/// whole set in well under a second. Unanswered DIDs are simply absent
/// from the result. Read-only, default session.
pub fn read_many(
    drv: &mut ElmDriver,
    db: &Db,
    module: &str,
    dids: &[u16],
) -> Result<Vec<UdsHit>, String> {
    let custom = custom_modules(db);
    let m = resolve(module, &custom).ok_or("unknown module")?;
    let mut operation = ScannerOperation::new(drv);
    setup_addressing(operation.driver(), &m).map_err(|e| e.to_string())?;
    let mut hits = Vec::with_capacity(dids.len());
    for did in dids.iter().take(64) {
        if let Some(data) = read_did_timeout(operation.driver(), *did, Duration::from_millis(600))
            .map_err(|e| e.to_string())?
        {
            hits.push(to_hit(*did, &data));
        }
    }
    Ok(hits)
}

pub fn read_one(
    drv: &mut ElmDriver,
    db: &Db,
    module: &str,
    did: u16,
) -> Result<Option<UdsHit>, String> {
    let custom = custom_modules(db);
    let m = resolve(module, &custom).ok_or("unknown module")?;
    let mut operation = ScannerOperation::new(drv);
    setup_addressing(operation.driver(), &m).map_err(|e| e.to_string())?;
    read_did(operation.driver(), did)
        .map_err(|e| e.to_string())
        .map(|opt| opt.map(|d| to_hit(did, &d)))
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
    let mut operation = ScannerOperation::new(drv);
    if let Err(e) = setup_addressing(operation.driver(), &m) {
        log::warn!("scan setup failed: {e}");
        return Err(e.to_string());
    }
    // This is an explicit Lab operation. Request extended mode, but continue
    // in default mode if the ECU refuses it: many useful DIDs are available
    // there and a refusal must not turn into more session traffic.
    let extended_session_open = operation.enter_extended_session();
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
            return Err(format!(
                "cancelled at DID {did:04X}; {} hits kept",
                hits.len()
            ));
        }
        if i % 20 == 19
            && matches!(
                (baseline_voltage, read_voltage(operation.driver())),
                (Some(base), Some(now)) if engine_likely_started(now, base)
            )
        {
            log::warn!("scan auto-stopped at DID {did:04X}: engine start detected");
            return Err(format!("engine_started:{did:04X}:{}", hits.len()));
        }
        if extended_session_open && i % 40 == 39 {
            tester_present(operation.driver());
        }
        match read_did_timeout(operation.driver(), did, Duration::from_millis(600)) {
            Ok(Some(d)) => hits.push(to_hit(did, &d)),
            Ok(None) => {}
            Err(ref e) => {
                log::debug!("scan read error at DID {did:04X}: {e}");
                errors += 1;
                if errors > 10 {
                    log::warn!("scan aborted: too many link errors ({errors}) at DID {did:04X}");
                    return Err(format!(
                        "link degraded mid-scan at DID {did:04X}; {} hits so far kept",
                        hits.len()
                    ));
                }
            }
        }
    }
    log::debug!("scan completed: {} hits, {errors} errors", hits.len());
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
        let mut operation = ScannerOperation::new(drv);
        if setup_addressing(operation.driver(), &m).is_err() {
            continue;
        }
        for p in group {
            if let Ok(Some(data)) = read_did(operation.driver(), p.did) {
                if let Some(v) = extract(&data, p.offset, p.len, p.scale, p.bias) {
                    let key = format!("uds_{}", p.label.to_lowercase().replace(' ', "_"));
                    db.insert_reading(ctx.connection_id, ctx.vehicle_id, &key, v);
                    out.insert(key, v);
                }
            }
        }
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
pub struct ModuleProbeResult {
    pub request_address: String,
    pub response_address: String,
    pub expected_name: Option<String>,
    pub profile_candidate: bool,
    pub source: uds_map::CandidateSource,
    pub outcome: DiagnosticOutcome,
}

/// One ISO 14229 identity read. Keeping negative outcomes is essential: a
/// partial fingerprint is evidence, not an assertion that every ECU exposes
/// the whole standard identity block.
#[derive(Serialize, Clone)]
pub struct EcuIdentityEvidence {
    pub did: u16,
    pub label: String,
    pub outcome: DiagnosticOutcome,
    pub raw_value: Option<String>,
    pub decoded_value: Option<String>,
}

#[derive(Serialize, Clone, Default)]
pub struct EcuFingerprint {
    pub request_address: String,
    pub response_address: String,
    pub spare_part_number: Option<String>,
    pub hardware_version: Option<String>,
    pub software_version: Option<String>,
    pub system_name: Option<String>,
    /// Stable comparison material. ECU serial number and VIN are deliberately
    /// excluded because they identify an individual unit/vehicle and prevent
    /// knowledge from matching the same ECU family in another car.
    pub match_key: Option<String>,
    pub fields_answered: u8,
    pub fields_total: u8,
    pub evidence: Vec<EcuIdentityEvidence>,
}

fn identity_value(data: &[u8]) -> String {
    printable(data).unwrap_or_else(|| hex_string(data))
}

fn build_fingerprint(
    request_address: String,
    response_address: String,
    evidence: Vec<EcuIdentityEvidence>,
) -> EcuFingerprint {
    let value = |did| {
        evidence
            .iter()
            .find(|item| item.did == did)
            .and_then(|item| item.decoded_value.clone())
    };
    let spare_part_number = value(0xF187);
    let hardware_version = value(0xF191);
    let software_version = value(0xF195);
    let system_name = value(0xF197);
    let (fields_answered, match_key) = {
        // Labels name the field, not the DID it came from, so an ISO F187
        // part number and a PSA F080 reference for the same ECU family
        // compare equal instead of being split by their source.
        let comparable = [
            ("part", spare_part_number.as_deref()),
            ("hw", hardware_version.as_deref()),
            ("sw", software_version.as_deref()),
            ("sys", system_name.as_deref()),
        ];
        let answered = comparable
            .iter()
            .filter(|(_, value)| value.is_some())
            .count() as u8;
        let key = (answered > 0).then(|| {
            comparable
                .iter()
                .filter_map(|(did, value)| value.map(|value| format!("{did}={value}")))
                .collect::<Vec<_>>()
                .join("|")
        });
        (answered, key)
    };
    EcuFingerprint {
        request_address,
        response_address,
        spare_part_number,
        hardware_version,
        software_version,
        system_name,
        match_key,
        fields_answered,
        fields_total: 4,
        evidence,
    }
}

#[derive(Serialize, Clone, Default)]
pub struct DiscoveryCoverage {
    pub candidates_total: u32,
    pub candidates_attempted: u32,
    pub candidates_skipped: u32,
    pub profile_candidates: u32,
    pub profile_reached: u32,
    pub reached: u32,
    pub refused: u32,
    pub timed_out: u32,
    pub transport_failed: u32,
    pub malformed: u32,
}

fn coverage_from_probes(
    probes: &[ModuleProbeResult],
    candidates_total: u32,
    profile_candidates: u32,
) -> DiscoveryCoverage {
    let mut coverage = DiscoveryCoverage {
        candidates_total,
        candidates_attempted: probes.len() as u32,
        candidates_skipped: candidates_total.saturating_sub(probes.len() as u32),
        profile_candidates,
        ..DiscoveryCoverage::default()
    };
    for probe in probes {
        match probe.outcome.status {
            DiagnosticStatus::Answered => coverage.reached += 1,
            DiagnosticStatus::Refused | DiagnosticStatus::Unsupported => {
                coverage.reached += 1;
                coverage.refused += 1;
            }
            DiagnosticStatus::TimedOut => coverage.timed_out += 1,
            DiagnosticStatus::TransportFailed => coverage.transport_failed += 1,
            DiagnosticStatus::Malformed => coverage.malformed += 1,
            DiagnosticStatus::Cancelled | DiagnosticStatus::SkippedForSafety => {}
        }
        if probe.profile_candidate
            && matches!(
                probe.outcome.status,
                DiagnosticStatus::Answered
                    | DiagnosticStatus::Refused
                    | DiagnosticStatus::Unsupported
            )
        {
            coverage.profile_reached += 1;
        }
    }
    coverage
}

fn outcome_rank(status: &DiagnosticStatus) -> u8 {
    match status {
        DiagnosticStatus::Answered => 5,
        DiagnosticStatus::Refused | DiagnosticStatus::Unsupported => 4,
        DiagnosticStatus::TransportFailed => 3,
        DiagnosticStatus::TimedOut => 2,
        DiagnosticStatus::Malformed => 1,
        DiagnosticStatus::Cancelled | DiagnosticStatus::SkippedForSafety => 0,
    }
}

#[derive(Serialize, Clone)]
pub struct DiscoveryReport {
    /// Stable machine-readable result shared by every diagnostic operation.
    /// Legacy discovery fields remain during the UI migration.
    pub outcome: DiagnosticOutcome,
    pub coverage: DiscoveryCoverage,
    pub module_probes: Vec<ModuleProbeResult>,
    /// Identity evidence from modules reached during this full pass. Fast
    /// refreshes intentionally do not re-read the identity block.
    pub fingerprints: Vec<EcuFingerprint>,
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
fn probe_addr(drv: &mut ElmDriver, timeout: Duration) -> DiagnosticOutcome {
    let did = uds_map::presence_probe_did();
    match drv.cmd(&format!("22{did:04X}"), timeout) {
        Err(error) => DiagnosticOutcome::from_elm_error("22", &error),
        Ok(raw) => {
            let lines = parser::clean_response(&raw);
            let bytes = parser::payload_bytes(&lines, "");
            let positive = [0x62, (did >> 8) as u8, (did & 0xFF) as u8];
            if bytes.windows(3).any(|window| window == positive) {
                DiagnosticOutcome::answered("22")
            } else if let Some(response) = bytes
                .windows(3)
                .find(|window| window[0] == 0x7F && window[1] == 0x22)
            {
                DiagnosticOutcome::refused(
                    "22",
                    response[2],
                    parser::negative_response_name(response[2]),
                )
            } else if raw.to_ascii_uppercase().contains("NO DATA") || raw.trim().is_empty() {
                DiagnosticOutcome::timed_out("22")
            } else {
                DiagnosticOutcome::malformed("22", "unexpected presence-probe response")
            }
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
    let mut operation = ScannerOperation::new(drv);
    discover_inner(
        operation.driver(),
        db,
        vehicle_id,
        vin,
        cancel_scan,
        app,
        full,
    )
}

fn discover_inner(
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
    let profile_candidates = addrs
        .iter()
        .filter(|candidate| candidate.profile_candidate)
        .count() as u32;
    let mut present: Vec<(u32, u32, Option<String>)> = Vec::new();
    let mut module_probes = Vec::with_capacity(addrs.len());
    for (i, candidate) in addrs.iter().enumerate() {
        let (req, resp, known_name) = (candidate.req, candidate.resp, &candidate.name);
        if cancel_scan.swap(false, Ordering::Relaxed) {
            return Ok(DiscoveryReport {
                outcome: DiagnosticOutcome::cancelled(),
                coverage: coverage_from_probes(&module_probes, total_addrs, profile_candidates),
                module_probes,
                fingerprints: Vec::new(),
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
            return Ok(DiscoveryReport {
                outcome: DiagnosticOutcome::skipped_for_safety("engine_started"),
                coverage: coverage_from_probes(&module_probes, total_addrs, profile_candidates),
                module_probes,
                fingerprints: Vec::new(),
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
                &format_can_address(req),
                present.len() as u32,
                0,
            );
        }
        let outcome = match point_at(drv, req, resp, &mut addressing) {
            Ok(()) => probe_addr(drv, Duration::from_millis(timings.presence_probe)),
            Err(error) => DiagnosticOutcome::from_elm_error("addressing", &error),
        };
        let reached = matches!(
            outcome.status,
            DiagnosticStatus::Answered | DiagnosticStatus::Refused | DiagnosticStatus::Unsupported
        );
        module_probes.push(ModuleProbeResult {
            request_address: format_can_address(req),
            response_address: format_can_address(resp),
            expected_name: known_name.clone(),
            profile_candidate: candidate.profile_candidate,
            source: candidate.source,
            outcome,
        });
        if reached {
            log::info!(
                "discovery: module answering at {}/{}",
                format_can_address(req),
                format_can_address(resp)
            );
            present.push((req, resp, known_name.clone()));
        }
    }

    // Phase 2 — the standard identification block per present module.
    let ident_dids = uds_map::ident_dids();
    let name_dids = uds_map::name_dids();
    let mut dids_found = 0u32;
    let mut module_rows: Vec<(i64, u32, u32)> = Vec::new();
    let mut fingerprints = Vec::with_capacity(present.len());
    let total_ident = (present.len() * ident_dids.len()) as u32;
    for (mi, (req, resp, known_name)) in present.iter().enumerate() {
        if point_at(drv, *req, *resp, &mut addressing).is_err() {
            continue;
        }
        // A name the map already documents beats anything read off the bus.
        let mut name: Option<String> = known_name.clone();
        let mut best_name_rank = usize::MAX;
        let mut ident_hits: Vec<(u16, Vec<u8>)> = Vec::new();
        let mut identity_evidence = Vec::with_capacity(ident_dids.len());
        for (di, did) in ident_dids.iter().enumerate() {
            if cancel_scan.swap(false, Ordering::Relaxed) {
                // Phase 2 (identification) never promotes probes — that
                // only happens in phase 3's data sweep — so 0 is exact
                // here, not a placeholder.
                return Ok(DiscoveryReport {
                    outcome: DiagnosticOutcome::cancelled(),
                    coverage: coverage_from_probes(&module_probes, total_addrs, profile_candidates),
                    module_probes,
                    fingerprints,
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
                return Ok(DiscoveryReport {
                    outcome: DiagnosticOutcome::skipped_for_safety("engine_started"),
                    coverage: coverage_from_probes(&module_probes, total_addrs, profile_candidates),
                    module_probes,
                    fingerprints,
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
            let label = uds_map::map()
                .standard
                .ident_dids
                .iter()
                .find(|entry| uds_map::hex16(&entry.did) == Some(*did))
                .map(|entry| entry.label.clone())
                .unwrap_or_else(|| format!("DID {did:04X}"));
            let (outcome, data) =
                match observe_did(drv, *did, Duration::from_millis(timings.ident_read)) {
                    Ok(observation) => observation,
                    Err(error) => (DiagnosticOutcome::from_elm_error("22", &error), None),
                };
            identity_evidence.push(EcuIdentityEvidence {
                did: *did,
                label,
                outcome,
                raw_value: data.as_ref().map(|data| hex_string(data)),
                decoded_value: data.as_ref().map(|data| identity_value(data)),
            });
            if let Some(data) = data {
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
        let fingerprint = build_fingerprint(
            format_can_address(*req),
            format_can_address(*resp),
            identity_evidence,
        );
        let module_id = db.upsert_discovered_module(
            vehicle_id,
            &format!("{}/{}", format_can_address(*req), format_can_address(*resp)),
            name.as_deref(),
        );
        db.update_ecu_fingerprint(module_id, &fingerprint);
        fingerprints.push(fingerprint);
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
                leave_extended_session(drv, extended_session_open);
                return Ok(DiscoveryReport {
                    outcome: DiagnosticOutcome::cancelled(),
                    coverage: coverage_from_probes(&module_probes, total_addrs, profile_candidates),
                    module_probes,
                    fingerprints,
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
                leave_extended_session(drv, extended_session_open);
                return Ok(DiscoveryReport {
                    outcome: DiagnosticOutcome::skipped_for_safety("engine_started"),
                    coverage: coverage_from_probes(&module_probes, total_addrs, profile_candidates),
                    module_probes,
                    fingerprints,
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
        outcome: DiagnosticOutcome::answered("discovery"),
        coverage: coverage_from_probes(&module_probes, total_addrs, profile_candidates),
        module_probes,
        fingerprints,
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
    let candidates_total = by_module.len() as u32;
    let mut module_probes = Vec::with_capacity(by_module.len());

    for (addr, dids) in &by_module {
        let Some((req, resp)) = parse_module_address(addr) else {
            module_probes.push(ModuleProbeResult {
                request_address: addr.clone(),
                response_address: String::new(),
                expected_name: None,
                profile_candidate: true,
                source: uds_map::CandidateSource::Profile,
                outcome: DiagnosticOutcome::malformed(
                    "addressing",
                    "saved module address is invalid",
                ),
            });
            continue;
        };
        if let Err(error) = point_at(drv, req, resp, addressing) {
            module_probes.push(ModuleProbeResult {
                request_address: format_can_address(req),
                response_address: format_can_address(resp),
                expected_name: None,
                profile_candidate: true,
                source: uds_map::CandidateSource::Profile,
                outcome: DiagnosticOutcome::from_elm_error("addressing", &error),
            });
            continue;
        }
        let module_id = db.upsert_discovered_module(vehicle_id, addr, None);
        let mut module_outcome =
            DiagnosticOutcome::malformed("22", "no saved identifier was attempted");
        let extended_session_open = matches!(
            uds_map::discovery_session_for_module(vin, req, resp),
            uds_map::DiscoverySession::DefaultThenExtended
        ) && enter_extended_session(drv);
        for did in dids {
            sweep_i += 1;
            if cancel_scan.swap(false, Ordering::Relaxed) {
                leave_extended_session(drv, extended_session_open);
                module_probes.push(ModuleProbeResult {
                    request_address: format_can_address(req),
                    response_address: format_can_address(resp),
                    expected_name: None,
                    profile_candidate: true,
                    source: uds_map::CandidateSource::Profile,
                    outcome: DiagnosticOutcome::cancelled(),
                });
                return Ok(DiscoveryReport {
                    outcome: DiagnosticOutcome::cancelled(),
                    coverage: coverage_from_probes(
                        &module_probes,
                        candidates_total,
                        candidates_total,
                    ),
                    module_probes,
                    fingerprints: Vec::new(),
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
                leave_extended_session(drv, extended_session_open);
                module_probes.push(ModuleProbeResult {
                    request_address: format_can_address(req),
                    response_address: format_can_address(resp),
                    expected_name: None,
                    profile_candidate: true,
                    source: uds_map::CandidateSource::Profile,
                    outcome: DiagnosticOutcome::skipped_for_safety("engine_started"),
                });
                return Ok(DiscoveryReport {
                    outcome: DiagnosticOutcome::skipped_for_safety("engine_started"),
                    coverage: coverage_from_probes(
                        &module_probes,
                        candidates_total,
                        candidates_total,
                    ),
                    module_probes,
                    fingerprints: Vec::new(),
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
            let observation = observe_did(drv, *did, Duration::from_millis(500));
            let (outcome, data) = match observation {
                Ok(observation) => observation,
                Err(error) => (DiagnosticOutcome::from_elm_error("22", &error), None),
            };
            if outcome_rank(&outcome.status) > outcome_rank(&module_outcome.status) {
                module_outcome = outcome;
            }
            if let Some(data) = data {
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
        if matches!(
            module_outcome.status,
            DiagnosticStatus::Answered | DiagnosticStatus::Refused | DiagnosticStatus::Unsupported
        ) {
            modules_seen += 1;
        }
        module_probes.push(ModuleProbeResult {
            request_address: format_can_address(req),
            response_address: format_can_address(resp),
            expected_name: None,
            profile_candidate: true,
            source: uds_map::CandidateSource::Profile,
            outcome: module_outcome,
        });
    }

    emit("done", total, total, "", modules_seen, dids_found);
    log::info!("fast refresh complete: {modules_seen} modules, {dids_found} DIDs re-verified");
    Ok(DiscoveryReport {
        outcome: DiagnosticOutcome::answered("discovery"),
        coverage: coverage_from_probes(&module_probes, candidates_total, candidates_total),
        module_probes,
        fingerprints: Vec::new(),
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
    fn lin_child_route_configures_extended_addressing_and_flow_control() {
        let cmds = addressing_commands_for_route(&module("730", "710"), Some(0x70)).unwrap();
        assert!(cmds.iter().any(|c| c == "ATFCSD 70 30 00 00"), "{cmds:?}");
        assert_eq!(cmds.last().map(String::as_str), Some("ATCEA 70"));
    }

    #[test]
    fn extended_addressing_is_rejected_for_29_bit_routes() {
        assert!(
            addressing_commands_for_route(&module("18DAC7F1", "18DAF1C7"), Some(0x70)).is_err()
        );
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

    #[test]
    fn uds_clear_accepts_single_byte_positive_response() {
        let raw = include_str!("../../tests/fixtures/elm/uds-clear-success.json");
        let mut driver = ElmDriver::from_replay_json(raw).unwrap();

        assert!(matches!(
            clear_dtcs(&mut driver),
            Ok(ClearDecision::Accepted)
        ));
        driver.assert_replay_complete();
    }

    #[test]
    fn uds_clear_accepts_pending_followed_by_positive_response() {
        let raw = include_str!("../../tests/fixtures/elm/uds-clear-pending-success.json");
        let mut driver = ElmDriver::from_replay_json(raw).unwrap();

        assert!(matches!(
            clear_dtcs(&mut driver),
            Ok(ClearDecision::Accepted)
        ));
        driver.assert_replay_complete();
    }

    #[test]
    fn uds_clear_preserves_the_refusal_code() {
        let raw = include_str!("../../tests/fixtures/elm/uds-clear-refused.json");
        let mut driver = ElmDriver::from_replay_json(raw).unwrap();

        assert!(matches!(
            clear_dtcs(&mut driver),
            Ok(ClearDecision::Refused(0x22))
        ));
        driver.assert_replay_complete();
    }

    #[test]
    fn uds_clear_silence_and_malformed_replies_are_errors() {
        let silence = include_str!("../../tests/fixtures/elm/uds-clear-silence.json");
        let mut driver = ElmDriver::from_replay_json(silence).unwrap();
        assert!(matches!(clear_dtcs(&mut driver), Err(ElmError::NoResponse)));
        driver.assert_replay_complete();

        let malformed = include_str!("../../tests/fixtures/elm/uds-clear-malformed.json");
        let mut driver = ElmDriver::from_replay_json(malformed).unwrap();
        let error = clear_dtcs(&mut driver).expect_err("OK is not a 54 acknowledgement");
        assert!(error.to_string().contains("no valid 54"));
        driver.assert_replay_complete();
    }

    #[test]
    fn presence_probe_keeps_refusal_and_timeout_distinct() {
        let refused = r#"{
          "schema_version": 1,
          "name": "presence refused",
          "contains_vehicle_identifiers": false,
          "steps": [{ "command": "22F186", "response": "7F 22 31\r>" }]
        }"#;
        let mut driver = ElmDriver::from_replay_json(refused).unwrap();
        let outcome = probe_addr(&mut driver, Duration::from_millis(500));
        assert_eq!(outcome.status, DiagnosticStatus::Refused);
        assert_eq!(outcome.nrc, Some(0x31));
        driver.assert_replay_complete();

        let timeout = r#"{
          "schema_version": 1,
          "name": "presence timeout",
          "contains_vehicle_identifiers": false,
          "steps": [{ "command": "22F186", "error": "no_response" }]
        }"#;
        let mut driver = ElmDriver::from_replay_json(timeout).unwrap();
        let outcome = probe_addr(&mut driver, Duration::from_millis(500));
        assert_eq!(outcome.status, DiagnosticStatus::TimedOut);
        driver.assert_replay_complete();
    }

    #[test]
    fn verification_evidence_preserves_complete_adapter_responses() {
        let replay = r#"{
          "schema_version": 1,
          "name": "raw DID evidence",
          "contains_vehicle_identifiers": false,
          "steps": [
            { "command": "22F080", "response": "62 F0 80 98 17 13 71 80 00 0F 98 42 72 50 80\r>" },
            { "command": "22A0F1", "response": "NO DATA\r>" }
          ]
        }"#;
        let mut driver = ElmDriver::from_replay_json(replay).unwrap();
        let answered =
            observe_did_evidence(&mut driver, 0xF080, Duration::from_millis(500)).unwrap();
        assert_eq!(answered.outcome.status, DiagnosticStatus::Answered);
        assert_eq!(
            answered.data,
            Some(vec![
                0x98, 0x17, 0x13, 0x71, 0x80, 0x00, 0x0F, 0x98, 0x42, 0x72, 0x50, 0x80
            ])
        );
        assert!(answered
            .raw_response
            .as_deref()
            .is_some_and(|raw| raw.contains("98 42 72 50 80")));

        let no_data =
            observe_did_evidence(&mut driver, 0xA0F1, Duration::from_millis(500)).unwrap();
        assert_eq!(no_data.outcome.status, DiagnosticStatus::TimedOut);
        assert_eq!(no_data.raw_response.as_deref(), Some("NO DATA\r>"));
        driver.assert_replay_complete();
    }

    #[test]
    fn coverage_is_derived_from_candidate_evidence() {
        let probes = vec![
            ModuleProbeResult {
                request_address: "700".into(),
                response_address: "708".into(),
                expected_name: Some("engine".into()),
                profile_candidate: true,
                source: uds_map::CandidateSource::Profile,
                outcome: DiagnosticOutcome::answered("22"),
            },
            ModuleProbeResult {
                request_address: "701".into(),
                response_address: "709".into(),
                expected_name: Some("abs".into()),
                profile_candidate: true,
                source: uds_map::CandidateSource::Profile,
                outcome: DiagnosticOutcome::refused("22", 0x31, "requestOutOfRange"),
            },
            ModuleProbeResult {
                request_address: "702".into(),
                response_address: "70A".into(),
                expected_name: None,
                profile_candidate: false,
                source: uds_map::CandidateSource::Conventional11bit,
                outcome: DiagnosticOutcome::timed_out("22"),
            },
        ];

        let coverage = coverage_from_probes(&probes, 5, 2);
        assert_eq!(coverage.candidates_attempted, 3);
        assert_eq!(coverage.candidates_skipped, 2);
        assert_eq!(coverage.reached, 2);
        assert_eq!(coverage.refused, 1);
        assert_eq!(coverage.timed_out, 1);
        assert_eq!(coverage.profile_reached, 2);
    }

    #[test]
    fn partial_fingerprint_uses_only_answered_family_identity() {
        let evidence = vec![
            EcuIdentityEvidence {
                did: 0xF187,
                label: "Spare part number".into(),
                outcome: DiagnosticOutcome::answered("22"),
                raw_value: Some("393831323334".into()),
                decoded_value: Some("981234".into()),
            },
            EcuIdentityEvidence {
                did: 0xF191,
                label: "Hardware version".into(),
                outcome: DiagnosticOutcome::refused("22", 0x31, "requestOutOfRange"),
                raw_value: None,
                decoded_value: None,
            },
            // A serial number is useful evidence but must never participate
            // in the cross-vehicle family match key.
            EcuIdentityEvidence {
                did: 0xF18C,
                label: "ECU serial number".into(),
                outcome: DiagnosticOutcome::answered("22"),
                raw_value: Some("53455249414C31".into()),
                decoded_value: Some("SERIAL1".into()),
            },
        ];

        let fingerprint = build_fingerprint("6A8".into(), "688".into(), evidence);
        assert_eq!(fingerprint.fields_answered, 1);
        assert_eq!(fingerprint.fields_total, 4);
        assert_eq!(fingerprint.match_key.as_deref(), Some("part=981234"));
        assert!(!fingerprint.match_key.unwrap().contains("SERIAL1"));
    }

    #[test]
    fn correlation_capture_reads_round_robin_and_flags_drift() {
        // Two repeats over two identifiers: D435 holds, D410 drifts between
        // repeats and must come back as noisy (stable = false), never as a
        // change.
        let replay = r#"{
          "schema_version": 1,
          "name": "correlation round robin",
          "contains_vehicle_identifiers": false,
          "steps": [
            { "command": "ATCEA", "response": "OK\r>" },
            { "command": "ATSP6", "response": "OK\r>" },
            { "command": "ATCAF1", "response": "OK\r>" },
            { "command": "ATH0", "response": "OK\r>" },
            { "command": "ATSH 6AD", "response": "OK\r>" },
            { "command": "ATCRA 68D", "response": "OK\r>" },
            { "command": "ATFCSH 6AD", "response": "OK\r>" },
            { "command": "ATFCSD 300000", "response": "OK\r>" },
            { "command": "ATFCSM 1", "response": "OK\r>" },
            { "command": "22D435", "response": "62 D4 35 07\r>" },
            { "command": "22D410", "response": "62 D4 10 29\r>" },
            { "command": "22D435", "response": "62 D4 35 07\r>" },
            { "command": "22D410", "response": "62 D4 10 2A\r>" },
            { "command": "ATCEA", "response": "OK\r>" },
            { "command": "ATSP0", "response": "OK\r>" },
            { "command": "ATSH 7DF", "response": "OK\r>" },
            { "command": "ATAR", "response": "OK\r>" },
            { "command": "ATFCSM 0", "response": "OK\r>" }
          ]
        }"#;
        let mut driver = ElmDriver::from_replay_json(replay).unwrap();
        let readings = correlation_capture(&mut driver, "6AD", "68D", &[0xD435, 0xD410], 2)
            .expect("route configured");
        assert_eq!(readings.len(), 2);
        assert_eq!(readings[0].did, "D435");
        assert!(readings[0].stable);
        assert_eq!(
            readings[0].payloads,
            vec![Some("07".into()), Some("07".into())]
        );
        assert_eq!(readings[1].did, "D410");
        assert!(!readings[1].stable);
        assert_eq!(
            readings[1].payloads,
            vec![Some("29".into()), Some("2A".into())]
        );
        driver.assert_replay_complete();
    }

    #[test]
    fn psa_f080_references_decode_only_valid_bcd_groups() {
        // Camera payload captured on the C4 in evidence run #2.
        let camera = [
            0x98, 0x17, 0x13, 0x71, 0x80, 0x00, 0x0F, 0x98, 0x42, 0x72, 0x50, 0x80, 0xFF, 0x71,
        ];
        assert_eq!(
            decode_psa_references(&camera),
            vec!["9817137180", "9842725080"]
        );
        // FF padding is not a number; a short payload yields nothing.
        assert_eq!(decode_psa_references(&[0xFF; 12]), Vec::<String>::new());
        assert_eq!(decode_psa_references(&[0x98, 0x17]), Vec::<String>::new());
        // A valid first group with a padded second group keeps only the first.
        let partial = [
            0x98, 0x46, 0x12, 0x49, 0x80, 0x00, 0x0D, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
        ];
        assert_eq!(decode_psa_references(&partial), vec!["9846124980"]);
    }

    #[test]
    fn verification_target_yields_fingerprint_without_serial_in_key() {
        let observation =
            |did: &str, payload: &str, printable: Option<&str>| VerificationObservation {
                did: did.into(),
                purpose: String::new(),
                outcome: DiagnosticOutcome::answered("22"),
                payload_hex: Some(payload.into()),
                printable: printable.map(Into::into),
                raw_response: None,
            };
        let target = VerificationTargetResult {
            key: "abs".into(),
            label: "ABS / ESP".into(),
            expected_family: "ESPMK100_UDS".into(),
            route: "6AD→68D".into(),
            evidence_source: String::new(),
            observations: vec![
                observation("F18C", "32 38 35", Some("285")),
                observation("F080", "98 46 12 49 80 00 0D 98 20 60 93 80 70 12", None),
                observation(
                    "F0FE",
                    "FF FF 00 00 0D 56 09 02 16 30 15 11 01 FF FF FF 00 02 00 00 01 95 04 15",
                    None,
                ),
            ],
            summary: None,
        };
        let fingerprint = psa_identity_fingerprint(&target).expect("F080 answered");
        assert_eq!(fingerprint.request_address, "6AD");
        assert_eq!(fingerprint.response_address, "68D");
        assert_eq!(fingerprint.spare_part_number.as_deref(), Some("9846124980"));
        assert_eq!(fingerprint.hardware_version.as_deref(), Some("9820609380"));
        assert_eq!(fingerprint.software_version.as_deref(), Some("9695041580"));
        assert_eq!(
            fingerprint.match_key.as_deref(),
            Some("part=9846124980|hw=9820609380|sw=9695041580")
        );
        assert_eq!(fingerprint.fields_answered, 3);
        assert!(decode_psa_software_reference(&[0xFF; 24]).is_none());
        assert!(decode_psa_software_reference(&[0x00; 10]).is_none());
        assert!(!fingerprint.match_key.unwrap().contains("285"));

        let silent = VerificationTargetResult {
            observations: vec![VerificationObservation {
                did: "F080".into(),
                purpose: String::new(),
                outcome: DiagnosticOutcome::timed_out("22"),
                payload_hex: None,
                printable: None,
                raw_response: None,
            }],
            ..target
        };
        assert!(psa_identity_fingerprint(&silent).is_none());
    }
}
