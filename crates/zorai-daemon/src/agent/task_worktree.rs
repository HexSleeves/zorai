use super::*;
use std::path::{Path, PathBuf};
use tokio::process::Command;

#[derive(Debug, Clone)]
pub(super) struct IsolatedTaskWorkspace {
    pub workspace_root: String,
    pub root: String,
    pub branch: String,
    pub created: bool,
}

fn safe_component(value: &str) -> String {
    let mut result = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    while result.contains("--") {
        result = result.replace("--", "-");
    }
    result.trim_matches(['-', '.']).chars().take(64).collect()
}

async fn run_git(repo_root: &Path, args: &[&str]) -> Result<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo_root)
        .output()
        .await?;
    if !output.status.success() {
        anyhow::bail!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn canonical_or_original(path: &str) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| PathBuf::from(path))
}

fn session_matches_hint(session: &zorai_protocol::SessionInfo, hint: Option<&str>) -> bool {
    let Some(hint) = hint.map(str::trim).filter(|value| !value.is_empty()) else {
        return false;
    };
    let id = session.id.to_string();
    id == hint || id.contains(hint)
}

fn session_cwd_matches_root(session: &zorai_protocol::SessionInfo, workspace_root: &str) -> bool {
    let Some(cwd) = session.cwd.as_deref() else {
        return false;
    };
    let cwd = canonical_or_original(cwd);
    let workspace_root = canonical_or_original(workspace_root);
    if cwd == workspace_root || cwd.starts_with(&workspace_root) {
        return true;
    }
    let cwd_git = crate::git::find_git_root(cwd.to_string_lossy().as_ref())
        .map(|value| canonical_or_original(&value));
    let root_git = crate::git::find_git_root(workspace_root.to_string_lossy().as_ref())
        .map(|value| canonical_or_original(&value));
    cwd_git.is_some() && cwd_git == root_git
}

#[derive(Debug, Clone)]
pub(super) enum IsolatedTaskSessionPlan {
    Reuse(zorai_protocol::SessionInfo),
    CloneFrom(zorai_protocol::SessionInfo),
    Unavailable,
}

pub(super) fn select_isolated_task_session(
    sessions: &[zorai_protocol::SessionInfo],
    task_session_hint: Option<&str>,
    turn_session_hint: Option<&str>,
    workspace_root: &str,
    isolated_root: &str,
) -> IsolatedTaskSessionPlan {
    let preferred = |hint: Option<&str>, root: &str| {
        sessions.iter().find(|session| {
            session_matches_hint(session, hint) && session_cwd_matches_root(session, root)
        })
    };

    if let Some(session) = preferred(task_session_hint, isolated_root)
        .or_else(|| preferred(turn_session_hint, isolated_root))
        .or_else(|| {
            sessions.iter().find(|session| {
                session.workspace_id.is_some() && session_cwd_matches_root(session, isolated_root)
            })
        })
    {
        return IsolatedTaskSessionPlan::Reuse(session.clone());
    }

    let compatible_source = preferred(task_session_hint, workspace_root)
        .or_else(|| preferred(turn_session_hint, workspace_root))
        .or_else(|| {
            sessions.iter().find(|session| {
                session.workspace_id.is_some() && session_cwd_matches_root(session, workspace_root)
            })
        });

    compatible_source
        .cloned()
        .map(IsolatedTaskSessionPlan::CloneFrom)
        .unwrap_or(IsolatedTaskSessionPlan::Unavailable)
}

