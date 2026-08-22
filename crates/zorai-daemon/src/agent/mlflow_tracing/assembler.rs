use super::*;
use crate::agent::types::AgentEvent;
use std::collections::{HashMap, HashSet, VecDeque};

#[derive(Debug, Clone)]
pub struct TurnObservationContext {
    pub relationships: MlflowTraceRelationships,
    pub input: Option<CapturedValue>,
    pub user_message_timestamp_ms: Option<u64>,
    pub autonomous: bool,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_input_tokens: u64,
    pub cache_creation_input_tokens: u64,
}

struct ActiveSpan {
    span_id: [u8; 8],
    name: String,
    kind: MlflowSpanKind,
    started_at_ms: u64,
    timing_inferred: bool,
    input: Option<CapturedValue>,
    output: Option<CapturedValue>,
    call_id: Option<String>,
}

struct ActiveTurn {
    trace_id: [u8; 16],
    root_span_id: [u8; 8],
    generation: u64,
    started_at_ms: u64,
    last_event_at_ms: u64,
    context: TurnObservationContext,
    output: String,
    reasoning: String,
    spans: Vec<CompletedTraceSpan>,
    llm: Option<ActiveSpan>,
    tools: HashMap<String, ActiveSpan>,
    seen_terminal_message_ids: HashSet<String>,
    input_tokens: u64,
    output_tokens: u64,
    cache_read_input_tokens: u64,
    cache_creation_input_tokens: u64,
}

pub struct TurnTraceAssembler {
    config: MlflowTracingConfig,
    active: HashMap<String, ActiveTurn>,
    generations: HashMap<String, u64>,
    completed: VecDeque<CompletedTurnTrace>,
}

impl TurnTraceAssembler {
    pub fn new(config: MlflowTracingConfig) -> Self {
        Self {
            config,
            active: HashMap::new(),
            generations: HashMap::new(),
            completed: VecDeque::new(),
        }
    }

    pub fn observe(&mut self, at_ms: u64, event: AgentEvent, context: TurnObservationContext) {
        let Some(thread_id) = event_thread_id(&event) else {
            return;
        };
        if matches!(event, AgentEvent::TurnInterrupted { .. }) {
            self.interrupt_turn(&thread_id.to_string(), at_ms);
            return;
        }
        if !is_traceable(&event) {
            return;
        }
        let thread_id = thread_id.to_string();
        let context_input_tokens = context.input_tokens;
        let context_output_tokens = context.output_tokens;
        let context_cache_read = context.cache_read_input_tokens;
        let context_cache_write = context.cache_creation_input_tokens;
        self.ensure_turn(&thread_id, at_ms, context);
        let turn = self.active.get_mut(&thread_id).expect("turn inserted");
        turn.last_event_at_ms = at_ms;
        turn.input_tokens = turn.input_tokens.max(context_input_tokens);
        turn.output_tokens = turn.output_tokens.max(context_output_tokens);
        turn.cache_read_input_tokens = turn.cache_read_input_tokens.max(context_cache_read);
        turn.cache_creation_input_tokens =
            turn.cache_creation_input_tokens.max(context_cache_write);
        match event {
            AgentEvent::Delta { content, .. } => {
                ensure_llm(turn, at_ms);
                append_capped(&mut turn.output, &content, self.config.max_assistant_chars);
            }
            AgentEvent::Reasoning { content, .. } => {
                ensure_llm(turn, at_ms);
                append_capped(
                    &mut turn.reasoning,
                    &content,
                    self.config.max_reasoning_chars,
                );
            }
            AgentEvent::ToolCall {
                call_id,
                name,
                arguments,
                ..
            } => {
                close_llm(turn, at_ms, MlflowTraceOutcome::Ok);
                if turn.tools.contains_key(&call_id)
                    || turn.spans.len() + turn.tools.len() >= self.config.max_spans_per_trace
                {
                    return;
                }
                let input = capture_tool_value(
                    &arguments,
                    self.config.capture_mode,
                    MlflowContentKind::ToolArguments,
                    self.config.max_tool_argument_chars,
                );
                turn.tools.insert(
                    call_id.clone(),
                    ActiveSpan {
                        span_id: random_span_id(),
                        name: format!("zorai.tool {name}"),
                        kind: MlflowSpanKind::Tool,
                        started_at_ms: at_ms,
                        timing_inferred: false,
                        input,
                        output: None,
                        call_id: Some(call_id),
                    },
                );
            }
            AgentEvent::ToolResult {
                call_id,
                content,
                is_error,
                ..
            } => {
                if let Some(mut span) = turn.tools.remove(&call_id) {
                    span.output = capture_tool_value(
                        &content,
                        self.config.capture_mode,
                        MlflowContentKind::ToolResult,
                        self.config.max_tool_result_chars,
                    );
                    finish_span(
                        turn,
                        span,
                        at_ms,
                        if is_error {
                            MlflowTraceOutcome::Error
                        } else {
                            MlflowTraceOutcome::Ok
                        },
                    );
                }
            }
            AgentEvent::Done {
                input_tokens,
                output_tokens,
                cost,
                provider,
                model,
                message_id,
                ..
            } => {
                if message_id
                    .as_ref()
                    .is_some_and(|id| !turn.seen_terminal_message_ids.insert(id.clone()))
                {
                    return;
                }
                self.finish_turn(
                    &thread_id,
                    at_ms,
                    MlflowTraceOutcome::Ok,
                    None,
                    input_tokens.max(context_input_tokens),
                    output_tokens.max(context_output_tokens),
                    cost,
                    provider,
                    model,
                );
            }
            AgentEvent::Error { message, .. } => {
                if let Some(output) = capture_text(
                    &message,
                    self.config.capture_mode,
                    MlflowContentKind::Error,
                    self.config.max_assistant_chars,
                ) {
                    turn.output = output.value;
                }
                self.finish_turn(
                    &thread_id,
                    at_ms,
                    MlflowTraceOutcome::Error,
                    None,
                    0,
                    0,
                    None,
                    None,
                    None,
                );
            }
            _ => {}
        }
    }

