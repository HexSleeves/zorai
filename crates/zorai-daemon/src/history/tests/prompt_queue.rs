use super::*;
use crate::history::prompt_queue::MAX_QUEUED_PROMPTS;

#[tokio::test]
async fn prompt_queue_persists_update_cancel_and_fifo_dequeue() -> Result<()> {
    let (store, _root) = make_test_store().await?;
    store.init_schema().await?;

    let first = store
        .enqueue_prompt("thread-a", "first", None, Some("prompt-1"))
        .await?;
    let second = store
        .enqueue_prompt("thread-a", "second", Some("[{\"type\":\"text\"}]"), None)
        .await?;
    store
        .enqueue_prompt("thread-b", "other-thread", None, None)
        .await?;

    assert_eq!(first.id, "prompt-1");
    assert_eq!(store.count_queued_prompts("thread-a").await?, 2);
    assert_eq!(store.list_queued_prompts(Some("thread-a")).await?.len(), 2);

    assert!(
        store
            .update_queued_prompt("thread-a", "prompt-1", "first-edited", None)
            .await?
    );
    let listed = store.list_queued_prompts(Some("thread-a")).await?;
    assert_eq!(listed[0].content, "first-edited");
    assert_eq!(listed[1].id, second.id);
    assert_eq!(
        listed[1].content_blocks_json.as_deref(),
        Some("[{\"type\":\"text\"}]")
    );

    let dequeued = store.dequeue_next_prompt("thread-a").await?.expect("fifo");
    assert_eq!(dequeued.id, "prompt-1");
    assert_eq!(dequeued.content, "first-edited");
    assert_eq!(store.count_queued_prompts("thread-a").await?, 1);

    let cancelled = store
        .delete_queued_prompt("thread-a", &second.id)
        .await?
        .expect("cancel");
    assert_eq!(cancelled.id, second.id);
    assert!(store
        .list_queued_prompts(Some("thread-a"))
        .await?
        .is_empty());
    assert_eq!(store.list_queued_prompts(None).await?.len(), 1);
    Ok(())
}

#[tokio::test]
async fn prompt_queue_refuses_when_full() -> Result<()> {
    let (store, _root) = make_test_store().await?;
    store.init_schema().await?;
    for index in 0..MAX_QUEUED_PROMPTS {
        store
            .enqueue_prompt("thread-full", &format!("item-{index}"), None, None)
            .await?;
    }
    let err = store
        .enqueue_prompt("thread-full", "overflow", None, None)
        .await
        .expect_err("cap");
    assert!(err.to_string().contains("QUEUE FULL"));
    assert_eq!(
        store.count_queued_prompts("thread-full").await?,
        MAX_QUEUED_PROMPTS
    );
    Ok(())
}
