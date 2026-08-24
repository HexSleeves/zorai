use super::*;
use zorai_protocol::QueuedPromptRecord;

pub(crate) const MAX_QUEUED_PROMPTS: usize = 500;

fn map_queued_prompt(row: &db::Row) -> anyhow::Result<QueuedPromptRecord> {
    Ok(QueuedPromptRecord {
        id: row.get(0)?,
        thread_id: row.get(1)?,
        position: row.get::<i64>(2)?,
        content: row.get(3)?,
        content_blocks_json: row.get(4)?,
        created_at: row.get::<i64>(5)?.max(0) as u64,
    })
}

impl HistoryStore {
    pub(crate) async fn count_queued_prompts(&self, thread_id: &str) -> Result<usize> {
        let rows = self
            .interactive_read_db
            .query(
                "SELECT COUNT(*) FROM thread_prompt_queue WHERE thread_id = ?1",
                db::db_params![thread_id],
            )
            .await?;
        let count = rows
            .first()
            .map(|row| row.get::<i64>(0))
            .transpose()?
            .unwrap_or(0)
            .max(0) as usize;
        Ok(count)
    }

    pub(crate) async fn list_queued_prompts(
        &self,
        thread_id: Option<&str>,
    ) -> Result<Vec<QueuedPromptRecord>> {
        let rows = if let Some(thread_id) = thread_id {
            self.interactive_read_db
                .query(
                    "SELECT id, thread_id, position, content, content_blocks_json, created_at
                     FROM thread_prompt_queue
                     WHERE thread_id = ?1
                     ORDER BY position ASC, created_at ASC, id ASC",
                    db::db_params![thread_id],
                )
                .await?
        } else {
            self.interactive_read_db
                .query(
                    "SELECT id, thread_id, position, content, content_blocks_json, created_at
                     FROM thread_prompt_queue
                     ORDER BY thread_id ASC, position ASC, created_at ASC, id ASC",
                    db::Params::None,
                )
                .await?
        };
        rows.iter()
            .map(map_queued_prompt)
            .collect::<anyhow::Result<Vec<_>>>()
    }

    pub(crate) async fn enqueue_prompt(
        &self,
        thread_id: &str,
        content: &str,
        content_blocks_json: Option<&str>,
        prompt_id: Option<&str>,
    ) -> Result<QueuedPromptRecord> {
        let count = self.count_queued_prompts(thread_id).await?;
        if count >= MAX_QUEUED_PROMPTS {
            anyhow::bail!("QUEUE FULL ({MAX_QUEUED_PROMPTS}); send or clear queued messages first");
        }
        let id = prompt_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let created_at = now_ts();
        let position_rows = self
            .interactive_read_db
            .query(
                "SELECT COALESCE(MAX(position), 0) FROM thread_prompt_queue WHERE thread_id = ?1",
                db::db_params![thread_id],
            )
            .await?;
        let next_position = position_rows
            .first()
            .map(|row| row.get::<i64>(0))
            .transpose()?
            .unwrap_or(0)
            + 1;
        self.conn_db
            .execute(
                "INSERT INTO thread_prompt_queue
                    (id, thread_id, position, content, content_blocks_json, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                db::db_params![
                    id.clone(),
                    thread_id,
                    next_position,
                    content,
                    content_blocks_json,
                    created_at as i64,
                ],
            )
            .await?;
        Ok(QueuedPromptRecord {
            id,
            thread_id: thread_id.to_string(),
            content: content.to_string(),
            content_blocks_json: content_blocks_json.map(ToOwned::to_owned),
            created_at,
            position: next_position,
        })
    }

    pub(crate) async fn update_queued_prompt(
        &self,
        thread_id: &str,
        prompt_id: &str,
        content: &str,
        content_blocks_json: Option<&str>,
    ) -> Result<bool> {
        let updated = self
            .conn_db
            .execute(
                "UPDATE thread_prompt_queue
                 SET content = ?1, content_blocks_json = ?2
                 WHERE id = ?3 AND thread_id = ?4",
                db::db_params![content, content_blocks_json, prompt_id, thread_id],
            )
            .await?;
        Ok(updated > 0)
    }

    pub(crate) async fn delete_queued_prompt(
        &self,
        thread_id: &str,
        prompt_id: &str,
    ) -> Result<Option<QueuedPromptRecord>> {
        let rows = self
            .conn_db
            .query(
                "DELETE FROM thread_prompt_queue
                 WHERE id = ?1 AND thread_id = ?2
                 RETURNING id, thread_id, position, content, content_blocks_json, created_at",
                db::db_params![prompt_id, thread_id],
            )
            .await?;
        rows.first().map(map_queued_prompt).transpose()
    }

    pub(crate) async fn dequeue_next_prompt(
        &self,
        thread_id: &str,
    ) -> Result<Option<QueuedPromptRecord>> {
        let rows = self
            .conn_db
            .query(
                "DELETE FROM thread_prompt_queue
                 WHERE id = (
                    SELECT id FROM thread_prompt_queue
                    WHERE thread_id = ?1
                    ORDER BY position ASC, created_at ASC, id ASC
                    LIMIT 1
                 )
                 RETURNING id, thread_id, position, content, content_blocks_json, created_at",
                db::db_params![thread_id],
            )
            .await?;
        rows.first().map(map_queued_prompt).transpose()
    }
}
