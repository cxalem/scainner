use super::*;

fn fixture(contents: &str) -> HypothesisInput {
    serde_json::from_str(contents).expect("valid HypothesisInput fixture")
}

fn correlation<'a>(report: &'a HypothesisReport, key: &str) -> &'a Correlation {
    report
        .correlations
        .iter()
        .find(|fit| fit.reference == key)
        .unwrap_or_else(|| panic!("missing {key} fit in {:?}", report.correlations))
}

#[test]
fn drive_wheels_are_a_ranked_four_value_array() {
    let fixtures = [
        include_str!("../../../tests/fixtures/psa/c41/correlation/drive-d400.json"),
        include_str!("../../../tests/fixtures/psa/c41/correlation/drive-d401.json"),
        include_str!("../../../tests/fixtures/psa/c41/correlation/drive-d402.json"),
        include_str!("../../../tests/fixtures/psa/c41/correlation/drive-d403.json"),
    ];
    for contents in fixtures {
        let report = analyze(&fixture(contents));
        let speed = correlation(&report, "speed");
        assert!(speed.r >= 0.98, "{:#?}", speed);
        assert!((speed.slope - 99.0).abs() <= 5.0, "{:#?}", speed);
        assert_eq!(
            report.array.as_ref().unwrap().group,
            [0xD400, 0xD401, 0xD402, 0xD403]
        );
        assert_eq!(report.interpretations[0].label, "wheel speed ×0.01 km/h");
        assert!(report.interpretations[0]
            .competing_with
            .contains(&"vehicle speed".to_string()));
    }
}

#[test]
fn cornering_resolves_the_outer_side() {
    let report = analyze(&fixture(include_str!(
        "../../../tests/fixtures/psa/c41/correlation/combined-d400.json"
    )));
    let split = report.array.unwrap().side_split.unwrap();
    assert_eq!(split.outer_in_left_turn, [0xD401, 0xD403]);
    assert!(report.interpretations[0].confidence > 0.6);
}

#[test]
fn binary_events_and_brake_magnitude_remain_ranked_not_named() {
    let switch = analyze(&fixture(include_str!(
        "../../../tests/fixtures/psa/c41/correlation/drive-d406.json"
    )));
    assert_eq!(switch.shape.variability, Variability::EventLike);
    assert!(switch.notes.iter().any(|note| note.contains("A→B→A")));
    assert!(!switch
        .interpretations
        .iter()
        .any(|item| item.label == "brake pedal switch"));
    assert!(correlation(&switch, "braking").r.abs() < 0.5);

    let pressure = analyze(&fixture(include_str!(
        "../../../tests/fixtures/psa/c41/correlation/drive-d40c.json"
    )));
    assert!(pressure.interpretations.is_empty());
    assert!(pressure
        .interpretations
        .iter()
        .all(|item| item.confidence <= 0.6));
    assert!(pressure
        .discriminating_test
        .as_deref()
        .is_some_and(|test| test.contains("stationary A→B→A")));

    let reverse = analyze(&fixture(include_str!(
        "../../../tests/fixtures/psa/c41/correlation/drive-d46d.json"
    )));
    assert_eq!(reverse.shape.variability, Variability::EventLike);
    assert!(reverse
        .discriminating_test
        .as_deref()
        .is_some_and(|test| test.contains("labelled A→B→A")));
}

#[test]
fn vacuum_requires_the_discriminating_engine_off_capture() {
    let drive = analyze(&fixture(include_str!(
        "../../../tests/fixtures/psa/c41/correlation/drive-d479.json"
    )));
    assert!(drive.correlations.iter().all(|fit| fit.r.abs() < 0.5));
    assert!(!drive
        .interpretations
        .iter()
        .any(|item| item.label == "servo vacuum"));

    let pump = analyze(&fixture(include_str!(
        "../../../tests/fixtures/psa/c41/correlation/vacuum-d479.json"
    )));
    assert_eq!(pump.interpretations[0].label, "servo vacuum");
    assert!(pump.interpretations[0].confidence > 0.6);
    assert!(pump.interpretations[0]
        .evidence
        .iter()
        .any(|evidence| evidence.contains("monotonically")));
}

#[test]
fn steering_raw_fits_preserve_slope_bias_and_low_confidence_candidates() {
    let angle = analyze(&fixture(include_str!(
        "../../../tests/fixtures/psa/c41/correlation/steering-static-d40d.json"
    )));
    let fit = correlation(&angle, "steering_angle");
    assert!((fit.slope - 10.0).abs() <= 0.3, "{fit:#?}");
    assert!(fit.bias.abs() <= 5.0, "{fit:#?}");

    let pinion = analyze(&fixture(include_str!(
        "../../../tests/fixtures/psa/c41/correlation/steering-static-d40e.json"
    )));
    let fit = correlation(&pinion, "steering_angle");
    assert!((fit.slope - 10.0).abs() <= 0.3, "{fit:#?}");
    assert!((fit.bias + 181.0).abs() <= 10.0, "{fit:#?}");

    for contents in [
        include_str!("../../../tests/fixtures/psa/c41/correlation/steering-static-d40f.json"),
        include_str!("../../../tests/fixtures/psa/c41/correlation/steering-static-d411.json"),
    ] {
        let report = analyze(&fixture(contents));
        assert!(report
            .interpretations
            .iter()
            .any(|item| item.label == "steering torque or motor current"));
        assert!(report
            .interpretations
            .iter()
            .all(|item| item.confidence <= 0.6));
    }

    let slow = analyze(&fixture(include_str!(
        "../../../tests/fixtures/psa/c41/correlation/steering-turn-d404.json"
    )));
    assert_eq!(slow.shape.variability, Variability::Slow);
}

