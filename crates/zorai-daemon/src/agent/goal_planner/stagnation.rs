//! Per-goal-run progress supervision — trajectory-level stagnation detection
//! and supervisor intervention when improvement stalls.
//!
//! Design: AVO-inspired (arXiv 2603.24517). Tracks scored pass verdicts via
//! geomean-of-scores comparison and repeated failure fingerprints.
//! When stagnation is detected, enqueues a bounded supervisor task that
//! produces 3 concrete alternative directions.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Persistent per-goal-run progress state (consolidation key `goal_progress:<goal_run_id>`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GoalProgressState {
    /// Best scores seen so far, keyed by metric name.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub best_scores: BTreeMap<String, f64>,
    /// Task that produced the current best scores.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub best_task_id: Option<String>,
    /// Number of scored pass commits since the last new best.
    #[serde(default)]
    pub commits_since_best: u32,
    /// Timestamp (ms) when the last new best was recorded.
    #[serde(default)]
    pub last_new_best_at: u64,
    /// Failure-fingerprint tracking: bucketed reason prefix of the last
    /// consecutive failure run.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_failure_fingerprint: Option<String>,
    /// Number of consecutive failures with the same fingerprint prefix.
    #[serde(default)]
    pub consecutive_failures: u32,
}

impl Default for GoalProgressState {
    fn default() -> Self {
        Self {
            best_scores: BTreeMap::new(),
            best_task_id: None,
            commits_since_best: 0,
            last_new_best_at: 0,
            last_failure_fingerprint: None,
            consecutive_failures: 0,
        }
    }
}

/// Reason stagnation was detected.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StagnationReason {
    /// No improvement in scored pass commits for N consecutive steps.
    CommitsWithoutImprovement(u32),
    /// Same failure fingerprint repeated N times consecutively.
    RepeatedFailureFingerprint(u32),
}

impl std::fmt::Display for StagnationReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::CommitsWithoutImprovement(n) => {
                write!(f, "commits without improvement ({n})")
            }
            Self::RepeatedFailureFingerprint(n) => {
                write!(f, "repeated failure fingerprint ({n})")
            }
        }
    }
}

/// Tunable thresholds for progress supervision.
#[derive(Debug, Clone)]
pub struct ProgressSupervisionThresholds {
    /// Emit `CommitsWithoutImprovement` when scored commits without a new
    /// best reach this count.
    pub commits_without_improvement: u32,
    /// Emit `RepeatedFailureFingerprint` when the same failure reason
    /// prefix repeats this many times consecutively.
    pub max_repeat_failures: u32,
}

impl Default for ProgressSupervisionThresholds {
    fn default() -> Self {
        Self {
            commits_without_improvement: 3,
            max_repeat_failures: 3,
        }
    }
}

// ── public API ──────────────────────────────────────────────────────────

/// Merge a completed goal-step review record into the progress state.
///
/// * Pass verdicts WITH scores: compute geomean, check for new best.
/// * Pass verdicts WITHOUT scores: no-op (regression-safe).
/// * Fail verdicts: track failure fingerprint.
///
/// Returns the updated state and whether the record was a new best.
pub fn merge_verdict(
    state: &GoalProgressState,
    record: &super::super::types::GoalStepReviewRecord,
    now: u64,
) -> (GoalProgressState, bool) {
    match record.verdict {
        super::super::types::GoalStepReviewVerdict::Pass => {
            let scores = record.evidence.as_ref().and_then(|ev| ev.scores.as_ref());
            let Some(scores) = scores else {
                // Scoreless pass — no stagnation tracking.
                return (state.clone(), false);
            };
            let candidate_geomean = geomean(scores);
            let is_new_best = if state.best_scores.is_empty() {
                true
            } else {
                let current_geomean = geomean(&state.best_scores);
                // Strictly better AND covers ≥ the same metric keys.
                candidate_geomean > current_geomean
                    && state.best_scores.keys().all(|k| scores.contains_key(k))
            };

            if is_new_best {
                (
                    GoalProgressState {
                        best_scores: scores.clone(),
                        best_task_id: Some(record.task_id.clone()),
                        commits_since_best: 0,
                        last_new_best_at: now,
                        last_failure_fingerprint: None,
                        consecutive_failures: 0,
                    },
                    true,
                )
            } else {
                (
                    GoalProgressState {
                        commits_since_best: state.commits_since_best.saturating_add(1),
                        ..state.clone()
                    },
                    false,
                )
            }
        }
        super::super::types::GoalStepReviewVerdict::Fail => {
            let fingerprint = failure_fingerprint_prefix(&record.explanation);
            let (consecutive_failures, last_failure_fingerprint) =
                if state.last_failure_fingerprint.as_deref() == Some(&fingerprint) {
                    (
                        state.consecutive_failures.saturating_add(1),
                        Some(fingerprint),
                    )
                } else {
                    (1, Some(fingerprint))
                };
            (
                GoalProgressState {
                    last_failure_fingerprint,
                    consecutive_failures,
                    ..state.clone()
                },
                false,
            )
        }
    }
}

