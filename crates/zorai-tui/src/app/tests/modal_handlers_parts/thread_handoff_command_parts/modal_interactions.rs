use super::*;

use crossterm::event::KeyCode;

#[test]
fn thread_handoff_modal_actions_excludes_current_responder_and_disabled_agents() {
    let (mut model, _daemon_rx) = make_model();
    seed_thread_with_state(&mut model, 2);

    model.open_thread_handoff_modal();
    let actions = model.thread_handoff_modal_actions();

    // Current responder (weles) must be absent
    assert!(
        !actions.iter().any(|a| match a {
            ThreadHandoffModalAction::Push { agent_id, .. } => agent_id == "weles",
            ThreadHandoffModalAction::Return => false,
        }),
        "current responder 'weles' must not appear as a push target"
    );
    // Svarog and Rarog built-ins must be present as push targets
    assert!(
        actions.iter().any(|a| match a {
            ThreadHandoffModalAction::Push { agent_id, .. } => agent_id == "swarog",
            ThreadHandoffModalAction::Return => false,
        }),
        "swarog must appear as a push target"
    );
}

#[test]
fn thread_handoff_modal_open_rejects_missing_active_thread() {
    let (mut model, _daemon_rx) = make_model();
    model.open_thread_handoff_modal();
    assert_eq!(model.status_line, "Start or load thread first");
    assert!(model.modal.top().is_none());
}

#[test]
fn thread_handoff_modal_actions_include_enabled_configured_and_canonical_dedupe() {
    let (mut model, _daemon_rx) = make_model();
    seed_thread_with_state(&mut model, 2);
    model.subagents.entries.extend([
        configured_handoff_agent("SWAROZYC_BUILTIN", "Duplicate Swarozyc", true),
        configured_handoff_agent("custom-agent", "", true),
        configured_handoff_agent("disabled-agent", "Disabled", false),
    ]);

    let actions = model.thread_handoff_modal_actions();
    assert_eq!(actions.first(), Some(&ThreadHandoffModalAction::Return));
    let targets: Vec<_> = actions
        .iter()
        .filter_map(|action| match action {
            ThreadHandoffModalAction::Push {
                agent_id,
                agent_name,
            } => Some((agent_id.as_str(), agent_name.as_str())),
            ThreadHandoffModalAction::Return => None,
        })
        .collect();
    assert!(targets.contains(&("custom-agent", "custom-agent")));
    assert!(!targets.iter().any(|(id, _)| *id == "disabled-agent"));
    assert_eq!(
        targets
            .iter()
            .filter(|(id, _)| id.eq_ignore_ascii_case("swarozyc"))
            .count(),
        1
    );
}

#[test]
fn thread_handoff_modal_actions_return_only_when_stack_depth_greater_than_one() {
    let (mut model, _daemon_rx) = make_model();

    // Stack depth 1 → no Return
    seed_thread_with_state(&mut model, 1);
    model.open_thread_handoff_modal();
    let actions_depth1 = model.thread_handoff_modal_actions();
    assert!(
        !actions_depth1
            .iter()
            .any(|a| matches!(a, ThreadHandoffModalAction::Return)),
        "Return must not appear when stack depth is 1"
    );

    // Stack depth 2 → Return is first
    seed_thread_with_state(&mut model, 2);
    model.open_thread_handoff_modal();
    let actions_depth2 = model.thread_handoff_modal_actions();
    assert!(
        matches!(
            actions_depth2.first(),
            Some(ThreadHandoffModalAction::Return)
        ),
        "Return must be the first action when stack depth > 1"
    );
}

#[test]
fn thread_handoff_modal_body_contains_thread_and_stack_info() {
    let (mut model, _daemon_rx) = make_model();
    seed_thread_with_state(&mut model, 2);
    model.open_thread_handoff_modal();

    let body = model.thread_handoff_modal_body();
    assert!(body.contains("Thread: Test thread"));
    assert!(body.contains("Active responder: Weles"));
    assert!(body.contains("Responder stack (2)"));
    assert!(body.contains("Svarog (swarog)"));
    assert!(body.contains("Weles (weles) [active]"));
}

