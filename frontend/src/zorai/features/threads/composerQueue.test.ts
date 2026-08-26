import { describe, expect, it } from "vitest";
import {
  EMPTY_PROMPT_QUEUE,
  createQueuedComposerMessage,
  queuedComposerLabel,
  queuedPromptsFromDaemon,
  readPromptQueueResponse,
  reconcileSentQueuedPromptMessages,
  sameQueuedPrompts,
  shouldApplyPromptQueueSnapshot,
} from "./composerQueue";
import { MAX_CACHED_PROMPT_QUEUES, selectThreadPromptQueue, usePromptQueueStore } from "./promptQueueStore";

describe("queued composer follow-ups", () => {
  it("keeps media blocks on a queued payload instead of flattening to text", () => {
    const queued = createQueuedComposerMessage({
      text: "",
      contentBlocksJson: '[{"type":"image","data_url":"data:image/png;base64,abc"}]',
      localContentBlocks: [{ type: "image", data_url: "data:image/png;base64,abc", mime_type: "image/png" }],
    });

    expect(queued.contentBlocksJson).toContain("image");
    expect(queued.localContentBlocks).toHaveLength(1);
    expect(queuedComposerLabel(queued)).toBe("(attachment)");
    expect(queued.id.length).toBeGreaterThan(0);
  });

  it("hydrates daemon-owned queue records into composer chips", () => {
    const prompts = queuedPromptsFromDaemon([
      {
        id: "prompt-1",
        thread_id: "thread-a",
        content: "stay on the migration",
        content_blocks_json: '[{"type":"image"}]',
      },
    ]);
    expect(prompts).toEqual([
      {
        id: "prompt-1",
        text: "stay on the migration",
        contentBlocksJson: '[{"type":"image"}]',
      },
    ]);
  });

  it("does not let an older IPC snapshot resurrect prompts cleared by a daemon event", () => {
    expect(shouldApplyPromptQueueSnapshot(4, 4)).toBe(true);
    expect(shouldApplyPromptQueueSnapshot(4, 5)).toBe(false);
  });

  it("shows a sent queued prompt before an assistant stream that raced ahead", () => {
    const interruptedAssistant = {
      id: "assistant-interrupted",
      threadId: "local-thread",
      createdAt: 5,
      role: "assistant",
      content: "old partial answer",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      isCompactionSummary: false,
      isStreaming: true,
    } as const;
    const streamingAssistant = {
      id: "assistant-local",
      threadId: "local-thread",
      createdAt: 20,
      role: "assistant",
      content: "partial answer",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      isCompactionSummary: false,
      isStreaming: true,
    } as const;
    const messages = reconcileSentQueuedPromptMessages(
      [interruptedAssistant, streamingAssistant],
      "local-thread",
      {
        id: "prompt-1",
        text: "send this now",
        contentBlocksJson: '[{"type":"image","data_url":"data:image/png;base64,abc"}]',
      },
      10,
      1,
    );

    expect(messages.map((message) => message.id)).toEqual([
      "assistant-interrupted",
      "queued-prompt:prompt-1",
      "assistant-local",
    ]);
    expect(messages[1]).toMatchObject({
      id: "queued-prompt:prompt-1",
      content: "send this now",
      contentBlocks: [{ type: "image" }],
    });
  });

  it("adopts an authoritative queued user row that arrives before Send now reconciliation", () => {
    const prompt = {
      id: "prompt-1",
      text: "send this now",
      contentBlocksJson: '[{"type":"image","data_url":"data:image/png;base64,abc"}]',
    };
    const authoritative = {
      id: "daemon-user-1",
      threadId: "local-thread",
      createdAt: 20,
      role: "user",
      content: "send this now",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      isCompactionSummary: false,
    } as const;

    const messages = reconcileSentQueuedPromptMessages(
      [authoritative],
      "local-thread",
      prompt,
      21,
      0,
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: "daemon-user-1",
      contentBlocks: [{ type: "image" }],
    });
  });

  it("does not duplicate a sent queued prompt during repeated reconciliation", () => {
    const prompt = { id: "prompt-1", text: "send once" };
    const once = reconcileSentQueuedPromptMessages([], "local-thread", prompt, 10);
    const twice = reconcileSentQueuedPromptMessages(once, "local-thread", prompt, 11);
    expect(twice).toBe(once);
    expect(twice).toHaveLength(1);
  });

  it("reads a prompt-queue IPC payload without mixing other threads", () => {
    const parsed = readPromptQueueResponse({
      thread_id: "thread-a",
      prompts: [{ id: "prompt-1", thread_id: "thread-a", content: "later" }],
    });
    expect(parsed.threadId).toBe("thread-a");
    expect(parsed.prompts).toHaveLength(1);
    expect(parsed.prompts[0]?.text).toBe("later");
  });

  it("keeps an empty thread queue referentially stable so React does not loop", () => {
    usePromptQueueStore.setState({ byThreadId: {} });
    const first = selectThreadPromptQueue(usePromptQueueStore.getState(), "thread-a");
    const missing = selectThreadPromptQueue(usePromptQueueStore.getState(), undefined);
    expect(first).toBe(EMPTY_PROMPT_QUEUE);
    expect(missing).toBe(EMPTY_PROMPT_QUEUE);

    usePromptQueueStore.getState().setQueue("thread-a", []);
    expect(selectThreadPromptQueue(usePromptQueueStore.getState(), "thread-a")).toBe(EMPTY_PROMPT_QUEUE);
    expect(sameQueuedPrompts(EMPTY_PROMPT_QUEUE, queuedPromptsFromDaemon([]))).toBe(true);
  });

  it("bounds thread queues and refreshes recency when a cached thread is touched", () => {
    usePromptQueueStore.setState({ byThreadId: {} });
    for (let index = 0; index < MAX_CACHED_PROMPT_QUEUES; index += 1) {
      usePromptQueueStore.getState().setQueue(`thread-${index}`, []);
    }

    usePromptQueueStore.getState().setQueue("thread-0", []);
    usePromptQueueStore.getState().setQueue("thread-new", []);

    const cachedIds = Object.keys(usePromptQueueStore.getState().byThreadId);
    expect(cachedIds).toHaveLength(MAX_CACHED_PROMPT_QUEUES);
    expect(cachedIds).toContain("thread-0");
    expect(cachedIds).toContain("thread-new");
    expect(cachedIds).not.toContain("thread-1");
  });
});
