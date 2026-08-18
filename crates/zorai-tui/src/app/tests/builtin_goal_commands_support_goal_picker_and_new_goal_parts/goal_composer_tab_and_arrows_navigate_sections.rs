use super::super::build_model;
use super::*;
use crate::state::goal_mission_control::{GoalMissionControlField, GoalMissionControlSection};

fn snapshot_assignments() -> Vec<task::GoalAgentAssignment> {
    vec![
        task::GoalAgentAssignment {
            role_id: zorai_protocol::AGENT_ID_SWAROG.to_string(),
            enabled: true,
            provider: "openai".to_string(),
            model: "gpt-5.4".to_string(),
            reasoning_effort: Some("low".to_string()),
            inherit_from_main: false,
        },
        task::GoalAgentAssignment {
            role_id: "planner".to_string(),
            enabled: true,
            provider: "openai".to_string(),
            model: "gpt-5.4-mini".to_string(),
            reasoning_effort: Some("medium".to_string()),
            inherit_from_main: false,
        },
    ]
}

fn open_two_agent_composer() -> TuiModel {
    let mut model = build_model();
    model
        .tasks
        .reduce(task::TaskAction::GoalRunDetailReceived(task::GoalRun {
            id: "goal-1".to_string(),
            title: "Previous Goal".to_string(),
            updated_at: 42,
            launch_assignment_snapshot: snapshot_assignments(),
            ..Default::default()
        }));
    model.open_new_goal_view();
    model
}

#[test]
fn goal_composer_tab_cycles_prompt_main_agent_and_roster() {
    let mut model = open_two_agent_composer();

    assert_eq!(model.focus, FocusArea::Input);
    assert_eq!(
        model.goal_mission_control.focused_section,
        GoalMissionControlSection::Prompt
    );

    let handled = model.handle_key(KeyCode::Tab, KeyModifiers::NONE);
    assert!(!handled);
    assert_eq!(model.focus, FocusArea::Chat);
    assert_eq!(
        model.goal_mission_control.focused_section,
        GoalMissionControlSection::MainAgent
    );

    let handled = model.handle_key(KeyCode::Tab, KeyModifiers::NONE);
    assert!(!handled);
    assert_eq!(
        model.goal_mission_control.focused_section,
        GoalMissionControlSection::RoleAssignments
    );

    let handled = model.handle_key(KeyCode::Tab, KeyModifiers::NONE);
    assert!(!handled);
    assert_eq!(model.focus, FocusArea::Input);
    assert_eq!(
        model.goal_mission_control.focused_section,
        GoalMissionControlSection::Prompt
    );

    let handled = model.handle_key(KeyCode::BackTab, KeyModifiers::NONE);
    assert!(!handled);
    assert_eq!(model.focus, FocusArea::Chat);
    assert_eq!(
        model.goal_mission_control.focused_section,
        GoalMissionControlSection::RoleAssignments
    );
}

#[test]
fn goal_composer_down_from_empty_prompt_moves_to_main_agent() {
    let mut model = open_two_agent_composer();

    let handled = model.handle_key(KeyCode::Down, KeyModifiers::NONE);
    assert!(!handled);
    assert_eq!(model.focus, FocusArea::Chat);
    assert_eq!(
        model.goal_mission_control.focused_section,
        GoalMissionControlSection::MainAgent
    );
}

#[test]
fn goal_composer_arrows_cycle_main_agent_fields_and_enter_opens_picker() {
    let mut model = open_two_agent_composer();
    model.handle_key(KeyCode::Tab, KeyModifiers::NONE);

    assert_eq!(
        model.goal_mission_control.selected_field,
        GoalMissionControlField::Provider
    );

    let handled = model.handle_key(KeyCode::Right, KeyModifiers::NONE);
    assert!(!handled);
    assert_eq!(
        model.goal_mission_control.selected_field,
        GoalMissionControlField::Model
    );

    let handled = model.handle_key(KeyCode::Enter, KeyModifiers::NONE);
    assert!(!handled);
    assert_eq!(model.modal.top(), Some(modal::ModalKind::ModelPicker));
}