#[test]
fn thread_handoff_modal_body_fallback_when_no_handoff_state() {
    let (mut model, _daemon_rx) = make_model();
    model
        .chat
        .reduce(chat::ChatAction::ThreadDetailReceived(chat::AgentThread {
            id: "thread-fallback".to_string(),
            title: "Legacy thread".to_string(),
            thread_handoff_state: None,
            agent_name: Some("Svarog".to_string()),
            ..Default::default()
        }));
    model.chat.reduce(chat::ChatAction::SelectThread(
        "thread-fallback".to_string(),
    ));
    model.subagents.entries.push(configured_handoff_agent(
        "svarog_builtin",
        "Configured Svarog",
        true,
    ));
    model.open_thread_handoff_modal();

    let body = model.thread_handoff_modal_body();
    assert!(body.contains("Responder stack (1)"));
    // Lines: 0=Thread:, 1=Active responder:, 2=Responder stack (1), 3=blank sep,
    // 4=first frame row, 5+=action rows, last=nav hint
    let frame_line = body
        .lines()
        .find(|l| l.contains("Svarog") && l.contains("active"))
        .expect("frame row with active marker not found in body: {body}");
    assert!(
        frame_line.contains("swarog"),
        "frame row must show 'swarog' not mangled id, got: {frame_line}"
    );
    let actions = model.thread_handoff_modal_actions();
    assert!(
        !actions.iter().any(|action| matches!(
            action,
            ThreadHandoffModalAction::Push { agent_id, .. } if agent_id == "swarog"
        )),
        "Svarog must not be offered as a target while it is the legacy current responder"
    );
    assert!(!actions
        .iter()
        .any(|action| matches!(action, ThreadHandoffModalAction::Return)));
}

#[test]
fn thread_handoff_modal_mouse_click_submits_return_row() {
    let (mut model, mut daemon_rx) = make_model();
    model.width = 100;
    model.height = 40;
    seed_thread_with_state(&mut model, 2);
    model.open_thread_handoff_modal();

    click_thread_handoff_action(&mut model, 0);

    assert!(matches!(
        daemon_rx.try_recv(),
        Ok(DaemonCommand::ThreadHandoff {
            action,
            target_agent_id: None,
            ..
        }) if action == "return_handoff"
    ));
    assert!(model.modal.top().is_none());
}

#[test]
fn thread_handoff_modal_mouse_click_submits_push_row() {
    let (mut model, mut daemon_rx) = make_model();
    model.width = 100;
    model.height = 40;
    seed_thread_with_state(&mut model, 2);
    model.open_thread_handoff_modal();
    let expected = model
        .thread_handoff_modal_actions()
        .get(1)
        .cloned()
        .expect("first push action should follow Return");
    let ThreadHandoffModalAction::Push {
        agent_id,
        agent_name,
    } = expected
    else {
        panic!("second handoff row must be a Push action");
    };

    click_thread_handoff_action(&mut model, 1);

    assert!(matches!(
        daemon_rx.try_recv(),
        Ok(DaemonCommand::ThreadHandoff {
            action,
            target_agent_id: Some(target_agent_id),
            reason,
            summary,
            ..
        }) if action == "push_handoff"
            && target_agent_id == agent_id
            && reason == format!("Operator requested handoff to {agent_name}")
            && summary == format!("Continue this thread as {agent_name}")
    ));
    assert!(model.modal.top().is_none());
}

#[test]
fn thread_handoff_modal_keyboard_esc_closes_modal() {
    let (mut model, _daemon_rx) = make_model();
    seed_thread_with_state(&mut model, 2);
    model.open_thread_handoff_modal();
    assert!(model.modal.top().is_some());

    model.handle_key(KeyCode::Esc, KeyModifiers::NONE);

    assert!(
        model.modal.top().is_none(),
        "Esc must close the ThreadHandoff modal"
    );
}

#[test]
fn thread_handoff_modal_keyboard_enter_submits_selected_action_and_closes() {
    let (mut model, mut daemon_rx) = make_model();
    seed_thread_with_state(&mut model, 2);
    model.open_thread_handoff_modal();

    // Default cursor is 0 → Return is selected
    model.handle_key(KeyCode::Enter, KeyModifiers::NONE);
    assert!(matches!(
        daemon_rx.try_recv(),
        Ok(DaemonCommand::ThreadHandoff {
            action,
            target_agent_id: None,
            ..
        }) if action == "return_handoff"
    ));
    assert!(model.modal.top().is_none());
}

#[test]
fn thread_handoff_modal_keyboard_enter_submits_selected_push_and_closes() {
    let (mut model, mut daemon_rx) = make_model();
    seed_thread_with_state(&mut model, 2);
    model.open_thread_handoff_modal();

    let expected = model
        .thread_handoff_modal_actions()
        .into_iter()
        .find_map(|action| match action {
            ThreadHandoffModalAction::Push {
                agent_id,
                agent_name,
            } => Some((agent_id, agent_name)),
            ThreadHandoffModalAction::Return => None,
        })
        .expect("modal should expose at least one push target");

    model.handle_key(KeyCode::Down, KeyModifiers::NONE);
    assert!(matches!(
        model
            .thread_handoff_modal_actions()
            .get(model.modal.picker_cursor()),
        Some(ThreadHandoffModalAction::Push { agent_id, agent_name })
            if agent_id == &expected.0 && agent_name == &expected.1
    ));

    model.handle_key(KeyCode::Enter, KeyModifiers::NONE);

    assert!(matches!(
        daemon_rx.try_recv(),
        Ok(DaemonCommand::ThreadHandoff {
            thread_id,
            action,
            target_agent_id: Some(target_agent_id),
            reason,
            summary,
        }) if thread_id == "thread-modal"
            && action == "push_handoff"
            && target_agent_id == expected.0
            && reason == format!("Operator requested handoff to {}", expected.1)
            && summary == format!("Continue this thread as {}", expected.1)
    ));
    assert!(model.modal.top().is_none());
}

