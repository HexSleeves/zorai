use super::render_edit_buffer_with_cursor;
use crate::state::config::ConfigState;
use crate::state::settings::SettingsState;
use crate::theme::ThemeTokens;
use ratatui::text::{Line, Span};

pub(crate) fn render_mlflow_tab<'a>(
    settings: &'a SettingsState,
    config: &'a ConfigState,
    theme: &ThemeTokens,
) -> Vec<Line<'a>> {
    let mut lines = vec![
        Line::raw(""),
        Line::from(Span::styled("  MLflow Tracing", theme.fg_active)),
        Line::from(Span::styled(
            "  One fail-open OTLP trace per Zorai turn",
            theme.fg_dim,
        )),
        Line::raw(""),
    ];
    let toggles = [
        (0, config.mlflow_enabled, "Enabled"),
        (1, config.mlflow_visible_operator, "Visible operator turns"),
        (2, config.mlflow_gateway, "Gateway turns"),
        (3, config.mlflow_goal_task, "Goal/task turns"),
        (4, config.mlflow_subagent, "Subagent turns"),
        (5, config.mlflow_concierge, "Concierge turns"),
        (
            6,
            config.mlflow_heartbeat_autonomous,
            "Heartbeat/autonomous",
        ),
    ];
    for (index, enabled, label) in toggles {
        lines.push(toggle_line(settings, theme, index, enabled, label));
    }
    lines.push(value_line(
        settings,
        theme,
        7,
        "Tracking URI",
        "mlflow_tracking_uri",
        &config.mlflow_tracking_uri,
    ));
    lines.push(value_line(
        settings,
        theme,
        8,
        "Experiment",
        "mlflow_experiment_name",
        &config.mlflow_experiment_name,
    ));
    lines.push(value_line(
        settings,
        theme,
        9,
        "Experiment ID",
        "mlflow_experiment_id",
        if config.mlflow_experiment_id.is_empty() {
            "<by name>"
        } else {
            &config.mlflow_experiment_id
        },
    ));
    lines.push(value_line(
        settings,
        theme,
        10,
        "Capture mode",
        "mlflow_capture_mode",
        &config.mlflow_capture_mode,
    ));
    lines.push(action_line(settings, theme, 11, "Test connection"));
    lines.push(action_line(settings, theme, 12, "Send test trace"));
    lines.push(Line::raw(""));
    let status = config.mlflow_runtime_status.as_ref();
    lines.push(Line::from(vec![
        Span::styled("  Status: ", theme.fg_dim),
        Span::styled(
            status
                .and_then(|value| value.get("state"))
                .and_then(|value| value.as_str())
                .unwrap_or("unknown"),
            theme.accent_primary,
        ),
    ]));
    if let Some(error) = status
        .and_then(|value| value.get("last_error"))
        .and_then(|value| value.as_str())
    {
        lines.push(Line::from(Span::styled(
            format!("  Error: {error}"),
            theme.accent_danger,
        )));
    }
    if let Some(result) = config.mlflow_test_result.as_ref() {
        let ok = result.get("ok").and_then(|value| value.as_bool()) == Some(true);
        if ok {
            let version = result
                .pointer("/connection/server_version")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            let label = if version.is_empty() {
                "  Test: connected".to_string()
            } else {
                format!("  Test: connected to MLflow {version}")
            };
            lines.push(Line::from(Span::styled(label, theme.accent_success)));
        } else if let Some(error) = result.get("error").and_then(|value| value.as_str()) {
            lines.push(Line::from(Span::styled(
                format!("  Test: {error}"),
                theme.accent_danger,
            )));
        }
    }
    lines
}

fn toggle_line<'a>(
    settings: &SettingsState,
    theme: &ThemeTokens,
    index: usize,
    enabled: bool,
    label: &'a str,
) -> Line<'a> {
    let selected = settings.field_cursor() == index;
    Line::from(vec![
        Span::styled(
            if selected { "> " } else { "  " },
            if selected {
                theme.accent_primary
            } else {
                theme.fg_dim
            },
        ),
        Span::styled(
            if enabled { "[x]" } else { "[ ]" },
            if enabled {
                theme.accent_success
            } else {
                theme.fg_dim
            },
        ),
        Span::raw(" "),
        Span::styled(
            label,
            if selected {
                theme.accent_primary
            } else {
                theme.fg_active
            },
        ),
    ])
}

fn value_line<'a>(
    settings: &'a SettingsState,
    theme: &ThemeTokens,
    index: usize,
    label: &'a str,
    field_name: &str,
    value: &str,
) -> Line<'a> {
    let selected = settings.field_cursor() == index;
    let editing = settings.is_editing() && settings.editing_field() == Some(field_name);
    let display = if editing {
        render_edit_buffer_with_cursor(settings.edit_buffer(), settings.edit_cursor())
    } else {
        value.to_string()
    };
    Line::from(vec![
        Span::styled(
            if selected { "> " } else { "  " },
            if selected {
                theme.accent_primary
            } else {
                theme.fg_dim
            },
        ),
        Span::styled(format!("{label}: "), theme.fg_dim),
        Span::styled(
            display,
            if selected {
                theme.accent_primary
            } else {
                theme.fg_active
            },
        ),
    ])
}

fn action_line<'a>(
    settings: &SettingsState,
    theme: &ThemeTokens,
    index: usize,
    label: &'a str,
) -> Line<'a> {
    let selected = settings.field_cursor() == index;
    Line::from(Span::styled(
        format!("{}[ {label} ]", if selected { "> " } else { "  " }),
        if selected {
            theme.accent_primary
        } else {
            theme.fg_active
        },
    ))
}