    pub fn expire_stale(&mut self, now_ms: u64) {
        let stale = self
            .active
            .iter()
            .filter_map(|(id, turn)| {
                (now_ms.saturating_sub(turn.last_event_at_ms) >= self.config.stale_turn_timeout_ms)
                    .then_some(id.clone())
            })
            .collect::<Vec<_>>();
        for id in stale {
            self.finish_turn(
                &id,
                now_ms,
                MlflowTraceOutcome::Unset,
                Some("stale_timeout".into()),
                0,
                0,
                None,
                None,
                None,
            );
        }
    }

    pub fn mark_broadcast_lag(&mut self, now_ms: u64) {
        let ids = self.active.keys().cloned().collect::<Vec<_>>();
        for id in ids {
            self.finish_turn(
                &id,
                now_ms,
                MlflowTraceOutcome::Unset,
                Some("broadcast_lag".into()),
                0,
                0,
                None,
                None,
                None,
            );
        }
    }

    pub fn drain_completed(&mut self) -> Vec<CompletedTurnTrace> {
        self.completed.drain(..).collect()
    }

    pub fn active_len(&self) -> usize {
        self.active.len()
    }

    pub fn interrupt_turn(&mut self, thread_id: &str, now_ms: u64) -> bool {
        if !self.active.contains_key(thread_id) {
            return false;
        }
        self.finish_turn(
            thread_id,
            now_ms,
            MlflowTraceOutcome::Unset,
            Some("interrupted".into()),
            0,
            0,
            None,
            None,
            None,
        );
        true
    }

    fn ensure_turn(&mut self, thread_id: &str, at_ms: u64, context: TurnObservationContext) {
        if self.active.contains_key(thread_id) {
            return;
        }
        let generation = self.generations.entry(thread_id.to_string()).or_insert(0);
        *generation += 1;
        let input_tokens = context.input_tokens;
        let output_tokens = context.output_tokens;
        let cache_read_input_tokens = context.cache_read_input_tokens;
        let cache_creation_input_tokens = context.cache_creation_input_tokens;
        self.active.insert(
            thread_id.to_string(),
            ActiveTurn {
                trace_id: random_trace_id(),
                root_span_id: random_span_id(),
                generation: *generation,
                started_at_ms: context.user_message_timestamp_ms.unwrap_or(at_ms),
                last_event_at_ms: at_ms,
                context,
                output: String::new(),
                reasoning: String::new(),
                spans: Vec::new(),
                llm: None,
                tools: HashMap::new(),
                seen_terminal_message_ids: HashSet::new(),
                input_tokens,
                output_tokens,
                cache_read_input_tokens,
                cache_creation_input_tokens,
            },
        );
    }

