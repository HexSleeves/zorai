use super::{GoalMissionControlHitTarget, OPEN_ACTIVE_THREAD_LABEL};
use crate::state::goal_mission_control::GoalMissionControlSection;
use crate::theme::ThemeTokens;
use ratatui::prelude::*;
use ratatui::style::Modifier;
use ratatui::text::Span;
use ratatui::widgets::{Block, BorderType, Borders};

const MAIN_SAVE_DEFAULT_LINE: u16 = 4;
const ROLE_HEADER_LINES: u16 = 2;
const ROLE_ROW_HEIGHT: u16 = 2;
const ROLE_MARKER_WIDTH: u16 = 2;
const REMOVE_CONTROL_WIDTH: u16 = 3;

pub(super) fn hit_test(
    area: Rect,
    mouse: Position,
    can_open_active_thread: bool,
    assignment_count: usize,
    runtime_mode: bool,
) -> Option<GoalMissionControlHitTarget> {
    if area.width == 0
        || area.height == 0
        || mouse.x < area.x
        || mouse.x >= area.x.saturating_add(area.width)
        || mouse.y < area.y
        || mouse.y >= area.y.saturating_add(area.height)
    {
        return None;
    }

    let sections = preflight_section_areas(area)?;
    if can_open_active_thread {
        if let Some(button) = open_active_thread_button_area(sections[3]) {
            if point_in_rect(button, mouse) {
                return Some(GoalMissionControlHitTarget::OpenActiveThread);
            }
        }
    }

    if !runtime_mode {
        if let Some(save_area) = save_as_default_area(area) {
            if point_in_rect(save_area, mouse) {
                return Some(GoalMissionControlHitTarget::SaveAsDefault);
            }
        }
    }

    if let Some(target) = role_assignment_hit(area, mouse, assignment_count, runtime_mode) {
        return Some(target);
    }

    let section = if point_in_rect(sections[0], mouse) {
        GoalMissionControlSection::Prompt
    } else if point_in_rect(sections[1], mouse) {
        GoalMissionControlSection::MainAgent
    } else if point_in_rect(sections[2], mouse) {
        GoalMissionControlSection::RoleAssignments
    } else if point_in_rect(sections[3], mouse) {
        GoalMissionControlSection::ThreadRouter
    } else {
        return None;
    };
    Some(GoalMissionControlHitTarget::Section(section))
}

pub(super) fn save_as_default_area(area: Rect) -> Option<Rect> {
    let sections = preflight_section_areas(area)?;
    let inner = section_inner(sections[1]);
    if inner.height <= MAIN_SAVE_DEFAULT_LINE {
        return None;
    }
    Some(Rect::new(
        inner.x,
        inner.y.saturating_add(MAIN_SAVE_DEFAULT_LINE),
        inner.width,
        1,
    ))
}

fn role_assignment_hit(
    area: Rect,
    mouse: Position,
    assignment_count: usize,
    runtime_mode: bool,
) -> Option<GoalMissionControlHitTarget> {
    if assignment_count == 0 {
        return None;
    }
    let sections = preflight_section_areas(area)?;
    let inner = section_inner(sections[2]);
    if !point_in_rect(inner, mouse) {
        return None;
    }
    let body_y = inner.y.saturating_add(ROLE_HEADER_LINES);
    if mouse.y < body_y {
        return None;
    }
    let rel = mouse.y.saturating_sub(body_y);
    let row = (rel / ROLE_ROW_HEIGHT) as usize;
    if row >= assignment_count {
        return None;
    }
    let on_first_line = rel % ROLE_ROW_HEIGHT == 0;
    if on_first_line && !runtime_mode && assignment_count > 1 {
        if let Some(remove_area) = remove_assignment_area(area, row) {
            if point_in_rect(remove_area, mouse) {
                return Some(GoalMissionControlHitTarget::RemoveAssignment(row));
            }
        }
    }
    Some(GoalMissionControlHitTarget::AssignmentRow(row))
}

pub(super) fn remove_assignment_area(area: Rect, row: usize) -> Option<Rect> {
    let sections = preflight_section_areas(area)?;
    let inner = section_inner(sections[2]);
    let y = inner
        .y
        .saturating_add(ROLE_HEADER_LINES)
        .saturating_add((row as u16).saturating_mul(ROLE_ROW_HEIGHT));
    if y >= inner.y.saturating_add(inner.height) {
        return None;
    }
    Some(Rect::new(
        inner.x.saturating_add(ROLE_MARKER_WIDTH),
        y,
        REMOVE_CONTROL_WIDTH.min(inner.width.saturating_sub(ROLE_MARKER_WIDTH)),
        1,
    ))
}

fn section_inner(area: Rect) -> Rect {
    Block::default().borders(Borders::ALL).inner(area)
}

pub(super) fn preflight_section_areas(area: Rect) -> Option<[Rect; 5]> {
    if area.width == 0 || area.height == 0 {
        return None;
    }
    let inner = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Double)
        .inner(area);
    let sections = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(5),
            Constraint::Length(8),
            Constraint::Min(7),
            Constraint::Length(3),
            Constraint::Length(2),
        ])
        .split(inner);
    Some([
        sections.first().copied()?,
        sections.get(1).copied()?,
        sections.get(2).copied()?,
        sections.get(3).copied()?,
        sections.get(4).copied()?,
    ])
}

pub(super) fn thread_router_area(area: Rect) -> Option<Rect> {
    preflight_section_areas(area).map(|sections| sections[3])
}

pub(super) fn section_border_style(theme: &ThemeTokens, focused: bool) -> Style {
    if focused {
        theme.accent_primary
    } else {
        theme.fg_dim
    }
}

pub(super) fn field_value_span<'a>(
    value: impl Into<String>,
    selected: bool,
    theme: &ThemeTokens,
) -> Span<'a> {
    let value = value.into();
    if selected {
        Span::styled(
            format!("[{value}]"),
            theme.accent_primary.add_modifier(Modifier::BOLD),
        )
    } else {
        Span::styled(value, theme.fg_active)
    }
}

pub(super) fn open_active_thread_button_area(area: Rect) -> Option<Rect> {
    let inner = Block::default().borders(Borders::ALL).inner(area);
    button_area(inner, OPEN_ACTIVE_THREAD_LABEL)
}

pub(super) fn button_area(inner: Rect, label: &str) -> Option<Rect> {
    if inner.width == 0 || inner.height == 0 {
        return None;
    }

    Some(Rect::new(
        inner.x,
        inner.y,
        label.chars().count().min(inner.width as usize) as u16,
        1,
    ))
}

fn point_in_rect(rect: Rect, point: Position) -> bool {
    point.x >= rect.x
        && point.x < rect.x.saturating_add(rect.width)
        && point.y >= rect.y
        && point.y < rect.y.saturating_add(rect.height)
}
