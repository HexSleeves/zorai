import { normalizeBridgePayload } from "./daemonHelpers";
import type {
  AgentChatPanelRuntimeValue,
  OperationStatusView,
  ThreadMutationResult,
} from "./types";

type ActiveDaemonThread = {
  localThreadId: string;
  daemonThreadId: string;
};

type CollaborationBridge = Pick<
  ZoraiBridge,
  | "agentHandoffThread"
  | "agentThreadParticipantCommand"
  | "agentGetOperationStatus"
  | "agentCancelOperation"
  | "agentSendParticipantSuggestion"
  | "agentDismissParticipantSuggestion"
>;

type ThreadCollaborationActionDependencies = {
  getActiveDaemonThread: () => ActiveDaemonThread | null;
  getBridge: () => CollaborationBridge | null;
  reloadThread: (daemonThreadId: string) => Promise<void>;
  stopStreaming: (localThreadId: string) => void;
};

type ThreadCollaborationActions = Pick<
  AgentChatPanelRuntimeValue,
  | "pushHandoff"
  | "returnHandoff"
  | "upsertParticipant"
  | "deactivateParticipant"
  | "getOperationStatus"
  | "cancelOperation"
  | "sendParticipantSuggestion"
  | "dismissParticipantSuggestion"
>;

function missingDaemonThread(action: string): ThreadMutationResult {
  return {
    ok: false,
    error: `Send the first message to create the daemon thread before ${action}.`,
  };
}

function mutationFailure(error: unknown, fallback: string): ThreadMutationResult {
  return {
    ok: false,
    error: error instanceof Error ? error.message : fallback,
  };
}

function normalizeOperationState(value: unknown): OperationStatusView["state"] {
  const state = String(value ?? "unknown").toLowerCase().replace(/[\s-]+/g, "_");
  if (state === "accepted" || state === "queued") return "accepted";
  if (state === "started" || state === "running" || state === "in_progress") return "started";
  if (state === "completed" || state === "succeeded" || state === "success") return "completed";
  if (state === "failed" || state === "error") return "failed";
  return "unknown";
}