#[test]
fn camera_constants_are_a_negative_and_request_a_driving_capture() {
    for contents in [
        include_str!("../../../tests/fixtures/psa/c41/correlation/camera-d400-constant.json"),
        include_str!("../../../tests/fixtures/psa/c41/correlation/camera-d401-constant.json"),
        include_str!("../../../tests/fixtures/psa/c41/correlation/camera-d402-constant.json"),
        include_str!("../../../tests/fixtures/psa/c41/correlation/camera-d403-constant.json"),
        include_str!("../../../tests/fixtures/psa/c41/correlation/camera-d404-constant.json"),
        include_str!("../../../tests/fixtures/psa/c41/correlation/camera-d405-constant.json"),
        include_str!("../../../tests/fixtures/psa/c41/correlation/camera-d407-constant.json"),
        include_str!("../../../tests/fixtures/psa/c41/correlation/camera-d408-constant.json"),
        include_str!("../../../tests/fixtures/psa/c41/correlation/camera-d409-constant.json"),
    ] {
        let report = analyze(&fixture(contents));
        assert_eq!(report.shape.variability, Variability::Constant);
        assert!(report.interpretations.is_empty());
        assert!(report
            .discriminating_test
            .as_deref()
            .is_some_and(|test| test.contains("driving")));
    }
    let anomalous = analyze(&fixture(include_str!(
        "../../../tests/fixtures/psa/c41/correlation/camera-d40a-constant.json"
    )));
    assert_eq!(anomalous.shape.variability, Variability::EventLike);
    assert!(anomalous.interpretations.is_empty());
    assert_eq!(anomalous.shape.distinct_values, 2);
}

#[test]
fn inherited_fit_can_cross_the_naming_threshold() {
    let mut input = fixture(include_str!(
        "../../../tests/fixtures/psa/c41/correlation/drive-d400.json"
    ));
    input.inherited = Some(InheritedDecode {
        label: "rear-left wheel speed".into(),
        offset: 0,
        len: 2,
        scale: 0.01,
        bias: 0.0,
        signed: false,
        unit: "km/h".into(),
    });
    let report = analyze(&input);
    assert!(matches!(
        report.inherited_fit,
        Some(InheritedFit::Matched { .. })
    ));
    assert!(report
        .interpretations
        .iter()
        .any(|item| item.label == "rear-left wheel speed" && item.confidence > 0.6));
}

#[test]
fn analysis_is_deterministic() {
    let input = fixture(include_str!(
        "../../../tests/fixtures/psa/c41/correlation/drive-d400.json"
    ));
    assert_eq!(analyze(&input), analyze(&input));
}

#[test]
fn fixtures_do_not_feed_target_brake_dids_back_as_references() {
    for contents in [
        include_str!("../../../tests/fixtures/psa/c41/correlation/drive-d406.json"),
        include_str!("../../../tests/fixtures/psa/c41/correlation/drive-d40c.json"),
        include_str!("../../../tests/fixtures/psa/c41/correlation/drive-d479.json"),
    ] {
        let input = fixture(contents);
        assert!(input
            .samples
            .iter()
            .flat_map(|sample| &sample.refs)
            .all(|reading| { matches!(reading.key.as_str(), "speed" | "rpm" | "voltage") }));
    }
}

#[test]
fn inherited_decode_without_a_testable_reference_is_insufficient() {
    let mut input = fixture(include_str!(
        "../../../tests/fixtures/psa/c41/correlation/drive-d400.json"
    ));
    input.inherited = Some(InheritedDecode {
        label: "coolant temperature".into(),
        offset: 0,
        len: 2,
        scale: 1.0,
        bias: 0.0,
        signed: false,
        unit: "°C".into(),
    });
    assert_eq!(
        analyze(&input).inherited_fit,
        Some(InheritedFit::Insufficient)
    );
}

#[test]
fn vacuum_requires_explicit_engine_off_evidence() {
    let mut input = fixture(include_str!(
        "../../../tests/fixtures/psa/c41/correlation/vacuum-d479.json"
    ));
    for sample in &mut input.samples {
        sample.refs.retain(|reading| reading.key != "engine_on");
    }
    assert!(!analyze(&input)
        .interpretations
        .iter()
        .any(|item| item.label == "servo vacuum"));
}

