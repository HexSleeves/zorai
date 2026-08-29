use super::super::*;
use crate::state::goal_workspace::{GoalWorkspaceMode, GoalWorkspaceState};
use crate::state::task::{
    GoalRun, GoalRunEvent, GoalRunStep, TaskAction, TaskState, ThreadWorkContext, TodoItem,
    TodoStatus, WorkContextEntry,
};
use crate::test_support::{env_var_lock, EnvVarGuard, ZORAI_DATA_DIR_ENV};
use crate::theme::ThemeTokens;
use ratatui::backend::TestBackend;
use ratatui::Terminal;

pub(super) fn sample_tasks() -> TaskState {
    let mut tasks = TaskState::new();
    tasks.reduce(TaskAction::GoalRunDetailReceived(GoalRun {
        id: "goal-1".into(),
        title: "Goal".into(),
        goal: "Research the ecosystem and produce a concrete learning plan.".into(),
        thread_id: Some("thread-1".into()),
        status: Some(crate::state::task::GoalRunStatus::Running),
        steps: vec![
            GoalRunStep {
                id: "step-2".into(),
                title: "Ship".into(),
                order: 1,
                ..Default::default()
            },
            GoalRunStep {
                id: "step-1".into(),
                title: "Plan".into(),
                order: 0,
                instructions: "Interview the user before drafting the plan.".into(),
                summary: Some("Capture constraints before outlining tasks.".into()),
                ..Default::default()
            },
        ],
        events: vec![GoalRunEvent {
            id: "event-1".into(),
            timestamp: 10,
            step_index: Some(0),
            message: "goal todo updated with a much longer explanation that should wrap onto another visual line in the timeline pane".into(),
            todo_snapshot: vec![
                TodoItem {
                    id: "todo-1".into(),
                    content: "Draft outline".into(),
                    status: Some(TodoStatus::InProgress),
                    step_index: Some(0),
                    position: 0,
                    ..Default::default()
                },
                TodoItem {
                    id: "todo-2".into(),
                    content: "Verify sources".into(),
                    status: Some(TodoStatus::Pending),
                    step_index: Some(0),
                    position: 1,
                    ..Default::default()
                },
            ],
            ..Default::default()
        }],
        dossier: Some(crate::state::task::GoalRunDossier {
            summary: Some("Checkpoint-backed execution dossier".into()),
            projection_state: "in_progress".into(),
            ..Default::default()
        }),
        ..Default::default()
    }));
    tasks.reduce(TaskAction::GoalRunCheckpointsReceived {
        goal_run_id: "goal-1".into(),
        checkpoints: vec![crate::state::task::GoalRunCheckpointSummary {
            id: "checkpoint-1".into(),
            checkpoint_type: "pre_step".into(),
            step_index: Some(0),
            context_summary_preview: Some("Checkpoint for Plan".into()),
            ..Default::default()
        }],
    });
    tasks.reduce(TaskAction::WorkContextReceived(ThreadWorkContext {
        thread_id: "thread-1".into(),
        entries: vec![WorkContextEntry {
            path: "/tmp/plan.md".into(),
            goal_run_id: Some("goal-1".into()),
            step_index: Some(0),
            ..Default::default()
        }],
    }));
    tasks
}

pub(super) fn render_plain_text(state: &GoalWorkspaceState, tick_counter: u64) -> String {
    render_plain_text_for_tasks(&sample_tasks(), state, tick_counter)
}

