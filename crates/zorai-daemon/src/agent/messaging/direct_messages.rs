use super::*;
use std::sync::Arc;
use tokio::sync::mpsc;

#[derive(Debug, Clone)]
pub(in crate::agent) struct InternalDmJob {
    sender: String,
    recipient: String,
    content: String,
    preferred_session_hint: Option<String>,
    originator_thread_id: String,
    originator_agent_id: String,
    originator_task_id: Option<String>,
}

pub(in crate::agent) fn spawn_internal_dm_worker(
    engine: Arc<AgentEngine>,
    mut jobs: mpsc::UnboundedReceiver<InternalDmJob>,
) {
    tokio::spawn(async move {
        while let Some(job) = jobs.recv().await {
            engine.dispatch_internal_dm_job(job).await;
        }
    });
}

fn should_resume_originator_after_internal_dm(thread_id: &str) -> bool {
    let thread_id = thread_id.trim();
    !thread_id.is_empty()
        && !is_internal_dm_thread(thread_id)
        && !is_participant_playground_thread(thread_id)
        && !is_internal_handoff_thread(thread_id)
}

fn internal_dm_reply_continuation_prompt(recipient_name: &str, response: &str) -> String {
    format!(
        "Internal DM reply from {recipient_name}. This is asynchronous mailbox delivery, not a new operator request.\n\n{}\n\nIntegrate this reply and continue. Another `message_agent` send is also asynchronous and will not block this turn.",
        response.trim()
    )
}

fn internal_dm_failure_continuation_prompt(recipient_name: &str, error: &anyhow::Error) -> String {
    format!(
        "Internal DM to {recipient_name} failed: {error}. Continue with an appropriate fallback."
    )
}

#[derive(Debug, Clone)]
pub struct SentMessageResult {
    pub thread_id: String,
    pub response: String,
    pub upstream_message: Option<CompletionUpstreamMessage>,
    pub provider_final_result: Option<CompletionProviderFinalResult>,
}

impl AgentEngine {
    pub async fn send_direct_message(
        &self,
        target: &str,
        thread_id: Option<&str>,
        preferred_session_hint: Option<&str>,
        content: &str,
    ) -> Result<SentMessageResult> {
        if is_concierge_target(target)
            || thread_id == Some(crate::agent::concierge::CONCIERGE_THREAD_ID)
        {
            let target_thread_id = thread_id
                .unwrap_or(crate::agent::concierge::CONCIERGE_THREAD_ID)
                .to_string();
            self.send_concierge_message_on_thread(
                &target_thread_id,
                content,
                preferred_session_hint,
                true,
                true,
            )
            .await?;
            return Ok(self
                .latest_assistant_message_result(&target_thread_id)
                .await
                .unwrap_or_else(|| SentMessageResult {
                    thread_id: target_thread_id,
                    response: String::new(),
                    upstream_message: None,
                    provider_final_result: None,
                }));
        }

        let outcome = Box::pin(self.send_message_inner(
            thread_id,
            content,
            None,
            None,
            preferred_session_hint,
            None,
            None,
            None,
            None,
            true,
        ))
        .await?;
        let thread_id = outcome.thread_id.clone();
        let mut result = self
            .latest_assistant_message_result(&thread_id)
            .await
            .unwrap_or_else(|| SentMessageResult {
                thread_id: thread_id.clone(),
                response: String::new(),
                upstream_message: None,
                provider_final_result: None,
            });
        result.thread_id = thread_id;
        if result.upstream_message.is_none() {
            result.upstream_message = outcome.upstream_message.clone();
        }
        if result.provider_final_result.is_none() {
            result.provider_final_result = outcome.provider_final_result.clone();
        }
        Ok(result)
    }

    pub(in crate::agent) async fn send_internal_agent_message(
        &self,
        sender: &str,
        recipient: &str,
        content: &str,
        preferred_session_hint: Option<&str>,
    ) -> Result<SentMessageResult> {
        let wrapped = wrap_internal_message(sender, recipient, content);
        let dm_thread_id = self
            .prepare_internal_dm_thread(sender, recipient, &wrapped)
            .await;
        let outcome = if is_concierge_target(recipient) {
            Box::pin(self.send_concierge_message_on_thread(
                &dm_thread_id,
                &wrapped,
                preferred_session_hint,
                false,
                false,
            ))
            .await?;
            None
        } else {
            Some(
                Box::pin(self.send_message_inner(
                    Some(&dm_thread_id),
                    &wrapped,
                    None,
                    None,
                    preferred_session_hint,
                    None,
                    None,
                    None,
                    None,
                    false,
                ))
                .await?,
            )
        };
        self.ensure_thread_identity(
            &dm_thread_id,
            &internal_dm_thread_title(sender, recipient),
            false,
        )
        .await;
        let mut result = self
            .latest_assistant_message_result(&dm_thread_id)
            .await
            .unwrap_or_else(|| SentMessageResult {
                thread_id: dm_thread_id.clone(),
                response: String::new(),
                upstream_message: None,
                provider_final_result: None,
            });
        if result.upstream_message.is_none() {
            result.upstream_message = outcome
                .as_ref()
                .and_then(|value| value.upstream_message.clone());
        }
        if result.provider_final_result.is_none() {
            result.provider_final_result = outcome
                .as_ref()
                .and_then(|value| value.provider_final_result.clone());
        }
        Ok(result)
    }

