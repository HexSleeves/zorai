//! One-worker goal runs with a blocking owner-supervisor review protocol.

use super::*;
use serde::{Deserialize, Serialize};

mod lifecycle;

pub(in crate::agent) const AWAITING_SUPERVISOR_BLOCKED_PREFIX: &str = "awaiting supervisor:";
const GOAL_REVIEW_STATE_PREFIX: &str = "goal_review:";
const GOAL_WORKER_SOURCE: &str = "goal_run";
const LEGACY_ORCHESTRATOR_STOP: &str = "legacy_goal_orchestrator_removed";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::agent) enum GoalSupervisorVerdict {
    Accept,
    SoftReject,
    HardReject,
}

impl GoalSupervisorVerdict {
    pub(in crate::agent) fn as_str(self) -> &'static str {
        match self {
            Self::Accept => "accept",
            Self::SoftReject => "soft_reject",
            Self::HardReject => "hard_reject",
        }
    }
}

pub(in crate::agent) fn parse_goal_supervisor_verdict(
    value: &str,
) -> Result<GoalSupervisorVerdict> {
    match value.trim().to_ascii_lowercase().as_str() {
        "accept" => Ok(GoalSupervisorVerdict::Accept),
        "soft_reject" | "soft-reject" => Ok(GoalSupervisorVerdict::SoftReject),
        "hard_reject" | "hard-reject" => Ok(GoalSupervisorVerdict::HardReject),
        other => anyhow::bail!(
            "unsupported verdict '{other}'; expected accept, soft_reject, or hard_reject"
        ),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(super) struct GoalReviewRecord {
    report: String,
    requested_at: u64,
    state: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    explanation: Option<String>,
}

pub(super) fn review_state_key(goal_run_id: &str) -> String {
    format!("{GOAL_REVIEW_STATE_PREFIX}{goal_run_id}")
}

fn worker_prompt(goal_run: &GoalRun) -> String {
    format!(
        "You are the sole worker for this goal.\n\n\
         Goal: {}\n\n\
         Work until the objective is met. Use tools. Keep a todo list if that helps you, \
         but todos are not a completion gate.\n\n\
         When you believe the work is complete, call `request_goal_review` with a concrete \
         report of what you delivered. Do not claim the goal is complete in prose. \
         The owner supervisor decides Accept, Soft reject, or Hard reject.\n\
         On a soft reject, stay on this thread and improve the work using the supervisor's explanation.",
        goal_run.goal
    )
}

impl AgentEngine {
    pub(in crate::agent) async fn enqueue_goal_worker(&self, goal_run_id: &str) -> Result<()> {
        let snapshot = self
            .get_goal_run(goal_run_id)
            .await
            .context("goal run missing while enqueuing worker")?;
        if snapshot.status.is_terminal() {
            return Ok(());
        }
        if snapshot.active_task_id.is_some() {
            return Ok(());
        }

        let owner_thread_id = snapshot.supervision_thread_id.clone();
        let worker_thread_id = snapshot.thread_id.clone();
        let task = self
            .enqueue_task(
                snapshot.title.clone(),
                worker_prompt(&snapshot),
                task_priority_to_str(snapshot.priority),
                None,
                snapshot.session_id.clone(),
                Vec::new(),
                None,
                GOAL_WORKER_SOURCE,
                Some(snapshot.id.clone()),
                None,
                owner_thread_id.clone(),
                None,
            )
            .await;
        let task = {
            let mut tasks = self.tasks.lock().await;
            let Some(current) = tasks.iter_mut().find(|entry| entry.id == task.id) else {
                anyhow::bail!("goal worker task disappeared after enqueue");
            };
            current.thread_id = worker_thread_id.clone();
            current.goal_run_title = Some(snapshot.title.clone());
            current.clone()
        };
        self.persist_tasks().await;

        let now = now_millis();
        let updated = {
            let mut goal_runs = self.goal_runs.lock().await;
            let Some(goal_run) = goal_runs.iter_mut().find(|item| item.id == goal_run_id) else {
                anyhow::bail!("goal run disappeared after worker enqueue");
            };
            if !goal_run.child_task_ids.iter().any(|id| id == &task.id) {
                goal_run.child_task_ids.push(task.id.clone());
            }
            goal_run.child_task_count = goal_run.child_task_ids.len() as u32;
            goal_run.status = GoalRunStatus::Running;
            goal_run.started_at.get_or_insert(now);
            goal_run.updated_at = now;
            goal_run.active_task_id = Some(task.id.clone());
            goal_run.last_error = None;
            goal_run.failure_cause = None;
            goal_run.events.push(make_goal_run_event(
                "execution",
                "queued sole worker for goal",
                Some(task.id.clone()),
            ));
            goal_run.clone()
        };
        self.persist_goal_runs().await;
        self.pin_goal_owner_thread(&updated).await;
        self.emit_goal_run_update(&updated, Some("Goal worker queued".into()));
        Ok(())
    }

    pub(in crate::agent) async fn request_goal_review(
        &self,
        goal_run_id: &str,
        worker_task_id: &str,
        report: &str,
    ) -> Result<GoalRun> {
        let report = report.trim();
        if report.is_empty() {
            anyhow::bail!("request_goal_review requires a non-empty report");
        }
        let snapshot = self
            .get_goal_run(goal_run_id)
            .await
            .context("goal run missing while requesting review")?;
        if snapshot.status.is_terminal() {
            anyhow::bail!(
                "goal {goal_run_id} is already {}",
                snapshot.status.as_label()
            );
        }
        if snapshot.active_task_id.as_deref() != Some(worker_task_id) {
            anyhow::bail!("request_goal_review can only be called by the active goal worker");
        }
        if matches!(snapshot.status, GoalRunStatus::AwaitingReview) {
            anyhow::bail!("goal {goal_run_id} already has an open supervisor review");
        }

        let now = now_millis();
        let record = GoalReviewRecord {
            report: report.to_string(),
            requested_at: now,
            state: "open".to_string(),
            explanation: None,
        };
        self.history
            .set_consolidation_state(
                &review_state_key(goal_run_id),
                &serde_json::to_string(&record)?,
                now,
            )
            .await?;

        let mut worker = self
            .task_by_id_for_dispatcher(worker_task_id)
            .await
            .ok_or_else(|| anyhow::anyhow!("goal worker task {worker_task_id} not found"))?;
        worker.status = TaskStatus::Blocked;
        worker.blocked_reason = Some(format!("{AWAITING_SUPERVISOR_BLOCKED_PREFIX} {report}"));
        worker.completed_at = None;
        worker.logs.push(make_task_log_entry(
            worker.retry_count,
            TaskLogLevel::Info,
            "goal_review",
            "worker requested supervisor review; blocked until owner verdict",
            Some(report.to_string()),
        ));
        self.upsert_live_task(&worker).await;

        let updated = {
            let mut goal_runs = self.goal_runs.lock().await;
            let Some(goal_run) = goal_runs.iter_mut().find(|item| item.id == goal_run_id) else {
                anyhow::bail!("goal run missing after review request");
            };
            goal_run.status = GoalRunStatus::AwaitingReview;
            goal_run.updated_at = now;
            goal_run.pending_review_report = Some(report.to_string());
            goal_run.events.push(make_goal_run_event(
                "review",
                "worker requested supervisor review",
                Some(report.to_string()),
            ));
            goal_run.clone()
        };
        self.persist_goal_runs().await;
        self.pin_goal_owner_thread(&updated).await;
        self.wake_goal_owner_for_review(&updated, report).await;
        self.emit_goal_run_update(&updated, Some("Goal awaiting supervisor review".into()));
        Ok(updated)
    }

    pub(in crate::agent) async fn submit_goal_review(
        &self,
        goal_run_id: &str,
        verdict: GoalSupervisorVerdict,
        explanation: &str,
        caller_thread_id: Option<&str>,
    ) -> Result<GoalRun> {
        let explanation = explanation.trim();
        if explanation.is_empty() && !matches!(verdict, GoalSupervisorVerdict::Accept) {
            anyhow::bail!("soft_reject and hard_reject require a non-empty explanation");
        }
        let snapshot = self
            .get_goal_run(goal_run_id)
            .await
            .context("goal run missing while submitting review")?;
        if snapshot.status.is_terminal() {
            anyhow::bail!("goal {goal_run_id} is already terminal");
        }
        if snapshot.status != GoalRunStatus::AwaitingReview {
            anyhow::bail!("goal {goal_run_id} is not awaiting supervisor review");
        }
        if let Some(caller_thread_id) = caller_thread_id {
            let owner = snapshot.supervision_thread_id.as_deref();
            if owner != Some(caller_thread_id) {
                anyhow::bail!("submit_goal_review can only be used by the owner supervisor");
            }
        }

        let mut record = self
            .load_goal_review_record(goal_run_id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("goal {goal_run_id} has no open review"))?;
        if record.state != "open" {
            anyhow::bail!("goal {goal_run_id} review was already decided");
        }
        record.state = verdict.as_str().to_string();
        record.explanation = (!explanation.is_empty()).then(|| explanation.to_string());
        self.history
            .set_consolidation_state(
                &review_state_key(goal_run_id),
                &serde_json::to_string(&record)?,
                now_millis(),
            )
            .await?;

        match verdict {
            GoalSupervisorVerdict::Accept => {
                self.complete_goal_from_supervisor(goal_run_id, explanation)
                    .await
            }
            GoalSupervisorVerdict::SoftReject => {
                self.soft_reject_goal_worker(goal_run_id, explanation).await
            }
            GoalSupervisorVerdict::HardReject => {
                self.hard_reject_goal_run(goal_run_id, explanation).await;
                self.get_goal_run(goal_run_id)
                    .await
                    .ok_or_else(|| anyhow::anyhow!("goal {goal_run_id} missing after hard reject"))
            }
        }
    }

    pub(in crate::agent) async fn attach_pending_review_report(&self, goal_run: &mut GoalRun) {
        if goal_run.pending_review_report.is_some() {
            return;
        }
        if !matches!(goal_run.status, GoalRunStatus::AwaitingReview) {
            return;
        }
        let Ok(Some(raw)) = self
            .history
            .get_consolidation_state(&review_state_key(&goal_run.id))
            .await
        else {
            return;
        };
        let Ok(record) = serde_json::from_str::<GoalReviewRecord>(&raw) else {
            return;
        };
        if record.state == "open" {
            goal_run.pending_review_report = Some(record.report);
        }
    }

    pub(in crate::agent) async fn nudge_goal_worker_for_review(
        &self,
        goal_run_id: &str,
        task: &AgentTask,
    ) -> Result<()> {
        let thread_id = match task.thread_id.clone() {
            Some(thread_id) => thread_id,
            None => match self
                .get_goal_run(goal_run_id)
                .await
                .and_then(|goal_run| goal_run.thread_id)
            {
                Some(thread_id) => thread_id,
                None => return Ok(()),
            },
        };
        // If the worker is hibernated (waiting on a background operation or
        // a scheduled wakeup), do NOT nudge or requeue. The thread parked
        // itself deliberately and the runtime will resume it when the
        // awaited event fires; requeueing here re-sends the full goal task
        // prompt mid-hibernation and the worker loops. The task stays
        // terminal until the wakeup resumes the thread; the next turn end
        // without review will re-enter this nudge path then.
        if self.thread_is_hibernated(&thread_id).await {
            tracing::info!(
                goal_run_id,
                thread_id = %thread_id,
                task_id = %task.id,
                "goal worker hibernated on background work; skipping review nudge requeue"
            );
            return Ok(());
        }
        let message = "You finished a turn without calling `request_goal_review`. \
                       The goal is not complete until the owner supervisor reviews your work. \
                       Call `request_goal_review` with a concrete report, or keep working.";
        self.append_system_thread_message(&thread_id, message).await;
        self.requeue_goal_worker_task(task).await;
        Ok(())
    }

    pub(in crate::agent) async fn retire_legacy_goal_orchestrator_run(
        &self,
        goal_run: &GoalRun,
    ) -> bool {
        if goal_run.status.is_terminal() || goal_run.steps.is_empty() {
            return false;
        }
        let _ = self
            .control_goal_run(&goal_run.id, "cancel", None, None)
            .await;
        let mut updated = None;
        {
            let mut goal_runs = self.goal_runs.lock().await;
            if let Some(current) = goal_runs.iter_mut().find(|item| item.id == goal_run.id) {
                current.stopped_reason = Some(LEGACY_ORCHESTRATOR_STOP.to_string());
                current.events.push(make_goal_run_event(
                    "control",
                    "cancelled legacy multi-step goal orchestrator",
                    Some(LEGACY_ORCHESTRATOR_STOP.to_string()),
                ));
                updated = Some(current.clone());
            }
        }
        if let Some(updated) = updated {
            self.persist_goal_runs().await;
            self.unpin_goal_owner_thread(&updated).await;
            self.emit_goal_run_update(&updated, Some("Legacy goal orchestrator cancelled".into()));
        }
        true
    }
}

#[cfg(test)]
#[path = "tests/goal_review.rs"]
mod tests;
