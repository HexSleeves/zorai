use super::*;

use crate::app::thread_handoff::{parse_thread_handoff_args, ThreadHandoffSlashAction};

#[test]
fn thread_handoff_slash_parser_preserves_all_forms_and_trimmed_tail() {
    assert_eq!(
        parse_thread_handoff_args(""),
        Ok(ThreadHandoffSlashAction::OpenModal)
    );
    assert_eq!(
        parse_thread_handoff_args("status"),
        Ok(ThreadHandoffSlashAction::OpenModal)
    );
    assert_eq!(
        parse_thread_handoff_args("status Inspect the stack"),
        Ok(ThreadHandoffSlashAction::Push {
            target_alias: "status".to_string(),
            reason: Some("Inspect the stack".to_string()),
        })
    );
    assert_eq!(
        parse_thread_handoff_args("weles"),
        Ok(ThreadHandoffSlashAction::Push {
            target_alias: "weles".to_string(),
            reason: None,
        })
    );
    assert_eq!(
        parse_thread_handoff_args("weles  Review the patch first  "),
        Ok(ThreadHandoffSlashAction::Push {
            target_alias: "weles".to_string(),
            reason: Some("Review the patch first".to_string()),
        })
    );
    assert_eq!(
        parse_thread_handoff_args("return"),
        Ok(ThreadHandoffSlashAction::Return { reason: None })
    );
    assert_eq!(
        parse_thread_handoff_args("return  Resume original  "),
        Ok(ThreadHandoffSlashAction::Return {
            reason: Some("Resume original".to_string()),
        })
    );
}

#[test]
fn thread_handoff_slash_no_active_thread_sends_no_command() {
    let (mut model, mut daemon_rx) = make_model();

    assert!(model.execute_slash_command_line("/handoff weles"));

    assert_eq!(model.status_line, "Start or load thread first");
    assert!(daemon_rx.try_recv().is_err());
}

#[test]
fn thread_handoff_slash_unknown_alias_sends_no_command() {
    let (mut model, mut daemon_rx) = make_model();
    seed_active_thread(&mut model, 2);

    assert!(model.execute_slash_command_line("/handoff nowhere"));

    assert_eq!(
        model.status_line,
        "Unknown or disabled handoff target: nowhere"
    );
    assert!(daemon_rx.try_recv().is_err());
}

#[test]
fn thread_handoff_slash_disabled_configured_alias_sends_no_command() {
    let (mut model, mut daemon_rx) = make_model();
    seed_active_thread(&mut model, 2);
    model.subagents.entries.push(configured_handoff_agent(
        "disabled-agent",
        "Disabled Agent",
        false,
    ));

    assert!(model.execute_slash_command_line("/handoff disabled-agent"));

    assert_eq!(
        model.status_line,
        "Unknown or disabled handoff target: disabled-agent"
    );
    assert!(daemon_rx.try_recv().is_err());
}

#[test]
fn thread_handoff_slash_canonicalizes_builtin_suffix_and_core_aliases() {
    for (alias, expected) in [
        ("svarog_builtin", zorai_protocol::AGENT_ID_SWAROG),
        ("main_builtin", zorai_protocol::AGENT_ID_SWAROG),
        ("concierge_builtin", zorai_protocol::AGENT_ID_RAROG),
        ("weles_builtin", "weles"),
    ] {
        let (mut model, mut daemon_rx) = make_model();
        seed_active_thread(&mut model, 1);

        assert!(model.execute_slash_command_line(&format!("/handoff {alias}")));

        assert!(matches!(
            daemon_rx.try_recv(),
            Ok(DaemonCommand::ThreadHandoff {
                target_agent_id: Some(target_agent_id),
                ..
            }) if target_agent_id == expected
        ));
    }
}

#[test]
fn thread_handoff_rejects_local_unsaved_thread_for_modal_push_and_return() {
    let (mut model, mut daemon_rx) = make_model();
    seed_active_thread_with_id(&mut model, "local-42", 2);

    assert!(model.execute_slash_command_line("/handoff"));
    assert_eq!(
        model.status_line,
        "Send the first message to create the daemon thread before using handoff"
    );
    assert!(model.modal.top().is_none());
    assert!(daemon_rx.try_recv().is_err());

    assert!(model.execute_slash_command_line("/handoff svarog"));
    assert_eq!(
        model.status_line,
        "Send the first message to create the daemon thread before using handoff"
    );
    assert!(daemon_rx.try_recv().is_err());

    assert!(model.execute_slash_command_line("/handoff return"));
    assert_eq!(
        model.status_line,
        "Send the first message to create the daemon thread before using handoff"
    );
    assert!(daemon_rx.try_recv().is_err());
}

