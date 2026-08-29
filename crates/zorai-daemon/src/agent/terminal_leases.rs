//! Auto-reclaim of terminals allocated for agents and subagents.
//!
//! Agent-owned lanes are cloned for parallel/isolated work and attached in the
//! GUI. Without a lease they live for the whole daemon process. This registry
//! closes them when the owning task finishes, the owning thread is deleted, or
//! the lane sits idle with no active command.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use tokio::time::MissedTickBehavior;
use zorai_protocol::SessionId;

use super::internal_event::InternalAgentEvent;
use super::task_prompt::now_millis;
use super::types::AgentEvent;
use super::AgentEngine;

pub(crate) const CLOSE_AGENT_TERMINAL_COMMAND: &str = "close_agent_terminal";
pub(crate) const AGENT_TERMINAL_IDLE_TIMEOUT_MS: u64 = 10 * 60 * 1000;
const AGENT_TERMINAL_SWEEP_INTERVAL: Duration = Duration::from_secs(15);

#[derive(Debug, Clone)]
pub(crate) struct AgentTerminalLease {
    pub session_id: SessionId,
    pub workspace_id: Option<String>,
    pub owner_task_id: Option<String>,
    pub owner_thread_id: Option<String>,
    pub last_idle_at: u64,
    pub busy_since: Option<u64>,
}

