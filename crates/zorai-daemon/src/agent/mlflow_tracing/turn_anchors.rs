use super::worker::MlflowTracingRuntime;
use std::collections::VecDeque;

const MAX_ANCHORS_PER_THREAD: usize = 32;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MlflowTurnAnchor {
    pub user_message_id: String,
    pub content: String,
    pub timestamp_ms: u64,
}

impl MlflowTracingRuntime {
    pub(crate) fn push_turn_anchor(&self, thread_id: &str, anchor: MlflowTurnAnchor) {
        let mut anchors = self
            .turn_anchors
            .lock()
            .expect("MLflow turn anchor mutex poisoned");
        let queue = anchors.entry(thread_id.to_string()).or_default();
        if queue
            .iter()
            .any(|queued| queued.user_message_id == anchor.user_message_id)
        {
            return;
        }
        while queue.len() >= MAX_ANCHORS_PER_THREAD {
            queue.pop_front();
        }
        queue.push_back(anchor);
    }

    pub(crate) fn front_turn_anchor(&self, thread_id: &str) -> Option<MlflowTurnAnchor> {
        self.turn_anchors
            .lock()
            .expect("MLflow turn anchor mutex poisoned")
            .get(thread_id)
            .and_then(VecDeque::front)
            .cloned()
    }

    pub(crate) fn pop_turn_anchor(&self, thread_id: &str) -> Option<MlflowTurnAnchor> {
        let mut anchors = self
            .turn_anchors
            .lock()
            .expect("MLflow turn anchor mutex poisoned");
        let popped = anchors.get_mut(thread_id).and_then(VecDeque::pop_front);
        if anchors.get(thread_id).is_some_and(|queue| queue.is_empty()) {
            anchors.remove(thread_id);
        }
        popped
    }
}
