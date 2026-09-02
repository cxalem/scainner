use super::pack_ext::band_classes_for_module;
use crate::db::{Db, HypothesisRow};
use crate::elm::correlation::{
    self, HypothesisInput, InheritedDecode, InheritedFit, RefReading, Sample,
};
use crate::elm::uds_map;
use serde::Serialize;
use std::collections::{HashMap, HashSet, VecDeque};
use std::time::{Duration, Instant};

const MAX_COHORT: usize = 8;
const MAX_SAMPLES: i64 = 40;
const CONSTANT_SAMPLES: i64 = 12;
const MAX_REFUSALS: u8 = 6;
const OCCUPANCY_WINDOW: Duration = Duration::from_secs(60);
const OCCUPANCY_LIMIT: f64 = 0.20;
const SLOW_READ: Duration = Duration::from_secs(4);

#[derive(Clone, Debug)]
pub struct Candidate {
    pub hypothesis: HypothesisRow,
    pub byte_length: Option<i64>,
}

#[derive(Clone, Debug)]
struct Member {
    hypothesis: HypothesisRow,
    refusals: u8,
    ride_samples: i64,
    first_payload: Option<String>,
    identical: bool,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
pub struct LearningStatus {
    pub cohort: usize,
    pub module: Option<String>,
    pub samples_this_ride: i64,
    pub suspended: bool,
}

#[derive(Debug)]
pub struct LearningRun {
    candidates: VecDeque<Candidate>,
    modules: VecDeque<String>,
    members: Vec<Member>,
    occupancy: VecDeque<(Instant, Duration)>,
    started: Instant,
    samples_this_ride: i64,
    sampled_ids: HashSet<i64>,
    suspended_logged: bool,
    slow_until: Option<Instant>,
}

fn opaque(shape: Option<&str>) -> bool {
    shape
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .and_then(|value| {
            value
                .get("variability")
                .and_then(|v| v.as_str())
                .map(str::to_owned)
        })
        .is_some_and(|value| value.eq_ignore_ascii_case("opaque"))
}

pub fn candidates(db: &Db, vehicle_id: i64) -> Vec<Candidate> {
    let vin = db.vehicle(vehicle_id).and_then(|vehicle| vehicle.vin);
    let identity = super::pack_ext::identity_dids(&uds_map::identity_block_for_vin(vin.as_deref()));
    let mut rows: Vec<Candidate> = db
        .list_hypotheses(vehicle_id)
        .into_iter()
        .filter(|h| h.knowledge_state == "unknown" && h.activation != "excluded")
        .filter_map(|hypothesis| {
            let did = db
                .discovered_dids(hypothesis.module_id)
                .into_iter()
                .find(|did| did.did == hypothesis.did)?;
            let classes = band_classes_for_module(
                uds_map::map(),
                vin.as_deref(),
                hypothesis.family_id.as_deref(),
            );
            let sample = did.raw_sample.as_deref().map(bytes).unwrap_or_default();
            (!identity.contains(&hypothesis.did)
                && super::state::is_hypothesis_candidate(
                    hypothesis.did,
                    did.byte_length.unwrap_or_default().max(0) as usize,
                    &sample,
                    &classes,
                )
                && !classes.is_config(hypothesis.did)
                && !opaque(hypothesis.shape_json.as_deref()))
            .then_some(Candidate {
                hypothesis,
                byte_length: did.byte_length,
            })
        })
        .collect();
    let array_ids: HashSet<i64> = rows
        .iter()
        .filter(|row| {
            rows.iter().any(|other| {
                other.hypothesis.module_id == row.hypothesis.module_id
                    && other.byte_length == row.byte_length
                    && other.hypothesis.did.abs_diff(row.hypothesis.did) == 1
            })
        })
        .map(|row| row.hypothesis.id)
        .collect();
    rows.sort_by_key(|row| {
        let inherited =
            row.hypothesis.decode_json.is_some() && row.hypothesis.vehicle_fit == "untested";
        let small = matches!(row.byte_length, Some(1..=4));
        let array = array_ids.contains(&row.hypothesis.id);
        (
            if inherited {
                0
            } else if small {
                1
            } else if array {
                2
            } else {
                3
            },
            row.hypothesis.module_address.clone(),
            row.hypothesis.did,
        )
    });
    rows
}

impl LearningRun {
    pub fn new(db: &Db, vehicle_id: i64) -> Self {
        let mut run = Self {
            candidates: candidates(db, vehicle_id).into(),
            modules: VecDeque::new(),
            members: Vec::new(),
            occupancy: VecDeque::new(),
            started: Instant::now(),
            samples_this_ride: 0,
            sampled_ids: HashSet::new(),
            suspended_logged: false,
            slow_until: None,
        };
        run.fill();
        run
    }