impl AgentEngine {
    pub(super) async fn ensure_isolated_task_workspace(
        &self,
        thread_id: &str,
        task: &AgentTask,
    ) -> Result<Option<IsolatedTaskWorkspace>> {
        let Some(context) = self.get_thread_workspace_context(thread_id).await else {
            return Ok(None);
        };
        if !context.isolate_agent_tasks {
            return Ok(None);
        }
        let workspace_root = context.root;
        let configured_root = PathBuf::from(&workspace_root);
        let Some(repo_root) = crate::git::find_git_root(configured_root.to_string_lossy().as_ref())
        else {
            return Ok(None);
        };
        let repo_root = std::fs::canonicalize(repo_root)?;
        if !configured_root.starts_with(&repo_root) && !repo_root.starts_with(&configured_root) {
            return Ok(None);
        }
        let task_component = safe_component(&task.id);
        if task_component.is_empty() {
            return Ok(None);
        }
        let goal_component = task
            .goal_run_id
            .as_deref()
            .map(safe_component)
            .filter(|value| !value.is_empty());
        let name = goal_component
            .as_deref()
            .map(|goal| format!("goal-{goal}-{task_component}"))
            .unwrap_or_else(|| format!("task-{task_component}"));
        let branch = format!("zorai/{name}");
        let container = repo_root
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(format!(
                "{}-worktrees",
                repo_root
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("workspace")
            ));
        tokio::fs::create_dir_all(&container).await?;
        let destination = container.join(&name);
        if destination.is_dir() {
            return Ok(Some(IsolatedTaskWorkspace {
                workspace_root,
                root: std::fs::canonicalize(destination)?
                    .to_string_lossy()
                    .to_string(),
                branch,
                created: false,
            }));
        }
        let destination_string = destination.to_string_lossy().to_string();
        let branch_exists = Command::new("git")
            .args([
                "show-ref",
                "--verify",
                "--quiet",
                &format!("refs/heads/{branch}"),
            ])
            .current_dir(&repo_root)
            .status()
            .await?
            .success();
        if branch_exists {
            run_git(
                &repo_root,
                &["worktree", "add", &destination_string, &branch],
            )
            .await?;
        } else {
            run_git(
                &repo_root,
                &[
                    "worktree",
                    "add",
                    "-b",
                    &branch,
                    &destination_string,
                    "HEAD",
                ],
            )
            .await?;
        }
        let canonical = std::fs::canonicalize(destination)?;
        Ok(Some(IsolatedTaskWorkspace {
            workspace_root,
            root: canonical.to_string_lossy().to_string(),
            branch,
            created: true,
        }))
    }
    pub(super) async fn bind_task_isolated_session(
        &self,
        task: &AgentTask,
        session_id: zorai_protocol::SessionId,
    ) -> AgentTask {
        let session_id = session_id.to_string();
        let updated = {
            let mut tasks = self.tasks.lock().await;
            if let Some(existing) = tasks.iter_mut().find(|existing| existing.id == task.id) {
                existing.session_id = Some(session_id.clone());
                existing.clone()
            } else {
                let mut updated = task.clone();
                updated.session_id = Some(session_id);
                tasks.push_back(updated.clone());
                updated
            }
        };
        self.persist_tasks().await;
        updated
    }
}

#[cfg(test)]
mod tests {
    use super::{safe_component, select_isolated_task_session, IsolatedTaskSessionPlan};

    fn session(id: &str, cwd: &str, workspace_id: Option<&str>) -> zorai_protocol::SessionInfo {
        zorai_protocol::SessionInfo {
            id: uuid::Uuid::parse_str(id).expect("valid session id"),
            title: Some("Agent lane".to_string()),
            cwd: Some(cwd.to_string()),
            cols: 120,
            rows: 40,
            created_at: 1,
            workspace_id: workspace_id.map(str::to_string),
            exit_code: None,
            is_alive: true,
            active_command: None,
        }
    }

    #[test]
    fn task_worktree_components_are_git_and_path_safe() {
        assert_eq!(safe_component("task:hello/world"), "task-hello-world");
        assert_eq!(safe_component("..unsafe.."), "unsafe");
    }

    #[test]
    fn persisted_task_session_in_isolated_root_is_reused_before_turn_hint() {
        let task_session = session(
            "11111111-1111-1111-1111-111111111111",
            "/repo-worktrees/task-1",
            Some("workspace-repo"),
        );
        let turn_session = session(
            "22222222-2222-2222-2222-222222222222",
            "/repo",
            Some("workspace-repo"),
        );
        let sessions = vec![turn_session, task_session.clone()];

        let plan = select_isolated_task_session(
            &sessions,
            Some("11111111"),
            Some("22222222"),
            "/repo",
            "/repo-worktrees/task-1",
        );

        assert!(matches!(
            plan,
            IsolatedTaskSessionPlan::Reuse(session) if session.id == task_session.id
        ));
    }

    #[test]
    fn unrelated_workspace_session_is_not_used_as_clone_source() {
        let unrelated = session(
            "33333333-3333-3333-3333-333333333333",
            "/unrelated",
            Some("workspace-unrelated"),
        );

        let plan = select_isolated_task_session(
            &[unrelated],
            None,
            None,
            "/repo",
            "/repo-worktrees/task-1",
        );

        assert!(matches!(plan, IsolatedTaskSessionPlan::Unavailable));
    }

    #[test]
    fn source_without_workspace_identity_is_not_reused_as_isolated_terminal() {
        let source = session("44444444-4444-4444-4444-444444444444", "/repo", None);

        let plan = select_isolated_task_session(&[source], None, None, "/repo", "/repo");

        assert!(matches!(plan, IsolatedTaskSessionPlan::Unavailable));
    }
}
