use super::{encode_otlp_batch, CapturedValue, CompletedTurnTrace};

pub fn cap_completed_trace(trace: &mut CompletedTurnTrace, max_bytes: usize) {
    for _ in 0..48 {
        let encoded = match encode_otlp_batch(std::slice::from_ref(trace)) {
            Ok(bytes) => bytes,
            Err(_) => return,
        };
        if encoded.len() <= max_bytes {
            return;
        }
        if !shrink_trace_payloads(trace) {
            mark_trace_bytes(trace);
            return;
        }
        mark_trace_bytes(trace);
    }
}

fn mark_trace_bytes(trace: &mut CompletedTurnTrace) {
    if trace.partial_reason.is_none() {
        trace.partial_reason = Some("trace_bytes".into());
    }
}

fn shrink_trace_payloads(trace: &mut CompletedTurnTrace) -> bool {
    let mut best = ShrinkTarget::None;
    let mut best_len = 0usize;
    consider_captured(&mut best, &mut best_len, ShrinkTarget::Input, &trace.input);
    consider_captured(
        &mut best,
        &mut best_len,
        ShrinkTarget::Output,
        &trace.output,
    );
    consider_captured(
        &mut best,
        &mut best_len,
        ShrinkTarget::Reasoning,
        &trace.reasoning,
    );
    for (index, span) in trace.spans.iter().enumerate() {
        consider_captured(
            &mut best,
            &mut best_len,
            ShrinkTarget::SpanInput(index),
            &span.input,
        );
        consider_captured(
            &mut best,
            &mut best_len,
            ShrinkTarget::SpanOutput(index),
            &span.output,
        );
    }
    for (event_index, event) in trace.events.iter().enumerate() {
        for (attr_index, (_, value)) in event.attributes.iter().enumerate() {
            if value.len() > best_len {
                best_len = value.len();
                best = ShrinkTarget::EventAttr {
                    event: event_index,
                    attr: attr_index,
                };
            }
        }
    }
    if best_len > 0 {
        return apply_shrink(trace, best);
    }
    if trace.events.pop().is_some() {
        trace.dropped_events = trace.dropped_events.saturating_add(1);
        return true;
    }
    if trace.spans.pop().is_some() {
        if trace.partial_reason.is_none() {
            trace.partial_reason = Some("trace_bytes".into());
        }
        return true;
    }
    false
}

#[derive(Clone, Copy)]
enum ShrinkTarget {
    None,
    Input,
    Output,
    Reasoning,
    SpanInput(usize),
    SpanOutput(usize),
    EventAttr { event: usize, attr: usize },
}

fn consider_captured(
    best: &mut ShrinkTarget,
    best_len: &mut usize,
    target: ShrinkTarget,
    value: &Option<CapturedValue>,
) {
    let Some(captured) = value else {
        return;
    };
    if captured.value.len() > *best_len {
        *best_len = captured.value.len();
        *best = target;
    }
}

fn apply_shrink(trace: &mut CompletedTurnTrace, target: ShrinkTarget) -> bool {
    match target {
        ShrinkTarget::None => false,
        ShrinkTarget::Input => shrink_captured(&mut trace.input),
        ShrinkTarget::Output => shrink_captured(&mut trace.output),
        ShrinkTarget::Reasoning => shrink_captured(&mut trace.reasoning),
        ShrinkTarget::SpanInput(index) => trace
            .spans
            .get_mut(index)
            .is_some_and(|span| shrink_captured(&mut span.input)),
        ShrinkTarget::SpanOutput(index) => trace
            .spans
            .get_mut(index)
            .is_some_and(|span| shrink_captured(&mut span.output)),
        ShrinkTarget::EventAttr { event, attr } => {
            let Some(value) = trace
                .events
                .get_mut(event)
                .and_then(|entry| entry.attributes.get_mut(attr))
                .map(|(_, value)| value)
            else {
                return false;
            };
            shrink_string(value)
        }
    }
}

fn shrink_captured(value: &mut Option<CapturedValue>) -> bool {
    let Some(captured) = value.as_mut() else {
        return false;
    };
    if !shrink_string(&mut captured.value) {
        return false;
    }
    captured.truncated = true;
    true
}

fn shrink_string(value: &mut String) -> bool {
    if value.is_empty() {
        return false;
    }
    let keep = value.chars().count() / 2;
    *value = value.chars().take(keep).collect();
    true
}
