use super::thread_picker_playgrounds_new_row_is_browse_only_to_slash_effort_updates::{
    seed_active_svarog_thread, seed_active_weles_thread,
};
use super::whatsapp_modal_esc_sends_stop_and_closes_to_clicking_rendered_settings::*;
use crate::app::*;
use zorai_shared::providers::*;

fn seed_active_dola_thread(model: &mut TuiModel) {
    model.connected = true;
    model.agent_config_loaded = true;
    model.config.provider = PROVIDER_ID_OPENAI.to_string();
    model.config.model = "gpt-5.4".to_string();
    model.auth.loaded = true;
    model
        .auth
        .entries
        .push(crate::state::auth::ProviderAuthEntry {
            provider_id: PROVIDER_ID_OPENAI.to_string(),
            provider_name: "OpenAI".to_string(),
            authenticated: true,
            auth_source: "api_key".to_string(),
            model: "gpt-5.4".to_string(),
        });
    model.subagents.entries.push(crate::state::SubAgentEntry {
        claude_permission_mode: None,
        id: "dola".to_string(),
        name: "Dola".to_string(),
        provider: PROVIDER_ID_OPENAI.to_string(),
        model: "gpt-5.4".to_string(),
        role: Some("specialist".to_string()),
        enabled: true,
        builtin: false,
        immutable_identity: false,
        disable_allowed: true,
        delete_allowed: true,
        protected_reason: None,
        reasoning_effort: Some("high".to_string()),
        api_transport: None,
        openrouter_provider_order: String::new(),
        openrouter_provider_ignore: String::new(),
        openrouter_allow_fallbacks: true,
        huggingface_provider: String::new(),
        raw_json: None,
    });
    model
        .chat
        .reduce(chat::ChatAction::ThreadDetailReceived(chat::AgentThread {
            id: "thread-dola".to_string(),
            agent_name: Some("Dola".to_string()),
            profile_provider: Some(PROVIDER_ID_OPENAI.to_string()),
            profile_model: Some("gpt-5.4".to_string()),
            profile_reasoning_effort: Some("high".to_string()),
            title: "Dola thread".to_string(),
            ..Default::default()
        }));
    model
        .chat
        .reduce(chat::ChatAction::SelectThread("thread-dola".to_string()));
}

fn enter_custom_model_id(model: &mut TuiModel, model_id: &str) {
    while !model.settings.edit_buffer().is_empty() {
        model.handle_key_modal(
            KeyCode::Backspace,
            KeyModifiers::NONE,
            modal::ModalKind::CustomModelEditor,
        );
    }
    for ch in model_id.chars() {
        model.handle_key_modal(
            KeyCode::Char(ch),
            KeyModifiers::NONE,
            modal::ModalKind::CustomModelEditor,
        );
    }
    model.handle_key_modal(
        KeyCode::Enter,
        KeyModifiers::NONE,
        modal::ModalKind::CustomModelEditor,
    );
}

fn open_slash_model_custom_editor(model: &mut TuiModel) {
    assert!(model.execute_slash_command_line("/model"));
    assert_eq!(model.modal.top(), Some(modal::ModalKind::ModelPicker));
    let custom_index = model.filtered_model_picker_models().len();
    model
        .modal
        .reduce(modal::ModalAction::Navigate(custom_index as i32));
    model.handle_modal_enter(modal::ModalKind::ModelPicker);
}

#[test]
fn slash_model_custom_opens_editor_for_weles_not_settings() {
    let (mut model, _daemon_rx) = make_model();
    seed_active_weles_thread(&mut model);

    open_slash_model_custom_editor(&mut model);

    assert_eq!(model.modal.top(), Some(modal::ModalKind::CustomModelEditor));
    assert_ne!(model.modal.top(), Some(modal::ModalKind::Settings));
    assert_eq!(
        model.settings.editing_field(),
        Some("thread_owner_custom_model")
    );
    assert!(model.custom_model_editor_body().contains("Pinned to Weles"));
}

#[test]
fn slash_model_custom_opens_editor_for_svarog_not_settings() {
    let (mut model, _daemon_rx) = make_model();
    seed_active_svarog_thread(&mut model);

    open_slash_model_custom_editor(&mut model);

    assert_eq!(model.modal.top(), Some(modal::ModalKind::CustomModelEditor));
    assert_ne!(model.modal.top(), Some(modal::ModalKind::Settings));
    assert!(model
        .custom_model_editor_body()
        .contains("Pinned to Swarog"));
}

#[test]
fn slash_model_custom_opens_editor_for_dola_subagent_not_settings() {
    let (mut model, _daemon_rx) = make_model();
    seed_active_dola_thread(&mut model);

    open_slash_model_custom_editor(&mut model);

    assert_eq!(model.modal.top(), Some(modal::ModalKind::CustomModelEditor));
    assert_ne!(model.modal.top(), Some(modal::ModalKind::Settings));
    assert!(model.custom_model_editor_body().contains("Pinned to Dola"));
}

#[test]
fn slash_model_custom_entry_updates_dola_subagent() {
    let (mut model, mut daemon_rx) = make_model();
    seed_active_dola_thread(&mut model);

    open_slash_model_custom_editor(&mut model);
    enter_custom_model_id(&mut model, "vendor/dola-model");

    let mut saw_target_update = false;
    let mut saw_svarog_update = false;
    while let Ok(command) = daemon_rx.try_recv() {
        match command {
            DaemonCommand::SetTargetAgentProviderModel {
                target_agent_id,
                provider_id,
                model,
            } if target_agent_id == "dola"
                && provider_id == PROVIDER_ID_OPENAI
                && model == "vendor/dola-model" =>
            {
                saw_target_update = true;
            }
            DaemonCommand::SetConfigItem { key_path, .. } if key_path == "/model" => {
                saw_svarog_update = true;
            }
            _ => {}
        }
    }
    assert!(saw_target_update);
    assert!(!saw_svarog_update);
    assert_eq!(
        model
            .chat
            .active_thread()
            .and_then(|thread| thread.runtime_model.as_deref()),
        Some("vendor/dola-model")
    );
    assert_eq!(
        model
            .subagents
            .entries
            .iter()
            .find(|entry| entry.id == "dola")
            .map(|entry| entry.model.as_str()),
        Some("vendor/dola-model")
    );
}

#[test]
fn slash_model_custom_entry_updates_active_svarog_thread() {
    let (mut model, mut daemon_rx) = make_model();
    seed_active_svarog_thread(&mut model);

    open_slash_model_custom_editor(&mut model);
    enter_custom_model_id(&mut model, "vendor/svarog-model");

    let mut saw_model_update = false;
    let mut saw_target_update = false;
    while let Ok(command) = daemon_rx.try_recv() {
        match command {
            DaemonCommand::SetConfigItem {
                key_path,
                value_json,
            } if key_path == "/model" && value_json.contains("vendor/svarog-model") => {
                saw_model_update = true;
            }
            DaemonCommand::SetTargetAgentProviderModel { .. } => {
                saw_target_update = true;
            }
            _ => {}
        }
    }
    assert!(saw_model_update);
    assert!(!saw_target_update);
    assert_eq!(model.config.model, "vendor/svarog-model");
    assert_eq!(
        model
            .chat
            .active_thread()
            .and_then(|thread| thread.runtime_model.as_deref()),
        Some("vendor/svarog-model")
    );
}
