use super::*;
use std::path::{Path, PathBuf};
use tokio::process::Command;

#[derive(Debug, Clone)]
pub(super) struct IsolatedTaskWorkspace {
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
        let configured_root = PathBuf::from(context.root);
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
            root: canonical.to_string_lossy().to_string(),
            branch,
            created: true,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::safe_component;

    #[test]
    fn task_worktree_components_are_git_and_path_safe() {
        assert_eq!(safe_component("task:hello/world"), "task-hello-world");
        assert_eq!(safe_component("..unsafe.."), "unsafe");
    }
}
