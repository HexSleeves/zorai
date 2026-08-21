use crate::agent::goal_planner::stagnation::*;
use crate::agent::types::{GoalStepReviewRecord, GoalStepReviewVerdict, GoalVerdictEvidence};
use std::collections::BTreeMap;

fn now() -> u64 {
    1_700_000_000_000
}

fn review_record(
    task_id: &str,
    goal_run_id: &str,
    goal_step_id: &str,
    verdict: GoalStepReviewVerdict,
    explanation: &str,
    scores: Option<BTreeMap<String, f64>>,
) -> GoalStepReviewRecord {
    let evidence = if scores.is_some() {
        Some(GoalVerdictEvidence {
            verifier: "test".into(),
            coverage: "test".into(),
            gaps: None,
            scores,
            is_new_best: None,
        })
    } else {
        None
    };
    GoalStepReviewRecord {
        task_id: task_id.into(),
        goal_run_id: goal_run_id.into(),
        goal_step_id: goal_step_id.into(),
        verdict,
        explanation: explanation.into(),
        evidence,
        submitted_at: now(),
    }
}

#[test]
fn geomean_of_single_metric_returns_the_value() {
    let mut scores = BTreeMap::new();
    scores.insert("accuracy".into(), 0.95);
    let g = geomean(&scores);
    assert!((g - 0.95).abs() < 1e-9);
}

#[test]
fn geomean_of_multiple_metrics_returns_root() {
    let mut scores = BTreeMap::new();
    scores.insert("a".into(), 4.0);
    scores.insert("b".into(), 9.0);
    let g = geomean(&scores);
    assert!((g - 6.0).abs() < 1e-9); // sqrt(4*9) = 6
}

#[test]
fn geomean_with_zero_returns_zero() {
    let mut scores = BTreeMap::new();
    scores.insert("a".into(), 0.0);
    scores.insert("b".into(), 10.0);
    assert_eq!(geomean(&scores), 0.0);
}

#[test]
fn geomean_empty_returns_zero() {
    assert_eq!(geomean(&BTreeMap::new()), 0.0);
}

#[test]
fn first_scored_pass_sets_new_best() {
    let state = GoalProgressState::default();
    let mut scores = BTreeMap::new();
    scores.insert("accuracy".into(), 0.9);
    let record = review_record(
        "t1",
        "g1",
        "s1",
        GoalStepReviewVerdict::Pass,
        "all good",
        Some(scores),
    );
    let (new_state, is_new_best) = merge_verdict(&state, &record, now());
    assert!(is_new_best);
    assert_eq!(new_state.commits_since_best, 0);
    assert_eq!(new_state.best_scores.get("accuracy"), Some(&0.9));
    assert_eq!(new_state.best_task_id.as_deref(), Some("t1"));
}

#[test]
fn higher_geomean_is_new_best() {
    let mut best = BTreeMap::new();
    best.insert("accuracy".into(), 0.9);
    let state = GoalProgressState {
        best_scores: best,
        best_task_id: Some("t1".into()),
        ..Default::default()
    };

    let mut scores = BTreeMap::new();
    scores.insert("accuracy".into(), 0.95);
    let record = review_record(
        "t2",
        "g1",
        "s2",
        GoalStepReviewVerdict::Pass,
        "better",
        Some(scores),
    );
    let (new_state, is_new_best) = merge_verdict(&state, &record, now());
    assert!(is_new_best);
    assert_eq!(new_state.commits_since_best, 0);
    assert_eq!(new_state.best_scores.get("accuracy"), Some(&0.95));
}

#[test]
fn lower_geomean_is_not_new_best() {
    let mut best = BTreeMap::new();
    best.insert("accuracy".into(), 0.9);
    let state = GoalProgressState {
        best_scores: best,
        best_task_id: Some("t1".into()),
        ..Default::default()
    };

    let mut scores = BTreeMap::new();
    scores.insert("accuracy".into(), 0.85);
    let record = review_record(
        "t2",
        "g1",
        "s2",
        GoalStepReviewVerdict::Pass,
        "worse",
        Some(scores),
    );
    let (new_state, is_new_best) = merge_verdict(&state, &record, now());
    assert!(!is_new_best);
    assert_eq!(new_state.commits_since_best, 1);
    // Best scores unchanged.
    assert_eq!(new_state.best_scores.get("accuracy"), Some(&0.9));
}

