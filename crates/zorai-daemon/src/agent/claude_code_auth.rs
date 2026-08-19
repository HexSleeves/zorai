use anyhow::{Context, Result};
use std::path::PathBuf;
use std::process::Command;
use zorai_shared::providers::PROVIDER_ID_CLAUDE_CODE_CLI;

const CLAUDE_BINARY: &str = "claude";
const CREDENTIALS_PATH_ENV: &str = "ZORAI_CLAUDE_CODE_CREDENTIALS_PATH";

pub(crate) fn claude_code_cli_authenticated() -> bool {
    super::llm_client::claude_cli_available() && claude_code_cli_has_credentials()
}

pub(crate) fn logout_claude_code_cli() -> Result<()> {
    let _ = run_claude_auth_logout();
    clear_claude_code_credentials()
}

fn claude_code_credentials_path() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os(CREDENTIALS_PATH_ENV) {
        let path = PathBuf::from(path);
        if !path.as_os_str().is_empty() {
            return Some(path);
        }
    }
    dirs::home_dir().map(|home| home.join(".claude").join(".credentials.json"))
}

fn claude_code_cli_has_credentials() -> bool {
    let Some(path) = claude_code_credentials_path() else {
        return false;
    };
    std::fs::read_to_string(path)
        .ok()
        .map(|raw| !raw.trim().is_empty())
        .unwrap_or(false)
}

fn run_claude_auth_logout() -> Result<()> {
    let binary = which::which(CLAUDE_BINARY)
        .with_context(|| format!("Claude Code CLI binary '{CLAUDE_BINARY}' not found on PATH"))?;
    let output = Command::new(&binary)
        .args(["auth", "logout"])
        .output()
        .with_context(|| format!("failed to run '{} auth logout'", binary.display()))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!(
            "claude auth logout failed for {PROVIDER_ID_CLAUDE_CODE_CLI}: {}",
            stderr.trim()
        );
    }
    Ok(())
}

fn clear_claude_code_credentials() -> Result<()> {
    let Some(path) = claude_code_credentials_path() else {
        return Ok(());
    };
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error).with_context(|| {
            format!(
                "failed to clear Claude Code credentials at '{}'",
                path.display()
            )
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{env_test_lock, EnvGuard};

    fn write_executable(path: &std::path::Path, contents: &str) {
        std::fs::write(path, contents).expect("write executable");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(path)
                .expect("stat executable")
                .permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(path, perms).expect("chmod executable");
        }
    }

    #[test]
    fn logout_clears_cli_credentials_so_auth_state_can_drop() {
        let _lock = env_test_lock();
        let _guard = EnvGuard::new(&["PATH", CREDENTIALS_PATH_ENV]);
        let root = tempfile::tempdir().expect("temp dir");
        let credentials = root.path().join("credentials.json");
        std::fs::write(&credentials, "{\"claudeAiOauth\":{}}").expect("write credentials");

        let bin_dir = root.path().join("bin");
        std::fs::create_dir_all(&bin_dir).expect("create bin");
        write_executable(
            &bin_dir.join(CLAUDE_BINARY),
            "#!/bin/sh\nif [ \"$1\" = \"auth\" ] && [ \"$2\" = \"logout\" ]; then exit 0; fi\nexit 1\n",
        );

        std::env::set_var("PATH", &bin_dir);
        std::env::set_var(CREDENTIALS_PATH_ENV, &credentials);

        assert!(
            claude_code_cli_authenticated(),
            "Claude Code must be authenticated from CLI credentials, not from an unused API key"
        );

        logout_claude_code_cli().expect("logout should succeed");

        assert!(
            !credentials.exists(),
            "logout must remove Claude Code credentials; clearing a provider API key is a no-op"
        );
        assert!(
            !claude_code_cli_authenticated(),
            "settings logout stays broken if auth state still treats a present claude binary as logged in"
        );
    }

    #[test]
    fn missing_credentials_are_not_authenticated_even_when_cli_exists() {
        let _lock = env_test_lock();
        let _guard = EnvGuard::new(&["PATH", CREDENTIALS_PATH_ENV]);
        let root = tempfile::tempdir().expect("temp dir");
        let credentials = root.path().join("credentials.json");
        let bin_dir = root.path().join("bin");
        std::fs::create_dir_all(&bin_dir).expect("create bin");
        write_executable(&bin_dir.join(CLAUDE_BINARY), "#!/bin/sh\nexit 0\n");

        std::env::set_var("PATH", &bin_dir);
        std::env::set_var(CREDENTIALS_PATH_ENV, &credentials);

        assert!(crate::agent::llm_client::claude_cli_available());
        assert!(
            !claude_code_cli_authenticated(),
            "installing the CLI is not a login; logout would otherwise appear and do nothing"
        );
    }
}
