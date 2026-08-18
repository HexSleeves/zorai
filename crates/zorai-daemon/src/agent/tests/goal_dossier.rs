use super::*;
use crate::session_manager::SessionManager;
use tempfile::tempdir;

#[tokio::test]
async fn goal_projection_writes_files_on_create_and_refresh() {
    let root = tempdir().expect("temp dir");
    let manager = SessionManager::new_test(root.path()).await;
    let engine = AgentEngine::new_test(manager, AgentConfig::default(), root.path()).await;

    let goal_run = engine
        .start_goal_run(
            "Ship goal projections".to_string(),
            Some("Goal projections".to_string()),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await;

    let projection_dir = root.path().join(".zorai/goals").join(&goal_run.id);
    let dossier_path = projection_dir.join("dossier.json");
    let proof_ledger_path = projection_dir.join("proof-ledger.json");
    let goal_md_path = projection_dir.join("goal.md");
    let inventory_dir = projection_dir.join("inventory");
    let specs_dir = inventory_dir.join("specs");
    let plans_dir = inventory_dir.join("plans");
    let execution_dir = inventory_dir.join("execution");

    assert!(projection_dir.exists(), "projection directory should exist");
    assert!(dossier_path.exists(), "dossier projection should exist");
    assert!(
        proof_ledger_path.exists(),
        "proof ledger projection should exist"
    );
    assert!(
        goal_md_path.exists(),
        "goal markdown projection should exist"
    );
    assert!(inventory_dir.exists(), "inventory directory should exist");
    assert!(specs_dir.exists(), "specs directory should exist");
    assert!(plans_dir.exists(), "plans directory should exist");
    assert!(execution_dir.exists(), "execution directory should exist");

    let ledger_md_path = specs_dir.join("ledger.md");
    let ledger_json_path = specs_dir.join("ledger.json");
    assert!(ledger_md_path.exists(), "loop ledger markdown should exist");
    assert!(ledger_json_path.exists(), "loop ledger json should exist");
    let ledger_markdown = tokio::fs::read_to_string(&ledger_md_path)
        .await
        .expect("read loop ledger markdown");
    for section in ["## Goal", "## Core", "## Verified", "## Open", "## Next"] {
        assert!(
            ledger_markdown.contains(section),
            "ledger markdown should contain the {section} section"
        );
    }
    assert!(
        ledger_markdown.contains("Ship goal projections"),
        "ledger should carry the goal text"
    );
    let ledger_json: serde_json::Value = serde_json::from_str(
        &tokio::fs::read_to_string(&ledger_json_path)
            .await
            .expect("read loop ledger json"),
    )
    .expect("loop ledger json should parse");
    assert!(
        ledger_json["core"].as_array().is_some_and(|items| !items.is_empty()),
        "ledger Core anchors should be non-empty"
    );
    assert!(
        ledger_json["next"].as_str().is_some_and(|next| !next.trim().is_empty()),
        "ledger Next should be a non-empty action"
    );

    let active_step_checkpoint =
        crate::agent::goal_dossier::goal_ledger_active_step_prompt_block(
            &engine.data_dir,
            &goal_run,
        )
        .await;
    assert!(active_step_checkpoint.contains("source:"));
    assert!(active_step_checkpoint.contains("ledger.json"));
    assert!(active_step_checkpoint.contains("current-step pointer:"));
    assert!(active_step_checkpoint.contains("## Core"));
    assert!(active_step_checkpoint.contains("## Next"));

    let resume_checkpoint = crate::agent::goal_dossier::goal_ledger_resume_checkpoint(
        &engine.data_dir,
        &goal_run.id,
    )
    .await
    .expect("persisted ledger should render a resume checkpoint");
    assert!(resume_checkpoint.contains("## Resume Ledger Checkpoint"));
    assert!(resume_checkpoint.contains("Core anchors:"));
    assert!(resume_checkpoint.contains("Next:"));

    let subagent_checkpoint =
        crate::agent::goal_dossier::goal_ledger_subagent_integration_checkpoint(
            &engine.data_dir,
            &goal_run.id,
        )
        .await
        .expect("persisted ledger should render a subagent integration checkpoint");
    assert!(subagent_checkpoint.contains("## Goal Ledger Integration Checkpoint"));
    assert!(subagent_checkpoint.contains("Already verified (do not re-derive):"));
    assert!(subagent_checkpoint.contains("Next:"));

    let initial_markdown = tokio::fs::read_to_string(&goal_md_path)
        .await
        .expect("read goal markdown");
    assert!(
        initial_markdown.contains("Ship goal projections"),
        "goal markdown should include the live goal text"
    );

    assert!(
        engine
            .control_goal_run(&goal_run.id, "pause", None, None)
            .await,
        "pausing the goal should succeed"
    );

    let refreshed_markdown = tokio::fs::read_to_string(&goal_md_path)
        .await
        .expect("read refreshed goal markdown");
    assert!(
        refreshed_markdown.contains("Goal paused"),
        "goal markdown should refresh after a state transition"
    );
}

#[tokio::test]
async fn persist_goal_runs_emits_goal_run_update_after_projection_refresh() {
    let root = tempdir().expect("temp dir");
    let manager = SessionManager::new_test(root.path()).await;
    let engine = AgentEngine::new_test(manager, AgentConfig::default(), root.path()).await;

    let goal_run = engine
        .start_goal_run(
            "Ship goal projections".to_string(),
            Some("Goal projections".to_string()),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await;

    let _delay_guard = crate::agent::goal_dossier::set_goal_projection_write_delay_for_tests(
        std::time::Duration::from_millis(250),
    );
    let mut events = engine.subscribe();

    let engine_for_persist = engine.clone();
    let persist = tokio::spawn(async move {
        engine_for_persist.persist_goal_runs().await;
    });

    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(100), events.recv())
            .await
            .is_err(),
        "projection-refresh updates must not be emitted before delayed writes complete"
    );

    let emitted = tokio::time::timeout(std::time::Duration::from_secs(1), events.recv())
        .await
        .expect("goal projection refresh should eventually emit a goal update")
        .expect("goal update event should arrive");

    match emitted {
        AgentEvent::GoalRunUpdate {
            goal_run_id,
            goal_run: Some(updated),
            ..
        } => {
            assert_eq!(goal_run_id, goal_run.id);
            assert_eq!(updated.id, goal_run.id);
        }
        other => panic!("expected goal run update, got {other:?}"),
    }

    persist.await.expect("persist task should finish");
}