#[test]
fn goal_composer_roster_arrows_select_rows_and_fields() {
    let mut model = open_two_agent_composer();
    model.handle_key(KeyCode::Tab, KeyModifiers::NONE);
    model.handle_key(KeyCode::Tab, KeyModifiers::NONE);

    assert_eq!(
        model.goal_mission_control.focused_section,
        GoalMissionControlSection::RoleAssignments
    );
    assert_eq!(
        model.goal_mission_control.selected_runtime_assignment_index,
        0
    );

    let handled = model.handle_key(KeyCode::Down, KeyModifiers::NONE);
    assert!(!handled);
    assert_eq!(
        model.goal_mission_control.selected_runtime_assignment_index,
        1
    );

    let handled = model.handle_key(KeyCode::Right, KeyModifiers::NONE);
    assert!(!handled);
    assert_eq!(
        model.goal_mission_control.selected_field,
        GoalMissionControlField::Model
    );

    let handled = model.handle_key(KeyCode::Enter, KeyModifiers::NONE);
    assert!(!handled);
    assert_eq!(model.modal.top(), Some(modal::ModalKind::ModelPicker));
}

#[test]
fn goal_composer_save_as_default_toggles_on_and_off_instead_of_staying_pending() {
    let mut model = open_two_agent_composer();
    model.handle_key(KeyCode::Tab, KeyModifiers::NONE);

    let handled = model.handle_key(KeyCode::Char('s'), KeyModifiers::NONE);
    assert!(!handled);
    assert!(model.goal_mission_control.save_as_default_pending);
    assert_eq!(
        model
            .goal_composer_saved_defaults
            .as_ref()
            .map(|assignments| assignments.len()),
        Some(2)
    );
    assert!(
        !model.status_line.to_ascii_lowercase().contains("pending"),
        "save-as-default status should not stay pending: {}",
        model.status_line
    );

    let handled = model.handle_key(KeyCode::Char('s'), KeyModifiers::NONE);
    assert!(!handled);
    assert!(!model.goal_mission_control.save_as_default_pending);
    assert!(model.goal_composer_saved_defaults.is_none());
}

#[test]
fn goal_composer_saved_default_is_reused_on_next_new_goal() {
    let mut model = open_two_agent_composer();
    model.handle_key(KeyCode::Tab, KeyModifiers::NONE);
    model.handle_key(KeyCode::Char('a'), KeyModifiers::NONE);
    model.handle_key(KeyCode::Char('s'), KeyModifiers::NONE);

    assert_eq!(model.goal_mission_control.role_assignments.len(), 3);
    assert!(model.goal_mission_control.save_as_default_pending);

    model.open_new_goal_view();

    assert_eq!(
        model.goal_mission_control.preset_source_label,
        "Saved default"
    );
    assert!(model.goal_mission_control.save_as_default_pending);
    assert_eq!(model.goal_mission_control.role_assignments.len(), 3);
}

#[test]
fn goal_composer_x_removes_added_agent_and_keeps_the_last_one() {
    let mut model = open_two_agent_composer();
    model.handle_key(KeyCode::Tab, KeyModifiers::NONE);
    model.handle_key(KeyCode::Char('a'), KeyModifiers::NONE);
    assert_eq!(model.goal_mission_control.role_assignments.len(), 3);

    let handled = model.handle_key(KeyCode::Char('x'), KeyModifiers::NONE);
    assert!(!handled);
    assert_eq!(model.goal_mission_control.role_assignments.len(), 2);

    model.handle_key(KeyCode::Char('x'), KeyModifiers::NONE);
    assert_eq!(model.goal_mission_control.role_assignments.len(), 1);
    model.handle_key(KeyCode::Char('x'), KeyModifiers::NONE);
    assert_eq!(model.goal_mission_control.role_assignments.len(), 1);
    assert!(
        model.status_line.contains("at least one agent"),
        "removing the last agent should explain why it stayed: {}",
        model.status_line
    );
}
