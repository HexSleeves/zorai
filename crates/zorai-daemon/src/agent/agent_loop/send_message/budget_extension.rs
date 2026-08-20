#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct SuccessfulBudgetExtension {
    pub target_task_id: Option<String>,
    pub target_thread_id: Option<String>,
    pub new_max_tokens: Option<u32>,
    pub additional_tokens: u32,
}

fn nonempty_json_str(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn json_u32(value: &serde_json::Value, key: &str) -> Option<u32> {
    value
        .get(key)
        .and_then(|value| value.as_u64())
        .map(|value| value.min(u32::MAX as u64) as u32)
}

pub(super) fn parse_successful_budget_extension(
    arguments: &str,
    result_content: &str,
) -> SuccessfulBudgetExtension {
    let result: serde_json::Value = serde_json::from_str(result_content).unwrap_or_default();
    let args: serde_json::Value = serde_json::from_str(arguments).unwrap_or_default();
    SuccessfulBudgetExtension {
        target_task_id: nonempty_json_str(&result, "task_id")
            .or_else(|| nonempty_json_str(&args, "child_task_id")),
        target_thread_id: nonempty_json_str(&result, "thread_id")
            .or_else(|| nonempty_json_str(&args, "child_thread_id")),
        new_max_tokens: json_u32(&result, "new_max_tokens"),
        additional_tokens: json_u32(&args, "additional_tokens").unwrap_or(0),
    }
}

pub(super) fn budget_extension_applies_to_runner(
    caller_task_id: Option<&str>,
    caller_thread_id: &str,
    target_task_id: Option<&str>,
    target_thread_id: Option<&str>,
) -> bool {
    let target_task_id = target_task_id.map(str::trim).filter(|id| !id.is_empty());
    let target_thread_id = target_thread_id.map(str::trim).filter(|id| !id.is_empty());
    if target_task_id.is_none() && target_thread_id.is_none() {
        return true;
    }
    if target_task_id.is_some_and(|id| caller_task_id == Some(id)) {
        return true;
    }
    target_thread_id == Some(caller_thread_id)
}

pub(super) fn should_exit_report_back_after_live_ceiling_sync(
    in_report_back: bool,
    ceiling_raised: bool,
    still_exceeded: bool,
) -> bool {
    in_report_back && ceiling_raised && !still_exceeded
}

pub(super) fn max_loops_for_budget_report_back(max_loops: u32, loop_count: u32) -> u32 {
    if max_loops > 0 && loop_count >= max_loops {
        loop_count.saturating_add(1)
    } else {
        max_loops
    }
}

pub(super) fn max_loops_after_successful_budget_extend(
    max_loops: u32,
    loop_count: u32,
    configured_max_tool_loops: u32,
) -> u32 {
    if max_loops == 0 {
        return 0;
    }
    if loop_count >= max_loops {
        loop_count.saturating_add(configured_max_tool_loops.max(1))
    } else {
        max_loops
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum FinishSubagentSynthesis {
    None,
    CancelledReport,
    BudgetTextReport,
    BudgetErrorReport,
}

pub(super) fn finish_subagent_synthesis(
    was_cancelled: bool,
    in_report_back: bool,
    has_report: bool,
    terminated_for_budget: bool,
    spawned: bool,
) -> FinishSubagentSynthesis {
    if has_report {
        return FinishSubagentSynthesis::None;
    }
    if was_cancelled {
        if in_report_back || spawned {
            return FinishSubagentSynthesis::CancelledReport;
        }
        return FinishSubagentSynthesis::None;
    }
    if in_report_back {
        return FinishSubagentSynthesis::BudgetTextReport;
    }
    if terminated_for_budget && spawned {
        return FinishSubagentSynthesis::BudgetErrorReport;
    }
    FinishSubagentSynthesis::None
}

pub(super) fn should_mark_terminated_after_failed_report_back_entry(entered: bool) -> bool {
    !entered
}

#[cfg(test)]
mod tests {
    use super::{
        budget_extension_applies_to_runner, finish_subagent_synthesis,
        max_loops_after_successful_budget_extend, max_loops_for_budget_report_back,
        parse_successful_budget_extension, should_exit_report_back_after_live_ceiling_sync,
        should_mark_terminated_after_failed_report_back_entry, FinishSubagentSynthesis,
    };

    #[test]
    fn parent_extend_result_does_not_apply_to_parent_runner() {
        let parsed = parse_successful_budget_extension(
            r#"{"child_task_id":"child-1","additional_tokens":512,"reason":"more tests"}"#,
            r#"{"ok":true,"action":"extend","task_id":"child-1","thread_id":"thread-child","previous_max_tokens":1000,"new_max_tokens":1512,"additional_tokens":512,"resumed":false,"reason":"more tests"}"#,
        );
        assert!(
            !budget_extension_applies_to_runner(
                Some("parent-1"),
                "thread-parent",
                parsed.target_task_id.as_deref(),
                parsed.target_thread_id.as_deref(),
            ),
            "a parent raising a child ceiling must keep its own live token limit unchanged"
        );
        assert_eq!(parsed.new_max_tokens, Some(1_512));
    }

    #[test]
    fn child_self_extend_result_applies_even_without_runner_task_id() {
        let parsed = parse_successful_budget_extension(
            r#"{"additional_tokens":512,"reason":"continue"}"#,
            r#"{"ok":true,"action":"extend","task_id":"child-1","thread_id":"thread-child","previous_max_tokens":1000,"new_max_tokens":1512,"additional_tokens":512,"resumed":false,"reason":"continue"}"#,
        );
        assert!(
            budget_extension_applies_to_runner(
                None,
                "thread-child",
                parsed.target_task_id.as_deref(),
                parsed.target_thread_id.as_deref(),
            ),
            "the still-running child must adopt the new ceiling on this turn, not after a restart"
        );
    }

    #[test]
    fn omitted_target_ids_mean_self_extension() {
        assert!(
            budget_extension_applies_to_runner(Some("child-1"), "thread-child", None, None),
            "a child calling extend without child_task_id is targeting its own runner"
        );
    }

    #[test]
    fn parent_extend_lets_report_back_child_resume_without_restart() {
        assert!(
            should_exit_report_back_after_live_ceiling_sync(true, true, false),
            "once the persisted child ceiling is live, a budget-stopped child should keep working instead of staying locked in report-back until restart"
        );
        assert!(!should_exit_report_back_after_live_ceiling_sync(
            true, true, true
        ));
        assert!(!should_exit_report_back_after_live_ceiling_sync(
            false, true, false
        ));
        assert!(!should_exit_report_back_after_live_ceiling_sync(
            true, false, false
        ));
    }

    #[test]
    fn report_back_at_tool_loop_cap_grants_only_one_extra_iteration() {
        assert_eq!(
            max_loops_for_budget_report_back(8, 8),
            9,
            "report-back needs one model call to extend or report; it must not look like the turn already finished"
        );
        assert_eq!(max_loops_for_budget_report_back(8, 7), 8);
        assert_eq!(max_loops_for_budget_report_back(0, 12), 0);
    }

    #[test]
    fn successful_extend_at_loop_cap_must_grant_a_continuation_allotment() {
        assert_eq!(
            max_loops_after_successful_budget_extend(9, 9, 8),
            17,
            "the +1 report-back iteration is consumed by extend itself; without a fresh allotment the runner stops and the dispatcher marks the child completed"
        );
        assert_eq!(
            max_loops_after_successful_budget_extend(9, 8, 8),
            9,
            "remaining tool loops already allow work on the raised ceiling"
        );
        assert_eq!(max_loops_after_successful_budget_extend(0, 12, 8), 0);
        assert_eq!(
            max_loops_after_successful_budget_extend(1, 1, 1),
            2,
            "even a 1-loop config must get another work iteration after the extend call"
        );
    }

    #[test]
    fn extend_after_report_back_at_cap_leaves_room_for_more_work() {
        let original_max = 8;
        let max_after_report_back = max_loops_for_budget_report_back(original_max, original_max);
        let loop_count_after_extend_turn = max_after_report_back;
        let max_after_extend = max_loops_after_successful_budget_extend(
            max_after_report_back,
            loop_count_after_extend_turn,
            original_max,
        );
        assert!(
            loop_count_after_extend_turn < max_after_extend,
            "the extend call consumes the +1 report-back iteration; without a continuation allotment the runner hits max_loops and the dispatcher marks the child completed"
        );
    }

    #[test]
    fn cancelled_report_back_must_not_synthesize_budget_exceeded() {
        assert_eq!(
            finish_subagent_synthesis(true, true, false, false, true),
            FinishSubagentSynthesis::CancelledReport,
            "cancelling during report-back must not record zorai_budget; the dispatcher would tell the parent to extend instead of treating the child as cancelled"
        );
        assert_eq!(
            finish_subagent_synthesis(false, true, false, false, true),
            FinishSubagentSynthesis::BudgetTextReport
        );
        assert_eq!(
            finish_subagent_synthesis(true, false, false, true, true),
            FinishSubagentSynthesis::CancelledReport,
            "a cancelled spawned turn must stay cancelled even if the budget flag was already set"
        );
        assert_eq!(
            finish_subagent_synthesis(false, false, false, true, true),
            FinishSubagentSynthesis::BudgetErrorReport
        );
        assert_eq!(
            finish_subagent_synthesis(false, true, true, false, true),
            FinishSubagentSynthesis::None
        );
    }

    #[test]
    fn text_completion_must_terminate_when_report_back_entry_fails() {
        assert!(
            should_mark_terminated_after_failed_report_back_entry(false),
            "the tool-loop path sets terminated_for_budget when enter_execution_budget_report_back fails; text completion must do the same or a spawned child is completed while still over budget"
        );
        assert!(!should_mark_terminated_after_failed_report_back_entry(true));
    }
}
