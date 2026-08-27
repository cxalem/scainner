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
        "../../../tests/fixtures/correlation/corner-d400.json"
    )));
    let split = report.array.unwrap().side_split.unwrap();
    assert_eq!(split.outer_in_left_turn, [0xD401, 0xD403]);
}

#[test]
fn binary_events_and_brake_magnitude_remain_ranked_not_named() {
    let switch = analyze(&fixture(include_str!(
        "../../../tests/fixtures/correlation/drive-d406.json"
    )));
    assert_eq!(switch.shape.variability, Variability::EventLike);
    assert!(switch.notes.iter().any(|note| note.contains("A→B→A")));
    assert!(switch
        .interpretations
        .iter()
        .any(|item| item.label == "brake pedal switch"));

    let pressure = analyze(&fixture(include_str!(
        "../../../tests/fixtures/correlation/drive-d40c.json"
    )));
    assert!(pressure
        .interpretations
        .iter()
        .any(|item| item.label == "brake pressure"));
    assert!(pressure
        .interpretations
        .iter()
        .any(|item| item.label == "deceleration demand"));
    assert!(pressure
        .interpretations
        .iter()
        .all(|item| item.confidence <= 0.6));
    assert!(pressure
        .discriminating_test
        .as_deref()
        .is_some_and(|test| test.contains("firm-pedal")));

    let reverse = analyze(&fixture(include_str!(
        "../../../tests/fixtures/correlation/drive-d46d.json"
    )));
    assert_eq!(reverse.shape.variability, Variability::EventLike);
    assert!(reverse
        .discriminating_test
        .as_deref()
        .is_some_and(|test| test.contains("reverse")));
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
        include_str!("../../../tests/fixtures/correlation/camera-d40a-constant.json"),
    ] {
        let report = analyze(&fixture(contents));
        assert_eq!(report.shape.variability, Variability::Constant);
        assert!(report.interpretations.is_empty());
        assert!(report
            .discriminating_test
            .as_deref()
            .is_some_and(|test| test.contains("driving")));
    }
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
