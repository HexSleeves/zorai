use super::*;
use anyhow::Result;
use std::sync::Arc;
use tokio::sync::mpsc;
use zorai_protocol::QueuedPromptRecord;

pub(crate) fn spawn_prompt_queue_startup_flush(engine: Arc<AgentEngine>) {
    tokio::spawn(async move {
        match engine.history.list_queued_prompts(None).await {
            Ok(prompts) => {
                let mut seen = std::collections::HashSet::new();
                for prompt in prompts {
                    if seen.insert(prompt.thread_id.clone()) {
                        engine.wake_prompt_queue(&prompt.thread_id);
                    }
                }
            }
            Err(error) => {
                tracing::warn!(%error, "failed to restore prompt queue on startup");
            }
        }
    });
}

pub(crate) fn spawn_prompt_queue_worker(
    engine: Arc<AgentEngine>,
    mut wake_rx: mpsc::UnboundedReceiver<String>,
) {
    tokio::spawn(async move {
        while let Some(thread_id) = wake_rx.recv().await {
            if let Err(error) = engine.dispatch_next_queued_prompt(&thread_id).await {
                tracing::warn!(
                    thread_id = %thread_id,
                    %error,
                    "failed to dispatch queued prompt"
                );
            }
        }
    });
}

impl AgentEngine {
    pub(crate) fn wake_prompt_queue(&self, thread_id: &str) {
        let _ = self.prompt_queue_wake_tx.send(thread_id.to_string());
    }

    pub(crate) async fn is_thread_streaming(&self, thread_id: &str) -> bool {
        self.stream_cancellations
            .lock()
            .await
            .contains_key(thread_id)
    }

    async fn broadcast_prompt_queue(&self, thread_id: &str) -> Result<Vec<QueuedPromptRecord>> {
        let prompts = self.history.list_queued_prompts(Some(thread_id)).await?;
        let _ = self.event_tx.send(AgentEvent::PromptQueueUpdate {
            thread_id: thread_id.to_string(),
            prompts: prompts.clone(),
        });
        Ok(prompts)
    }

    pub(crate) async fn enqueue_prompt(
        &self,
        thread_id: &str,
        content: &str,
        content_blocks_json: Option<&str>,
        prompt_id: Option<&str>,
    ) -> Result<Vec<QueuedPromptRecord>> {
        if thread_id.trim().is_empty() {
            anyhow::bail!("thread_id is required to enqueue a prompt");
        }
        if content.trim().is_empty() && content_blocks_json.is_none() {
            anyhow::bail!("queued prompt content is empty");
        }
        self.history
            .enqueue_prompt(thread_id, content, content_blocks_json, prompt_id)
            .await?;
        let prompts = self.broadcast_prompt_queue(thread_id).await?;
        self.wake_prompt_queue(thread_id);
        Ok(prompts)
    }

    pub(crate) async fn list_prompt_queue(
        &self,
        thread_id: Option<&str>,
    ) -> Result<Vec<QueuedPromptRecord>> {
        self.history.list_queued_prompts(thread_id).await
    }

    pub(crate) async fn update_queued_prompt(
        &self,
        thread_id: &str,
        prompt_id: &str,
        content: &str,
        content_blocks_json: Option<&str>,
    ) -> Result<Vec<QueuedPromptRecord>> {
        if !self
            .history
            .update_queued_prompt(thread_id, prompt_id, content, content_blocks_json)
            .await?
        {
            anyhow::bail!("queued prompt {prompt_id} was not found");
        }
        self.broadcast_prompt_queue(thread_id).await
    }

    pub(crate) async fn cancel_queued_prompt(
        &self,
        thread_id: &str,
        prompt_id: &str,
    ) -> Result<Vec<QueuedPromptRecord>> {
        if self
            .history
            .delete_queued_prompt(thread_id, prompt_id)
            .await?
            .is_none()
        {
            anyhow::bail!("queued prompt {prompt_id} was not found");
        }
        self.broadcast_prompt_queue(thread_id).await
    }

    pub(crate) async fn send_queued_prompt_now(
        self: &Arc<Self>,
        thread_id: &str,
        prompt_id: &str,
    ) -> Result<Vec<QueuedPromptRecord>> {
        let Some(prompt) = self
            .history
            .delete_queued_prompt(thread_id, prompt_id)
            .await?
        else {
            anyhow::bail!("queued prompt {prompt_id} was not found");
        };
        let remaining = self.broadcast_prompt_queue(thread_id).await?;
        let _ = self.begin_stream_cancellation(thread_id).await;
        let engine = Arc::clone(self);
        let thread_id = thread_id.to_string();
        tokio::spawn(async move {
            if let Err(error) = Box::pin(engine.send_message_with_session_surface_and_target(
                Some(&thread_id),
                None,
                &prompt.content,
                prompt.content_blocks_json.as_deref(),
                None,
                None,
            ))
            .await
            {
                tracing::warn!(
                    thread_id = %thread_id,
                    %error,
                    "failed to send queued prompt now"
                );
            }
        });
        Ok(remaining)
    }

    pub(crate) async fn dispatch_next_queued_prompt(&self, thread_id: &str) -> Result<()> {
        if self.is_thread_streaming(thread_id).await {
            return Ok(());
        }
        let Some(prompt) = self.history.dequeue_next_prompt(thread_id).await? else {
            return Ok(());
        };
        let _ = self.broadcast_prompt_queue(thread_id).await;
        if let Err(error) = Box::pin(self.send_message_with_session_surface_and_target(
            Some(thread_id),
            None,
            &prompt.content,
            prompt.content_blocks_json.as_deref(),
            None,
            None,
        ))
        .await
        {
            tracing::warn!(
                thread_id = %thread_id,
                prompt_id = %prompt.id,
                %error,
                "failed to auto-dispatch queued prompt"
            );
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::prompt_queue::MAX_QUEUED_PROMPTS;

    #[test]
    fn queue_cap_matches_tui_bound() {
        assert_eq!(MAX_QUEUED_PROMPTS, 500);
    }
}
