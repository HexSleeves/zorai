use super::*;
use crate::state::settings::{SettingsAction, SettingsTab};

const MIN_CONTEXT_WINDOW_TOKENS: u32 = 1_000;
const MAX_CONTEXT_WINDOW_TOKENS: u32 = 2_000_000;

impl TuiModel {
    pub(crate) fn parse_context_window_tokens(raw: &str) -> Option<u32> {
        let normalized = raw.trim().replace(['_', ',', ' '], "");
        if normalized.is_empty() {
            return None;
        }
        normalized
            .parse::<u32>()
            .ok()
            .map(|tokens| tokens.clamp(MIN_CONTEXT_WINDOW_TOKENS, MAX_CONTEXT_WINDOW_TOKENS))
    }

    pub(crate) fn current_thread_context_window_tokens(&self) -> u32 {
        self.current_conversation_agent_profile()
            .context_window_tokens
            .or_else(|| {
                self.chat
                    .active_thread()
                    .and_then(|thread| thread.profile_context_window_tokens)
            })
            .unwrap_or(self.config.context_window_tokens)
            .max(1)
    }

    pub(crate) fn open_active_thread_context_window_editor(&mut self) {
        let current = self.current_thread_context_window_tokens().to_string();
        if self.modal.top() != Some(modal::ModalKind::Settings) {
            self.modal
                .reduce(modal::ModalAction::Push(modal::ModalKind::Settings));
        }
        self.settings
            .reduce(SettingsAction::SwitchTab(SettingsTab::Provider));
        self.settings_navigate_to(7);
        if let Some(pending) = self.active_thread_target_agent_config() {
            let target_agent_name = pending.target_agent_name.clone();
            self.pending_target_agent_config = Some(pending);
            self.settings
                .start_editing("target_agent_context_window", &current);
            self.status_line = format!("Enter context window tokens for {target_agent_name}");
            return;
        }
        self.settings.start_editing("context_window_tokens", &current);
        self.status_line = "Enter context window tokens".to_string();
    }

    pub(crate) fn apply_active_thread_context_window(&mut self, tokens: u32) {
        let tokens = tokens.clamp(MIN_CONTEXT_WINDOW_TOKENS, MAX_CONTEXT_WINDOW_TOKENS);
        if let Some(pending) = self.active_thread_target_agent_config() {
            self.send_daemon_command(DaemonCommand::SetTargetAgentContextWindow {
                target_agent_id: pending.target_agent_id.clone(),
                context_window_tokens: tokens,
            });
            apply_target_agent_context_window_locally(self, &pending.target_agent_id, tokens);
            self.status_line = format!("{} context: {tokens} tok", pending.target_agent_name);
            return;
        }

        apply_svarog_context_window_locally(self, tokens);
        if let Ok(value_json) = serde_json::to_string(&serde_json::json!(tokens)) {
            self.send_daemon_command(DaemonCommand::SetConfigItem {
                key_path: "/context_window_tokens".to_string(),
                value_json: value_json.clone(),
            });
            self.send_daemon_command(DaemonCommand::SetConfigItem {
                key_path: format!("/providers/{}/context_window_tokens", self.config.provider),
                value_json: value_json.clone(),
            });
            self.send_daemon_command(DaemonCommand::SetConfigItem {
                key_path: format!("/{}/context_window_tokens", self.config.provider),
                value_json,
            });
        }
        self.status_line = format!("Context: {tokens} tok");
    }
}

fn apply_svarog_context_window_locally(model: &mut TuiModel, tokens: u32) {
    model.config.custom_context_window_tokens = Some(tokens);
    model.config.context_window_tokens = tokens;
    if let Some(raw) = model.config.agent_config_raw.as_mut() {
        raw["context_window_tokens"] = serde_json::json!(tokens);
        let provider_id = model.config.provider.clone();
        if raw.get("providers").and_then(|value| value.get(&provider_id)).is_some() {
            raw["providers"][provider_id.as_str()]["context_window_tokens"] =
                serde_json::json!(tokens);
        }
        if raw.get(&provider_id).is_some() {
            raw[provider_id]["context_window_tokens"] = serde_json::json!(tokens);
        }
    }
    if let Some(thread) = model.chat.active_thread_mut() {
        thread.profile_context_window_tokens = Some(tokens);
    }
}

fn apply_target_agent_context_window_locally(
    model: &mut TuiModel,
    target_agent_id: &str,
    tokens: u32,
) {
    for entry in &mut model.subagents.entries {
        let id_matches = entry.id.eq_ignore_ascii_case(target_agent_id)
            || entry
                .id
                .strip_suffix("_builtin")
                .is_some_and(|alias| alias.eq_ignore_ascii_case(target_agent_id));
        if id_matches || entry.name.eq_ignore_ascii_case(target_agent_id) {
            if let Some(raw) = entry.raw_json.as_mut() {
                raw["context_window_tokens"] = serde_json::json!(tokens);
            }
        }
    }
    if let Some(thread) = model.chat.active_thread_mut() {
        thread.profile_context_window_tokens = Some(tokens);
    }
}