    #[allow(clippy::too_many_arguments)]
    fn finish_turn(
        &mut self,
        thread_id: &str,
        at_ms: u64,
        outcome: MlflowTraceOutcome,
        mut partial_reason: Option<String>,
        input_tokens: u64,
        output_tokens: u64,
        cost_usd: Option<f64>,
        provider: Option<String>,
        model: Option<String>,
    ) {
        let Some(mut turn) = self.active.remove(thread_id) else {
            return;
        };
        let input_tokens = input_tokens.max(turn.input_tokens);
        let output_tokens = output_tokens.max(turn.output_tokens);
        let cache_read_input_tokens = turn.cache_read_input_tokens;
        let cache_creation_input_tokens = turn.cache_creation_input_tokens;
        close_llm(&mut turn, at_ms, outcome);
        let tools = std::mem::take(&mut turn.tools);
        if !tools.is_empty() && partial_reason.is_none() {
            partial_reason = Some("missing_tool_result".into());
        }
        for (_, span) in tools {
            finish_span(&mut turn, span, at_ms, MlflowTraceOutcome::Unset);
        }
        if turn.spans.len() > self.config.max_spans_per_trace {
            turn.spans.truncate(self.config.max_spans_per_trace);
            partial_reason = Some("span_limit".into());
        }
        let output = capture_text(
            &turn.output,
            self.config.capture_mode,
            MlflowContentKind::Assistant,
            self.config.max_assistant_chars,
        );
        let reasoning = capture_text(
            &turn.reasoning,
            self.config.capture_mode,
            MlflowContentKind::Reasoning,
            self.config.max_reasoning_chars,
        );
        let scope = turn
            .context
            .relationships
            .classify_scope(turn.context.autonomous);
        let trace = CompletedTurnTrace {
            trace_id: turn.trace_id,
            root_span_id: turn.root_span_id,
            relationships: turn.context.relationships,
            scope,
            generation: turn.generation,
            started_at_ms: turn.started_at_ms,
            ended_at_ms: at_ms.max(turn.started_at_ms),
            timing_inferred: true,
            outcome,
            partial_reason,
            input: turn.context.input,
            output,
            reasoning,
            spans: turn.spans,
            input_tokens,
            output_tokens,
            cache_read_input_tokens,
            cache_creation_input_tokens,
            cost_usd,
            provider,
            model,
        };
        while self.completed.len() >= self.config.queue_capacity {
            self.completed.pop_front();
        }
        self.completed.push_back(trace);
    }
}

fn ensure_llm(turn: &mut ActiveTurn, at_ms: u64) {
    if turn.llm.is_none() {
        turn.llm = Some(ActiveSpan {
            span_id: random_span_id(),
            name: "gen_ai.response".into(),
            kind: MlflowSpanKind::Llm,
            started_at_ms: at_ms,
            timing_inferred: true,
            input: None,
            output: None,
            call_id: None,
        });
    }
}

fn close_llm(turn: &mut ActiveTurn, at_ms: u64, outcome: MlflowTraceOutcome) {
    if let Some(span) = turn.llm.take() {
        finish_span(turn, span, at_ms, outcome);
    }
}

fn finish_span(turn: &mut ActiveTurn, span: ActiveSpan, at_ms: u64, outcome: MlflowTraceOutcome) {
    turn.spans.push(CompletedTraceSpan {
        span_id: span.span_id,
        parent_span_id: turn.root_span_id,
        name: span.name,
        kind: span.kind,
        started_at_ms: span.started_at_ms,
        ended_at_ms: at_ms.max(span.started_at_ms),
        timing_inferred: span.timing_inferred,
        outcome,
        input: span.input,
        output: span.output,
        call_id: span.call_id,
    });
}

fn append_capped(target: &mut String, value: &str, max_chars: usize) {
    let remaining = max_chars.saturating_sub(target.chars().count());
    target.extend(value.chars().take(remaining));
}

fn random_trace_id() -> [u8; 16] {
    *uuid::Uuid::new_v4().as_bytes()
}

fn random_span_id() -> [u8; 8] {
    let bytes = uuid::Uuid::new_v4();
    let mut id = [0; 8];
    id.copy_from_slice(&bytes.as_bytes()[..8]);
    id
}

fn is_traceable(event: &AgentEvent) -> bool {
    matches!(
        event,
        AgentEvent::Delta { .. }
            | AgentEvent::Reasoning { .. }
            | AgentEvent::ToolCall { .. }
            | AgentEvent::ToolResult { .. }
            | AgentEvent::Done { .. }
            | AgentEvent::Error { .. }
            | AgentEvent::ApprovalRequired { .. }
            | AgentEvent::RetryStatus { .. }
    )
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
