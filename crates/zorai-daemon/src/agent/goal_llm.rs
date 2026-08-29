//! Structured LLM helpers used by orchestrator policy.

use super::*;

#[path = "goal_llm_transport.rs"]
mod transport;

use transport::orchestrator_policy_json_schema;

impl AgentEngine {
    pub(super) async fn request_orchestrator_policy_decision(
        &self,
        prompt: &str,
    ) -> Result<Option<super::orchestrator_policy::PolicyDecision>> {
        let raw = self
            .run_goal_llm_json_with_schema(
                prompt,
                orchestrator_policy_json_schema(),
                "orchestrator policy LLM call",
                None,
            )
            .await?;

        Ok(parse_json_block::<super::orchestrator_policy::PolicyDecision>(&raw).ok())
    }
}