#[test]
fn equal_geomean_is_not_new_best() {
    let mut best = BTreeMap::new();
    best.insert("accuracy".into(), 0.9);
    let state = GoalProgressState {
        best_scores: best,
        best_task_id: Some("t1".into()),
        ..Default::default()
    };

    let mut scores = BTreeMap::new();
    scores.insert("accuracy".into(), 0.9);
    let record = review_record(
        "t2",
        "g1",
        "s2",
        GoalStepReviewVerdict::Pass,
        "same",
        Some(scores),
    );
    let (new_state, is_new_best) = merge_verdict(&state, &record, now());
    assert!(!is_new_best);
    assert_eq!(new_state.commits_since_best, 1);
}

#[test]
fn partial_metric_coverage_blocks_new_best() {
    // Current best has accuracy + latency; candidate only has accuracy.
    let mut best = BTreeMap::new();
    best.insert("accuracy".into(), 0.9);
    best.insert("latency_ms".into(), 100.0);
    let state = GoalProgressState {
        best_scores: best,
        best_task_id: Some("t1".into()),
        ..Default::default()
    };

    let mut scores = BTreeMap::new();
    scores.insert("accuracy".into(), 0.99);
    let record = review_record(
        "t2",
        "g1",
        "s2",
        GoalStepReviewVerdict::Pass,
        "better accuracy only",
        Some(scores),
    );
    let (new_state, is_new_best) = merge_verdict(&state, &record, now());
    assert!(!is_new_best);
    assert_eq!(new_state.commits_since_best, 1);
}

#[test]
fn metric_key_mismatch_is_not_new_best() {
    // Current best has accuracy; candidate has latency (different key).
    let mut best = BTreeMap::new();
    best.insert("accuracy".into(), 0.9);
    let state = GoalProgressState {
        best_scores: best,
        best_task_id: Some("t1".into()),
        ..Default::default()
    };

    let mut scores = BTreeMap::new();
    scores.insert("latency_ms".into(), 50.0);
    let record = review_record(
        "t2",
        "g1",
        "s2",
        GoalStepReviewVerdict::Pass,
        "different metric",
        Some(scores),
    );
    let (new_state, is_new_best) = merge_verdict(&state, &record, now());
    assert!(!is_new_best);
    assert_eq!(new_state.commits_since_best, 1);
}

#[test]
fn superset_metric_coverage_allows_new_best() {
    // Current best has accuracy; candidate has accuracy + latency.
    let mut best = BTreeMap::new();
    best.insert("accuracy".into(), 0.9);
    let state = GoalProgressState {
        best_scores: best,
        best_task_id: Some("t1".into()),
        ..Default::default()
    };

    let mut scores = BTreeMap::new();
    scores.insert("accuracy".into(), 0.95);
    scores.insert("latency_ms".into(), 50.0);
    let record = review_record(
        "t2",
        "g1",
        "s2",
        GoalStepReviewVerdict::Pass,
        "more metrics",
        Some(scores),
    );
    let (new_state, is_new_best) = merge_verdict(&state, &record, now());
    assert!(is_new_best);
    assert_eq!(new_state.commits_since_best, 0);
}

#[test]
fn scoreless_pass_verdict_is_noop() {
    let mut best = BTreeMap::new();
    best.insert("accuracy".into(), 0.9);
    let state = GoalProgressState {
        best_scores: best.clone(),
        best_task_id: Some("t1".into()),
        commits_since_best: 2,
        ..Default::default()
    };

    let record = review_record(
        "t2",
        "g1",
        "s2",
        GoalStepReviewVerdict::Pass,
        "no scores",
        None,
    );
    let (new_state, is_new_best) = merge_verdict(&state, &record, now());
    assert!(!is_new_best);
    assert_eq!(new_state.commits_since_best, 2); // unchanged
    assert_eq!(new_state.best_scores, best);
}

#[test]
fn new_best_resets_stagnation_counters() {
    let state = GoalProgressState {
        best_scores: BTreeMap::from([("a".into(), 0.5)]),
        best_task_id: Some("t1".into()),
        commits_since_best: 5,
        last_failure_fingerprint: Some("bad".into()),
        consecutive_failures: 3,
        ..Default::default()
    };

    let mut scores = BTreeMap::new();
    scores.insert("a".into(), 0.9);
    let record = review_record(
        "t2",
        "g1",
        "s2",
        GoalStepReviewVerdict::Pass,
        "new best",
        Some(scores),
    );
    let (new_state, _) = merge_verdict(&state, &record, now());
    assert_eq!(new_state.commits_since_best, 0);
    assert_eq!(new_state.consecutive_failures, 0);
    assert!(new_state.last_failure_fingerprint.is_none());
}

