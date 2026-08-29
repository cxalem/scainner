//! The automatic run on connect (multi-brand plan P2.7; protocol §4):
//! after S0 the supervisor calls [`run`], which does
//!
//! - **S1 census** over `uds_map::addresses_to_probe(vin)` with the
//!   presence probe in the default session, recording every outcome
//!   (`reached` / `refused` / `silent` / `transport_failed`) per route in
//!   `route_outcomes` and the reached ones in `discovered_modules` with
//!   their route tuple;
//! - **S2 identity** on every reached route: the brand's identity block,
//!   read with the module's read service, **twice**, the second pass after
//!   every other module has been read (other traffic in between); the
//!   fingerprint is written back and `identity_fit` becomes `provisional`
//!   (or `conflicted` when the two reads disagree);
//! - **S3 join** and the **coverage report**.
//!
//! Budgets: S1+S2 within [`AutoConfig::census_and_identity_secs`] (3 min),
//! the whole run within [`AutoConfig::global_secs`] (10 min); work that
//! does not fit is left for the next connection and the report says so.
//! Services sent: the presence probe and the read services `22`/`21`/`1A`.
//! The run never opens `10 03` (no `enter_extended_session` call exists
//! in this file) and it is skipped when `app_settings.auto_discovery` is
//! `off`.

use super::coverage::{self, CoverageReport};
use super::identity::{self, IdentityObservation};
use super::join::{self, JoinSummary};
use super::pack_ext;
use super::state::AUTO_DISCOVERY_SETTING;
use crate::db::Db;
use crate::elm::driver::ElmDriver;
use crate::elm::operation::ScannerOperation;
use crate::elm::outcome::{DiagnosticOutcome, DiagnosticStatus};
use crate::elm::uds::{self, format_can_address, AddressingState};
use crate::elm::uds_map::{self, AddressCandidate, Route};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

#[derive(Clone, Debug)]
pub struct AutoConfig {
    /// S1 + S2 together (protocol §7: 3 min).
    pub census_and_identity_secs: u64,
    /// Whole automatic run (protocol §7: 10 min).
    pub global_secs: u64,
    /// Probe only the profile's documented routes (tests, quick runs);
    /// the default census also walks the conventional range.
    pub profile_only: bool,
    /// Per-request timeouts from the pack's `timings_ms` unless overridden.
    pub presence_probe_ms: Option<u64>,
    pub ident_read_ms: Option<u64>,
}

