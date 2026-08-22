use super::*;
use crate::agent::types::{AgentEvent, AgentThread, MessageRole};
use crate::agent::AgentEngine;

pub async fn enrich_event(
    engine: &AgentEngine,
    event: &AgentEvent,
    config: &MlflowTracingConfig,
) -> Option<TurnObservationContext> {
    let thread_id = event_thread_id(event)?.to_string();
    let thread = match engine.live_thread(&thread_id).await {
        Some(thread) if !thread.messages.is_empty() => thread,
        _ => engine.get_thread(&thread_id).await?,
    };
    let protocol_surface = engine.get_thread_client_surface(&thread_id).await;
    let gateway_bound = engine
        .gateway_threads
        .read()
        .await
        .values()
        .any(|id| id == &thread_id);
    let surface = resolved_client_surface(protocol_surface, gateway_bound, &thread.title);

    let task = {
        let tasks = engine.tasks.lock().await;
        tasks
            .iter()
            .find(|task| task.thread_id.as_deref() == Some(thread_id.as_str()))
            .cloned()
    };
    let goal = {
        let goals = engine.goal_runs.lock().await;
        goals
            .iter()
            .find(|goal| {
                goal.thread_id.as_deref() == Some(thread_id.as_str())
                    || goal.root_thread_id.as_deref() == Some(thread_id.as_str())
                    || goal.active_thread_id.as_deref() == Some(thread_id.as_str())
                    || goal.execution_thread_ids.iter().any(|id| id == &thread_id)
            })
            .cloned()
    };

    let user_anchor = engine.mlflow_tracing.front_turn_anchor(&thread_id);
    let user = select_turn_user(&thread.messages, user_anchor.as_ref());
    let assistant = thread
        .messages
        .iter()
        .rev()
        .find(|message| message.role == MessageRole::Assistant);
    let (input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens) =
        turn_usage_tokens(
            &thread,
            user.as_ref().map(|message| message.timestamp),
            user.as_ref()
                .and_then(|message| next_user_timestamp(&thread.messages, &message.id)),
        );
    let task_is_subagent = task
        .as_ref()
        .is_some_and(crate::agent::types::AgentTask::is_spawned_subagent);
    let autonomous = surface.is_none() && (task.is_some() || goal.is_some());
    let relationships = MlflowTraceRelationships {
        thread_id: thread_id.clone(),
        user_message_id: user.as_ref().map(|message| message.id.clone()),
        assistant_message_id: assistant.map(|message| message.id.clone()),
        agent_id: task
            .as_ref()
            .and_then(|task| task.sub_agent_def_id.clone())
            .or_else(|| thread.agent_name.clone()),
        agent_name: thread.agent_name.clone(),
        client_surface: surface,
        task_id: task.as_ref().map(|task| task.id.clone()),
        parent_task_id: task.as_ref().and_then(|task| task.parent_task_id.clone()),
        goal_run_id: task
            .as_ref()
            .and_then(|task| task.goal_run_id.clone())
            .or_else(|| goal.as_ref().map(|goal| goal.id.clone())),
        goal_step_index: goal.as_ref().map(|goal| goal.current_step_index),
        parent_thread_id: task.as_ref().and_then(|task| task.parent_thread_id.clone()),
        root_thread_id: goal.as_ref().and_then(|goal| goal.root_thread_id.clone()),
        session_id: task
            .as_ref()
            .and_then(|task| task.session_id.clone())
            .or_else(|| goal.as_ref().and_then(|goal| goal.session_id.clone())),
        workspace_id: None,
        provider: event_provider(event).or_else(|| thread.upstream_provider.clone()),
        model: event_model(event).or_else(|| thread.upstream_model.clone()),
        api_transport: thread
            .upstream_transport
            .map(|transport| format!("{transport:?}").to_ascii_lowercase()),
    };
    let scope = relationships.classify_scope(autonomous);
    if !scope_enabled(scope, &config.scopes) {
        return None;
    }
    Some(TurnObservationContext {
        input: user.as_ref().and_then(|message| {
            capture_text(
                &message.content,
                config.capture_mode,
                MlflowContentKind::User,
                config.max_user_chars,
            )
        }),
        user_message_timestamp_ms: user.as_ref().map(|message| message.timestamp),
        relationships,
        autonomous: autonomous && !task_is_subagent,
        input_tokens,
        output_tokens,
        cache_read_input_tokens,
        cache_creation_input_tokens,
    })
}