    pub(in crate::agent) async fn enqueue_internal_agent_message(
        &self,
        sender: &str,
        recipient: &str,
        content: &str,
        preferred_session_hint: Option<&str>,
        originator_thread_id: &str,
        originator_task_id: Option<&str>,
    ) -> Result<String> {
        let wrapped = wrap_internal_message(sender, recipient, content);
        let dm_thread_id = self
            .prepare_internal_dm_thread(sender, recipient, &wrapped)
            .await;
        self.ensure_thread_identity(
            &dm_thread_id,
            &internal_dm_thread_title(sender, recipient),
            false,
        )
        .await;
        self.internal_dm_jobs_tx
            .send(InternalDmJob {
                sender: sender.to_string(),
                recipient: recipient.to_string(),
                content: content.to_string(),
                preferred_session_hint: preferred_session_hint.map(str::to_string),
                originator_thread_id: originator_thread_id.to_string(),
                originator_agent_id: agent_turn_scope_id(sender),
                originator_task_id: originator_task_id
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string),
            })
            .map_err(|_| anyhow::anyhow!("internal DM worker is not running"))?;
        Ok(dm_thread_id)
    }

    async fn dispatch_internal_dm_job(&self, job: InternalDmJob) {
        let result = Box::pin(self.send_internal_agent_message(
            &job.sender,
            &job.recipient,
            &job.content,
            job.preferred_session_hint.as_deref(),
        ))
        .await;
        self.resume_originator_after_internal_dm(&job, result).await;
    }

    async fn resume_originator_after_internal_dm(
        &self,
        job: &InternalDmJob,
        result: Result<SentMessageResult>,
    ) {
        if !should_resume_originator_after_internal_dm(&job.originator_thread_id) {
            if let Err(error) = result {
                tracing::warn!(
                    sender = %job.sender,
                    recipient = %job.recipient,
                    originator_thread_id = %job.originator_thread_id,
                    %error,
                    "async internal DM failed"
                );
            }
            return;
        }
        let recipient_name = canonical_agent_name(&job.recipient);
        let llm_user_content = match result {
            Ok(sent) => internal_dm_reply_continuation_prompt(&recipient_name, &sent.response),
            Err(error) => {
                tracing::warn!(
                    sender = %job.sender,
                    recipient = %job.recipient,
                    originator_thread_id = %job.originator_thread_id,
                    %error,
                    "async internal DM failed"
                );
                internal_dm_failure_continuation_prompt(&recipient_name, &error)
            }
        };
        self.enqueue_visible_thread_continuation(
            &job.originator_thread_id,
            DeferredVisibleThreadContinuation {
                agent_id: job.originator_agent_id.clone(),
                task_id: job.originator_task_id.clone(),
                preferred_session_hint: job.preferred_session_hint.clone(),
                llm_user_content,
                queued_at_ms: 0,
                force_compaction: false,
                rerun_participant_observers_after_turn: true,
                internal_delegate_sender: None,
                internal_delegate_message: None,
            },
        )
        .await;
        if let Err(error) = self
            .flush_deferred_visible_thread_continuations(&job.originator_thread_id)
            .await
        {
            tracing::warn!(
                originator_thread_id = %job.originator_thread_id,
                %error,
                "failed to flush originator continuation after async internal DM"
            );
        }
    }

    pub(in crate::agent) async fn latest_assistant_message_text(
        &self,
        thread_id: &str,
    ) -> Option<String> {
        self.latest_assistant_message_result(thread_id)
            .await
            .map(|message| message.response)
    }

    async fn latest_assistant_message_result(&self, thread_id: &str) -> Option<SentMessageResult> {
        let message = match self.history.latest_assistant_message(thread_id).await {
            Ok(message) => message,
            Err(error) => {
                tracing::warn!(
                    thread_id = %thread_id,
                    "failed to load latest assistant message from history: {error}"
                );
                None
            }
        }?;
        super::agent_message_from_db(message).map(|message| SentMessageResult {
            thread_id: thread_id.to_string(),
            response: message.content,
            upstream_message: message.upstream_message,
            provider_final_result: message.provider_final_result,
        })
    }
}