    fn fill(&mut self) {
        while self.members.len() < MAX_COHORT {
            let Some(candidate) = self.candidates.pop_front() else {
                break;
            };
            if candidate.hypothesis.sample_count >= MAX_SAMPLES {
                continue;
            }
            let module = candidate.hypothesis.module_address.clone();
            if !self.modules.contains(&module) {
                self.modules.push_back(module);
            }
            self.members.push(Member {
                hypothesis: candidate.hypothesis,
                refusals: 0,
                ride_samples: 0,
                first_payload: None,
                identical: true,
            });
        }
    }

    fn prune_occupancy(&mut self, now: Instant) {
        while self
            .occupancy
            .front()
            .is_some_and(|(at, _)| now.duration_since(*at) > OCCUPANCY_WINDOW)
        {
            self.occupancy.pop_front();
        }
    }

    pub fn suspended(&mut self, now: Instant) -> bool {
        self.prune_occupancy(now);
        let elapsed = now
            .duration_since(self.started)
            .min(OCCUPANCY_WINDOW)
            .as_secs_f64();
        elapsed > 0.0
            && self
                .occupancy
                .iter()
                .map(|(_, duration)| duration.as_secs_f64())
                .sum::<f64>()
                / elapsed
                > OCCUPANCY_LIMIT
            || self.slow_until.is_some_and(|until| now < until)
    }

    pub fn current(&mut self, now: Instant) -> Option<(String, Vec<(i64, u16)>)> {
        if self.suspended(now) {
            return None;
        }
        let module = self.modules.pop_front()?;
        self.modules.push_back(module.clone());
        let dids = self
            .members
            .iter()
            .filter(|m| m.hypothesis.module_address == module)
            .map(|m| (m.hypothesis.id, m.hypothesis.did))
            .collect();
        Some((module, dids))
    }

    pub fn record(&mut self, module: &str, elapsed: Duration, hits: &[(u16, String)]) {
        let now = Instant::now();
        self.occupancy.push_back((now, elapsed));
        if elapsed > SLOW_READ {
            self.slow_until = Some(now + OCCUPANCY_WINDOW);
        }
        let found: HashMap<u16, &String> =
            hits.iter().map(|(did, payload)| (*did, payload)).collect();
        for member in self
            .members
            .iter_mut()
            .filter(|m| m.hypothesis.module_address == module)
        {
            match found.get(&member.hypothesis.did) {
                Some(payload) => {
                    member.refusals = 0;
                    member.ride_samples += 1;
                    member.identical &= member
                        .first_payload
                        .as_ref()
                        .is_none_or(|first| first == *payload);
                    member
                        .first_payload
                        .get_or_insert_with(|| (*payload).clone());
                    self.samples_this_ride += 1;
                    self.sampled_ids.insert(member.hypothesis.id);
                }
                None => member.refusals = member.refusals.saturating_add(1),
            }
        }
        self.members.retain(|member| {
            member.hypothesis.sample_count + member.ride_samples < MAX_SAMPLES
                && !(member.ride_samples >= CONSTANT_SAMPLES && member.identical)
                && member.refusals < MAX_REFUSALS
        });
        self.modules.retain(|candidate| {
            self.members
                .iter()
                .any(|m| &m.hypothesis.module_address == candidate)
        });
        self.fill();
    }

    pub fn slow(&self, elapsed: Duration) -> bool {
        elapsed > SLOW_READ
    }

    pub fn status(&mut self) -> LearningStatus {
        LearningStatus {
            cohort: self.members.len(),
            module: self.modules.front().cloned(),
            samples_this_ride: self.samples_this_ride,
            suspended: self.suspended(Instant::now()),
        }
    }

