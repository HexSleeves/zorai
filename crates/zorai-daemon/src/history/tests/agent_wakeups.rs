use super::*;
use crate::history::schema_helpers::table_has_column_sync;

#[tokio::test]
async fn init_schema_backfills_legacy_goal_supervision_wakeups() -> Result<()> {
    let (store, root) = make_test_store().await?;

    store
        .conn
        .call(|conn| {
            conn.execute_batch(
                "DROP TABLE IF EXISTS agent_wakeups;
                 CREATE TABLE agent_wakeups (
                    id TEXT PRIMARY KEY,
                    thread_id TEXT NOT NULL,
                    message TEXT NOT NULL,
                    interval_ms INTEGER NOT NULL,
                    next_fire_at INTEGER NOT NULL,
                    repetitions_remaining INTEGER,
                    created_at INTEGER NOT NULL
                 );
                 INSERT INTO agent_wakeups VALUES (
                    'wakeup-goal',
                    'thread-1',
                    'Supervise goal_abc123. Check status.',
                    600000,
                    600000,
                    NULL,
                    1
                 );
                 INSERT INTO agent_wakeups VALUES (
                    'wakeup-ambiguous',
                    'thread-1',
                    'Please Supervise generic reminder mentioning goal_wrong',
                    600000,
                    600000,
                    NULL,
                    1
                 );
                 INSERT INTO agent_wakeups VALUES (
                    'wakeup-generic',
                    'thread-1',
                    'Drink water',
                    600000,
                    600000,
                    NULL,
                    1
                 );",
            )?;
            Ok(())
        })
        .await
        .map_err(|error| anyhow::anyhow!("{error}"))?;

    store.init_schema().await?;

    let migrated = store
        .conn
        .call(|conn| {
            let has_kind = table_has_column_sync(conn, "agent_wakeups", "wakeup_kind")?;
            let has_goal = table_has_column_sync(conn, "agent_wakeups", "goal_run_id")?;
            let goal: (String, Option<String>, Option<i64>) = conn.query_row(
                "SELECT wakeup_kind, goal_run_id, repetitions_remaining FROM agent_wakeups WHERE id = 'wakeup-goal'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )?;
            let ambiguous: (String, Option<String>, Option<i64>) = conn.query_row(
                "SELECT wakeup_kind, goal_run_id, repetitions_remaining FROM agent_wakeups WHERE id = 'wakeup-ambiguous'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )?;
            let generic: (String, Option<String>, Option<i64>) = conn.query_row(
                "SELECT wakeup_kind, goal_run_id, repetitions_remaining FROM agent_wakeups WHERE id = 'wakeup-generic'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )?;
            Ok((has_kind, has_goal, goal, ambiguous, generic))
        })
        .await
        .map_err(|error| anyhow::anyhow!("{error}"))?;

    assert!(migrated.0);
    assert!(migrated.1);
    assert_eq!(migrated.2 .0, "goal_supervision");
    assert_eq!(migrated.2 .1.as_deref(), Some("goal_abc123"));
    assert_eq!(migrated.2 .2, Some(1));
    assert_eq!(migrated.3 .0, "generic");
    assert_eq!(migrated.3 .1, None);
    assert_eq!(migrated.3 .2, None);
    assert_eq!(migrated.4 .0, "generic");
    assert_eq!(migrated.4 .1, None);
    assert_eq!(migrated.4 .2, None);

    let _ = std::fs::remove_dir_all(root);
    Ok(())
}