impl Default for AutoConfig {
    fn default() -> Self {
        Self {
            census_and_identity_secs: 180,
            global_secs: 600,
            profile_only: false,
            presence_probe_ms: None,
            ident_read_ms: None,
        }
    }
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct CensusSummary {
    pub candidates: usize,
    pub attempted: usize,
    pub reached: usize,
    pub refused: usize,
    pub silent: usize,
    pub transport_failed: usize,
    /// Candidates left for the next connection when the budget ran out.
    pub deferred: usize,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct IdentitySummary {
    pub modules: usize,
    pub fingerprinted: usize,
    pub provisional: usize,
    pub conflicted: usize,
    /// Modules whose second read did not fit in the budget.
    pub read_once: usize,
}

#[derive(Serialize, Clone, Debug)]
pub struct AutoSummary {
    pub vehicle_id: i64,
    pub plan_version: String,
    pub census: CensusSummary,
    pub identity: IdentitySummary,
    pub join: Option<JoinSummary>,
    pub coverage_status: Option<String>,
    pub elapsed_ms: u128,
    pub cancelled: bool,
    /// Why the run stopped before finishing, when it did.
    pub stopped: Option<String>,
}

/// De-identified notification raised before an unprofiled vehicle enters
/// conservative discovery. The full VIN is deliberately never exposed.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct UnknownBrandNotice {
    pub classification: &'static str,
    pub reason: &'static str,
    pub wmi: Option<String>,
    pub brand_id: Option<String>,
    pub fallback_policy: &'static str,
    pub discovery_continues: bool,
}

/// Invoke `callback` exactly once when no first-class brand profile can be
/// selected. This is a notification, not a gate: the caller continues with
/// the manufacturer-agnostic fallback after the callback returns.
pub fn notify_unknown_brand(vin: Option<&str>, callback: impl FnOnce(&UnknownBrandNotice)) -> bool {
    let brand = uds_map::brand_for_vin(vin);
    let standard_only = brand
        .is_some_and(|brand| brand.profiled_level == Some(uds_map::ProfiledLevel::StandardOnly));
    if brand.is_some() && !standard_only {
        return false;
    }
    let normalized = vin.map(str::trim).filter(|value| !value.is_empty());
    let scan_allowed = brand.is_none() || !uds_map::addresses_to_probe(vin).is_empty();
    let notice = UnknownBrandNotice {
        classification: if standard_only {
            "known_brand_unprofiled"
        } else {
            "unknown_brand"
        },
        reason: if standard_only {
            "brand_not_profiled"
        } else if normalized.is_some() {
            "wmi_not_profiled"
        } else {
            "vin_unavailable"
        },
        wmi: normalized
            .map(|value| value.chars().take(3).collect::<String>())
            .filter(|value| value.chars().count() == 3)
            .map(|value| value.to_ascii_uppercase()),
        brand_id: brand.map(|brand| brand.id.clone()),
        fallback_policy: if standard_only && !scan_allowed {
            "brand_policy_no_enumeration"
        } else {
            "manufacturer_agnostic_read_only"
        },
        discovery_continues: scan_allowed,
    };
    callback(&notice);
    true
}

/// Whether the automatic run is switched on (`app_settings.auto_discovery`
/// is anything but `off`).
pub fn enabled(db: &Db) -> bool {
    db.setting_get(AUTO_DISCOVERY_SETTING)
        .map(|v| v.trim() != "off")
        .unwrap_or(true)
}

fn address_of(req: u32, resp: u32) -> String {
    format!("{}/{}", format_can_address(req), format_can_address(resp))
}

fn route_state_of(outcome: &DiagnosticOutcome) -> &'static str {
    match outcome.status {
        DiagnosticStatus::Answered => "reached",
        DiagnosticStatus::Refused | DiagnosticStatus::Unsupported => "refused",
        DiagnosticStatus::TransportFailed | DiagnosticStatus::Malformed => "transport_failed",
        _ => "silent",
    }
}

struct Reached {
    module_id: i64,
    req: u32,
    resp: u32,
    route: Route,
}

/// Progress callback: `(phase, current, total, detail)`.
pub type Progress<'a> = &'a dyn Fn(&str, u32, u32, &str);

