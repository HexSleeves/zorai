import { describe, expect, it } from "vitest";
import {
  EMPTY_PROMPT_QUEUE,
  createQueuedComposerMessage,
  queuedComposerLabel,
  queuedPromptsFromDaemon,
  readPromptQueueResponse,
  sameQueuedPrompts,
} from "./composerQueue";
import { selectThreadPromptQueue, usePromptQueueStore } from "./promptQueueStore";

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
});
