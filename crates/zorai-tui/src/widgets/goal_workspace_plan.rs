use crate::state::goal_workspace::GoalWorkspaceState;
use crate::state::task::TaskState;
use crate::theme::ThemeTokens;
use ratatui::style::Modifier;
use ratatui::text::{Line, Span};

use super::GoalWorkspaceHitTarget;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GoalWorkspacePlanMarkerState {
    Pending,
    Completed,
    Running,
    Error,
}

#[derive(Clone)]
pub(crate) struct GoalWorkspacePlanRow {
    pub(crate) line: Line<'static>,
    pub(crate) selection: Option<crate::state::goal_workspace::GoalPlanSelection>,
    pub(crate) target: Option<GoalWorkspaceHitTarget>,
    pub(crate) marker_state: Option<GoalWorkspacePlanMarkerState>,
    pub(crate) marker_span_index: Option<usize>,
    pub(crate) confidence: Option<super::GoalStepConfidence>,
    pub(crate) confidence_span_index: Option<usize>,
}

/// Cache key for `build_rows`. Hashes the inputs that actually affect the
/// row tree: the task-state revision (bumped on any state mutation), the
/// goal_run_id, and the GoalWorkspaceState bits that change row content
/// (prompt_expanded + expanded_step_ids). Theme is a pure styling input
/// — same theme during a session — and excluded from the key for now.
fn build_rows_cache_key(tasks: &TaskState, goal_run_id: &str, state: &GoalWorkspaceState) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    tasks.tasks_revision().hash(&mut hasher);
    goal_run_id.hash(&mut hasher);
    state.prompt_expanded().hash(&mut hasher);
    for step_id in state.expanded_step_ids_iter() {
        step_id.hash(&mut hasher);
    }
    hasher.finish()
}

thread_local! {
    static PLAN_ROWS_CACHE: std::cell::RefCell<Option<(u64, Vec<GoalWorkspacePlanRow>)>> =
        const { std::cell::RefCell::new(None) };
}

pub(crate) fn build_rows(
    tasks: &TaskState,
    goal_run_id: &str,
    state: &GoalWorkspaceState,
    theme: &ThemeTokens,
) -> Vec<GoalWorkspacePlanRow> {
    let key = build_rows_cache_key(tasks, goal_run_id, state);
    if let Some(cached) = PLAN_ROWS_CACHE.with(|cell| {
        cell.borrow()
            .as_ref()
            .filter(|(cached_key, _)| *cached_key == key)
            .map(|(_, rows)| rows.clone())
    }) {
        return cached;
    }
    let rows = build_rows_inner(tasks, goal_run_id, state, theme);
    PLAN_ROWS_CACHE.with(|cell| {
        *cell.borrow_mut() = Some((key, rows.clone()));
    });
    rows
}

fn build_rows_inner(
    tasks: &TaskState,
    goal_run_id: &str,
    state: &GoalWorkspaceState,
    theme: &ThemeTokens,
) -> Vec<GoalWorkspacePlanRow> {
    let mut rows = Vec::new();
    let run = tasks.goal_run_by_id(goal_run_id);
    let prompt_expanded = state.prompt_expanded();
    let prompt_button = if prompt_expanded { "[Hide]" } else { "[Show]" };
    let section_style = theme.accent_primary.add_modifier(Modifier::BOLD);
    rows.push(GoalWorkspacePlanRow {
        line: Line::from(vec![
            Span::styled(if prompt_expanded { "▾ " } else { "▸ " }, theme.fg_dim),
            Span::styled("Goal Prompt", section_style),
            Span::raw("  "),
            Span::styled(prompt_button, theme.fg_dim),
        ]),
        selection: Some(crate::state::goal_workspace::GoalPlanSelection::PromptToggle),
        target: Some(GoalWorkspaceHitTarget::PlanPromptToggle),
        marker_state: None,
        marker_span_index: None,
        confidence: None,
        confidence_span_index: None,
    });
    if prompt_expanded {
        let goal = run
            .map(|run| run.goal.trim())
            .filter(|goal| !goal.is_empty())
            .unwrap_or("No goal prompt available.");
        for line in wrap_plain_text(goal, 52) {
            rows.push(GoalWorkspacePlanRow {
                line: Line::from(vec![Span::raw("    "), Span::styled(line, theme.fg_dim)]),
                selection: None,
                target: None,
                marker_state: None,
                marker_span_index: None,
                confidence: None,
                confidence_span_index: None,
            });
        }
    }

    let mut listed_thread = false;
    if let Some(run) = run {
        for entry in super::goal_thread_entries(tasks, run) {
            if entry.label != "Worker" && entry.label != "Owner" {
                continue;
            }
            listed_thread = true;
            rows.push(GoalWorkspacePlanRow {
                line: Line::from(vec![
                    Span::styled("[thread] ", theme.fg_dim),
                    Span::styled(format!("{}  ", entry.label), theme.fg_active),
                    Span::styled(entry.thread_id.clone(), theme.fg_active),
                ]),
                selection: Some(
                    crate::state::goal_workspace::GoalPlanSelection::MainThread {
                        thread_id: entry.thread_id.clone(),
                    },
                ),
                target: Some(GoalWorkspaceHitTarget::PlanMainThread(entry.thread_id)),
                marker_state: None,
                marker_span_index: None,
                confidence: None,
                confidence_span_index: None,
            });
        }
    }
    if !listed_thread {
        rows.push(GoalWorkspacePlanRow {
            line: Line::from(Span::styled("No worker thread yet.", theme.fg_dim)),
            selection: None,
            target: None,
            marker_state: None,
            marker_span_index: None,
            confidence: None,
            confidence_span_index: None,
        });
    }

    rows
}

fn wrap_plain_text(text: &str, width: usize) -> Vec<String> {
    if width == 0 {
        return vec![text.to_string()];
    }
    let mut wrapped = Vec::new();
    for raw_line in text.lines() {
        let mut current = String::new();
        for word in raw_line.split_whitespace() {
            let candidate = if current.is_empty() {
                word.to_string()
            } else {
                format!("{current} {word}")
            };
            if candidate.chars().count() > width && !current.is_empty() {
                wrapped.push(current);
                current = word.to_string();
            } else {
                current = candidate;
            }
        }
        if current.is_empty() {
            wrapped.push(String::new());
        } else {
            wrapped.push(current);
        }
    }
    if wrapped.is_empty() {
        wrapped.push(String::new());
    }
    wrapped
}
