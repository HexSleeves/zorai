use super::{encode_otlp_batch, CapturedValue, CompletedTurnTrace};

pub fn cap_completed_trace(trace: &mut CompletedTurnTrace, max_bytes: usize) {
    loop {
        match encode_otlp_batch(std::slice::from_ref(trace)) {
            Ok(bytes) if bytes.len() <= max_bytes => return,
            Err(_) => return,
            Ok(_) => {}
        }
        mark_trace_bytes(trace);
        if shrink_all_captured(trace) {
            continue;
        }
        if !trace.events.is_empty() {
            trace.dropped_events = trace
                .dropped_events
                .saturating_add(trace.events.len() as u32);
            trace.events.clear();
            continue;
        }
        if trace.spans.is_empty() {
            return;
        }
        let keep = trace.spans.len() / 2;
        trace.spans.truncate(keep);
    }
}

fn mark_trace_bytes(trace: &mut CompletedTurnTrace) {
    if trace.partial_reason.is_none() {
        trace.partial_reason = Some("trace_bytes".into());
    }
}

fn shrink_all_captured(trace: &mut CompletedTurnTrace) -> bool {
    let mut changed = false;
    changed |= shrink_captured(&mut trace.input);
    changed |= shrink_captured(&mut trace.output);
    changed |= shrink_captured(&mut trace.reasoning);
    for span in &mut trace.spans {
        changed |= shrink_captured(&mut span.input);
        changed |= shrink_captured(&mut span.output);
    }
    for event in &mut trace.events {
        for (_, value) in &mut event.attributes {
            changed |= shrink_string(value);
        }
    }
    changed
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
