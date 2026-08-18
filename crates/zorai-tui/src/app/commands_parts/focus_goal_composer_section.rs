use super::*;
use crate::state::goal_mission_control::{GoalMissionControlField, GoalMissionControlSection};

impl TuiModel {
    pub(crate) fn apply_goal_composer_section_focus(&mut self) {
        match self.goal_mission_control.focused_section {
            GoalMissionControlSection::Prompt => self.focus = FocusArea::Input,
            _ => self.focus = FocusArea::Chat,
        }
        self.input.set_mode(input::InputMode::Insert);
        self.status_line = self.goal_composer_section_status();
    }

    pub(crate) fn focus_next_goal_composer_section(&mut self) -> bool {
        if !matches!(self.main_pane_view, MainPaneView::GoalComposer) {
            return false;
        }
        let include_thread = self.mission_control_has_thread_target();
        self.goal_mission_control.focus_next_section(include_thread);
        self.apply_goal_composer_section_focus();
        true
    }

    pub(crate) fn focus_prev_goal_composer_section(&mut self) -> bool {
        if !matches!(self.main_pane_view, MainPaneView::GoalComposer) {
            return false;
        }
        let include_thread = self.mission_control_has_thread_target();
        self.goal_mission_control.focus_prev_section(include_thread);
        self.apply_goal_composer_section_focus();
        true
    }

    pub(crate) fn step_goal_composer_vertical(&mut self, delta: i32) -> bool {
        if !matches!(self.main_pane_view, MainPaneView::GoalComposer) {
            return false;
        }
        match self.goal_mission_control.focused_section {
            GoalMissionControlSection::Prompt => false,
            GoalMissionControlSection::MainAgent | GoalMissionControlSection::ThreadRouter => {
                self.cycle_goal_composer_field(delta)
            }
            GoalMissionControlSection::RoleAssignments => {
                self.cycle_goal_composer_assignment(delta)
            }
        }
    }

    pub(crate) fn step_goal_composer_horizontal(&mut self, delta: i32) -> bool {
        if !matches!(self.main_pane_view, MainPaneView::GoalComposer)
            || self.focus != FocusArea::Chat
        {
            return false;
        }
        match self.goal_mission_control.focused_section {
            GoalMissionControlSection::Prompt | GoalMissionControlSection::ThreadRouter => false,
            GoalMissionControlSection::MainAgent | GoalMissionControlSection::RoleAssignments => {
                self.cycle_goal_composer_field(delta)
            }
        }
    }

    pub(crate) fn handle_goal_composer_input_vertical(&mut self, delta: i32) -> bool {
        if !matches!(self.main_pane_view, MainPaneView::GoalComposer)
            || self.focus != FocusArea::Input
        {
            return false;
        }
        let before = self.input.cursor_pos();
        let wrap_w = self.input_wrap_width();
        if delta < 0 {
            self.input
                .reduce(input::InputAction::MoveCursorUpVisual(wrap_w));
        } else {
            self.input
                .reduce(input::InputAction::MoveCursorDownVisual(wrap_w));
        }
        if self.input.cursor_pos() != before {
            return true;
        }
        if delta < 0 {
            self.focus_prev_goal_composer_section()
        } else {
            self.focus_next_goal_composer_section()
        }
    }

    pub(crate) fn activate_goal_composer_selection(&mut self) -> bool {
        if !matches!(self.main_pane_view, MainPaneView::GoalComposer)
            || self.focus != FocusArea::Chat
        {
            return false;
        }
        match self.goal_mission_control.focused_section {
            GoalMissionControlSection::Prompt => false,
            GoalMissionControlSection::ThreadRouter => {
                if self.mission_control_has_thread_target() {
                    self.open_mission_control_goal_thread()
                } else {
                    self.status_line =
                        "Mission Control has no source goal thread to open".to_string();
                    true
                }
            }
            GoalMissionControlSection::MainAgent | GoalMissionControlSection::RoleAssignments => {
                self.activate_goal_composer_field()
            }
        }
    }

    fn cycle_goal_composer_assignment(&mut self, delta: i32) -> bool {
        if self
            .goal_mission_control
            .cycle_selected_runtime_assignment(delta)
        {
            let role_label = self
                .goal_mission_control
                .selected_runtime_row_label()
                .unwrap_or("assignment");
            self.status_line = format!("Mission Control selected {role_label}");
            true
        } else {
            false
        }
    }

    fn cycle_goal_composer_field(&mut self, delta: i32) -> bool {
        if !self.goal_mission_control.cycle_selected_field(delta) {
            return false;
        }
        self.status_line = self.goal_composer_section_status();
        true
    }

    fn activate_goal_composer_field(&mut self) -> bool {
        if self.goal_mission_control.focused_section == GoalMissionControlSection::MainAgent {
            self.goal_mission_control.select_main_assignment_row();
        }
        match self.goal_mission_control.selected_field {
            GoalMissionControlField::SaveAsDefault => self.toggle_goal_composer_save_as_default(),
            field => {
                let Some(edit_field) = field.to_runtime_edit_field() else {
                    return false;
                };
                if !self.stage_mission_control_assignment_modal_edit(edit_field) {
                    self.status_line = "Mission Control roster is unavailable".to_string();
                    return true;
                }
                true
            }
        }
    }

    fn goal_composer_section_status(&self) -> String {
        match self.goal_mission_control.focused_section {
            GoalMissionControlSection::Prompt => {
                "Mission Control prompt — type the goal, Tab for next section".to_string()
            }
            GoalMissionControlSection::MainAgent => {
                "Mission Control main agent — arrows select fields, Enter edits".to_string()
            }
            GoalMissionControlSection::RoleAssignments => {
                "Mission Control roster — ↑↓ agents, ←→ fields, Enter edits".to_string()
            }
            GoalMissionControlSection::ThreadRouter => {
                "Mission Control thread router — Enter opens the active thread".to_string()
            }
        }
    }
}
