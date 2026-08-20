import { describe, expect, it, vi } from "vitest";
import { createThreadCollaborationActions } from "./threadCollaborationActions";

function makeHarness({ daemonThread = true }: { daemonThread?: boolean } = {}) {
  const bridge = {
    agentHandoffThread: vi.fn(async () => ({ ok: true })),
    agentThreadParticipantCommand: vi.fn(async () => ({ ok: true })),
    agentGetOperationStatus: vi.fn(async () => ({
      operation_id: "op-1",
      kind: "shell",
      state: "in_progress",
      revision: 4,
      dedup: "run-1",
    })),
    agentCancelOperation: vi.fn(async () => ({ ok: true })),
    agentSendParticipantSuggestion: vi.fn(async () => ({ ok: true })),
    agentDismissParticipantSuggestion: vi.fn(async () => ({ ok: true })),
  };
  const reloadThread = vi.fn(async () => undefined);
  const stopStreaming = vi.fn();
  const actions = createThreadCollaborationActions({
    getActiveDaemonThread: () => daemonThread
      ? { localThreadId: "local-1", daemonThreadId: "daemon-1" }
      : null,
    getBridge: () => bridge as unknown as ZoraiBridge,
    reloadThread,
    stopStreaming,
  });
  return { actions, bridge, reloadThread, stopStreaming };
}

describe("createThreadCollaborationActions", () => {
  it("refuses handoff for a local-only thread with an actionable error", async () => {
    const { actions, bridge, reloadThread } = makeHarness({ daemonThread: false });

    await expect(actions.pushHandoff({
      targetAgentId: "weles",
      reason: "Operator requested handoff",
      summary: "Continue the thread",
    })).resolves.toEqual({
      ok: false,
      error: "Send the first message to create the daemon thread before handing it off.",
    });
    expect(bridge.agentHandoffThread).not.toHaveBeenCalled();
    expect(reloadThread).not.toHaveBeenCalled();
  });

  it("pushes and returns handoff through the bridge, then reloads authoritative state", async () => {
    const { actions, bridge, reloadThread } = makeHarness();

    await expect(actions.pushHandoff({
      targetAgentId: " weles ",
      reason: " operator choice ",
      summary: " continue ",
    })).resolves.toEqual({ ok: true });
    expect(bridge.agentHandoffThread).toHaveBeenNthCalledWith(1, {
      threadId: "daemon-1",
      action: "push_handoff",
      targetAgentId: "weles",
      reason: "operator choice",
      summary: "continue",
      sessionId: null,
    });

    await expect(actions.returnHandoff({
      reason: " return now ",
      summary: " resume ownership ",
    })).resolves.toEqual({ ok: true });
    expect(bridge.agentHandoffThread).toHaveBeenNthCalledWith(2, {
      threadId: "daemon-1",
      action: "return_handoff",
      targetAgentId: null,
      reason: "return now",
      summary: "resume ownership",
      sessionId: null,
    });
    expect(reloadThread).toHaveBeenNthCalledWith(1, "daemon-1");
    expect(reloadThread).toHaveBeenNthCalledWith(2, "daemon-1");
  });

  it("normalizes daemon mutation errors without reloading", async () => {
    const { actions, bridge, reloadThread } = makeHarness();
    bridge.agentHandoffThread.mockResolvedValueOnce({ ok: false, error: "target inactive" });

    await expect(actions.pushHandoff({
      targetAgentId: "weles",
      reason: "handoff",
      summary: "continue",
    })).resolves.toEqual({ ok: false, error: "target inactive" });
    expect(reloadThread).not.toHaveBeenCalled();
  });

  it("upserts and deactivates participants, reloading after each success", async () => {
    const { actions, bridge, reloadThread } = makeHarness();

    await expect(actions.upsertParticipant({
      targetAgentId: " weles ",
      instruction: " review the patch ",
    })).resolves.toEqual({ ok: true });
    expect(bridge.agentThreadParticipantCommand).toHaveBeenNthCalledWith(1, {
      threadId: "daemon-1",
      targetAgentId: "weles",
      action: "upsert",
      instruction: "review the patch",
      sessionId: null,
    });

    await expect(actions.deactivateParticipant(" weles ")).resolves.toEqual({ ok: true });
    expect(bridge.agentThreadParticipantCommand).toHaveBeenNthCalledWith(2, {
      threadId: "daemon-1",
      targetAgentId: "weles",
      action: "deactivate",
      instruction: null,
      sessionId: null,
    });
    expect(reloadThread).toHaveBeenCalledTimes(2);
  });

  it("passes forceSend explicitly, stops only the matching active stream, and reloads", async () => {
    const { actions, bridge, reloadThread, stopStreaming } = makeHarness();

    await actions.sendParticipantSuggestion("daemon-1", "suggestion-1", true);
    expect(stopStreaming).toHaveBeenCalledWith("local-1");
    expect(bridge.agentSendParticipantSuggestion).toHaveBeenCalledWith({
      threadId: "daemon-1",
      suggestionId: "suggestion-1",
      sessionId: null,
      forceSend: true,
    });
    expect(reloadThread).toHaveBeenCalledWith("daemon-1");

    await actions.sendParticipantSuggestion("daemon-other", "suggestion-2", true);
    expect(stopStreaming).toHaveBeenCalledTimes(1);
  });

  it("dismisses suggestions and reloads authoritative state", async () => {
    const { actions, bridge, reloadThread } = makeHarness();

    await actions.dismissParticipantSuggestion("daemon-1", "suggestion-1");
    expect(bridge.agentDismissParticipantSuggestion).toHaveBeenCalledWith({
      threadId: "daemon-1",
      suggestionId: "suggestion-1",
      sessionId: null,
    });
    expect(reloadThread).toHaveBeenCalledWith("daemon-1");
  });

  it("normalizes operation status and routes cancellation to the bridge", async () => {
    const { actions, bridge } = makeHarness();

    await expect(actions.getOperationStatus(" op-1 ")).resolves.toEqual({
      operationId: "op-1",
      kind: "shell",
      state: "started",
      revision: 4,
      dedup: "run-1",
    });
    expect(bridge.agentGetOperationStatus).toHaveBeenCalledWith("op-1");

    await expect(actions.cancelOperation(" op-1 ")).resolves.toEqual({ ok: true });
    expect(bridge.agentCancelOperation).toHaveBeenCalledWith("op-1");
  });
});