#[test]
fn thread_handoff_slash_direct_default_push_sends_exact_command() {
    let (mut model, mut daemon_rx) = make_model();
    seed_active_thread(&mut model, 2);

    assert!(model.execute_slash_command_line("/handoff weles"));

    assert!(matches!(
        daemon_rx.try_recv(),
        Ok(DaemonCommand::ThreadHandoff {
            thread_id,
            action,
            target_agent_id,
            reason,
            summary,
        }) if thread_id == "thread-handoff"
            && action == "push_handoff"
            && target_agent_id.as_deref() == Some("weles")
            && reason == "Operator requested handoff to Weles"
            && summary == "Continue this thread as Weles"
    ));
    assert_eq!(model.status_line, "Requesting handoff to Weles...");
}

#[test]
fn thread_handoff_slash_direct_custom_push_preserves_reason() {
    let (mut model, mut daemon_rx) = make_model();
    seed_active_thread(&mut model, 2);

    assert!(model.execute_slash_command_line("/handoff weles Review the patch first"));

    assert!(matches!(
        daemon_rx.try_recv(),
        Ok(DaemonCommand::ThreadHandoff { reason, summary, .. })
            if reason == "Review the patch first" && summary == "Continue this thread as Weles"
    ));
}

#[test]
fn thread_handoff_slash_return_sends_exact_default_command() {
    let (mut model, mut daemon_rx) = make_model();
    seed_active_thread(&mut model, 2);

    assert!(model.execute_slash_command_line("/handoff return"));

    assert!(matches!(
        daemon_rx.try_recv(),
        Ok(DaemonCommand::ThreadHandoff {
            thread_id,
            action,
            target_agent_id,
            reason,
            summary,
        }) if thread_id == "thread-handoff"
            && action == "return_handoff"
            && target_agent_id.is_none()
            && reason == "Operator requested return to the previous responder"
            && summary == "Resume this thread as the previous responder"
    ));
}

#[test]
fn thread_handoff_slash_custom_return_preserves_reason() {
    let (mut model, mut daemon_rx) = make_model();
    seed_active_thread(&mut model, 2);

    assert!(model.execute_slash_command_line("/handoff return Resume original"));

    assert!(matches!(
        daemon_rx.try_recv(),
        Ok(DaemonCommand::ThreadHandoff { reason, .. }) if reason == "Resume original"
    ));
}

#[test]
fn thread_handoff_slash_shallow_return_is_rejected() {
    let (mut model, mut daemon_rx) = make_model();
    seed_active_thread(&mut model, 1);

    assert!(model.execute_slash_command_line("/handoff return"));

    assert_eq!(model.status_line, "No previous responder to return to");
    assert!(daemon_rx.try_recv().is_err());
}

#[test]
fn thread_handoff_slash_bare_and_status_open_modal_without_rewriting_input() {
    let (mut model, mut daemon_rx) = make_model();
    seed_active_thread(&mut model, 2);
    model.input.set_text("unchanged input");

    assert!(model.execute_slash_command_line("/handoff"));
    assert_eq!(
        model.modal.top(),
        Some(crate::state::modal::ModalKind::ThreadHandoff)
    );
    assert_eq!(model.status_line, "Viewing thread handoff");
    assert_eq!(model.input.buffer(), "unchanged input");
    assert!(daemon_rx.try_recv().is_err());

    model.close_top_modal();
    assert!(model.execute_slash_command_line("/handoff status"));
    assert_eq!(
        model.modal.top(),
        Some(crate::state::modal::ModalKind::ThreadHandoff)
    );
    assert_eq!(model.status_line, "Viewing thread handoff");
    assert!(daemon_rx.try_recv().is_err());
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 4: Modal tests (RED until modal slice is implemented)
// ─────────────────────────────────────────────────────────────────────────────
