use super::*;
use zorai_shared::providers::{PROVIDER_ID_CLAUDE_CODE_CLI, PROVIDER_ID_GITHUB_COPILOT};

#[tokio::test]
async fn custom_auth_api_key_marks_custom_provider_authenticated() {
    let _lock = crate::test_support::env_test_lock();
    let _guard = EnvGuard::new(&["ZORAI_CUSTOM_AUTH_PATH"]);
    let root = tempdir().unwrap();
    let custom_auth_path = root.path().join("custom-auth.yaml");
    std::fs::write(
        &custom_auth_path,
        r#"
providers:
  - id: local-openai
    name: Local OpenAI-Compatible
    default_base_url: http://127.0.0.1:11434/v1
    default_model: llama3.3
    api_key: local-secret
    models:
      - id: llama3.3
        context_window: 128000
"#,
    )
    .expect("write custom auth");
    std::env::set_var("ZORAI_CUSTOM_AUTH_PATH", &custom_auth_path);

    let manager = SessionManager::new_test(root.path()).await;
    let engine = AgentEngine::new_test(manager, AgentConfig::default(), root.path()).await;

    let states = engine.get_provider_auth_states().await;
    let custom = states
        .into_iter()
        .find(|state| state.provider_id == "local-openai")
        .expect("custom provider auth state should be present");

    assert!(custom.authenticated);
    assert_eq!(custom.model, "llama3.3");
    assert_eq!(custom.base_url, "http://127.0.0.1:11434/v1");
}

#[tokio::test]
async fn copilot_auth_states_include_provider_row_when_unconfigured() {
    let _lock = crate::agent::provider_auth_store::provider_auth_test_env_lock();
    let _guard = EnvGuard::new(&[
        "ZORAI_GITHUB_COPILOT_DISABLE_GH_CLI",
        "ZORAI_PROVIDER_AUTH_DB_PATH",
        "COPILOT_GITHUB_TOKEN",
        "GITHUB_TOKEN",
        "GH_TOKEN",
    ]);
    let root = tempdir().unwrap();
    let manager = SessionManager::new_test(root.path()).await;
    let engine = AgentEngine::new_test(manager, AgentConfig::default(), root.path()).await;
    std::env::set_var("ZORAI_GITHUB_COPILOT_DISABLE_GH_CLI", "1");
    std::env::set_var(
        "ZORAI_PROVIDER_AUTH_DB_PATH",
        root.path().join("provider-auth.db"),
    );
    std::env::remove_var("COPILOT_GITHUB_TOKEN");
    std::env::remove_var("GITHUB_TOKEN");
    std::env::remove_var("GH_TOKEN");

    let states = engine.get_provider_auth_states().await;
    let copilot = states
        .into_iter()
        .find(|state| state.provider_id == PROVIDER_ID_GITHUB_COPILOT)
        .expect("github copilot provider row should be present");

    assert!(!copilot.authenticated);
    assert_eq!(copilot.auth_source, AuthSource::GithubCopilot);
}

#[tokio::test]
async fn claude_code_logout_clears_cli_credentials_from_auth_states() {
    let _lock = crate::agent::provider_auth_store::provider_auth_test_env_lock();
    let _guard = EnvGuard::new(&["PATH", "ZORAI_CLAUDE_CODE_CREDENTIALS_PATH"]);
    let root = tempdir().unwrap();
    let credentials = root.path().join("credentials.json");
    std::fs::write(&credentials, "{\"claudeAiOauth\":{}}").expect("write credentials");

    let bin_dir = root.path().join("bin");
    std::fs::create_dir_all(&bin_dir).expect("create bin");
    let claude_path = bin_dir.join("claude");
    std::fs::write(
        &claude_path,
        "#!/bin/sh\nif [ \"$1\" = \"auth\" ] && [ \"$2\" = \"logout\" ]; then exit 0; fi\nexit 1\n",
    )
    .expect("write fake claude");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&claude_path)
            .expect("stat fake claude")
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&claude_path, perms).expect("chmod fake claude");
    }

    std::env::set_var("PATH", &bin_dir);
    std::env::set_var("ZORAI_CLAUDE_CODE_CREDENTIALS_PATH", &credentials);

    let manager = SessionManager::new_test(root.path()).await;
    let engine = AgentEngine::new_test(manager, AgentConfig::default(), root.path()).await;

    let before = engine
        .get_provider_auth_states()
        .await
        .into_iter()
        .find(|state| state.provider_id == PROVIDER_ID_CLAUDE_CODE_CLI)
        .expect("claude-code-cli row");
    assert!(
        before.authenticated,
        "Claude Code should be authenticated from CLI credentials before logout"
    );

    crate::agent::claude_code_auth::logout_claude_code_cli().expect("logout");

    let after = engine
        .get_provider_auth_states()
        .await
        .into_iter()
        .find(|state| state.provider_id == PROVIDER_ID_CLAUDE_CODE_CLI)
        .expect("claude-code-cli row");
    assert!(
        !after.authenticated,
        "logout must stop reporting Claude Code as authenticated; the claude binary can remain on PATH"
    );
    assert!(!credentials.exists());
}