#[test]
fn running_rpm_overrides_a_false_engine_off_flag() {
    let mut input = fixture(include_str!(
        "../../../tests/fixtures/psa/c41/correlation/vacuum-d479.json"
    ));
    for sample in &mut input.samples {
        sample.refs.push(RefReading {
            key: "rpm".into(),
            value: 800.0,
            ts_ms: sample.ts_ms,
        });
    }
    assert!(!analyze(&input)
        .interpretations
        .iter()
        .any(|item| item.label == "servo vacuum"));
}

#[test]
fn inherited_brake_event_tests_association_not_numeric_slope() {
    let samples = (0..20)
        .map(|index| {
            let braking = index % 2 == 1;
            Sample {
                ts_ms: index * 1_000,
                payload: vec![if braking { 20 } else { 0 }],
                refs: vec![RefReading {
                    key: "speed".into(),
                    value: if braking { 5.0 } else { 10.0 },
                    ts_ms: index * 1_000,
                }],
            }
        })
        .collect();
    let report = analyze(&HypothesisInput {
        module: "test".into(),
        did: 1,
        samples,
        siblings: Vec::new(),
        inherited: Some(InheritedDecode {
            label: "brake pressure".into(),
            offset: 0,
            len: 1,
            scale: 1.0,
            bias: 0.0,
            signed: false,
            unit: "bar".into(),
        }),
    });
    assert!(matches!(
        report.inherited_fit,
        Some(InheritedFit::Matched { r }) if r >= 0.7
    ));

    let mut weak = fixture(include_str!(
        "../../../tests/fixtures/psa/c41/correlation/drive-d40c.json"
    ));
    weak.inherited = Some(InheritedDecode {
        label: "brake pressure".into(),
        offset: 0,
        len: 1,
        scale: 1.0,
        bias: 0.0,
        signed: false,
        unit: "bar".into(),
    });
    assert_eq!(
        analyze(&weak).inherited_fit,
        Some(InheritedFit::Insufficient)
    );
}

#[test]
fn non_finite_references_never_escape_into_the_report() {
    let mut input = fixture(include_str!(
        "../../../tests/fixtures/psa/c41/correlation/drive-d400.json"
    ));
    let ts_ms = input.samples[0].ts_ms;
    input.samples[0].refs.push(RefReading {
        key: "bad".into(),
        value: f64::NAN,
        ts_ms,
    });
    let report = analyze(&input);
    assert!(report.correlations.iter().all(|fit| {
        fit.r.is_finite()
            && fit.slope.is_finite()
            && fit.bias.is_finite()
            && fit.residual_sd.is_finite()
    }));
    let json = serde_json::to_string(&report).expect("finite report serializes");
    let _: HypothesisReport = serde_json::from_str(&json).expect("report round-trips");
}

#[test]
fn mixed_width_samples_are_excluded_deterministically() {
    let mut input = fixture(include_str!(
        "../../../tests/fixtures/psa/c41/correlation/drive-d400.json"
    ));
    input.samples.push(Sample {
        ts_ms: 999_999,
        payload: vec![1],
        refs: Vec::new(),
    });
    let report = analyze(&input);
    assert_eq!(report.samples_used, 196);
    assert!(report
        .notes
        .iter()
        .any(|note| note.contains("payload width")));
}

#[test]
fn duplicate_candidate_labels_are_coalesced() {
    let mut input = fixture(include_str!(
        "../../../tests/fixtures/psa/c41/correlation/drive-d400.json"
    ));
    input.inherited = Some(InheritedDecode {
        label: "wheel speed ×0.01 km/h".into(),
        offset: 0,
        len: 2,
        scale: 0.01,
        bias: 0.0,
        signed: false,
        unit: "km/h".into(),
    });
    let report = analyze(&input);
    assert_eq!(
        report
            .interpretations
            .iter()
            .filter(|item| item.label == "wheel speed ×0.01 km/h")
            .count(),
        1
    );
}

#[test]
fn lag_search_reports_positive_when_the_did_lags_the_reference() {
    let samples = (0..30)
        .map(|index| Sample {
            ts_ms: 2_000 + index * 100,
            payload: vec![index as u8],
            refs: vec![RefReading {
                key: "synthetic".into(),
                value: index as f64,
                ts_ms: index * 100,
            }],
        })
        .collect();
    let report = analyze(&HypothesisInput {
        module: "test".into(),
        did: 1,
        samples,
        siblings: Vec::new(),
        inherited: None,
    });
    assert_eq!(correlation(&report, "synthetic").lag_ms, 2_000);
}

#[test]
fn array_requires_equal_rest_values_and_covariation() {
    let mut input = fixture(include_str!(
        "../../../tests/fixtures/psa/c41/correlation/drive-d400.json"
    ));
    for snapshot in &mut input.siblings {
        if snapshot.did == 0xD401 && snapshot.payload == [0, 0] {
            snapshot.payload = vec![0, 100];
        }
    }
    assert!(analyze(&input).array.is_none());
}