pub fn scope_enabled(scope: MlflowTraceScope, scopes: &MlflowTracingScopes) -> bool {
    match scope {
        MlflowTraceScope::VisibleOperator => scopes.visible_operator,
        MlflowTraceScope::Gateway => scopes.gateway,
        MlflowTraceScope::GoalTask => scopes.goal_task,
        MlflowTraceScope::Subagent => scopes.subagent,
        MlflowTraceScope::Concierge => scopes.concierge,
        MlflowTraceScope::HeartbeatAutonomous => scopes.heartbeat_autonomous,
        MlflowTraceScope::Unknown => false,
    }
}

const GATEWAY_THREAD_TITLE_PREFIXES: [&str; 4] = ["slack ", "discord ", "telegram ", "whatsapp "];

pub(super) fn resolved_client_surface(
    protocol_surface: Option<zorai_protocol::ClientSurface>,
    gateway_bound: bool,
    thread_title: &str,
) -> Option<String> {
    if gateway_bound || is_gateway_thread_title(thread_title) {
        return Some("gateway".into());
    }
    protocol_surface.map(|surface| match surface {
        zorai_protocol::ClientSurface::Tui => "tui".into(),
        zorai_protocol::ClientSurface::Electron => "electron".into(),
    })
}

fn is_gateway_thread_title(title: &str) -> bool {
    let title = title.trim().to_ascii_lowercase();
    GATEWAY_THREAD_TITLE_PREFIXES
        .iter()
        .any(|prefix| title.starts_with(prefix))
}

fn event_thread_id(event: &AgentEvent) -> Option<&str> {
    match event {
        AgentEvent::Delta { thread_id, .. }
        | AgentEvent::Reasoning { thread_id, .. }
        | AgentEvent::ToolCall { thread_id, .. }
        | AgentEvent::ToolResult { thread_id, .. }
        | AgentEvent::Done { thread_id, .. }
        | AgentEvent::Error { thread_id, .. }
        | AgentEvent::TurnInterrupted { thread_id }
        | AgentEvent::ApprovalRequired { thread_id, .. }
        | AgentEvent::RetryStatus { thread_id, .. } => Some(thread_id),
        _ => None,
    }
}

fn event_provider(event: &AgentEvent) -> Option<String> {
    match event {
        AgentEvent::Done { provider, .. } => provider.clone(),
        _ => None,
    }
}

fn event_model(event: &AgentEvent) -> Option<String> {
    match event {
        AgentEvent::Done { model, .. } => model.clone(),
        _ => None,
    }
}

fn turn_usage_tokens(
    thread: &AgentThread,
    user_timestamp_ms: Option<u64>,
    next_user_timestamp_ms: Option<u64>,
) -> (u64, u64, u64, u64) {
    let Some(started_at_ms) = user_timestamp_ms else {
        return (0, 0, 0, 0);
    };
    thread
        .messages
        .iter()
        .filter(|message| {
            message.role == MessageRole::Assistant
                && message.timestamp >= started_at_ms
                && next_user_timestamp_ms.is_none_or(|ended_at_ms| message.timestamp < ended_at_ms)
        })
        .fold(
            (0, 0, 0, 0),
            |(input, output, cache_read, cache_write), message| {
                let (message_cache_read, message_cache_write) = message.cache_usage_tokens();
                (
                    input.saturating_add(message.input_tokens),
                    output.saturating_add(message.output_tokens),
                    cache_read.saturating_add(message_cache_read),
                    cache_write.saturating_add(message_cache_write),
                )
            },
        )
}

fn next_user_timestamp(
    messages: &[crate::agent::types::AgentMessage],
    user_message_id: &str,
) -> Option<u64> {
    let mut seen = false;
    for message in messages {
        if message.id == user_message_id {
            seen = true;
            continue;
        }
        if seen && message.role == MessageRole::User {
            return Some(message.timestamp);
        }
    }
    None
}

pub(super) struct SelectedTurnUser {
    pub id: String,
    pub content: String,
    pub timestamp: u64,
}

pub(super) fn select_turn_user(
    messages: &[crate::agent::types::AgentMessage],
    anchor: Option<&MlflowTurnAnchor>,
) -> Option<SelectedTurnUser> {
    if let Some(anchor) = anchor {
        if let Some(message) = messages
            .iter()
            .find(|message| message.id == anchor.user_message_id)
        {
            return Some(SelectedTurnUser {
                id: message.id.clone(),
                content: message.content.clone(),
                timestamp: message.timestamp,
            });
        }
        return Some(SelectedTurnUser {
            id: anchor.user_message_id.clone(),
            content: anchor.content.clone(),
            timestamp: anchor.timestamp_ms,
        });
    }
    messages
        .iter()
        .rev()
        .find(|message| message.role == MessageRole::User)
        .map(|message| SelectedTurnUser {
            id: message.id.clone(),
            content: message.content.clone(),
            timestamp: message.timestamp,
        })
}
