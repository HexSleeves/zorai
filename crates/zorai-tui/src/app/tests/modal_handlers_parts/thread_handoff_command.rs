use crate::app::thread_handoff::ThreadHandoffModalAction;
use crate::app::*;
use crate::state::chat;
use crossterm::event::{KeyModifiers, MouseButton, MouseEvent, MouseEventKind};

use super::whatsapp_modal_esc_sends_stop_and_closes_to_clicking_rendered_settings::make_model;

#[path = "thread_handoff_command_parts/modal_interactions.rs"]
mod modal_interactions;
#[path = "thread_handoff_command_parts/result_refresh.rs"]
mod result_refresh;
#[path = "thread_handoff_command_parts/slash_actions.rs"]
mod slash_actions;

fn seed_active_thread_with_id(model: &mut TuiModel, thread_id: &str, responder_stack_len: usize) {
    let responder_stack = (0..responder_stack_len)
        .map(|index| chat::ThreadHandoffFrame {
            agent_id: if index == 0 { "swarog" } else { "weles" }.to_string(),
            agent_name: if index == 0 { "Svarog" } else { "Weles" }.to_string(),
            entered_at: index as u64,
            linked_thread_id: None,
        })
        .collect();
    model
        .chat
        .reduce(chat::ChatAction::ThreadDetailReceived(chat::AgentThread {
            id: thread_id.to_string(),
            title: "Handoff thread".to_string(),
            thread_handoff_state: Some(chat::ThreadHandoffState {
                origin_agent_id: "swarog".to_string(),
                active_agent_id: "weles".to_string(),
                responder_stack,
                pending_approval_id: None,
            }),
            ..Default::default()
        }));
    model
        .chat
        .reduce(chat::ChatAction::SelectThread(thread_id.to_string()));
}

fn seed_active_thread(model: &mut TuiModel, responder_stack_len: usize) {
    seed_active_thread_with_id(model, "thread-handoff", responder_stack_len);
}

fn seed_thread_with_state(model: &mut TuiModel, stack_len: usize) {
    let responder_stack: Vec<chat::ThreadHandoffFrame> = (0..stack_len)
        .map(|index| chat::ThreadHandoffFrame {
            agent_id: if index == 0 { "swarog" } else { "weles" }.to_string(),
            agent_name: if index == 0 { "Svarog" } else { "Weles" }.to_string(),
            entered_at: index as u64 * 10,
            linked_thread_id: if index > 0 {
                Some(format!("thread-linked-{}", index))
            } else {
                None
            },
        })
        .collect();
    model
        .chat
        .reduce(chat::ChatAction::ThreadDetailReceived(chat::AgentThread {
            id: "thread-modal".to_string(),
            title: "Test thread".to_string(),
            thread_handoff_state: Some(chat::ThreadHandoffState {
                origin_agent_id: "swarog".to_string(),
                active_agent_id: "weles".to_string(),
                responder_stack,
                pending_approval_id: None,
            }),
            ..Default::default()
        }));
    model
        .chat
        .reduce(chat::ChatAction::SelectThread("thread-modal".to_string()));
}

fn configured_handoff_agent(id: &str, name: &str, enabled: bool) -> crate::state::SubAgentEntry {
    crate::state::SubAgentEntry {
        id: id.to_string(),
        name: name.to_string(),
        provider: String::new(),
        model: String::new(),
        role: None,
        enabled,
        builtin: false,
        immutable_identity: false,
        disable_allowed: true,
        delete_allowed: true,
        protected_reason: None,
        reasoning_effort: None,
        api_transport: None,
        claude_permission_mode: None,
        openrouter_provider_order: String::new(),
        openrouter_provider_ignore: String::new(),
        openrouter_allow_fallbacks: false,
        huggingface_provider: String::new(),
        raw_json: None,
    }
}

fn click_thread_handoff_action(model: &mut TuiModel, index: usize) {
    let (_, overlay_area) = model
        .current_modal_area()
        .expect("handoff modal should expose an overlay area");
    let rendered_line = model
        .thread_handoff_modal_action_start_line()
        .saturating_add(index)
        .saturating_sub(model.thread_handoff_modal_cursor_scroll());
    model.handle_mouse(MouseEvent {
        kind: MouseEventKind::Down(MouseButton::Left),
        column: overlay_area.x.saturating_add(2),
        row: overlay_area
            .y
            .saturating_add(1)
            .saturating_add(rendered_line.min(u16::MAX as usize) as u16),
        modifiers: KeyModifiers::NONE,
    });
}