export function createThreadCollaborationActions({
  getActiveDaemonThread,
  getBridge,
  reloadThread,
  stopStreaming,
}: ThreadCollaborationActionDependencies): ThreadCollaborationActions {
  const pushHandoff: ThreadCollaborationActions["pushHandoff"] = async ({
    targetAgentId,
    reason,
    summary,
  }) => {
    const target = getActiveDaemonThread();
    if (!target) return missingDaemonThread("handing it off");

    const agentId = targetAgentId.trim();
    if (!agentId) return { ok: false, error: "A handoff target is required." };

    const bridge = getBridge();
    if (!bridge?.agentHandoffThread) {
      return { ok: false, error: "Thread handoff is not available in this runtime." };
    }

    try {
      const result = normalizeBridgePayload(await bridge.agentHandoffThread({
        threadId: target.daemonThreadId,
        action: "push_handoff",
        targetAgentId: agentId,
        reason: reason.trim(),
        summary: summary.trim(),
        sessionId: null,
      }));
      if (result?.ok === false) {
        return { ok: false, error: String(result.error ?? "Thread handoff failed.") };
      }
      await reloadThread(target.daemonThreadId);
      return { ok: true };
    } catch (error) {
      return mutationFailure(error, "Thread handoff failed.");
    }
  };

  const returnHandoff: ThreadCollaborationActions["returnHandoff"] = async ({
    reason,
    summary,
  }) => {
    const target = getActiveDaemonThread();
    if (!target) return missingDaemonThread("returning the handoff");

    const bridge = getBridge();
    if (!bridge?.agentHandoffThread) {
      return { ok: false, error: "Thread handoff is not available in this runtime." };
    }

    try {
      const result = normalizeBridgePayload(await bridge.agentHandoffThread({
        threadId: target.daemonThreadId,
        action: "return_handoff",
        targetAgentId: null,
        reason: reason.trim(),
        summary: summary.trim(),
        sessionId: null,
      }));
      if (result?.ok === false) {
        return { ok: false, error: String(result.error ?? "Thread handoff return failed.") };
      }
      await reloadThread(target.daemonThreadId);
      return { ok: true };
    } catch (error) {
      return mutationFailure(error, "Thread handoff return failed.");
    }
  };

  const upsertParticipant: ThreadCollaborationActions["upsertParticipant"] = async ({
    targetAgentId,
    instruction,
  }) => {
    const target = getActiveDaemonThread();
    if (!target) return missingDaemonThread("updating participants");

    const agentId = targetAgentId.trim();
    const nextInstruction = instruction.trim();
    if (!agentId || !nextInstruction) {
      return { ok: false, error: "Participant and instruction are required." };
    }

    const bridge = getBridge();
    if (!bridge?.agentThreadParticipantCommand) {
      return { ok: false, error: "Thread participants are not available in this runtime." };
    }

    try {
      const result = normalizeBridgePayload(await bridge.agentThreadParticipantCommand({
        threadId: target.daemonThreadId,
        targetAgentId: agentId,
        action: "upsert",
        instruction: nextInstruction,
        sessionId: null,
      }));
      if (result?.ok === false) {
        return { ok: false, error: String(result.error ?? "Participant update failed.") };
      }
      await reloadThread(target.daemonThreadId);
      return { ok: true };
    } catch (error) {
      return mutationFailure(error, "Participant update failed.");
    }
  };

  const deactivateParticipant: ThreadCollaborationActions["deactivateParticipant"] = async (
    targetAgentId,
  ) => {
    const target = getActiveDaemonThread();
    if (!target) return missingDaemonThread("deactivating participants");

    const agentId = targetAgentId.trim();
    if (!agentId) return { ok: false, error: "A participant is required." };

    const bridge = getBridge();
    if (!bridge?.agentThreadParticipantCommand) {
      return { ok: false, error: "Thread participants are not available in this runtime." };
    }

    try {
      const result = normalizeBridgePayload(await bridge.agentThreadParticipantCommand({
        threadId: target.daemonThreadId,
        targetAgentId: agentId,
        action: "deactivate",
        instruction: null,
        sessionId: null,
      }));
      if (result?.ok === false) {
        return { ok: false, error: String(result.error ?? "Participant deactivation failed.") };
      }
      await reloadThread(target.daemonThreadId);
      return { ok: true };
    } catch (error) {
      return mutationFailure(error, "Participant deactivation failed.");
    }
  };

  const getOperationStatus: ThreadCollaborationActions["getOperationStatus"] = async (
    operationId,
  ) => {
    const id = operationId.trim();
    const bridge = getBridge();
    if (!bridge?.agentGetOperationStatus || !id) return null;

    try {
      const payload = normalizeBridgePayload(await bridge.agentGetOperationStatus(id));
      if (payload?.ok === false) return null;
      const resolvedId = typeof payload?.operation_id === "string" ? payload.operation_id : id;
      if (!resolvedId) return null;
      return {
        operationId: resolvedId,
        kind: typeof payload?.kind === "string" ? payload.kind : "unknown",
        state: normalizeOperationState(payload?.state),
        revision: Number.isFinite(Number(payload?.revision)) ? Number(payload.revision) : 0,
        dedup: typeof payload?.dedup === "string" ? payload.dedup : null,
      };
    } catch {
      return null;
    }
  };

  const cancelOperation: ThreadCollaborationActions["cancelOperation"] = async (operationId) => {
    const id = operationId.trim();
    if (!id) return { ok: false, error: "An operation ID is required." };

    const bridge = getBridge();
    if (!bridge?.agentCancelOperation) {
      return { ok: false, error: "Operation cancellation is not available in this runtime." };
    }

    try {
      const result = normalizeBridgePayload(await bridge.agentCancelOperation(id));
      return result?.ok === false
        ? { ok: false, error: String(result.error ?? "Operation cancellation failed.") }
        : { ok: true };
    } catch (error) {
      return mutationFailure(error, "Operation cancellation failed.");
    }
  };

  const sendParticipantSuggestion: ThreadCollaborationActions["sendParticipantSuggestion"] = async (
    threadId,
    suggestionId,
    forceSend = false,
  ) => {
    const bridge = getBridge();
    if (!bridge?.agentSendParticipantSuggestion) return;

    const target = getActiveDaemonThread();
    if (forceSend && target?.daemonThreadId === threadId) {
      stopStreaming(target.localThreadId);
    }
    const result = normalizeBridgePayload(await bridge.agentSendParticipantSuggestion({
      threadId,
      suggestionId,
      sessionId: null,
      forceSend,
    }));
    if (result?.ok !== false) await reloadThread(threadId);
  };

  const dismissParticipantSuggestion: ThreadCollaborationActions["dismissParticipantSuggestion"] = async (
    threadId,
    suggestionId,
  ) => {
    const bridge = getBridge();
    if (!bridge?.agentDismissParticipantSuggestion) return;

    const result = normalizeBridgePayload(await bridge.agentDismissParticipantSuggestion({
      threadId,
      suggestionId,
      sessionId: null,
    }));
    if (result?.ok !== false) await reloadThread(threadId);
  };

  return {
    pushHandoff,
    returnHandoff,
    upsertParticipant,
    deactivateParticipant,
    getOperationStatus,
    cancelOperation,
    sendParticipantSuggestion,
    dismissParticipantSuggestion,
  };
}