#[test]
fn thread_handoff_modal_configured_builtin_suffix_submits_canonical_target_id() {
    let (mut model, mut daemon_rx) = make_model();
    seed_thread_with_state(&mut model, 2);
    model.subagents.entries.push(configured_handoff_agent(
        "custom_builtin",
        "Custom Agent",
        true,
    ));
    model.open_thread_handoff_modal();

    let target_index = model
        .thread_handoff_modal_actions()
        .iter()
        .position(|action| {
            matches!(
                action,
                ThreadHandoffModalAction::Push { agent_id, agent_name }
                    if agent_id == "custom" && agent_name == "Custom Agent"
            )
        })
        .expect("custom_builtin must be exposed with its canonical custom target ID");
    for _ in 0..target_index {
        model.handle_key(KeyCode::Down, KeyModifiers::NONE);
    }
    model.handle_key(KeyCode::Enter, KeyModifiers::NONE);

    assert!(matches!(
        daemon_rx.try_recv(),
        Ok(DaemonCommand::ThreadHandoff {
            action,
            target_agent_id: Some(target_agent_id),
            reason,
            summary,
            ..
        }) if action == "push_handoff"
            && target_agent_id == "custom"
            && reason == "Operator requested handoff to Custom Agent"
            && summary == "Continue this thread as Custom Agent"
    ));
}

#[test]
fn thread_handoff_modal_keyboard_navigation_keeps_selected_agent_visible() {
    let (mut model, _daemon_rx) = make_model();
    model.width = 100;
    model.height = 20;
    seed_thread_with_state(&mut model, 2);
    model.open_thread_handoff_modal();

    let selected_row_is_visible = |model: &TuiModel| {
        let (_, area) = model
            .current_modal_area()
            .expect("handoff modal should expose an overlay area");
        let viewport_lines = area.height.saturating_sub(3) as usize;
        let scroll = model.thread_handoff_modal_cursor_scroll();
        model
            .thread_handoff_modal_body()
            .lines()
            .skip(scroll)
            .take(viewport_lines)
            .any(|line| line.starts_with('>'))
    };

    assert!(selected_row_is_visible(&model));
    for _ in 0..8 {
        model.handle_key(KeyCode::Down, KeyModifiers::NONE);
        assert!(
            selected_row_is_visible(&model),
            "selected row left the viewport at cursor {} with scroll {}",
            model.modal.picker_cursor(),
            model.thread_handoff_modal_cursor_scroll()
        );
    }
    for _ in 0..5 {
        model.handle_key(KeyCode::Up, KeyModifiers::NONE);
        assert!(
            selected_row_is_visible(&model),
            "selected row left the viewport while navigating up at cursor {} with scroll {}",
            model.modal.picker_cursor(),
            model.thread_handoff_modal_cursor_scroll()
        );
    }
}

#[test]
fn thread_handoff_modal_keyboard_down_and_up_navigates() {
    let (mut model, _daemon_rx) = make_model();
    seed_thread_with_state(&mut model, 2);
    model.open_thread_handoff_modal();

    let initial_cursor = model.modal.picker_cursor();
    model.handle_key(KeyCode::Down, KeyModifiers::NONE);
    assert!(model.modal.picker_cursor() > initial_cursor);

    model.handle_key(KeyCode::Up, KeyModifiers::NONE);
    assert_eq!(model.modal.picker_cursor(), initial_cursor);
}

#[test]
fn thread_handoff_modal_keyboard_j_k_navigation() {
    let (mut model, _daemon_rx) = make_model();
    seed_thread_with_state(&mut model, 2);
    model.open_thread_handoff_modal();

    let initial_cursor = model.modal.picker_cursor();
    model.handle_key(KeyCode::Char('j'), KeyModifiers::NONE);
    assert!(model.modal.picker_cursor() > initial_cursor);

    model.handle_key(KeyCode::Char('k'), KeyModifiers::NONE);
    assert_eq!(model.modal.picker_cursor(), initial_cursor);
}

#[test]
fn thread_handoff_modal_sync_item_count_and_cursor_scroll() {
    let (mut model, _daemon_rx) = make_model();
    seed_thread_with_state(&mut model, 3);
    model.open_thread_handoff_modal();
    model.sync_thread_handoff_modal_item_count();

    let count = model.thread_handoff_modal_actions().len();
    assert_eq!(count, model.thread_handoff_modal_actions().len());
    assert_eq!(model.modal.picker_cursor(), 0, "cursor must start at 0");
    let _scroll = model.thread_handoff_modal_cursor_scroll();
}

#[test]
fn handoff_discoverability_is_recognized_as_builtin_command() {
    let (model, _daemon_rx) = make_model();
    assert!(model.is_builtin_command("handoff"));
}
