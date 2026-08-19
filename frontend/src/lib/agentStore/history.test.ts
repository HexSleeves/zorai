import { describe, expect, it } from "vitest";
import {
  buildHydratedRemoteThread,
  isGatewayAgentThread,
  isInternalAgentThread,
} from "./history.ts";

describe("agent thread classification", () => {
  it("recognizes internal daemon threads by id or title", () => {
    expect(isInternalAgentThread({ daemonThreadId: "dm:svarog:weles", title: "Review" })).toBe(true);
    expect(isInternalAgentThread({ title: "Internal DM · Swarog ↔ WELES" })).toBe(true);
    expect(isInternalAgentThread({ daemonThreadId: "thread-user-1", title: "Regular work" })).toBe(false);
  });

  it("recognizes gateway threads by daemon title", () => {
    expect(isGatewayAgentThread({ title: "slack Alice" })).toBe(true);
    expect(isGatewayAgentThread({ title: "discord Bob" })).toBe(true);
    expect(isGatewayAgentThread({ title: "Regular Conversation", lastMessagePreview: "[slack — Alice]: hello" })).toBe(true);
    expect(isGatewayAgentThread({ title: "Regular Conversation", lastMessagePreview: "plain message" })).toBe(false);
  });
});

describe("buildHydratedRemoteThread", () => {
  it("keeps internal daemon threads visible for the React thread browser", () => {
    const hydrated = buildHydratedRemoteThread(
      {
        id: "dm:svarog:weles",
        title: "Internal DM · Swarog ↔ WELES",
        messages: [
          {
            role: "assistant",
            content: "visible in internal tab",
            timestamp: 1,
          },
        ],
      },
      "Svarog",
    );

    expect(hydrated?.thread.daemonThreadId).toBe("dm:svarog:weles");
    expect(hydrated?.thread.title).toBe("Internal DM · Swarog ↔ WELES");
  });

  it("hydrates daemon runtime profile and active context-window token metadata", () => {
    const hydrated = buildHydratedRemoteThread(
      {
        id: "thread-runtime-context",
        title: "Runtime Context",
        profile_provider: "alibaba-coding-plan",
        profile_model: "glm-5",
        profile_reasoning_effort: "high",
        profile_context_window_tokens: 202_752,
        active_context_window_start: 2,
        active_context_window_end: 6,
        active_context_window_tokens: 12_345,
        messages: [],
      },
      "Svarog",
    );

    expect(hydrated?.thread.profileProvider).toBe("alibaba-coding-plan");
    expect(hydrated?.thread.profileModel).toBe("glm-5");
    expect(hydrated?.thread.profileReasoningEffort).toBe("high");
    expect(hydrated?.thread.profileContextWindowTokens).toBe(202_752);
    expect(hydrated?.thread.activeContextWindowStart).toBe(2);
    expect(hydrated?.thread.activeContextWindowEnd).toBe(6);
    expect(hydrated?.thread.activeContextWindowTokens).toBe(12_345);
  });

  it("hydrates authoritative thread handoff state", () => {
    const hydrated = buildHydratedRemoteThread(
      {
        id: "thread-handoff-state",
        title: "Responder state",
        thread_handoff_state: {
          origin_agent_id: "swarog",
          active_agent_id: "weles",
          responder_stack: [
            { agent_id: "swarog", agent_name: "Svarog", entered_at: 1 },
            { agent_id: "weles", agent_name: "Weles", entered_at: 2, linked_thread_id: "handoff:1" },
          ],
          pending_approval_id: null,
        },
        messages: [],
      },
      "Svarog",
    );

    expect(hydrated?.thread).toMatchObject({
      threadHandoffState: {
        originAgentId: "swarog",
        activeAgentId: "weles",
        responderStack: [
          { agentId: "swarog", agentName: "Svarog", enteredAt: 1, linkedThreadId: null },
          { agentId: "weles", agentName: "Weles", enteredAt: 2, linkedThreadId: "handoff:1" },
        ],
        pendingApprovalId: null,
      },
    });
  });

  it("normalizes unix-second thread timestamps to milliseconds", () => {
    const seconds = Math.floor(Date.now() / 1000);
    const hydrated = buildHydratedRemoteThread(
      {
        id: "thread-seconds",
        title: "Seconds stamp",
        created_at: seconds,
        updated_at: seconds,
        messages: [],
      },
      "Svarog",
    );

    expect(hydrated?.thread.updatedAt).toBe(seconds * 1000);
    expect(hydrated?.thread.createdAt).toBe(seconds * 1000);
  });
});