    pub fn sampled_ids(&self) -> Vec<i64> {
        self.sampled_ids.iter().copied().collect()
    }
    pub fn take_suspend_log(&mut self, suspended: bool) -> bool {
        if suspended && !self.suspended_logged {
            self.suspended_logged = true;
            true
        } else {
            if !suspended {
                self.suspended_logged = false;
            }
            false
        }
    }
}

fn bytes(raw: &str) -> Vec<u8> {
    raw.split_whitespace()
        .filter_map(|part| u8::from_str_radix(part, 16).ok())
        .collect()
}

fn inherited(raw: Option<&str>) -> Option<InheritedDecode> {
    let value = serde_json::from_str::<serde_json::Value>(raw?).ok()?;
    Some(InheritedDecode {
        label: value.get("label")?.as_str()?.into(),
        offset: value.get("offset")?.as_u64()? as u8,
        len: value.get("len")?.as_u64()? as u8,
        scale: value.get("scale")?.as_f64()?,
        bias: value.get("bias")?.as_f64()?,
        signed: value.get("signed")?.as_bool()?,
        unit: value.get("unit")?.as_str()?.into(),
    })
}

pub fn analyze_ride(db: &Db, hypothesis_ids: &[i64]) {
    for id in hypothesis_ids {
        let Some(row) = db.hypothesis(*id) else {
            continue;
        };
        let samples: Vec<Sample> = db
            .hypothesis_samples(*id, 5000)
            .into_iter()
            .rev()
            .map(|sample| Sample {
                ts_ms: sample.ts_ms,
                payload: bytes(&sample.payload_hex),
                refs: sample
                    .refs_json
                    .as_deref()
                    .and_then(|raw| serde_json::from_str::<Vec<RefReading>>(raw).ok())
                    .unwrap_or_default(),
            })
            .collect();
        if samples.is_empty() {
            continue;
        }
        let input = HypothesisInput {
            module: row.module_address.clone(),
            did: row.did,
            samples: samples.clone(),
            siblings: Vec::new(),
            inherited: inherited(row.decode_json.as_deref()),
        };
        let report = correlation::analyze(&input);
        let width = report.shape.len as usize;
        let mut minimum = vec![u8::MAX; width];
        let mut maximum = vec![u8::MIN; width];
        for sample in &samples {
            for (index, byte) in sample.payload.iter().take(width).enumerate() {
                minimum[index] = minimum[index].min(*byte);
                maximum[index] = maximum[index].max(*byte);
            }
        }
        let shape = serde_json::json!({"byte_length": report.shape.len, "len": report.shape.len, "signedness_guess": report.shape.signed_guess, "signed_guess": report.shape.signed_guess, "variability": report.shape.variability, "sentinels": report.shape.sentinels, "min": minimum, "max": maximum});
        let interpretations = serde_json::json!({"reference_correlations": report.correlations, "candidate_interpretations": report.interpretations});
        let confidence = report
            .interpretations
            .iter()
            .map(|item| item.confidence)
            .fold(0.0, f64::max);
        let fit = match report.inherited_fit {
            Some(InheritedFit::Matched { .. }) => Some("matched"),
            Some(InheritedFit::Conflicted { .. }) => Some("conflicted"),
            _ => None,
        };
        db.write_hypothesis_analysis(
            *id,
            &shape.to_string(),
            &interpretations.to_string(),
            confidence,
            fit,
        );
    }
}

pub fn reference_readings(values: &HashMap<String, (f64, i64)>) -> Vec<RefReading> {
    const KEYS: [&str; 9] = [
        "speed",
        "rpm",
        "coolant",
        "intake_temp",
        "load",
        "throttle",
        "map",
        "voltage",
        "fuel_rate",
    ];
    KEYS.into_iter()
        .filter_map(|key| {
            values.get(key).map(|(value, ts_ms)| RefReading {
                key: key.into(),
                value: *value,
                ts_ms: *ts_ms,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::HypothesisUpsert;

    fn seed_candidate(
        db: &Db,
        vehicle_id: i64,
        module_id: i64,
        did: u16,
        width: i64,
        decode_json: Option<String>,
    ) -> i64 {
        db.upsert_discovered_did(module_id, did, &"00 ".repeat(width as usize), width, None);
        db.upsert_hypothesis(&HypothesisUpsert {
            vehicle_id,
            module_id,
            did,
            knowledge_state: "unknown".into(),
            decode_json,
            ..Default::default()
        })
        .0
    }

    fn seeded_run() -> (Db, LearningRun, Vec<i64>) {
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        let vehicle_id = db.create_vehicle_named("test vehicle");
        let first = db.upsert_discovered_module(vehicle_id, "700/708", None);
        let second = db.upsert_discovered_module(vehicle_id, "701/709", None);
        let decode = serde_json::json!({"label":"candidate", "offset":0, "len":1, "scale":1.0, "bias":0.0, "signed":false, "unit":"km/h"}).to_string();
        let inherited = seed_candidate(&db, vehicle_id, first, 0xD100, 8, Some(decode));
        let small = seed_candidate(&db, vehicle_id, first, 0xD110, 2, None);
        let array_a = seed_candidate(&db, vehicle_id, second, 0xD200, 8, None);
        let array_b = seed_candidate(&db, vehicle_id, second, 0xD201, 8, None);
        let excluded = seed_candidate(&db, vehicle_id, first, 0xF190, 4, None);
        let opaque = seed_candidate(&db, vehicle_id, first, 0xD120, 5, None);
        db.write_hypothesis_analysis(
            opaque,
            &serde_json::json!({"variability":"opaque"}).to_string(),
            "{}",
            0.0,
            None,
        );
        let run = LearningRun::new(&db, vehicle_id);
        (
            db,
            run,
            vec![inherited, small, array_a, array_b, excluded, opaque],
        )
    }

    #[test]
    fn cohort_orders_inherited_small_then_arrays_and_excludes_unsafe_classes() {
        let (_db, run, ids) = seeded_run();
        let selected: Vec<i64> = run
            .members
            .iter()
            .map(|member| member.hypothesis.id)
            .collect();
        assert_eq!(selected, ids[..4]);
        assert!(!selected.contains(&ids[4]));
        assert!(!selected.contains(&ids[5]));
    }

    #[test]
    fn learning_ticks_rotate_across_modules() {
        let (_db, mut run, _) = seeded_run();
        let first = run.current(Instant::now()).unwrap().0;
        let second = run.current(Instant::now()).unwrap().0;
        let third = run.current(Instant::now()).unwrap().0;
        assert_ne!(first, second);
        assert_eq!(first, third);
    }

    #[test]
    fn twelve_identical_samples_retire_a_hypothesis() {
        let (_db, mut run, ids) = seeded_run();
        for _ in 0..12 {
            run.record("700/708", Duration::ZERO, &[(0xD100, "01".into())]);
        }
        assert!(!run
            .members
            .iter()
            .any(|member| member.hypothesis.id == ids[0]));
    }

    #[test]
    fn occupancy_over_twenty_percent_self_suspends() {
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        let mut run = LearningRun::new(&db, 1);
        run.started = Instant::now() - Duration::from_secs(10);
        run.occupancy
            .push_back((Instant::now(), Duration::from_millis(2001)));
        assert!(run.suspended(Instant::now()));
    }

    #[test]
    fn ride_analysis_writes_shape_and_fit_without_naming_or_promoting() {
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        let vehicle_id = db.create_vehicle_named("analysis test");
        let module_id = db.upsert_discovered_module(vehicle_id, "700/708", None);
        let decode = serde_json::json!({"label":"inherited candidate", "offset":0, "len":1, "scale":1.0, "bias":0.0, "signed":false, "unit":"km/h"}).to_string();
        let id = seed_candidate(&db, vehicle_id, module_id, 0xD100, 1, Some(decode));
        for value in 10..30 {
            let refs = serde_json::to_string(&vec![RefReading {
                key: "speed".into(),
                value: value as f64,
                ts_ms: value,
            }])
            .unwrap();
            db.insert_hypothesis_sample(id, value, &format!("{value:02X}"), Some(&refs));
        }
        analyze_ride(&db, &[id]);
        let row = db.hypothesis(id).unwrap();
        assert!(row.shape_json.is_some());
        assert!(row.interpretations_json.is_some());
        assert_eq!(row.vehicle_fit, "matched");
        assert_eq!(row.label, None);
        assert_eq!(row.knowledge_state, "unknown");
    }
}