impl AgentTerminalLease {
    pub(crate) fn new(
        session_id: SessionId,
        workspace_id: Option<String>,
        owner_task_id: Option<String>,
        owner_thread_id: Option<String>,
        now_ms: u64,
    ) -> Self {
        Self {
            session_id,
            workspace_id,
            owner_task_id: owner_task_id.filter(|value| !value.is_empty()),
            owner_thread_id: owner_thread_id.filter(|value| !value.is_empty()),
            last_idle_at: now_ms,
            busy_since: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AgentTerminalCloseReason {
    OwnerTaskFinished,
    Idle,
    SessionGone,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct AgentTerminalSweepView {
    pub now_ms: u64,
    pub idle_timeout_ms: u64,
    pub owner_task_is_terminal: bool,
    pub session_alive: bool,
    pub has_active_command: bool,
}

pub(crate) fn close_reason_for_lease(
    lease: &AgentTerminalLease,
    view: &AgentTerminalSweepView,
) -> Option<AgentTerminalCloseReason> {
    if !view.session_alive {
        return Some(AgentTerminalCloseReason::SessionGone);
    }
    if view.owner_task_is_terminal {
        return Some(AgentTerminalCloseReason::OwnerTaskFinished);
    }
    if view.has_active_command {
        return None;
    }
    if view.now_ms.saturating_sub(lease.last_idle_at) >= view.idle_timeout_ms {
        return Some(AgentTerminalCloseReason::Idle);
    }
    None
}

fn reason_label(reason: AgentTerminalCloseReason) -> &'static str {
    match reason {
        AgentTerminalCloseReason::OwnerTaskFinished => "owner_finished",
        AgentTerminalCloseReason::Idle => "idle",
        AgentTerminalCloseReason::SessionGone => "session_gone",
    }
}

impl AgentEngine {
    pub(super) fn spawn_agent_terminal_lease_worker(engine: Arc<Self>) {
        tokio::spawn(async move {
            let mut events = engine.internal_event_tx.subscribe();
            let mut interval = tokio::time::interval(AGENT_TERMINAL_SWEEP_INTERVAL);
            interval.set_missed_tick_behavior(MissedTickBehavior::Delay);
            interval.tick().await;
            loop {
                tokio::select! {
                    event = events.recv() => {
                        match event {
                            Ok(InternalAgentEvent::TaskTerminal { task_id, .. }) => {
                                engine.release_agent_terminals_for_task(&task_id).await;
                            }
                            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                        }
                    }
                    _ = interval.tick() => {
                        engine.sweep_agent_terminal_leases().await;
                    }
                }
            }
        });
    }

    pub(crate) async fn register_agent_terminal_lease(&self, lease: AgentTerminalLease) {
        let session_id = lease.session_id;
        self.agent_terminal_leases
            .lock()
            .await
            .insert(session_id, lease);
        tracing::info!(%session_id, "registered agent-owned terminal lease");
    }

    pub(crate) async fn release_agent_terminals_for_task(&self, task_id: &str) {
        let session_ids = {
            let leases = self.agent_terminal_leases.lock().await;
            leases
                .values()
                .filter(|lease| lease.owner_task_id.as_deref() == Some(task_id))
                .map(|lease| lease.session_id)
                .collect::<Vec<_>>()
        };
        self.release_agent_terminal_sessions(
            &session_ids,
            AgentTerminalCloseReason::OwnerTaskFinished,
        )
        .await;
    }

    pub(crate) async fn release_agent_terminals_for_thread(&self, thread_id: &str) {
        let session_ids = {
            let leases = self.agent_terminal_leases.lock().await;
            leases
                .values()
                .filter(|lease| lease.owner_thread_id.as_deref() == Some(thread_id))
                .map(|lease| lease.session_id)
                .collect::<Vec<_>>()
        };
        self.release_agent_terminal_sessions(
            &session_ids,
            AgentTerminalCloseReason::OwnerTaskFinished,
        )
        .await;
    }

    pub(crate) async fn sweep_agent_terminal_leases(&self) {
        let now_ms = now_millis();
        let snapshots = self.session_manager.list().await;
        let sessions: HashMap<SessionId, bool> = snapshots
            .iter()
            .map(|session| (session.id, session.active_command.is_some()))
            .collect();

        let task_terminal_by_id = {
            let tasks = self.tasks.lock().await;
            tasks
                .iter()
                .map(|task| (task.id.clone(), task.status.is_terminal()))
                .collect::<HashMap<_, _>>()
        };

        let mut due = Vec::new();
        {
            let mut leases = self.agent_terminal_leases.lock().await;
            for lease in leases.values_mut() {
                let session_busy = sessions.get(&lease.session_id).copied();
                let session_alive = session_busy.is_some();
                let has_active_command = session_busy.unwrap_or(false);
                if has_active_command {
                    if lease.busy_since.is_none() {
                        lease.busy_since = Some(now_ms);
                    }
                } else if lease.busy_since.take().is_some() {
                    lease.last_idle_at = now_ms;
                }

                let owner_task_is_terminal = match lease.owner_task_id.as_deref() {
                    Some(task_id) => task_terminal_by_id.get(task_id).copied().unwrap_or(true),
                    None => false,
                };
                let view = AgentTerminalSweepView {
                    now_ms,
                    idle_timeout_ms: AGENT_TERMINAL_IDLE_TIMEOUT_MS,
                    owner_task_is_terminal,
                    session_alive,
                    has_active_command,
                };
                if let Some(reason) = close_reason_for_lease(lease, &view) {
                    due.push((lease.session_id, reason));
                }
            }
        }

        for (session_id, reason) in due {
            self.release_agent_terminal_sessions(&[session_id], reason)
                .await;
        }
    }

    async fn release_agent_terminal_sessions(
        &self,
        session_ids: &[SessionId],
        reason: AgentTerminalCloseReason,
    ) {
        for session_id in session_ids {
            let lease = self.agent_terminal_leases.lock().await.remove(session_id);
            let workspace_id = lease.and_then(|lease| lease.workspace_id);
            if let Err(error) = self.session_manager.kill(*session_id).await {
                tracing::debug!(
                    %session_id,
                    %error,
                    "agent terminal kill skipped or failed during reclaim"
                );
            }
            let _ = self.event_tx.send(AgentEvent::WorkspaceCommand {
                command: CLOSE_AGENT_TERMINAL_COMMAND.to_string(),
                args: serde_json::json!({
                    "session_id": session_id.to_string(),
                    "workspace_id": workspace_id,
                    "reason": reason_label(reason),
                }),
            });
            tracing::info!(
                %session_id,
                reason = reason_label(reason),
                "reclaimed agent-owned terminal"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::types::{AgentConfig, TaskStatus};
    use super::*;
    use crate::session_manager::SessionManager;
    use tempfile::tempdir;
    use tokio::time::{timeout, Duration};

    fn lease_at(last_idle_at: u64) -> AgentTerminalLease {
        AgentTerminalLease {
            session_id: SessionId::nil(),
            workspace_id: Some("ws".to_string()),
            owner_task_id: Some("task-1".to_string()),
            owner_thread_id: Some("thread-1".to_string()),
            last_idle_at,
            busy_since: None,
        }
    }

    fn view(
        now_ms: u64,
        owner_task_is_terminal: bool,
        session_alive: bool,
        has_active_command: bool,
    ) -> AgentTerminalSweepView {
        AgentTerminalSweepView {
            now_ms,
            idle_timeout_ms: AGENT_TERMINAL_IDLE_TIMEOUT_MS,
            owner_task_is_terminal,
            session_alive,
            has_active_command,
        }
    }

    #[test]
    fn finished_owner_closes_even_when_command_is_still_running() {
        let lease = lease_at(1);
        assert_eq!(
            close_reason_for_lease(&lease, &view(2, true, true, true)),
            Some(AgentTerminalCloseReason::OwnerTaskFinished)
        );
    }

    #[test]
    fn in_progress_owner_keeps_a_busy_terminal() {
        let lease = lease_at(1);
        assert_eq!(
            close_reason_for_lease(
                &lease,
                &view(AGENT_TERMINAL_IDLE_TIMEOUT_MS * 4, false, true, true)
            ),
            None
        );
    }

    #[test]
    fn unused_lane_closes_after_idle_timeout() {
        let lease = lease_at(1);
        assert_eq!(
            close_reason_for_lease(
                &lease,
                &view(1 + AGENT_TERMINAL_IDLE_TIMEOUT_MS, false, true, false)
            ),
            Some(AgentTerminalCloseReason::Idle)
        );
    }

    #[test]
    fn unused_lane_stays_before_idle_timeout() {
        let lease = lease_at(1);
        assert_eq!(
            close_reason_for_lease(
                &lease,
                &view(1 + AGENT_TERMINAL_IDLE_TIMEOUT_MS - 1, false, true, false)
            ),
            None
        );
    }

    #[test]
    fn dead_session_is_reclaimed() {
        let lease = lease_at(1);
        assert_eq!(
            close_reason_for_lease(&lease, &view(2, false, false, false)),
            Some(AgentTerminalCloseReason::SessionGone)
        );
    }

    #[test]
    fn close_reason_does_not_depend_on_task_status_enum_layout() {
        assert!(TaskStatus::Completed.is_terminal());
        assert!(TaskStatus::Failed.is_terminal());
        assert!(TaskStatus::Cancelled.is_terminal());
        assert!(!TaskStatus::InProgress.is_terminal());
    }

    async fn wait_for_close_command(
        events: &mut tokio::sync::broadcast::Receiver<AgentEvent>,
        session_id: SessionId,
    ) -> serde_json::Value {
        timeout(Duration::from_secs(2), async {
            loop {
                match events.recv().await.expect("close event") {
                    AgentEvent::WorkspaceCommand { command, args }
                        if command == CLOSE_AGENT_TERMINAL_COMMAND
                            && args.get("session_id").and_then(|value| value.as_str())
                                == Some(&session_id.to_string()) =>
                    {
                        return args;
                    }
                    _ => {}
                }
            }
        })
        .await
        .expect("timed out waiting for close_agent_terminal")
    }

    #[tokio::test]
    async fn releasing_owner_task_emits_close_and_drops_the_lease() {
        let root = tempdir().expect("tempdir");
        let manager = SessionManager::new_test(root.path()).await;
        let engine =
            super::super::AgentEngine::new_test(manager, AgentConfig::default(), root.path()).await;
        let session_id = SessionId::from_u128(42);
        let mut events = engine.subscribe();
        engine
            .register_agent_terminal_lease(AgentTerminalLease::new(
                session_id,
                Some("ws-agent".to_string()),
                Some("task-owner".to_string()),
                Some("thread-owner".to_string()),
                10,
            ))
            .await;
        engine.release_agent_terminals_for_task("task-owner").await;
        let args = wait_for_close_command(&mut events, session_id).await;
        assert_eq!(
            args.get("reason").and_then(|value| value.as_str()),
            Some("owner_finished")
        );
        assert!(engine.agent_terminal_leases.lock().await.is_empty());
    }

    #[tokio::test]
    async fn sweep_reclaims_leases_whose_session_is_already_gone() {
        let root = tempdir().expect("tempdir");
        let manager = SessionManager::new_test(root.path()).await;
        let engine =
            super::super::AgentEngine::new_test(manager, AgentConfig::default(), root.path()).await;
        let session_id = SessionId::from_u128(43);
        let mut events = engine.subscribe();
        engine
            .register_agent_terminal_lease(AgentTerminalLease::new(
                session_id,
                Some("ws-agent".to_string()),
                None,
                Some("thread-chat".to_string()),
                10,
            ))
            .await;
        engine.sweep_agent_terminal_leases().await;
        let args = wait_for_close_command(&mut events, session_id).await;
        assert_eq!(
            args.get("reason").and_then(|value| value.as_str()),
            Some("session_gone")
        );
        assert!(engine.agent_terminal_leases.lock().await.is_empty());
    }
}