/// The automatic run. `vin` selects the profile; `connection_id` stamps the
/// identity reads and the route outcomes.
#[allow(clippy::too_many_arguments)]
pub fn run(
    drv: &mut ElmDriver,
    db: &Db,
    vehicle_id: i64,
    vin: Option<&str>,
    connection_id: i64,
    cancel: &AtomicBool,
    config: &AutoConfig,
    progress: Progress<'_>,
) -> AutoSummary {
    let started = Instant::now();
    let s1s2 = Duration::from_secs(config.census_and_identity_secs);
    let global = Duration::from_secs(config.global_secs);
    let timings = &uds_map::map().standard.timings_ms;
    let probe_timeout =
        Duration::from_millis(config.presence_probe_ms.unwrap_or(timings.presence_probe));
    let ident_timeout = Duration::from_millis(config.ident_read_ms.unwrap_or(timings.ident_read));
    let mut summary = AutoSummary {
        vehicle_id,
        plan_version: super::plan::plan_version(vin),
        census: CensusSummary::default(),
        identity: IdentitySummary::default(),
        join: None,
        coverage_status: None,
        elapsed_ms: 0,
        cancelled: false,
        stopped: None,
    };
    let mut operation = ScannerOperation::new(drv);
    let mut addressing = AddressingState::default();

    // ---- S1 census ----
    let candidates: Vec<AddressCandidate> = uds_map::addresses_to_probe(vin)
        .into_iter()
        .filter(|c| !config.profile_only || c.profile_candidate)
        .collect();
    summary.census.candidates = candidates.len();
    let mut reached: Vec<Reached> = Vec::new();
    for (i, candidate) in candidates.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            summary.cancelled = true;
            summary.stopped = Some("cancelled during the census".into());
            break;
        }
        // Keep a third of the S1+S2 budget for identity reads.
        if started.elapsed() > s1s2 * 2 / 3 {
            summary.stopped = Some(format!(
                "census budget reached after {} of {} candidates; the rest resumes next connection",
                i,
                candidates.len()
            ));
            break;
        }
        progress(
            "auto-census",
            i as u32,
            candidates.len() as u32,
            &format_can_address(candidate.req),
        );
        let route = uds_map::route_for_module(vin, candidate.req, candidate.resp);
        let outcome = match uds::point_at(operation.driver(), &route, &mut addressing) {
            Ok(()) => uds::probe_addr(operation.driver(), probe_timeout),
            Err(error) => DiagnosticOutcome::from_elm_error("addressing", &error),
        };
        summary.census.attempted += 1;
        let state = route_state_of(&outcome);
        let address = address_of(candidate.req, candidate.resp);
        let route_json = serde_json::to_string(&route).ok();
        db.record_route_outcome(
            vehicle_id,
            Some(connection_id),
            &address,
            state,
            route_json.as_deref(),
            outcome.detail.as_deref(),
        );
        match state {
            "reached" | "refused" => {
                if state == "reached" {
                    summary.census.reached += 1;
                } else {
                    summary.census.refused += 1;
                }
                let module_id =
                    db.upsert_discovered_module(vehicle_id, &address, candidate.name.as_deref());
                db.set_module_route_state(module_id, state);
                if let Some(json) = &route_json {
                    db.set_module_route(module_id, json);
                }
                reached.push(Reached {
                    module_id,
                    req: candidate.req,
                    resp: candidate.resp,
                    route,
                });
            }
            "silent" => summary.census.silent += 1,
            _ => summary.census.transport_failed += 1,
        }
    }
    summary.census.deferred = candidates.len() - summary.census.attempted;

    // ---- S2 identity: two passes, every other module between them ----
    let block = uds_map::identity_block_for_vin(vin);
    let dids = pack_ext::identity_dids(&block);
    summary.identity.modules = reached.len();
    let mut first_pass: Vec<Option<Vec<IdentityObservation>>> = vec![None; reached.len()];
    let mut second_pass: Vec<Option<Vec<IdentityObservation>>> = vec![None; reached.len()];
    'passes: for pass in 0..2 {
        for (i, module) in reached.iter().enumerate() {
            if cancel.load(Ordering::Relaxed) {
                summary.cancelled = true;
                summary.stopped = Some("cancelled during identity reads".into());
                break 'passes;
            }
            if started.elapsed() > s1s2 || started.elapsed() > global {
                summary.stopped = Some(format!(
                    "identity budget reached during pass {} at module {}",
                    pass + 1,
                    address_of(module.req, module.resp)
                ));
                break 'passes;
            }
            progress(
                "auto-identity",
                (pass * reached.len() + i) as u32,
                (2 * reached.len()) as u32,
                &format_can_address(module.req),
            );
            if uds::point_at(operation.driver(), &module.route, &mut addressing).is_err() {
                continue;
            }
            let service = uds_map::read_service_for_module(vin, module.req, module.resp);
            let mut observations = Vec::with_capacity(dids.len());
            for did in &dids {
                let (outcome, payload) = match uds::observe_did_evidence(
                    operation.driver(),
                    service,
                    *did,
                    ident_timeout,
                ) {
                    Ok(evidence) => (evidence.outcome, evidence.data.unwrap_or_default()),
                    Err(error) => (
                        DiagnosticOutcome::from_elm_error(service.as_str(), &error),
                        Vec::new(),
                    ),
                };
                observations.push(IdentityObservation {
                    did: *did,
                    outcome,
                    payload,
                });
            }
            if pass == 0 {
                first_pass[i] = Some(observations);
            } else {
                second_pass[i] = Some(observations);
            }
        }
    }
    for (i, module) in reached.iter().enumerate() {
        let Some(first) = &first_pass[i] else {
            continue;
        };
        let route = (
            format_can_address(module.req),
            format_can_address(module.resp),
        );
        let Some(fingerprint) = identity::fingerprint(vin, (&route.0, &route.1), first) else {
            continue;
        };
        summary.identity.fingerprinted += 1;
        db.update_ecu_fingerprint(module.module_id, &fingerprint);
        let mut fit = identity::record_identity(db, module.module_id, &fingerprint, connection_id);
        match &second_pass[i] {
            Some(second) => {
                let again = identity::fingerprint(vin, (&route.0, &route.1), second);
                match again {
                    Some(again) => {
                        fit =
                            identity::record_identity(db, module.module_id, &again, connection_id);
                    }
                    // A block that answered once and not the second time
                    // is not byte-identical: record a conflict honestly.
                    None => {
                        let mut conflicting = fingerprint.clone();
                        conflicting.match_key =
                            Some("second read: identity block unanswered".into());
                        fit = identity::record_identity(
                            db,
                            module.module_id,
                            &conflicting,
                            connection_id,
                        );
                    }
                }
            }
            None => summary.identity.read_once += 1,
        }
        match fit.map(|(f, _)| f) {
            Some(super::state::IdentityFit::Conflicted) => summary.identity.conflicted += 1,
            Some(_) => summary.identity.provisional += 1,
            None => {}
        }
    }
    drop(operation);

    // ---- S3 join + coverage (local, instant) ----
    progress("auto-join", 0, 1, "");
    let joined = join::join_vehicle(db, uds_map::map(), vehicle_id);
    summary.join = Some(joined);
    let report: Option<CoverageReport> = coverage::coverage(db, uds_map::map(), vehicle_id);
    summary.coverage_status = report.map(|r| r.status.to_string());
    summary.elapsed_ms = started.elapsed().as_millis();
    progress(
        "auto-done",
        1,
        1,
        summary.coverage_status.as_deref().unwrap_or(""),
    );
    summary
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::elm::discovery::join::fixtures::verified_vin;
    use crate::elm::operation;
    use crate::elm::uds_map::{map, ReadService};
    use serde_json::json;

    /// Build the replay fixture the run will consume for `vin` when the
    /// listed routes answer. `answers` maps `(req, resp)` to the presence
    /// outcome and the identity payloads (per DID, hex) it answers.
    struct Answering {
        req: u32,
        resp: u32,
        presence: &'static str,
        identity: Vec<(u16, &'static str)>,
    }

    fn fixture(vin: &str, answering: &[Answering]) -> String {
        let mut steps = Vec::new();
        let mut state = AddressingState::default();
        let candidates: Vec<AddressCandidate> = uds_map::addresses_to_probe(Some(vin))
            .into_iter()
            .filter(|c| c.profile_candidate)
            .collect();
        let probe_did = uds_map::presence_probe_did();
        let mut reached = Vec::new();
        for c in &candidates {
            let route = uds_map::route_for_module(Some(vin), c.req, c.resp);
            for command in uds::point_at_commands(&route, &mut state).unwrap() {
                steps.push(json!({"command": command, "response": "OK\r>"}));
            }
            match answering
                .iter()
                .find(|a| a.req == c.req && a.resp == c.resp)
            {
                Some(a) => {
                    steps.push(
                        json!({"command": format!("22{probe_did:04X}"), "response": a.presence}),
                    );
                    reached.push((c, a, route));
                }
                None => steps.push(
                    json!({"command": format!("22{probe_did:04X}"), "response": "NO DATA\r>"}),
                ),
            }
        }
        let dids = pack_ext::identity_dids(&uds_map::identity_block_for_vin(Some(vin)));
        for _pass in 0..2 {
            for (c, a, route) in &reached {
                for command in uds::point_at_commands(route, &mut state).unwrap() {
                    steps.push(json!({"command": command, "response": "OK\r>"}));
                }
                let service = uds_map::read_service_for_module(Some(vin), c.req, c.resp);
                for did in &dids {
                    let Some((request, _)) = uds::request_for(service, *did) else {
                        continue;
                    };
                    match a.identity.iter().find(|(d, _)| d == did) {
                        Some((_, hex)) => steps.push(json!({
                            "command": request,
                            "response": format!("62 {:02X} {:02X} {hex}\r>", did >> 8, did & 0xFF)
                        })),
                        None => steps.push(json!({"command": request, "response": "7F 22 31\r>"})),
                    }
                }
            }
        }
        for command in ["ATCEA", "ATSP0", "ATSH 7DF", "ATAR", "ATFCSM 0"] {
            steps.push(json!({"command": command, "response": "OK\r>"}));
        }
        json!({
            "schema_version": 1,
            "name": format!("auto run for {} (synthetic)", &vin[..3]),
            "contains_vehicle_identifiers": false,
            "steps": steps
        })
        .to_string()
    }

    fn config() -> AutoConfig {
        AutoConfig {
            profile_only: true,
            ..AutoConfig::default()
        }
    }

    #[test]
    fn the_verified_brand_reaches_join_and_coverage_with_real_route_states() {
        let _guard = operation::tests::LINK_TEST_LOCK
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        operation::set_link_state(None);
        let vin = verified_vin();
        // The ABS/ESP answers its vendor block (this project's captured
        // payloads), the steering rack refuses the presence probe but
        // answers its identity, the rest is silent.
        let answering = [
            Answering {
                req: 0x6AD,
                resp: 0x68D,
                presence: "62 F1 86 01\r>",
                identity: vec![
                    (0xF080, "98 46 12 49 80 00 0D 98 20 60 93 80 70 12"),
                    (
                        0xF0FE,
                        "FF FF 00 00 0D 56 09 02 16 30 15 11 01 FF FF FF 00 02 00 00 01 95 04 15",
                    ),
                    (0xF18C, "32 38 35"),
                ],
            },
            Answering {
                req: 0x6B5,
                resp: 0x695,
                presence: "7F 22 31\r>",
                identity: vec![(0xF080, "98 44 55 17 80 00 0D FF FF FF FF FF")],
            },
        ];
        let raw = fixture(&vin, &answering);
        let mut driver = ElmDriver::from_replay_json(&raw).unwrap();
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        let (vehicle_id, _) = db.ensure_vehicle(&vin);
        let connection = db.start_connection("ELM327", "test");
        let cancel = AtomicBool::new(false);
        let phases = std::sync::Mutex::new(Vec::new());
        let summary = run(
            &mut driver,
            &db,
            vehicle_id,
            Some(&vin),
            connection,
            &cancel,
            &config(),
            &|phase, _, _, _| phases.lock().unwrap().push(phase.to_string()),
        );
        driver.assert_replay_complete();
        assert!(
            !raw.contains("\"1003\""),
            "the automatic run never opens 10 03"
        );
        assert!(summary.stopped.is_none(), "{:?}", summary.stopped);
        assert_eq!(summary.census.reached, 1);
        assert_eq!(summary.census.refused, 1);
        assert_eq!(summary.census.silent, summary.census.candidates - 2);
        assert_eq!(summary.census.deferred, 0);
        assert_eq!(summary.identity.modules, 2);
        assert_eq!(summary.identity.fingerprinted, 2);
        assert_eq!(summary.identity.provisional, 2);
        assert_eq!(summary.identity.conflicted, 0);
        assert_eq!(summary.coverage_status.as_deref(), Some("partial"));
        let joined = summary.join.unwrap();
        assert_eq!(
            joined.inherited_created, 16,
            "ABS strong match + steering weak/strong"
        );
        let modules = db.discovered_summary(vehicle_id);
        assert_eq!(modules.len(), 2);
        let abs = modules.iter().find(|m| m.address == "6AD/68D").unwrap();
        assert_eq!(abs.route_state.as_deref(), Some("reached"));
        assert_eq!(abs.identity_fit.as_deref(), Some("provisional"));
        assert_eq!(abs.identity_reads, 2);
        assert_eq!(abs.spare_part_number.as_deref(), Some("9846124980"));
        assert_eq!(abs.supplier.as_deref(), Some("0D"));
        assert!(abs.route_json.as_deref().unwrap().contains("can11_500"));
        let eps = modules.iter().find(|m| m.address == "6B5/695").unwrap();
        assert_eq!(eps.route_state.as_deref(), Some("refused"));
        let outcomes = db.route_outcomes(vehicle_id);
        assert_eq!(outcomes.len(), summary.census.candidates);
        assert_eq!(
            outcomes
                .iter()
                .filter(|o| o.route_state == "silent")
                .count(),
            summary.census.silent
        );
        let report = coverage::coverage(&db, map(), vehicle_id).unwrap();
        assert_eq!(report.routes.reached, 2);
        assert_eq!(report.routes.silent, summary.census.silent);
        assert_eq!(report.routes.refused, 1);
        assert!(report.routes.limitations.is_empty());
        let phases = phases.lock().unwrap();
        assert!(phases.contains(&"auto-census".to_string()));
        assert!(phases.contains(&"auto-identity".to_string()));
        assert_eq!(phases.last().map(String::as_str), Some("auto-done"));
    }

    #[test]
    fn a_second_brand_with_an_iso_block_and_a_service_21_module_reaches_coverage() {
        let _guard = operation::tests::LINK_TEST_LOCK
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        operation::set_link_state(None);
        let (brand, local_id) = map()
            .brands
            .iter()
            .find_map(|b| {
                b.modules
                    .iter()
                    .find(|m| m.read_service == Some(ReadService::DataByLocalIdentifier))
                    .map(|m| (b, m))
            })
            .expect("a module on service 21 in the pack");
        let vin = format!("{}EXAMPLE0000002", brand.wmi[0]);
        let iso = brand
            .modules
            .iter()
            .find(|m| m.read_service.is_none() && uds_map::can11(&m.req).is_some())
            .expect("an ISO route on the brand");
        let answering = [
            Answering {
                req: uds_map::can_address(&iso.req).unwrap(),
                resp: uds_map::can_address(&iso.resp).unwrap(),
                presence: "62 F1 86 01\r>",
                identity: vec![
                    (0xF187, "31 4B 30 39 30 37 35 33 30 41"),
                    (0xF191, "48 30 31"),
                    (0xF195, "30 32 31 30"),
                ],
            },
            // The 21 module answers the presence probe; its identity block
            // cannot be asked on a one-byte service, so no read is sent.
            Answering {
                req: uds_map::can_address(&local_id.req).unwrap(),
                resp: uds_map::can_address(&local_id.resp).unwrap(),
                presence: "7F 22 11\r>",
                identity: Vec::new(),
            },
        ];
        let raw = fixture(&vin, &answering);
        let mut driver = ElmDriver::from_replay_json(&raw).unwrap();
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        let (vehicle_id, _) = db.ensure_vehicle(&vin);
        let connection = db.start_connection("ELM327", "test");
        let summary = run(
            &mut driver,
            &db,
            vehicle_id,
            Some(&vin),
            connection,
            &AtomicBool::new(false),
            &config(),
            &|_, _, _, _| {},
        );
        driver.assert_replay_complete();
        assert_eq!(
            summary.plan_version,
            format!("{}-unknown-v{}", brand.id, pack_ext::plan_revision())
        );
        assert_eq!(summary.census.reached, 1);
        assert_eq!(summary.census.refused, 1);
        assert_eq!(summary.identity.fingerprinted, 1);
        assert_eq!(summary.identity.provisional, 1);
        assert_eq!(summary.join.as_ref().unwrap().inherited_created, 0);
        assert_eq!(summary.coverage_status.as_deref(), Some("partial"));
        let modules = db.discovered_summary(vehicle_id);
        let engine = modules
            .iter()
            .find(|m| m.address.starts_with(&iso.req.to_uppercase()))
            .unwrap();
        assert_eq!(engine.spare_part_number.as_deref(), Some("1K0907530A"));
        assert_eq!(engine.identity_fit.as_deref(), Some("provisional"));
        let report = coverage::coverage(&db, map(), vehicle_id).unwrap();
        assert_eq!(report.routes.reached, 2);
        assert_eq!(report.routes.refused, 1);
        assert_eq!(report.identified.family_matches, 0);
        assert!(report
            .remaining
            .iter()
            .any(|r| r.contains("not fingerprinted")));
    }

    #[test]
    fn the_setting_switches_the_run_off() {
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        assert!(enabled(&db));
        db.setting_set(AUTO_DISCOVERY_SETTING, "off");
        assert!(!enabled(&db));
        db.setting_set(AUTO_DISCOVERY_SETTING, "on");
        assert!(enabled(&db));
    }

    #[test]
    fn unknown_brand_callback_is_deidentified_and_does_not_fire_for_known_wmis() {
        let known = verified_vin();
        let mut notices = Vec::new();
        assert!(!notify_unknown_brand(Some(&known), |notice| {
            notices.push(notice.clone())
        }));
        assert!(notices.is_empty());

        assert!(notify_unknown_brand(Some("ZZZPRIVATE00000001"), |notice| {
            notices.push(notice.clone())
        }));
        assert_eq!(notices.len(), 1);
        assert_eq!(notices[0].wmi.as_deref(), Some("ZZZ"));
        assert_eq!(notices[0].reason, "wmi_not_profiled");
        assert!(notices[0].brand_id.is_none());
        let json = serde_json::to_string(&notices[0]).unwrap();
        assert!(!json.contains("ZZZPRIVATE00000001"));
        assert!(notices[0].discovery_continues);

        notices.clear();
        assert!(notify_unknown_brand(None, |notice| notices.push(notice.clone())));
        assert_eq!(notices[0].reason, "vin_unavailable");
        assert!(notices[0].wmi.is_none());
    }

    #[test]
    fn standard_only_brands_trigger_with_their_scan_policy() {
        let brand = map()
            .brands
            .iter()
            .find(|brand| brand.profiled_level == Some(uds_map::ProfiledLevel::StandardOnly))
            .expect("the pack has a standard-only brand");
        let vin = format!("{}EXAMPLE0000001", brand.wmi[0]);
        let mut notice = None;
        assert!(notify_unknown_brand(Some(&vin), |value| {
            notice = Some(value.clone())
        }));
        let notice = notice.unwrap();
        assert_eq!(notice.classification, "known_brand_unprofiled");
        assert_eq!(notice.reason, "brand_not_profiled");
        assert_eq!(notice.brand_id.as_deref(), Some(brand.id.as_str()));
        assert_eq!(
            notice.discovery_continues,
            !uds_map::addresses_to_probe(Some(&vin)).is_empty()
        );
    }
}
