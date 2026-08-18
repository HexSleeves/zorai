use super::*;
use crate::state::goal_mission_control::{GoalMissionControlField, GoalMissionControlSection};
use crate::state::task::GoalAgentAssignment;
use crate::widgets::goal_mission_control::GoalMissionControlHitTarget;
use serde::{Deserialize, Serialize};

const GOAL_COMPOSER_DEFAULTS_FILE: &str = "goal-composer-default-assignments.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct GoalComposerSavedDefaultsFile {
    assignments: Vec<GoalAgentAssignment>,
}

impl TuiModel {
    pub(crate) fn load_goal_composer_saved_defaults() -> Option<Vec<GoalAgentAssignment>> {
        if cfg!(test) {
            return None;
        }
        let path = goal_composer_defaults_path()?;
        let bytes = std::fs::read(path).ok()?;
        let parsed: GoalComposerSavedDefaultsFile = serde_json::from_slice(&bytes).ok()?;
        if parsed.assignments.is_empty() {
            None
        } else {
            Some(parsed.assignments)
        }
    }

    pub(crate) fn toggle_goal_composer_save_as_default(&mut self) -> bool {
        if self.goal_mission_control.runtime_mode() {
            return false;
        }
        self.goal_mission_control.toggle_save_as_default_pending();
        if self.goal_mission_control.save_as_default_pending {
            self.goal_composer_saved_defaults = Some(
                self.goal_mission_control
                    .display_role_assignments()
                    .to_vec(),
            );
            persist_goal_composer_defaults(self.goal_composer_saved_defaults.as_deref());
            self.status_line = "Mission Control roster saved as the new default".to_string();
        } else {
            self.goal_composer_saved_defaults = None;
            persist_goal_composer_defaults(None);
            self.status_line = "Mission Control saved default cleared".to_string();
        }
        true
    }

    pub(crate) fn persist_goal_composer_defaults_if_enabled(&mut self) {
        if !self.goal_mission_control.save_as_default_pending {
            return;
        }
        self.goal_composer_saved_defaults = Some(
            self.goal_mission_control
                .display_role_assignments()
                .to_vec(),
        );
        persist_goal_composer_defaults(self.goal_composer_saved_defaults.as_deref());
    }

    pub(crate) fn remove_goal_composer_assignment(&mut self) -> bool {
        match self.goal_mission_control.remove_preflight_assignment() {
            Some(role_id) => {
                self.persist_goal_composer_defaults_if_enabled();
                self.status_line = format!("Mission Control removed {role_id}");
                true
            }
            None => {
                self.status_line = "Mission Control needs at least one agent".to_string();
                true
            }
        }
    }

    pub(crate) fn apply_goal_composer_mouse_hit(
        &mut self,
        hit: GoalMissionControlHitTarget,
    ) -> bool {
        match hit {
            GoalMissionControlHitTarget::OpenActiveThread => {
                let _ = self.open_mission_control_goal_thread();
                true
            }
            GoalMissionControlHitTarget::SaveAsDefault => {
                self.goal_mission_control
                    .set_focused_section(GoalMissionControlSection::MainAgent);
                self.goal_mission_control.selected_field = GoalMissionControlField::SaveAsDefault;
                self.toggle_goal_composer_save_as_default();
                self.apply_goal_composer_section_focus();
                true
            }
            GoalMissionControlHitTarget::RemoveAssignment(index) => {
                self.goal_mission_control
                    .set_focused_section(GoalMissionControlSection::RoleAssignments);
                self.goal_mission_control
                    .set_selected_runtime_assignment_index(index);
                self.remove_goal_composer_assignment();
                self.apply_goal_composer_section_focus();
                true
            }
            GoalMissionControlHitTarget::AssignmentRow(index) => {
                self.goal_mission_control
                    .set_focused_section(GoalMissionControlSection::RoleAssignments);
                self.goal_mission_control
                    .set_selected_runtime_assignment_index(index);
                self.apply_goal_composer_section_focus();
                false
            }
            GoalMissionControlHitTarget::Section(section) => {
                self.goal_mission_control.set_focused_section(section);
                self.apply_goal_composer_section_focus();
                false
            }
        }
    }
}

fn goal_composer_defaults_path() -> Option<std::path::PathBuf> {
    zorai_protocol::ensure_zorai_data_dir()
        .ok()
        .map(|dir| dir.join(GOAL_COMPOSER_DEFAULTS_FILE))
}

fn persist_goal_composer_defaults(assignments: Option<&[GoalAgentAssignment]>) {
    if cfg!(test) {
        return;
    }
    let Some(path) = goal_composer_defaults_path() else {
        return;
    };
    match assignments.filter(|values| !values.is_empty()) {
        Some(values) => {
            let payload = GoalComposerSavedDefaultsFile {
                assignments: values.to_vec(),
            };
            if let Ok(bytes) = serde_json::to_vec_pretty(&payload) {
                let _ = std::fs::write(path, bytes);
            }
        }
        None => {
            let _ = std::fs::remove_file(path);
        }
    }
}