#[test]
fn five_thousand_samples_stay_inside_the_bounded_fit_path() {
    let samples = (0..5_000)
        .map(|index| Sample {
            ts_ms: index * 20,
            payload: (index as u16).to_be_bytes().to_vec(),
            refs: vec![RefReading {
                key: "ramp".into(),
                value: index as f64,
                ts_ms: index * 20,
            }],
        })
        .collect();
    let input = HypothesisInput {
        module: "benchmark".into(),
        did: 1,
        samples,
        siblings: Vec::new(),
        inherited: None,
    };
    let started = std::time::Instant::now();
    let report = analyze(&input);
    assert_eq!(report.samples_used, 5_000);
    assert!(
        started.elapsed() < std::time::Duration::from_secs(5),
        "bounded fit regressed to {:?}",
        started.elapsed()
    );
}

mod shapes {
    use std::collections::{BTreeMap, BTreeSet};
    use std::path::{Path, PathBuf};
    use std::time::Duration;

    use serde::Deserialize;

    use super::super::fit::decode_with;
    use super::super::shape::{offset_binary_window, signed_guess};
    use super::super::*;
    use crate::elm::driver::ElmDriver;
    use crate::elm::parser;
    use crate::elm::uds::read_did;

    #[derive(Deserialize)]
    struct Expected {
        synthetic_framing: bool,
        service: String,
        parameter: String,
        route: Route,
        signals: BTreeMap<String, SignalDef>,
        cases: Vec<Case>,
    }

    #[derive(Deserialize)]
    struct Route {
        request_id: String,
        response_id: String,
        bits29: bool,
        props: BTreeMap<String, String>,
    }

    #[derive(Deserialize)]
    struct SignalDef {
        fmt: serde_json::Value,
    }

    #[derive(Deserialize)]
    struct Case {
        values: BTreeMap<String, serde_json::Value>,
        #[serde(default)]
        frames: Vec<String>,
    }

    #[derive(Deserialize)]
    struct Replay {
        contains_vehicle_identifiers: bool,
        steps: Vec<Step>,
    }

    #[derive(Deserialize)]
    struct Step {
        command: String,
        response: String,
    }

    struct Fixture {
        brand: String,
        name: String,
        input: HypothesisInput,
        expected: Expected,
        replay_json: String,
        replay: Replay,
    }

