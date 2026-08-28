import { beforeEach, describe, expect, it } from "vitest";
import {
  clearDeferredThreadReloads,
  consumeDeferredThreadReload,
  deferThreadReload,
  hasDeferredThreadReload,
  shouldDeferThreadReload,
} from "./deferredThreadReload";

describe("deferredThreadReload", () => {
  beforeEach(clearDeferredThreadReloads);

  it("coalesces repeated background reload notices for one active thread", () => {
    deferThreadReload("thread-1");
    deferThreadReload("thread-1");

    expect(hasDeferredThreadReload("thread-1")).toBe(true);
    expect(consumeDeferredThreadReload("thread-1")).toBe(true);
    expect(consumeDeferredThreadReload("thread-1")).toBe(false);
  });

  it("defers persistence paste while assistant content is streaming", () => {
    expect(shouldDeferThreadReload([{
      id: "assistant",
      threadId: "thread-1",
      createdAt: 1,
      role: "assistant",
      content: "partial",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      isCompactionSummary: false,
      isStreaming: true,
    }])).toBe(true);
  });

  it("allows persistence paste after the assistant message is final", () => {
    expect(shouldDeferThreadReload([{
      id: "assistant",
      threadId: "thread-1",
      createdAt: 1,
      role: "assistant",
      content: "final",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      isCompactionSummary: false,
      isStreaming: false,
    }])).toBe(false);
  });
});