/// Check whether the current progress state triggers a stagnation
/// intervention.
pub fn should_intervene(
    state: &GoalProgressState,
    thresholds: &ProgressSupervisionThresholds,
) -> Option<StagnationReason> {
    if state.commits_since_best >= thresholds.commits_without_improvement {
        return Some(StagnationReason::CommitsWithoutImprovement(
            state.commits_since_best,
        ));
    }
    if state.consecutive_failures >= thresholds.max_repeat_failures {
        return Some(StagnationReason::RepeatedFailureFingerprint(
            state.consecutive_failures,
        ));
    }
    None
}

/// Consolidation-state key for per-goal-run progress state.
pub fn goal_progress_state_key(goal_run_id: &str) -> String {
    format!("goal_progress:{goal_run_id}")
}

/// Consolidation-state key to guard against double-enqueue of supervisor
/// tasks.
pub fn goal_stagnation_pending_key(goal_run_id: &str) -> String {
    format!("goal_stagnation_pending:{goal_run_id}")
}

/// Render a compact lineage digest for the supervisor prompt: current best
/// scores, time since last improvement, non-improving commit count, and the
/// dominant failure fingerprint.
pub fn lineage_digest(
    state: &GoalProgressState,
    snapshot: &super::super::types::GoalRun,
) -> String {
    let mut lines = Vec::new();
    lines.push(format!("Goal run: {} ({})", snapshot.title, snapshot.id));
    lines.push(format!(
        "Steps: {} total, currently at index {}",
        snapshot.steps.len(),
        snapshot.current_step_index
    ));
    if state.best_scores.is_empty() {
        lines.push("Score trajectory: no scored pass verdicts recorded yet.".to_string());
    } else {
        let best = state
            .best_scores
            .iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect::<Vec<_>>()
            .join(", ");
        lines.push(format!("Best scores: {best}"));
        lines.push(format!(
            "Commits since last improvement: {}",
            state.commits_since_best
        ));
        if let Some(task_id) = &state.best_task_id {
            lines.push(format!("Best produced by task: {task_id}"));
        }
    }
    if let Some(fingerprint) = &state.last_failure_fingerprint {
        lines.push(format!(
            "Last failure fingerprint (repeated {}x): {fingerprint}",
            state.consecutive_failures
        ));
    }
    if !snapshot.step_failure_history.is_empty() {
        lines.push("Recent step failure history:".to_string());
        let recent = snapshot
            .step_failure_history
            .iter()
            .rev()
            .take(5)
            .rev()
            .collect::<Vec<_>>();
        for entry in recent {
            lines.push(format!("- {entry}"));
        }
    }
    lines.join("\n")
}

// ── helpers ─────────────────────────────────────────────────────────────

/// Geometric mean of a non-empty score map. Returns 0.0 when the map is
/// empty (caller should guard).
pub(in crate::agent) fn geomean(scores: &BTreeMap<String, f64>) -> f64 {
    if scores.is_empty() {
        return 0.0;
    }
    let product: f64 = scores.values().product();
    if product <= 0.0 {
        return 0.0;
    }
    product.powf(1.0 / scores.len() as f64)
}

/// Derive a stable fingerprint prefix from a failure explanation.
/// Uses the first line (up to 100 Unicode scalar values) to bucket similar failures.
pub(in crate::agent) fn failure_fingerprint_prefix(explanation: &str) -> String {
    explanation
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .chars()
        .take(100)
        .collect()
}
