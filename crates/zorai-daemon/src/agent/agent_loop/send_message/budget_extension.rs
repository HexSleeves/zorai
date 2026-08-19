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

#[cfg(test)]
mod tests {
    use super::{
        budget_extension_applies_to_runner, parse_successful_budget_extension,
        should_exit_report_back_after_live_ceiling_sync,
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
}
