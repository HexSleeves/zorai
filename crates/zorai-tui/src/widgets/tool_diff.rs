#[path = "tool_diff_parts/render_tool_edit_diff_to_summarize_array_value.rs"]
mod render_tool_edit_diff_to_summarize_array_value;

#[path = "tool_diff_parts/empty_key_to_wrap_preserving_whitespace.rs"]
mod empty_key_to_wrap_preserving_whitespace;

pub(crate) use render_tool_edit_diff_to_summarize_array_value::*;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    #[test]
    fn summarize_array_value_returns_empty_brackets_for_empty_array() {
        assert_eq!(summarize_array_value(&[]), "[]");
    }

    #[test]
    fn summarize_array_value_lists_primitives_inline() {
        let items = vec![
            Value::Number(1.into()),
            Value::Number(2.into()),
            Value::Bool(true),
        ];
        assert_eq!(summarize_array_value(&items), "[1, 2, true]");
    }

    #[test]
    fn summarize_array_value_truncates_after_five_primitives() {
        let items: Vec<Value> = (1..=8).map(|n| Value::Number(n.into())).collect();
        assert_eq!(summarize_array_value(&items), "[1, 2, 3, 4, 5, +3 more]");
    }

    #[test]
    fn summarize_array_value_falls_back_to_count_for_complex_items() {
        let items = vec![Value::Bool(true), json!([1, 2, 3])];
        assert_eq!(summarize_array_value(&items), "2 items");
    }

    #[test]
    fn summarize_array_value_falls_back_to_count_for_nested_objects() {
        let items = vec![json!({"k": 1}), json!({"k": 2})];
        assert_eq!(summarize_array_value(&items), "2 items");
    }

    fn lines_to_text(lines: &[ratatui::text::Line<'static>]) -> String {
        lines
            .iter()
            .map(|line| {
                line.spans
                    .iter()
                    .map(|span| span.content.as_ref())
                    .collect::<String>()
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn structured_result_expands_object_arrays_with_indices() {
        let theme = crate::theme::ThemeTokens::default();
        let raw = r#"[{"provider_id":"openai","authenticated":true},{"provider_id":"anthropic","authenticated":false}]"#;
        let lines = render_tool_structured_json(
            "fetch_authenticated_providers",
            ToolStructuredValueSource::Result,
            raw,
            &theme,
            120,
        )
        .expect("structured render should produce fields for an object array");
        let text = lines_to_text(&lines);
        assert!(text.contains("[0].provider_id: openai"), "{text}");
        assert!(text.contains("[1].provider_id: anthropic"), "{text}");
        assert!(!text.contains("2 items"), "{text}");
    }

    #[test]
    fn structured_result_surfaces_truncation_for_large_object_arrays() {
        let theme = crate::theme::ThemeTokens::default();
        let items: Vec<Value> = (0..20)
            .map(|n| json!({"provider_id": format!("p{n}"), "authenticated": true}))
            .collect();
        let raw = serde_json::to_string(&Value::Array(items)).unwrap();
        let lines = render_tool_structured_json(
            "fetch_authenticated_providers",
            ToolStructuredValueSource::Result,
            &raw,
            &theme,
            120,
        )
        .expect("structured render should produce fields for an object array");
        let text = lines_to_text(&lines);
        assert!(text.contains("more items"), "{text}");
    }
}
