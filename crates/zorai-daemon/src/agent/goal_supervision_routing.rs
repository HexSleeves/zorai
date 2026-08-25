use super::*;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(in crate::agent) struct GoalSupervisionRoute {
    pub(in crate::agent) goal_run_id: String,
    pub(in crate::agent) thread_id: String,
    pub(in crate::agent) agent_id: String,
}

impl AgentEngine {
    pub(in crate::agent) async fn resolve_goal_supervision_route(
        &self,
        goal_run_id: &str,
    ) -> Result<GoalSupervisionRoute> {
        let mut goal_run = self
            .get_goal_run(goal_run_id)
            .await
            .with_context(|| format!("goal run not found: {goal_run_id}"))?;

        let mut route_was_inferred = false;
        let supervision_thread_id = match goal_run
            .supervision_thread_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            Some(thread_id) => thread_id.to_string(),
            None => {
                let inferred = self
                    .infer_legacy_goal_supervision_thread(&goal_run)
                    .await
                    .with_context(|| {
                        format!("goal {goal_run_id} has no resolvable supervision thread")
                    })?;
                goal_run.supervision_thread_id = Some(inferred.clone());
                route_was_inferred = true;
                inferred
            }
        };

        if !self
            .ensure_thread_messages_loaded(&supervision_thread_id)
            .await
        {
            anyhow::bail!(
                "goal {goal_run_id} supervision thread not found: {supervision_thread_id}"
            );
        }

        let agent_id = self
            .active_agent_id_for_thread(&supervision_thread_id)
            .await
            .with_context(|| {
                format!(
                    "goal {goal_run_id} supervision thread has no active responder: {supervision_thread_id}"
                )
            })?;

        if route_was_inferred {
            {
                let mut goal_runs = self.goal_runs.lock().await;
                if let Some(existing) = goal_runs.iter_mut().find(|item| item.id == goal_run_id) {
                    existing.supervision_thread_id = Some(supervision_thread_id.clone());
                    existing.updated_at = now_millis();
                } else {
                    goal_runs.push_back(goal_run.clone());
                }
            }
            self.persist_goal_runs().await;
        }

        Ok(GoalSupervisionRoute {
            goal_run_id: goal_run_id.to_string(),
            thread_id: supervision_thread_id,
            agent_id,
        })
    }

    async fn infer_legacy_goal_supervision_thread(&self, goal_run: &GoalRun) -> Option<String> {
        if let Some(goal_thread_id) = goal_run.thread_id.as_deref() {
            if self.ensure_thread_messages_loaded(goal_thread_id).await {
                if let Some(upstream_thread_id) = self
                    .threads
                    .read()
                    .await
                    .get(goal_thread_id)
                    .and_then(|thread| thread.upstream_thread_id.clone())
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
                {
                    return Some(upstream_thread_id);
                }
            }
        }

        goal_run
            .root_thread_id
            .as_deref()
            .or(goal_run.thread_id.as_deref())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    }
}
