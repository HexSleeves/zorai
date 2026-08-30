import { describe, expect, it } from "vitest";
import type { AgentThread } from "./types";
import {
  clearThreadRuntimeOverlay,
  mergeRemoteThreadProfile,
  pinThreadRuntimeOverlay,
} from "./threadProfileMerge";

function thread(partial: Partial<AgentThread> = {}): AgentThread {
  return {
    id: "local-1",
    daemonThreadId: "daemon-1",
    workspaceId: null,
    surfaceId: null,
    paneId: null,
    agent_name: "Rod",
    title: "Chat",
    createdAt: 1,
    updatedAt: 1,
    messageCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    compactionCount: 0,
    lastMessagePreview: "",
    ...partial,
  };
}

describe("mergeRemoteThreadProfile", () => {
  it("keeps a pinned provider when a stale reload still reports the previous provider", () => {
    pinThreadRuntimeOverlay("local-1", {
      profileProvider: "z.ai-coding-plan",
      profileModel: "glm-5.3",
      profileReasoningEffort: "high",
      profileContextWindowTokens: 1_000_000,
    });

    const merged = mergeRemoteThreadProfile(
      thread({
        profileProvider: "z.ai-coding-plan",
        profileModel: "glm-5.3",
      }),
      thread({
        profileProvider: "ollama",
        profileModel: "glm-5.3:cloud",
        profileReasoningEffort: "high",
        profileContextWindowTokens: 1_000_000,
      }),
    );

    expect(merged).toMatchObject({
      profileProvider: "z.ai-coding-plan",
      profileModel: "glm-5.3",
    });
    clearThreadRuntimeOverlay("local-1");
  });

  it("keeps the local profile when the daemon list omits execution profile fields", () => {
    const merged = mergeRemoteThreadProfile(
      thread({
        profileProvider: "z.ai-coding-plan",
        profileModel: "glm-5.3",
        profileReasoningEffort: "high",
        profileContextWindowTokens: 1_000_000,
      }),
      thread({
        profileProvider: null,
        profileModel: null,
        profileReasoningEffort: null,
        profileContextWindowTokens: null,
      }),
    );

    expect(merged).toMatchObject({
      profileProvider: "z.ai-coding-plan",
      profileModel: "glm-5.3",
      profileReasoningEffort: "high",
      profileContextWindowTokens: 1_000_000,
    });
  });

  it("accepts the daemon profile once it matches the pinned selection", () => {
    pinThreadRuntimeOverlay("local-1", {
      profileProvider: "z.ai-coding-plan",
      profileModel: "glm-5.3",
      profileReasoningEffort: "high",
      profileContextWindowTokens: 1_000_000,
    });

    const merged = mergeRemoteThreadProfile(
      thread({
        profileProvider: "z.ai-coding-plan",
        profileModel: "glm-5.3",
      }),
      thread({
        profileProvider: "z.ai-coding-plan",
        profileModel: "glm-5.3",
        profileReasoningEffort: "high",
        profileContextWindowTokens: 1_000_000,
      }),
    );

    expect(merged.profileProvider).toBe("z.ai-coding-plan");
    expect(mergeRemoteThreadProfile(
      thread({ profileProvider: "z.ai-coding-plan", profileModel: "glm-5.3" }),
      thread({ profileProvider: "openai", profileModel: "gpt-5.5" }),
    )).toMatchObject({
      profileProvider: "openai",
      profileModel: "gpt-5.5",
    });
  });
});
