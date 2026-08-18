use super::thread_picker_playgrounds_new_row_is_browse_only_to_slash_effort_updates::{
    seed_active_svarog_thread, seed_active_weles_thread,
};
use super::whatsapp_modal_esc_sends_stop_and_closes_to_clicking_rendered_settings::*;
use crate::app::*;
use crate::state::settings::SettingsTab;

#[test]
fn slash_context_opens_editor_for_active_svarog_thread() {
    let (mut model, _daemon_rx) = make_model();
    seed_active_svarog_thread(&mut model);
    model.config.context_window_tokens = 128_000;

    assert!(model.execute_slash_command_line("/context"));
    assert_eq!(model.modal.top(), Some(modal::ModalKind::Settings));
    assert_eq!(model.settings.active_tab(), SettingsTab::Provider);
    assert_eq!(
        model.settings.editing_field(),
        Some("context_window_tokens")
    );
    assert_eq!(model.settings.edit_buffer(), "128000");
}

#[test]
fn slash_context_with_tokens_updates_active_svarog_thread() {
    let (mut model, mut daemon_rx) = make_model();
    seed_active_svarog_thread(&mut model);

    assert!(model.execute_slash_command_line("/context 200000"));
    assert_eq!(model.config.context_window_tokens, 200_000);
    assert_eq!(model.config.custom_context_window_tokens, Some(200_000));
    assert_eq!(
        model
            .chat
            .active_thread()
            .and_then(|thread| thread.profile_context_window_tokens),
        Some(200_000)
    );
    assert_eq!(
        model
            .current_header_agent_profile()
            .context_window_tokens,
        Some(200_000)
    );

    let mut saw_context_update = false;
    while let Ok(command) = daemon_rx.try_recv() {
        if matches!(
            command,
            DaemonCommand::SetConfigItem { key_path, value_json }
                if key_path == "/context_window_tokens" && value_json.contains("200000")
        ) {
            saw_context_update = true;
        }
    }
    assert!(saw_context_update);
}

#[test]
fn slash_context_with_tokens_updates_active_thread_owner() {
    let (mut model, mut daemon_rx) = make_model();
    seed_active_weles_thread(&mut model);

    assert!(model.execute_slash_command_line("/context 256000"));
    assert_eq!(
        model
            .chat
            .active_thread()
            .and_then(|thread| thread.profile_context_window_tokens),
        Some(256_000)
    );
    assert_eq!(
        model
            .current_header_agent_profile()
            .context_window_tokens,
        Some(256_000)
    );

    let mut saw_target_update = false;
    while let Ok(command) = daemon_rx.try_recv() {
        if matches!(
            command,
            DaemonCommand::SetTargetAgentContextWindow {
                target_agent_id,
                context_window_tokens,
            } if target_agent_id == "weles" && context_window_tokens == 256_000
        ) {
            saw_target_update = true;
        }
    }
    assert!(saw_target_update);
}

#[test]
fn slash_context_opens_target_editor_for_weles_thread() {
    let (mut model, _daemon_rx) = make_model();
    seed_active_weles_thread(&mut model);

    assert!(model.execute_slash_command_line("/context"));
    assert_eq!(model.modal.top(), Some(modal::ModalKind::Settings));
    assert_eq!(
        model.settings.editing_field(),
        Some("target_agent_context_window")
    );
}