#[test]
fn fail_verdict_tracks_fingerprint() {
    let state = GoalProgressState::default();
    let record = review_record(
        "t1",
        "g1",
        "s1",
        GoalStepReviewVerdict::Fail,
        "missing type annotation on line 42",
        None,
    );
    let (new_state, _) = merge_verdict(&state, &record, now());
    assert_eq!(new_state.consecutive_failures, 1);
    assert_eq!(
        new_state.last_failure_fingerprint.as_deref(),
        Some("missing type annotation on line 42")
    );
}

#[test]
fn same_failure_fingerprint_increments_consecutive() {
    let state = GoalProgressState {
        last_failure_fingerprint: Some("missing type annotation on line 42".into()),
        consecutive_failures: 2,
        ..Default::default()
    };
    let record = review_record(
        "t2",
        "g1",
        "s2",
        GoalStepReviewVerdict::Fail,
        "missing type annotation on line 42\nmore details here",
        None,
    );
    let (new_state, _) = merge_verdict(&state, &record, now());
    assert_eq!(new_state.consecutive_failures, 3);
}

#[test]
fn different_failure_fingerprint_resets_consecutive() {
    let state = GoalProgressState {
        last_failure_fingerprint: Some("missing type annotation".into()),
        consecutive_failures: 2,
        ..Default::default()
    };
    let record = review_record(
        "t2",
        "g1",
        "s2",
        GoalStepReviewVerdict::Fail,
        "different error entirely",
        None,
    );
    let (new_state, _) = merge_verdict(&state, &record, now());
    assert_eq!(new_state.consecutive_failures, 1);
    assert_eq!(
        new_state.last_failure_fingerprint.as_deref(),
        Some("different error entirely")
    );
}

#[test]
fn failure_fingerprint_truncates_at_100_chars() {
    let long = "a".repeat(200);
    let fingerprint = failure_fingerprint_prefix(&long);
    assert_eq!(fingerprint.len(), 100);
}

#[test]
fn failure_fingerprint_truncates_on_a_utf8_char_boundary() {
    let long = format!("{}{}", "a".repeat(99), "é".repeat(20));
    assert!(
        !long.is_char_boundary(100),
        "byte 100 sits inside é; slicing there would panic"
    );
    let fingerprint = failure_fingerprint_prefix(&long);
    assert_eq!(fingerprint.chars().count(), 100);
    assert!(fingerprint.ends_with('é'));
}

#[test]
fn should_intervene_on_commits_without_improvement() {
    let state = GoalProgressState {
        commits_since_best: 3,
        ..Default::default()
    };
    let thresholds = ProgressSupervisionThresholds::default();
    assert_eq!(
        should_intervene(&state, &thresholds),
        Some(StagnationReason::CommitsWithoutImprovement(3))
    );
}

#[test]
fn should_intervene_on_repeated_failure() {
    let state = GoalProgressState {
        consecutive_failures: 3,
        last_failure_fingerprint: Some("err".into()),
        ..Default::default()
    };
    let thresholds = ProgressSupervisionThresholds::default();
    assert_eq!(
        should_intervene(&state, &thresholds),
        Some(StagnationReason::RepeatedFailureFingerprint(3))
    );
}

#[test]
fn should_not_intervene_below_thresholds() {
    let state = GoalProgressState {
        commits_since_best: 2,
        consecutive_failures: 2,
        ..Default::default()
    };
    let thresholds = ProgressSupervisionThresholds::default();
    assert_eq!(should_intervene(&state, &thresholds), None);
}

#[test]
fn commits_without_improvement_takes_priority_over_failures() {
    let state = GoalProgressState {
        commits_since_best: 3,
        consecutive_failures: 3,
        last_failure_fingerprint: Some("err".into()),
        ..Default::default()
    };
    let thresholds = ProgressSupervisionThresholds::default();
    assert_eq!(
        should_intervene(&state, &thresholds),
        Some(StagnationReason::CommitsWithoutImprovement(3))
    );
}

#[test]
fn default_thresholds_are_three() {
    let t = ProgressSupervisionThresholds::default();
    assert_eq!(t.commits_without_improvement, 3);
    assert_eq!(t.max_repeat_failures, 3);
}

#[test]
fn goal_progress_state_key_format() {
    assert_eq!(goal_progress_state_key("gr-123"), "goal_progress:gr-123");
}

#[test]
fn goal_stagnation_pending_key_format() {
    assert_eq!(
        goal_stagnation_pending_key("gr-123"),
        "goal_stagnation_pending:gr-123"
    );
}
