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
        include_str!("../../../tests/fixtures/correlation/drive-d400.json"),
        include_str!("../../../tests/fixtures/correlation/drive-d401.json"),
        include_str!("../../../tests/fixtures/correlation/drive-d402.json"),
        include_str!("../../../tests/fixtures/correlation/drive-d403.json"),
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
        "../../../tests/fixtures/correlation/combined-d400.json"
    )));
    let split = report.array.unwrap().side_split.unwrap();
    assert_eq!(split.outer_in_left_turn, [0xD401, 0xD403]);
    assert!(report.interpretations[0].confidence > 0.6);
}

#[test]
fn binary_events_and_brake_magnitude_remain_ranked_not_named() {
    let switch = analyze(&fixture(include_str!(
        "../../../tests/fixtures/correlation/drive-d406.json"
    )));
    assert_eq!(switch.shape.variability, Variability::EventLike);
    assert!(switch.notes.iter().any(|note| note.contains("A→B→A")));
    assert!(!switch
        .interpretations
        .iter()
        .any(|item| item.label == "brake pedal switch"));
    assert!(correlation(&switch, "braking").r.abs() < 0.5);

    let pressure = analyze(&fixture(include_str!(
        "../../../tests/fixtures/correlation/drive-d40c.json"
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
        "../../../tests/fixtures/correlation/drive-d46d.json"
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
        "../../../tests/fixtures/correlation/drive-d479.json"
    )));
    assert!(drive.correlations.iter().all(|fit| fit.r.abs() < 0.5));
    assert!(!drive
        .interpretations
        .iter()
        .any(|item| item.label == "servo vacuum"));

    let pump = analyze(&fixture(include_str!(
        "../../../tests/fixtures/correlation/vacuum-d479.json"
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
        "../../../tests/fixtures/correlation/steering-static-d40d.json"
    )));
    let fit = correlation(&angle, "steering_angle");
    assert!((fit.slope - 10.0).abs() <= 0.3, "{fit:#?}");
    assert!(fit.bias.abs() <= 5.0, "{fit:#?}");

    let pinion = analyze(&fixture(include_str!(
        "../../../tests/fixtures/correlation/steering-static-d40e.json"
    )));
    let fit = correlation(&pinion, "steering_angle");
    assert!((fit.slope - 10.0).abs() <= 0.3, "{fit:#?}");
    assert!((fit.bias + 181.0).abs() <= 10.0, "{fit:#?}");

    for contents in [
        include_str!("../../../tests/fixtures/correlation/steering-static-d40f.json"),
        include_str!("../../../tests/fixtures/correlation/steering-static-d411.json"),
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
        "../../../tests/fixtures/correlation/steering-turn-d404.json"
    )));
    assert_eq!(slow.shape.variability, Variability::Slow);
}

#[test]
fn camera_constants_are_a_negative_and_request_a_driving_capture() {
    for contents in [
        include_str!("../../../tests/fixtures/correlation/camera-d400-constant.json"),
        include_str!("../../../tests/fixtures/correlation/camera-d401-constant.json"),
        include_str!("../../../tests/fixtures/correlation/camera-d402-constant.json"),
        include_str!("../../../tests/fixtures/correlation/camera-d403-constant.json"),
        include_str!("../../../tests/fixtures/correlation/camera-d404-constant.json"),
        include_str!("../../../tests/fixtures/correlation/camera-d405-constant.json"),
        include_str!("../../../tests/fixtures/correlation/camera-d407-constant.json"),
        include_str!("../../../tests/fixtures/correlation/camera-d408-constant.json"),
        include_str!("../../../tests/fixtures/correlation/camera-d409-constant.json"),
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
        "../../../tests/fixtures/correlation/camera-d40a-constant.json"
    )));
    assert_eq!(anomalous.shape.variability, Variability::EventLike);
    assert!(anomalous.interpretations.is_empty());
    assert_eq!(anomalous.shape.distinct_values, 2);
}

#[test]
fn inherited_fit_can_cross_the_naming_threshold() {
    let mut input = fixture(include_str!(
        "../../../tests/fixtures/correlation/drive-d400.json"
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
        "../../../tests/fixtures/correlation/drive-d400.json"
    ));
    assert_eq!(analyze(&input), analyze(&input));
}

#[test]
fn fixtures_do_not_feed_target_brake_dids_back_as_references() {
    for contents in [
        include_str!("../../../tests/fixtures/correlation/drive-d406.json"),
        include_str!("../../../tests/fixtures/correlation/drive-d40c.json"),
        include_str!("../../../tests/fixtures/correlation/drive-d479.json"),
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
        "../../../tests/fixtures/correlation/drive-d400.json"
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
        "../../../tests/fixtures/correlation/vacuum-d479.json"
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
        "../../../tests/fixtures/correlation/vacuum-d479.json"
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
        "../../../tests/fixtures/correlation/drive-d40c.json"
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
        "../../../tests/fixtures/correlation/drive-d400.json"
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
        "../../../tests/fixtures/correlation/drive-d400.json"
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
        "../../../tests/fixtures/correlation/drive-d400.json"
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
        "../../../tests/fixtures/correlation/drive-d400.json"
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
