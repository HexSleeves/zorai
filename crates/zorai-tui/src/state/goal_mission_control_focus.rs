use super::{GoalMissionControlState, MAIN_AGENT_ROLE_ID};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GoalMissionControlSection {
    Prompt,
    MainAgent,
    RoleAssignments,
    ThreadRouter,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GoalMissionControlField {
    Provider,
    Model,
    ReasoningEffort,
    Role,
    SaveAsDefault,
}

impl GoalMissionControlSection {
    pub fn fields(self, runtime_mode: bool) -> &'static [GoalMissionControlField] {
        match self {
            Self::Prompt | Self::ThreadRouter => &[],
            Self::MainAgent if runtime_mode => &[
                GoalMissionControlField::Provider,
                GoalMissionControlField::Model,
                GoalMissionControlField::ReasoningEffort,
            ],
            Self::MainAgent => &[
                GoalMissionControlField::Provider,
                GoalMissionControlField::Model,
                GoalMissionControlField::ReasoningEffort,
                GoalMissionControlField::SaveAsDefault,
            ],
            Self::RoleAssignments => &[
                GoalMissionControlField::Provider,
                GoalMissionControlField::Model,
                GoalMissionControlField::ReasoningEffort,
                GoalMissionControlField::Role,
            ],
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Prompt => "prompt",
            Self::MainAgent => "main agent",
            Self::RoleAssignments => "role assignments",
            Self::ThreadRouter => "thread router",
        }
    }
}

impl GoalMissionControlField {
    pub fn to_runtime_edit_field(self) -> Option<super::RuntimeAssignmentEditField> {
        match self {
            Self::Provider => Some(super::RuntimeAssignmentEditField::Provider),
            Self::Model => Some(super::RuntimeAssignmentEditField::Model),
            Self::ReasoningEffort => Some(super::RuntimeAssignmentEditField::ReasoningEffort),
            Self::Role => Some(super::RuntimeAssignmentEditField::Role),
            Self::SaveAsDefault => None,
        }
    }
}

impl GoalMissionControlState {
    pub fn set_focused_section(&mut self, section: GoalMissionControlSection) {
        self.focused_section = section;
        self.clamp_selected_field();
        if section == GoalMissionControlSection::MainAgent {
            self.select_main_assignment_row();
        }
    }

    pub fn focus_next_section(&mut self, include_thread_router: bool) -> GoalMissionControlSection {
        self.cycle_focused_section(1, include_thread_router)
    }

    pub fn focus_prev_section(&mut self, include_thread_router: bool) -> GoalMissionControlSection {
        self.cycle_focused_section(-1, include_thread_router)
    }

    pub fn cycle_selected_field(&mut self, delta: i32) -> bool {
        let fields = self.focused_section.fields(self.runtime_mode());
        if fields.is_empty() {
            return false;
        }
        let current = fields
            .iter()
            .position(|field| *field == self.selected_field)
            .unwrap_or(0);
        let len = fields.len() as i32;
        let next = (current as i32 + delta).rem_euclid(len) as usize;
        if fields[next] == self.selected_field {
            return false;
        }
        self.selected_field = fields[next];
        true
    }

    pub fn select_main_assignment_row(&mut self) {
        let assignments = self.display_role_assignments();
        if let Some(index) = assignments
            .iter()
            .position(|assignment| assignment.role_id == MAIN_AGENT_ROLE_ID)
            .or_else(|| assignments.first().map(|_| 0))
        {
            self.selected_runtime_assignment_index = index;
        }
    }

    fn cycle_focused_section(
        &mut self,
        delta: i32,
        include_thread_router: bool,
    ) -> GoalMissionControlSection {
        let sections = visible_sections(include_thread_router);
        let current = sections
            .iter()
            .position(|section| *section == self.focused_section)
            .unwrap_or(0);
        let len = sections.len() as i32;
        let next = (current as i32 + delta).rem_euclid(len) as usize;
        self.set_focused_section(sections[next]);
        self.focused_section
    }

    fn clamp_selected_field(&mut self) {
        let fields = self.focused_section.fields(self.runtime_mode());
        if !fields.contains(&self.selected_field) {
            self.selected_field = fields
                .first()
                .copied()
                .unwrap_or(GoalMissionControlField::Provider);
        }
    }
}

fn visible_sections(include_thread_router: bool) -> Vec<GoalMissionControlSection> {
    let mut sections = vec![
        GoalMissionControlSection::Prompt,
        GoalMissionControlSection::MainAgent,
        GoalMissionControlSection::RoleAssignments,
    ];
    if include_thread_router {
        sections.push(GoalMissionControlSection::ThreadRouter);
    }
    sections
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::task::GoalAgentAssignment;

    fn sample_state() -> GoalMissionControlState {
        GoalMissionControlState::from_main_assignment(
            GoalAgentAssignment {
                role_id: zorai_protocol::AGENT_ID_SWAROG.to_string(),
                enabled: true,
                provider: "openai".to_string(),
                model: "gpt-5.4".to_string(),
                reasoning_effort: Some("low".to_string()),
                inherit_from_main: false,
            },
            vec![
                GoalAgentAssignment {
                    role_id: zorai_protocol::AGENT_ID_SWAROG.to_string(),
                    enabled: true,
                    provider: "openai".to_string(),
                    model: "gpt-5.4".to_string(),
                    reasoning_effort: Some("low".to_string()),
                    inherit_from_main: false,
                },
                GoalAgentAssignment {
                    role_id: "planner".to_string(),
                    enabled: true,
                    provider: "openai".to_string(),
                    model: "gpt-5.4-mini".to_string(),
                    reasoning_effort: Some("medium".to_string()),
                    inherit_from_main: false,
                },
            ],
            "Previous goal snapshot",
        )
    }

    #[test]
    fn tab_cycle_skips_thread_router_when_unavailable() {
        let mut state = sample_state();
        state.set_focused_section(GoalMissionControlSection::Prompt);

        assert_eq!(
            state.focus_next_section(false),
            GoalMissionControlSection::MainAgent
        );
        assert_eq!(
            state.focus_next_section(false),
            GoalMissionControlSection::RoleAssignments
        );
        assert_eq!(
            state.focus_next_section(false),
            GoalMissionControlSection::Prompt
        );
        assert_eq!(
            state.focus_prev_section(false),
            GoalMissionControlSection::RoleAssignments
        );
    }

    #[test]
    fn field_cycle_wraps_within_focused_section() {
        let mut state = sample_state();
        state.set_focused_section(GoalMissionControlSection::MainAgent);

        assert_eq!(state.selected_field, GoalMissionControlField::Provider);
        assert!(state.cycle_selected_field(1));
        assert_eq!(state.selected_field, GoalMissionControlField::Model);
        assert!(state.cycle_selected_field(-1));
        assert_eq!(state.selected_field, GoalMissionControlField::Provider);
        assert!(state.cycle_selected_field(-1));
        assert_eq!(state.selected_field, GoalMissionControlField::SaveAsDefault);
    }
}