pub(super) fn render_plain_text_for_tasks(
    tasks: &TaskState,
    state: &GoalWorkspaceState,
    tick_counter: u64,
) -> String {
    let area = Rect::new(0, 0, 100, 28);
    let backend = TestBackend::new(area.width, area.height);
    let mut terminal = Terminal::new(backend).expect("terminal should initialize");

    terminal
        .draw(|frame| {
            render(
                frame,
                area,
                tasks,
                "goal-1",
                state,
                &ThemeTokens::default(),
                tick_counter,
            );
        })
        .expect("goal workspace render should succeed");

    let buffer = terminal.backend().buffer();
    (area.y..area.y.saturating_add(area.height))
        .map(|y| {
            (area.x..area.x.saturating_add(area.width))
                .filter_map(|x| buffer.cell((x, y)).map(|cell| cell.symbol()))
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub(super) fn render_buffer_for_tasks(
    tasks: &TaskState,
    state: &GoalWorkspaceState,
    tick_counter: u64,
) -> (Rect, ratatui::buffer::Buffer) {
    let area = Rect::new(0, 0, 100, 28);
    let backend = TestBackend::new(area.width, area.height);
    let mut terminal = Terminal::new(backend).expect("terminal should initialize");

    terminal
        .draw(|frame| {
            render(
                frame,
                area,
                tasks,
                "goal-1",
                state,
                &ThemeTokens::default(),
                tick_counter,
            );
        })
        .expect("goal workspace render should succeed");

    let buffer = terminal.backend().buffer().clone();
    (area, buffer)
}

#[test]
fn goal_workspace_renders_plan_timeline_and_details_panes() {
    let state = GoalWorkspaceState::new();

    let plain = render_plain_text(&state, 0);

    assert!(plain.contains("Work"), "{plain}");
    assert!(plain.contains("Review"), "{plain}");
    assert!(plain.contains("Activity"), "{plain}");
    assert!(plain.contains("Threads"), "{plain}");
    assert!(plain.contains("Files"), "{plain}");
    assert!(plain.contains("[Actions]"), "{plain}");
}

#[test]
fn goal_workspace_dossier_mode_renders_prompt_without_embedded_files_list() {
    let state = GoalWorkspaceState::new();

    let plain = render_plain_text(&state, 0);

    assert!(plain.contains("Goal Prompt"), "{plain}");
    assert!(plain.contains("[Show]"), "{plain}");
    assert!(!plain.contains("Research the ecosystem"), "{plain}");
    assert!(plain.contains("Worker"), "{plain}");
    assert!(!plain.contains("/tmp/plan.md"), "{plain}");
}

#[test]
fn goal_workspace_renders_steps_and_nested_todos_for_expanded_step() {
    let mut state = GoalWorkspaceState::new();
    state.set_prompt_expanded(true);

    let plain = render_plain_text(&state, 0);

    assert!(plain.contains("Research the ecosystem"), "{plain}");
    assert!(plain.contains("Draft outline"), "{plain}");
    assert!(plain.contains("Verify sources"), "{plain}");
}

#[test]
fn goal_workspace_progress_mode_renders_progress_panel_copy() {
    let mut state = GoalWorkspaceState::new();
    state.set_mode(GoalWorkspaceMode::Work);

    let plain = render_plain_text(&state, 0);

    assert!(plain.contains("Worker progress"), "{plain}");
    assert!(plain.contains("Draft outline"), "{plain}");
    assert!(plain.contains("Verify sources"), "{plain}");
}

#[test]
fn goal_workspace_usage_mode_renders_model_and_agent_usage() {
    let mut tasks = sample_tasks();
    if let Some(run) = tasks.goal_run_by_id_mut("goal-1") {
        run.status = Some(crate::state::task::GoalRunStatus::AwaitingReview);
        run.pending_review_report = Some("Ship the learning plan after source checks.".into());
    }
    let mut state = GoalWorkspaceState::new();
    state.set_mode(GoalWorkspaceMode::Review);

    let plain = render_plain_text_for_tasks(&tasks, &state, 0);

    assert!(plain.contains("Supervisor review"), "{plain}");
    assert!(plain.contains("Ship the learning plan"), "{plain}");
    assert!(plain.contains("[Accept]"), "{plain}");
    assert!(plain.contains("[Soft reject]"), "{plain}");
    assert!(plain.contains("[Hard reject]"), "{plain}");
}

#[test]
fn goal_workspace_selected_step_dossier_uses_unit_projection_state() {
    let mut tasks = TaskState::new();
    tasks.reduce(TaskAction::GoalRunDetailReceived(GoalRun {
        id: "goal-1".into(),
        title: "Goal".into(),
        goal: "Verify completed step status.".into(),
        status: Some(crate::state::task::GoalRunStatus::AwaitingReview),
        pending_review_report: Some("Rebuild matrix finished and is ready for accept.".into()),
        ..Default::default()
    }));

    let mut state = GoalWorkspaceState::new();
    state.set_mode(GoalWorkspaceMode::Review);
    let plain = render_plain_text_for_tasks(&tasks, &state, 0);

    assert!(plain.contains("Rebuild matrix finished"), "{plain}");
    assert!(plain.contains("[report]"), "{plain}");
}

#[test]
fn goal_workspace_files_mode_lists_projection_root_and_nested_inventory_files() {
    let _lock = env_var_lock();
    let temp_home = tempfile::tempdir().expect("temp home should exist");
    let _data_dir = EnvVarGuard::set(ZORAI_DATA_DIR_ENV, temp_home.path());

    let goal_root = zorai_protocol::ensure_zorai_data_dir()
        .expect("zorai data dir")
        .join("goals")
        .join("goal-1");
    std::fs::create_dir_all(goal_root.join("inventory/execution"))
        .expect("goal inventory tree should exist");
    std::fs::write(goal_root.join("goal.md"), "# Goal\n").expect("goal.md should be written");
    std::fs::write(goal_root.join("dossier.json"), "{}").expect("dossier.json should be written");
    std::fs::write(
        goal_root.join("inventory/execution/step-1-complete.md"),
        "done\n",
    )
    .expect("nested inventory file should be written");

    let mut state = GoalWorkspaceState::new();
    state.set_mode(GoalWorkspaceMode::Files);

    let plain = render_plain_text(&state, 0);

    assert!(plain.contains("Files"), "{plain}");
    assert!(plain.contains("goal.md"), "{plain}");
    assert!(plain.contains("dossier.json"), "{plain}");
    assert!(plain.contains("step-1-complete.md"), "{plain}");
}

#[test]
fn goal_workspace_threads_mode_renders_thread_inventory() {
    let mut state = GoalWorkspaceState::new();
    state.set_mode(GoalWorkspaceMode::Threads);

    let plain = render_plain_text(&state, 0);

    assert!(plain.contains("Threads"), "{plain}");
    assert!(plain.contains("Worker"), "{plain}");
    assert!(plain.contains("thread-1"), "{plain}");
}

#[test]
fn goal_workspace_thread_views_include_goal_scoped_live_todo_thread() {
    let mut tasks = TaskState::new();
    tasks.reduce(TaskAction::GoalRunDetailReceived(GoalRun {
        id: "goal-1".into(),
        title: "Goal".into(),
        goal: "Track the live worker thread.".into(),
        status: Some(crate::state::task::GoalRunStatus::Running),
        steps: vec![GoalRunStep {
            id: "step-1".into(),
            title: "Plan".into(),
            order: 0,
            ..Default::default()
        }],
        ..Default::default()
    }));
    tasks.reduce(TaskAction::ThreadTodosReceived {
        thread_id: "thread-live".into(),
        goal_run_id: Some("goal-1".into()),
        step_index: Some(0),
        items: vec![TodoItem {
            id: "todo-live".into(),
            content: "live worker todo".into(),
            status: Some(TodoStatus::InProgress),
            step_index: Some(0),
            ..Default::default()
        }],
    });

    let mut state = GoalWorkspaceState::new();
    state.set_mode(GoalWorkspaceMode::Threads);
    let plain = render_plain_text_for_tasks(&tasks, &state, 0);
    assert!(!plain.contains("Live goal thread"), "{plain}");
    assert!(!plain.contains("thread-live"), "{plain}");

    state.set_mode(GoalWorkspaceMode::Work);
    let plain = render_plain_text_for_tasks(&tasks, &state, 0);
    assert!(plain.contains("live worker todo"), "{plain}");
}

#[test]
fn goal_workspace_plan_falls_back_to_goal_task_thread_when_run_thread_ids_are_missing() {
    let mut tasks = TaskState::new();
    tasks.reduce(TaskAction::TaskListReceived(vec![
        crate::state::task::AgentTask {
            id: "task-1".into(),
            title: "Worker Task".into(),
            thread_id: Some("thread-worker".into()),
            goal_run_id: Some("goal-1".into()),
            status: Some(crate::state::task::TaskStatus::InProgress),
            ..Default::default()
        },
    ]));
    tasks.reduce(TaskAction::GoalRunDetailReceived(GoalRun {
        id: "goal-1".into(),
        title: "Goal".into(),
        goal: "Investigate fallback thread discovery.".into(),
        status: Some(crate::state::task::GoalRunStatus::Running),
        steps: vec![GoalRunStep {
            id: "step-1".into(),
            title: "Plan".into(),
            order: 0,
            ..Default::default()
        }],
        ..Default::default()
    }));

    let plain = render_plain_text_for_tasks(&tasks, &GoalWorkspaceState::new(), 0);

    assert!(plain.contains("Worker"), "{plain}");
    assert!(plain.contains("thread-worker"), "{plain}");
}