    fn fixtures_root() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
    }

    fn sorted_dirs(path: &Path) -> Vec<PathBuf> {
        let mut dirs = std::fs::read_dir(path)
            .map(|entries| {
                entries
                    .filter_map(Result::ok)
                    .map(|entry| entry.path())
                    .filter(|path| path.is_dir())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        dirs.sort();
        dirs
    }

    fn corpus(shape: &str) -> Vec<Fixture> {
        let mut fixtures = Vec::new();
        for brand in sorted_dirs(&fixtures_root()) {
            for platform in sorted_dirs(&brand) {
                let correlation = platform.join(shape).join("correlation");
                let mut files = std::fs::read_dir(&correlation)
                    .map(|entries| {
                        entries
                            .filter_map(Result::ok)
                            .map(|entry| entry.path())
                            .filter(|path| {
                                path.extension().is_some_and(|ext| ext == "json")
                                    && !path.to_string_lossy().ends_with(".expected.json")
                            })
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                files.sort();
                for file in files {
                    let stem = file.file_stem().unwrap().to_string_lossy().to_string();
                    let expected_path = correlation.join(format!("{stem}.expected.json"));
                    let replay_path = platform
                        .join(shape)
                        .join("elm")
                        .join(format!("{stem}.json"));
                    let replay_json = std::fs::read_to_string(&replay_path)
                        .unwrap_or_else(|_| panic!("missing replay {}", replay_path.display()));
                    fixtures.push(Fixture {
                        brand: brand.file_name().unwrap().to_string_lossy().to_string(),
                        name: file.display().to_string(),
                        input: serde_json::from_str(&std::fs::read_to_string(&file).unwrap())
                            .unwrap_or_else(|error| panic!("{}: {error}", file.display())),
                        expected: serde_json::from_str(
                            &std::fs::read_to_string(&expected_path).unwrap_or_else(|_| {
                                panic!("missing sidecar {}", expected_path.display())
                            }),
                        )
                        .unwrap_or_else(|error| panic!("{}: {error}", expected_path.display())),
                        replay: serde_json::from_str(&replay_json)
                            .unwrap_or_else(|error| panic!("{}: {error}", replay_path.display())),
                        replay_json,
                    });
                }
            }
        }
        fixtures
    }

    fn brands(fixtures: &[Fixture]) -> BTreeSet<String> {
        fixtures
            .iter()
            .map(|fixture| fixture.brand.clone())
            .collect()
    }

    fn require(shape: &str, min_brands: usize) -> Vec<Fixture> {
        let fixtures = corpus(shape);
        let found = brands(&fixtures);
        assert!(
            found.len() >= min_brands,
            "shape {shape} needs fixtures from at least {min_brands} brands, found {found:?}"
        );
        for fixture in &fixtures {
            assert_eq!(
                fixture.input.samples.len(),
                fixture.expected.cases.len(),
                "{}: one expected case per sample",
                fixture.name
            );
            assert!(
                !fixture.replay.contains_vehicle_identifiers,
                "{}",
                fixture.name
            );
        }
        fixtures
    }

    fn extract_bits(data: &[u8], bix: usize, len: usize, blsb: bool) -> Option<u64> {
        if bix + len > data.len() * 8 {
            return None;
        }
        let mut data = data.to_vec();
        if blsb && len > 8 {
            let start = bix / 8;
            let end = (start + len.div_ceil(8)).min(data.len());
            data[start..end].reverse();
        }
        let mut result = 0_u64;
        for bit in bix..bix + len {
            if data[bit / 8] & (1 << (7 - bit % 8)) != 0 {
                result |= 1 << (bix + len - bit - 1);
            }
        }
        Some(result)
    }

    fn number(fmt: &serde_json::Value, key: &str, default: f64) -> f64 {
        fmt.get(key)
            .and_then(serde_json::Value::as_f64)
            .unwrap_or(default)
    }

    fn decode(fmt: &serde_json::Value, data: &[u8]) -> Option<serde_json::Value> {
        let len = number(fmt, "len", 0.0) as usize;
        let bix = number(fmt, "bix", 0.0) as usize;
        let blsb = fmt
            .get("blsb")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        let raw = extract_bits(data, bix, len, blsb)?;
        if let Some(map) = fmt.get("map") {
            return map.get(raw.to_string()).map(|entry| {
                entry
                    .get("value")
                    .cloned()
                    .unwrap_or_else(|| serde_json::Value::String(entry.to_string()))
            });
        }
        let mut raw = raw as i128;
        if fmt
            .get("sign")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false)
            && raw & (1 << (len - 1)) != 0
        {
            raw -= 1 << len;
        }
        let mut value = raw as f64 * number(fmt, "mul", 1.0) / number(fmt, "div", 1.0)
            + number(fmt, "add", 0.0);
        let (lo, hi) = (number(fmt, "min", 0.0), number(fmt, "max", 0.0));
        if hi > lo {
            value = value.clamp(lo, hi);
        }
        Some(serde_json::json!(value))
    }

    fn same(expected: &serde_json::Value, actual: &serde_json::Value) -> bool {
        match (expected.as_f64(), actual.as_f64()) {
            (Some(a), Some(b)) => (a - b).abs() <= 1e-6 + 1e-6 * a.abs(),
            _ => expected == actual,
        }
    }

    fn assert_expectations_decode(fixture: &Fixture) {
        for (sample, case) in fixture.input.samples.iter().zip(&fixture.expected.cases) {
            for (id, expected) in &case.values {
                if id == "ascii" {
                    continue;
                }
                let fmt = &fixture.expected.signals[id].fmt;
                let actual = decode(fmt, &sample.payload)
                    .unwrap_or_else(|| panic!("{}: {id} needs more data", fixture.name));
                assert!(
                    same(expected, &actual),
                    "{}: {id} expected {expected} decoded {actual}",
                    fixture.name
                );
            }
        }
    }

    fn inherited_from(id: &str, fmt: &serde_json::Value) -> Option<InheritedDecode> {
        let len = number(fmt, "len", 0.0) as usize;
        let bix = number(fmt, "bix", 0.0) as usize;
        let blsb = fmt
            .get("blsb")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        if fmt.get("map").is_some()
            || blsb
            || !len.is_multiple_of(8)
            || !bix.is_multiple_of(8)
            || len > 64
        {
            return None;
        }
        Some(InheritedDecode {
            label: id.to_string(),
            offset: (bix / 8) as u8,
            len: (len / 8) as u8,
            scale: number(fmt, "mul", 1.0) / number(fmt, "div", 1.0),
            bias: number(fmt, "add", 0.0),
            signed: fmt
                .get("sign")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false),
            unit: fmt
                .get("unit")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .into(),
        })
    }

    fn assert_engine_decodes(fixture: &Fixture) -> usize {
        let mut checked = 0;
        for (id, signal) in &fixture.expected.signals {
            let Some(inherited) = inherited_from(id, &signal.fmt) else {
                continue;
            };
            let (lo, hi) = (
                number(&signal.fmt, "min", 0.0),
                number(&signal.fmt, "max", 0.0),
            );
            for (sample, case) in fixture.input.samples.iter().zip(&fixture.expected.cases) {
                let Some(expected) = case.values.get(id).and_then(serde_json::Value::as_f64) else {
                    continue;
                };
                let mut value = decode_with(&sample.payload, &inherited)
                    .unwrap_or_else(|| panic!("{}: {id} did not decode", fixture.name));
                if hi > lo {
                    value = value.clamp(lo, hi);
                }
                assert!(
                    (value - expected).abs() <= 1e-6 + 1e-6 * expected.abs(),
                    "{}: {id} expected {expected} engine decoded {value}",
                    fixture.name
                );
                checked += 1;
            }
        }
        checked
    }

    fn replay_through_driver(fixture: &Fixture) {
        let mut driver = ElmDriver::from_replay_json(&fixture.replay_json)
            .unwrap_or_else(|error| panic!("{}: {error}", fixture.name));
        let echo = 1 + fixture.expected.parameter.len() / 2;
        let mut index = 0;
        for step in &fixture.replay.steps {
            if step.command.starts_with("AT") {
                let reply = driver.cmd(&step.command, Duration::from_secs(1)).unwrap();
                assert!(reply.contains("OK"), "{}: {}", fixture.name, step.command);
                continue;
            }
            let sample = &fixture.input.samples[index];
            let payload = if fixture.expected.service == "22" {
                let did = u16::from_str_radix(&fixture.expected.parameter, 16).unwrap();
                assert_eq!(did, fixture.input.did);
                read_did(
                    &mut driver,
                    crate::elm::uds_map::ReadService::DataByIdentifier,
                    did,
                )
                .unwrap()
                .unwrap_or_else(|| panic!("{}: DID {did:04X} not answered", fixture.name))
            } else {
                let raw = driver.cmd(&step.command, Duration::from_secs(1)).unwrap();
                let bytes = parser::payload_bytes(&parser::clean_response(&raw), "");
                let positive = u8::from_str_radix(&fixture.expected.service, 16).unwrap() + 0x40;
                assert_eq!(bytes[0], positive, "{}", fixture.name);
                bytes[echo..].to_vec()
            };
            assert_eq!(payload, sample.payload, "{}: case {index}", fixture.name);
            index += 1;
        }
        assert_eq!(index, fixture.input.samples.len(), "{}", fixture.name);
        driver.assert_replay_complete();
    }

    fn setup_commands(fixture: &Fixture) -> Vec<&str> {
        fixture
            .replay
            .steps
            .iter()
            .map(|step| step.command.as_str())
            .filter(|command| command.starts_with("AT"))
            .collect()
    }

    fn window_input(fixture: &Fixture, offset: usize, len: usize) -> HypothesisInput {
        let mut input = fixture.input.clone();
        input.inherited = None;
        for sample in &mut input.samples {
            sample.payload = sample.payload[offset..offset + len].to_vec();
        }
        input
    }

    #[test]
    fn service_21_group_responses_are_plain_payloads_to_the_engine() {
        let fixtures = require("svc21", 3);
        let mut decoded = 0;
        for fixture in &fixtures {
            assert_eq!(fixture.expected.service, "21", "{}", fixture.name);
            assert!(fixture.input.did <= 0xFF, "{}: group byte", fixture.name);
            assert_expectations_decode(fixture);
            decoded += assert_engine_decodes(fixture);
            replay_through_driver(fixture);
            let report = analyze(&fixture.input);
            assert_eq!(report.samples_used, fixture.input.samples.len());
            assert_eq!(
                usize::from(report.shape.len),
                fixture.input.samples[0].payload.len().min(255)
            );
            assert!(
                report
                    .interpretations
                    .iter()
                    .all(|item| item.confidence <= 0.6),
                "{}: nothing is named without discriminating evidence",
                fixture.name
            );
        }
        assert!(decoded > 0);
    }

    #[test]
    fn service_1a_identification_payloads_are_ascii_constants() {
        let fixtures = require("svc1a", 1);
        for fixture in &fixtures {
            assert_eq!(fixture.expected.service, "1A", "{}", fixture.name);
            assert!(fixture.expected.synthetic_framing, "{}", fixture.name);
            replay_through_driver(fixture);
            let report = analyze(&fixture.input);
            assert_eq!(
                report.shape.variability,
                Variability::Constant,
                "{}",
                fixture.name
            );
            assert!(
                report
                    .notes
                    .iter()
                    .any(|note| note.contains("printable ASCII")),
                "{}: {:?}",
                fixture.name,
                report.notes
            );
            assert!(report.interpretations.is_empty());
        }
    }

    #[test]
    fn ascii_strings_are_constant_with_a_note_and_decode_to_the_recorded_text() {
        let fixtures = require("ascii", 3);
        for fixture in &fixtures {
            replay_through_driver(fixture);
            for (sample, case) in fixture.input.samples.iter().zip(&fixture.expected.cases) {
                let text = sample
                    .payload
                    .iter()
                    .filter(|byte| **byte != 0)
                    .map(|byte| char::from(*byte))
                    .collect::<String>();
                assert_eq!(
                    case.values["ascii"].as_str().unwrap(),
                    text,
                    "{}",
                    fixture.name
                );
                let frames = &case.frames;
                assert!(
                    !frames.is_empty(),
                    "{}: synthetic frames recorded",
                    fixture.name
                );
            }
            let report = analyze(&fixture.input);
            assert_eq!(
                report.shape.variability,
                Variability::Constant,
                "{}",
                fixture.name
            );
            assert!(
                report
                    .notes
                    .iter()
                    .any(|note| note.contains("printable ASCII")),
                "{}: {:?}",
                fixture.name,
                report.notes
            );
        }
    }

    #[test]
    fn twenty_nine_bit_routes_replay_with_extended_ids_and_target_bytes() {
        let fixtures = require("can29", 3);
        let mut target_iteration = 0;
        for fixture in &fixtures {
            assert!(fixture.expected.route.bits29, "{}", fixture.name);
            let setup = setup_commands(fixture);
            assert_eq!(setup[0], "ATSP7", "{}", fixture.name);
            assert!(
                setup.iter().any(|c| c.starts_with("ATCP ")),
                "{}",
                fixture.name
            );
            let cra = setup.iter().find(|c| c.starts_with("ATCRA ")).unwrap();
            assert_eq!(cra.len(), "ATCRA ".len() + 8, "{}: {cra}", fixture.name);
            assert_eq!(
                &cra[6..],
                fixture.expected.route.response_id,
                "{}",
                fixture.name
            );
            let fcsh = setup.iter().find(|c| c.starts_with("ATFCSH ")).unwrap();
            assert_eq!(
                &fcsh[7..],
                fixture.expected.route.request_id,
                "{}",
                fixture.name
            );
            if let Some(target) = fixture.expected.route.props.get("ta") {
                target_iteration += 1;
                let sh = setup.iter().find(|c| c.starts_with("ATSH ")).unwrap();
                assert!(
                    sh.ends_with(&target.to_uppercase()),
                    "{}: {sh}",
                    fixture.name
                );
                assert!(fixture
                    .expected
                    .route
                    .request_id
                    .ends_with(&target.to_uppercase()));
                assert!(fixture
                    .expected
                    .route
                    .response_id
                    .ends_with(&target.to_uppercase()));
            }
            assert_expectations_decode(fixture);
            assert_engine_decodes(fixture);
            replay_through_driver(fixture);
            let report = analyze(&fixture.input);
            assert!(report.module.contains('/'));
            assert_eq!(report.module, fixture.input.module);
        }
        assert!(
            target_iteration >= 3,
            "target-byte routes: {target_iteration}"
        );
    }

    #[test]
    fn extended_addressing_routes_set_the_address_extension_and_reassemble() {
        let fixtures = require("ext-addr", 2);
        let mut multi_frame = 0;
        for fixture in &fixtures {
            let extension = fixture.expected.route.props["e"].to_uppercase();
            let setup = setup_commands(fixture);
            assert!(
                setup.contains(&format!("ATCEA {extension}").as_str()),
                "{}: {setup:?}",
                fixture.name
            );
            assert!(
                setup.contains(&format!("ATFCSD {extension} 30 00 00").as_str()),
                "{}: {setup:?}",
                fixture.name
            );
            multi_frame += usize::from(fixture.input.samples[0].payload.len() > 4);
            assert_expectations_decode(fixture);
            assert_engine_decodes(fixture);
            replay_through_driver(fixture);
        }
        assert!(multi_frame > 0);
    }

    #[test]
    fn multi_frame_payloads_longer_than_eight_bytes_are_analysed_and_decoded() {
        let fixtures = require("multiframe", 4);
        let lengths = fixtures
            .iter()
            .map(|fixture| fixture.input.samples[0].payload.len())
            .collect::<BTreeSet<_>>();
        assert!(
            lengths.iter().any(|len| (9..=24).contains(len)),
            "{lengths:?}"
        );
        assert!(
            lengths.iter().any(|len| (48..=96).contains(len)),
            "{lengths:?}"
        );
        assert!(lengths.iter().any(|len| *len > 200), "{lengths:?}");
        let mut decoded = 0;
        for fixture in &fixtures {
            assert!(
                fixture.input.samples[0].payload.len() > 8,
                "{}",
                fixture.name
            );
            assert_expectations_decode(fixture);
            decoded += assert_engine_decodes(fixture);
            replay_through_driver(fixture);
            let report = analyze(&fixture.input);
            assert_eq!(report.samples_used, fixture.input.samples.len());
            assert_eq!(
                usize::from(report.shape.len),
                fixture.input.samples[0].payload.len().min(255)
            );
            assert!(
                report
                    .notes
                    .iter()
                    .any(|note| note.contains("first 8 bytes")),
                "{}: {:?}",
                fixture.name,
                report.notes
            );
            if let Some((id, signal)) = fixture
                .expected
                .signals
                .iter()
                .find(|(id, signal)| inherited_from(id, &signal.fmt).is_some())
            {
                let mut input = fixture.input.clone();
                input.inherited = inherited_from(id, &signal.fmt);
                let report = analyze(&input);
                assert!(report
                    .notes
                    .iter()
                    .all(|note| !note.contains("first 8 bytes")));
                assert!(report.inherited_fit.is_some());
            }
        }
        assert!(decoded > 0);
    }

    #[test]
    fn offset_binary_sixteen_bit_fields_are_flagged_and_decode_with_a_bias() {
        let fixtures = require("offset-binary", 2);
        let mut flagged = 0;
        let mut decoded = 0;
        for fixture in &fixtures {
            assert_expectations_decode(fixture);
            decoded += assert_engine_decodes(fixture);
            replay_through_driver(fixture);
            for (id, signal) in &fixture.expected.signals {
                let Some(inherited) = inherited_from(id, &signal.fmt) else {
                    continue;
                };
                if inherited.signed || inherited.len != 2 || inherited.bias == 0.0 {
                    continue;
                }
                let window = window_input(
                    fixture,
                    usize::from(inherited.offset),
                    usize::from(inherited.len),
                );
                let distinct = window
                    .samples
                    .iter()
                    .map(|sample| sample.payload.clone())
                    .collect::<BTreeSet<_>>();
                if distinct.len() < 3 {
                    continue;
                }
                assert!(
                    !signed_guess(&window),
                    "{}: {id} must not read as two's complement",
                    fixture.name
                );
                if offset_binary_window(&window, 0, 2) {
                    flagged += 1;
                    let report = analyze(&window);
                    assert!(
                        report
                            .notes
                            .iter()
                            .any(|note| note.contains("offset-binary")),
                        "{}: {:?}",
                        fixture.name,
                        report.notes
                    );
                    let mut with_decode = fixture.input.clone();
                    with_decode.inherited = Some(inherited.clone());
                    let report = analyze(&with_decode);
                    assert!(report
                        .notes
                        .iter()
                        .any(|note| note.contains("offset-binary")));
                }
            }
        }
        assert!(flagged >= 2, "offset-binary windows flagged: {flagged}");
        assert!(decoded > 0);
    }

    #[test]
    fn twos_complement_sixteen_bit_fields_keep_the_signed_guess() {
        let fixtures = require("twos-complement", 3);
        let mut guessed = 0;
        for fixture in &fixtures {
            assert_expectations_decode(fixture);
            assert!(assert_engine_decodes(fixture) > 0, "{}", fixture.name);
            replay_through_driver(fixture);
            for (id, signal) in &fixture.expected.signals {
                let Some(inherited) = inherited_from(id, &signal.fmt) else {
                    continue;
                };
                if !inherited.signed || inherited.len != 2 {
                    continue;
                }
                let window = window_input(
                    fixture,
                    usize::from(inherited.offset),
                    usize::from(inherited.len),
                );
                let signs = window
                    .samples
                    .iter()
                    .map(|sample| sample.payload[0] & 0x80 != 0)
                    .collect::<BTreeSet<_>>();
                if signs.len() == 2 {
                    assert!(signed_guess(&window), "{}: {id}", fixture.name);
                    assert!(
                        !offset_binary_window(&window, 0, 2),
                        "{}: {id}",
                        fixture.name
                    );
                    guessed += 1;
                }
            }
        }
        assert!(
            guessed > 0,
            "no signed field with both polarities in the corpus"
        );
    }

    #[test]
    fn bit_packed_flags_decode_per_bit_and_are_noted_when_they_toggle() {
        let fixtures = require("bitfield", 3);
        let mut sub_byte = 0;
        for fixture in &fixtures {
            assert_expectations_decode(fixture);
            assert_engine_decodes(fixture);
            replay_through_driver(fixture);
            let flags = fixture
                .expected
                .signals
                .iter()
                .filter(|(_, signal)| number(&signal.fmt, "len", 8.0) < 8.0)
                .collect::<Vec<_>>();
            sub_byte += flags.len();
            if let Some((_, signal)) = flags.first() {
                let bix = number(&signal.fmt, "bix", 0.0) as usize;
                let mut input = fixture.input.clone();
                input.inherited = None;
                let base = input.samples[0].payload.clone();
                input.samples = (0..12)
                    .map(|index| {
                        let mut payload = base.clone();
                        if index % 2 == 1 {
                            payload[bix / 8] ^= 1 << (7 - bix % 8);
                        }
                        Sample {
                            ts_ms: index * 1_000,
                            payload,
                            refs: Vec::new(),
                        }
                    })
                    .collect();
                let report = analyze(&input);
                assert!(
                    report.notes.iter().any(|note| note.contains("bit-packed")),
                    "{}: {:?}",
                    fixture.name,
                    report.notes
                );
                assert_eq!(report.shape.distinct_values, 2);
            }
        }
        assert!(sub_byte >= 3, "sub-byte flags in the corpus: {sub_byte}");
    }

    #[test]
    fn corpus_replays_render_multi_frame_responses_the_way_the_parser_reads_them() {
        let mut long = 0;
        for shape in [
            "svc21",
            "svc1a",
            "ascii",
            "can29",
            "ext-addr",
            "multiframe",
            "offset-binary",
            "twos-complement",
            "bitfield",
        ] {
            for fixture in corpus(shape) {
                for step in fixture
                    .replay
                    .steps
                    .iter()
                    .filter(|s| !s.command.starts_with("AT"))
                {
                    let lines = parser::clean_response(&step.response);
                    if lines.len() > 1 {
                        long += 1;
                        assert!(
                            lines[0].len() == 3 && lines[1].starts_with("0: "),
                            "{}: {:?}",
                            fixture.name,
                            lines
                        );
                        let declared = usize::from_str_radix(&lines[0], 16).unwrap();
                        let bytes = parser::payload_bytes(&lines, "");
                        assert_eq!(bytes.len(), declared, "{}", fixture.name);
                    }
                }
            }
        }
        assert!(long > 0);
    }
}
