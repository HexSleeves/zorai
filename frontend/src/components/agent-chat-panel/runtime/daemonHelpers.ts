import type { Dispatch, SetStateAction } from "react";
import { buildHydratedRemoteMessage, buildHydratedRemoteThread, canonicalizeHydratedToolCalls, useAgentStore } from "@/lib/agentStore";
import type {
  AgentMessage,
  AgentProviderConfig,
  AgentThread,
  AgentTodoItem,
  RemoteAgentMessageRecord,
} from "@/lib/agentStore";
import { useAgentMissionStore } from "@/lib/agentMissionStore";
import { getAgentBridge } from "@/lib/agentDaemonConfig";
import { fetchThreadTodos } from "@/lib/agentTodos";
import { useWorkspaceStore } from "@/lib/workspaceStore";
import { resolveReactChatHistoryMessageLimit } from "@/lib/chatHistoryPageSize";
import type { GoalRun } from "@/lib/goalRuns";
import type { Workspace } from "@/lib/types";
import type { WelesHealthState } from "@/lib/agentStore/types";
import { findTaskWorkspaceLocation } from "../tasks-view/helpers";
import { formatSkillWorkflowNotice } from "./skillWorkflowNotice";

type RemoteAgentThread = {
  id: string;
  title: string;
  messages: RemoteAgentMessageRecord[];
  total_message_count?: number | null;
  loaded_message_start?: number | null;
  loaded_message_end?: number | null;
};

export function normalizeBridgePayload(payload: any) {
  if (payload && typeof payload === "object" && "data" in payload) {
    return payload.data ?? {};
  }
  return payload ?? {};
}

export function appendDaemonSystemMessage(content: string, threadId: string | null) {
  if (!threadId) return;
  useAgentStore.getState().addMessage(threadId, {
    role: "system",
    content,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    isCompactionSummary: false,
  });
}

export function recordDaemonWorkflowNotice({
  event,
  activePaneId,
  activeWorkspace,
}: {
  event: any;
  activePaneId: string | null;
  activeWorkspace: ReturnType<ReturnType<typeof useWorkspaceStore.getState>["activeWorkspace"]>;
}) {
  const daemonThreadId = typeof event?.thread_id === "string" ? event.thread_id : null;
  const localThreadId = useAgentStore.getState().threads.find((thread) => thread.daemonThreadId === daemonThreadId)?.id ?? null;
  const thread = localThreadId
    ? useAgentStore.getState().threads.find((entry) => entry.id === localThreadId)
    : undefined;
  const paneId = thread?.paneId ?? activePaneId ?? "agent";
  const workspaceId = thread?.workspaceId ?? activeWorkspace?.id ?? null;
  const surfaceId = thread?.surfaceId ?? activeWorkspace?.surfaces?.[0]?.id ?? null;
  const rawKind = typeof event?.kind === "string" ? event.kind : "tool-call";
  const rawMessage = typeof event?.message === "string" ? event.message : null;
  const details = typeof event?.details === "string" ? event.details : null;
  const normalized = formatSkillWorkflowNotice(rawKind, rawMessage, details);
  const kind = normalized.kind;
  const message = normalized.message;

  if (kind === "transport-fallback" && details) {
    try {
      const parsed = JSON.parse(details);
      const provider = typeof parsed?.provider === "string" ? parsed.provider : null;
      const toTransport = parsed?.to === "chat_completions" ? "chat_completions" : null;
      if (provider && toTransport) {
        const currentSettings = useAgentStore.getState().agentSettings;
        const currentConfig = currentSettings[provider as keyof typeof currentSettings];
        if (currentConfig && typeof currentConfig === "object" && "base_url" in currentConfig) {
          useAgentStore.getState().updateAgentSetting(
            provider as keyof typeof currentSettings,
            {
              ...(currentConfig as AgentProviderConfig),
              api_transport: toTransport,
            } as any,
          );
        }
      }
    } catch {
      // Best-effort notice handling.
    }
  }

  useAgentMissionStore.getState().recordOperationalEvent({
    paneId,
    workspaceId,
    surfaceId,
    sessionId: daemonThreadId,
    kind: kind as any,
    command: kind,
    message: message ?? (details ? details : null),
  });
}

export async function reloadDaemonThreadIntoLocalState({
  daemonThreadId,
  setThreadTodos,
  setDaemonTodosByThread,
}: {
  daemonThreadId: string;
  setThreadTodos: (threadId: string, todos: AgentTodoItem[]) => void;
  setDaemonTodosByThread: Dispatch<SetStateAction<Record<string, AgentTodoItem[]>>>;
}) {
  await loadDaemonThreadPageIntoLocalState({
    daemonThreadId,
    mergeMode: "replace",
    setThreadTodos,
    setDaemonTodosByThread,
  });
}

export function resolveAbsoluteMessageIndex(
  loadedMessageStart: number | null | undefined,
  messages: AgentMessage[],
  messageId: string,
): number | undefined {
  const localIndex = messages.findIndex((message) => message.id === messageId);
  if (localIndex < 0) return undefined;
  return Math.max(0, loadedMessageStart ?? 0) + localIndex;
}

export async function refreshDaemonThreadMessagesIntoLocalState({
  daemonThreadId,
  setThreadTodos,
  setDaemonTodosByThread,
}: {
  daemonThreadId: string;
  setThreadTodos: (threadId: string, todos: AgentTodoItem[]) => void;
  setDaemonTodosByThread: Dispatch<SetStateAction<Record<string, AgentTodoItem[]>>>;
}) {
  return loadDaemonThreadPageIntoLocalState({
    daemonThreadId,
    mergeMode: "append",
    setThreadTodos,
    setDaemonTodosByThread,
  });
}

export async function refreshDaemonThreadMetadataIntoLocalState({
  daemonThreadId,
  setThreadTodos,
  setDaemonTodosByThread,
}: {
  daemonThreadId: string;
  setThreadTodos: (threadId: string, todos: AgentTodoItem[]) => void;
  setDaemonTodosByThread: Dispatch<SetStateAction<Record<string, AgentTodoItem[]>>>;
}) {
  return loadDaemonThreadPageIntoLocalState({
    daemonThreadId,
    messageLimit: 0,
    messageOffset: 0,
    mergeMode: "metadata",
    setThreadTodos,
    setDaemonTodosByThread,
  });
}

export async function loadDaemonThreadPageIntoLocalState({
  daemonThreadId,
  localThreadId: requestedLocalThreadId,
  messageLimit,
  messageOffset,
  mergeMode,
  setThreadTodos,
  setDaemonTodosByThread,
}: {
  daemonThreadId: string;
  localThreadId?: string | null;
  messageLimit?: number | null;
  messageOffset?: number | null;
  mergeMode: "replace" | "prepend" | "append" | "metadata";
  setThreadTodos: (threadId: string, todos: AgentTodoItem[]) => void;
  setDaemonTodosByThread: Dispatch<SetStateAction<Record<string, AgentTodoItem[]>>>;
}): Promise<boolean> {
  const zorai = getAgentBridge();
  if (!zorai?.agentGetThread) return false;

  const stateBeforeLoad = useAgentStore.getState();
  const localThreadId = requestedLocalThreadId
    ?? stateBeforeLoad.threads.find(
      (thread) => thread.id === stateBeforeLoad.activeThreadId && thread.daemonThreadId === daemonThreadId,
    )?.id
    ?? stateBeforeLoad.threads.find(
      (thread) => thread.daemonThreadId === daemonThreadId,
    )?.id;
  if (!localThreadId) return false;
  const messagesAtRequestStart = stateBeforeLoad.messages[localThreadId] ?? [];

  const remotePayload = await zorai.agentGetThread(daemonThreadId, {
    messageLimit: messageLimit ?? resolveReactChatHistoryMessageLimit(
      useAgentStore.getState().agentSettings.react_chat_history_page_size,
    ) ?? null,
    messageOffset: messageOffset ?? null,
  }).catch(() => null) as any;
  const remoteThread = normalizeBridgePayload(remotePayload);
  const hydrated = buildHydratedRemoteThread(
    (remoteThread ?? {}) as any,
    remoteThread?.agent_name ?? "assistant",
  );
  if (!hydrated) return false;

  const reloadedThread = {
    ...hydrated.thread,
    id: localThreadId,
    daemonThreadId,
  } as AgentThread;
  const reloadedMessages = hydrated.messages.map((message) => ({
    ...message,
    threadId: localThreadId,
  })) as AgentMessage[];

  if (mergeMode === "prepend" || mergeMode === "append") {
    const existingIds = new Set(
      (useAgentStore.getState().messages[localThreadId] ?? [])
        .map((message) => message.id)
        .filter((id) => id.length > 0),
    );
    const hasNewMessages = reloadedMessages.some(
      (message) => message.id.length > 0 && !existingIds.has(message.id),
    );
    if (!hasNewMessages && mergeMode === "prepend") return false;
  }

  useAgentStore.setState((state) => ({
    threads: state.threads.map((thread) => thread.id === localThreadId ? {
      ...thread,
      ...reloadedThread,
      lastMessagePreview: reloadedThread.lastMessagePreview || thread.lastMessagePreview,
      loadedMessageStart: mergeMode === "prepend" || mergeMode === "append"
        ? Math.min(thread.loadedMessageStart ?? reloadedThread.loadedMessageStart ?? 0, reloadedThread.loadedMessageStart ?? 0)
        : reloadedThread.loadedMessageStart,
      loadedMessageEnd: mergeMode === "prepend" || mergeMode === "append"
        ? Math.max(thread.loadedMessageEnd ?? 0, reloadedThread.loadedMessageEnd ?? 0)
        : reloadedThread.loadedMessageEnd,
    } : thread),
    messages: mergeMode === "metadata"
      ? state.messages
      : {
        ...state.messages,
        [localThreadId]: mergeMode === "prepend"
          ? mergeMessages(reloadedMessages, state.messages[localThreadId] ?? [])
          : mergeMode === "append"
          ? mergeMessagesForLiveRefresh(state.messages[localThreadId] ?? [], reloadedMessages)
          : state.messages[localThreadId] !== messagesAtRequestStart
          ? mergeMessagesForLiveRefresh(state.messages[localThreadId] ?? [], reloadedMessages)
          : reloadedMessages,
      },
  }));

  const todos = await fetchThreadTodos(daemonThreadId).catch(() => []);
  setThreadTodos(localThreadId, todos);
  setDaemonTodosByThread((current) => ({ ...current, [daemonThreadId]: todos }));
  return true;
}

export function trimDaemonThreadMessagesToLatestWindow({
  localThreadId,
  messageLimit,
}: {
  localThreadId: string;
  messageLimit?: number | null;
}): boolean {
  if (!Number.isFinite(messageLimit) || (messageLimit ?? 0) <= 0) {
    return false;
  }

  const limit = Math.floor(messageLimit as number);
  let didTrim = false;
  useAgentStore.setState((state) => {
    const currentMessages = state.messages[localThreadId] ?? [];
    if (currentMessages.length <= limit) {
      return {};
    }

    const thread = state.threads.find((entry) => entry.id === localThreadId);
    if (!thread) {
      return {};
    }

    const keptMessages = latestLogicalMessageWindow(currentMessages, limit);
    if (keptMessages.length === currentMessages.length) {
      return {};
    }
    const loadedMessageEnd = thread.loadedMessageEnd ?? thread.messageCount ?? currentMessages.length;
    const loadedMessageStart = Math.max(0, loadedMessageEnd - keptMessages.length);
    didTrim = true;

    return {
      threads: state.threads.map((entry) => entry.id === localThreadId ? {
        ...entry,
        loadedMessageStart,
        loadedMessageEnd,
      } : entry),
      messages: {
        ...state.messages,
        [localThreadId]: keptMessages,
      },
    };
  });

  return didTrim;
}

function latestLogicalMessageWindow(messages: AgentMessage[], logicalLimit: number): AgentMessage[] {
  if (logicalLimit <= 0 || messages.length === 0) return messages;
  let slots = 0;
  let start = messages.length;
  let previousWasTool = false;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const isTool = messages[index].role === "tool";
    if (!isTool || !previousWasTool) {
      slots += 1;
      if (slots > logicalLimit) break;
    }
    start = index;
    previousWasTool = isTool;
  }
  return messages.slice(start);
}

function mergeMessagesForLiveRefresh(
  existing: AgentMessage[],
  persisted: AgentMessage[],
): AgentMessage[] {
  const persistedIds = new Set(persisted.map((message) => message.id));
  const liveTailStart = existing.findIndex((message) =>
    message.isStreaming === true
    || (message.role === "tool" && !persistedIds.has(message.id))
  );
  if (liveTailStart < 0) {
    return canonicalizeHydratedToolCalls(
      reconcileEquivalentUserMessages(mergeLiveMessages(existing, persisted)),
    );
  }

  // A reload event can arrive while the current turn still has ephemeral tool
  // rows or an assistant stream that the daemon page does not contain yet.
  // Insert newly persisted rows before that live suffix; appending the fetched
  // page after it makes history trimming discard the active turn.
  const messages = mergeMessages(
    mergeLiveMessages(existing.slice(0, liveTailStart), persisted),
    existing.slice(liveTailStart),
  );
  return canonicalizeHydratedToolCalls(reconcileEquivalentUserMessages(messages));
}

function mergeLiveMessages(existing: AgentMessage[], persisted: AgentMessage[]): AgentMessage[] {
  const persistedById = new Map(persisted.map((message) => [message.id, message]));
  const consumed = new Set<string>();
  const merged = existing.map((message) => {
    const exact = persistedById.get(message.id);
    if (exact) {
      consumed.add(exact.id);
      return exact;
    }
    if (!isOptimisticLocalMessage(message)) return message;
    const authoritative = persisted.find((candidate) =>
      !consumed.has(candidate.id) && messagesAreEquivalent(message, candidate)
    );
    if (!authoritative) return message;
    consumed.add(authoritative.id);
    return mergeAuthoritativeMessageWithLocalContent(authoritative, message);
  });
  return mergeMessages(merged, persisted.filter((message) => !consumed.has(message.id)));
}

function isOptimisticLocalMessage(message: AgentMessage): boolean {
  return message.id.startsWith("queued-prompt:") || /^msg_\d+$/.test(message.id);
}

function messagesAreEquivalent(left: AgentMessage, right: AgentMessage): boolean {
  if (left.role !== right.role) return false;
  if (left.role === "assistant") {
    const hasIdentity = Boolean(left.content.trim() || left.reasoning?.trim());
    return hasIdentity
      && left.content === right.content
      && (left.reasoning ?? "") === (right.reasoning ?? "");
  }
  if (left.role === "user") {
    return left.content.trim() === right.content.trim()
      && Math.abs(normalizeMessageTimestamp(left.createdAt) - normalizeMessageTimestamp(right.createdAt)) <= 120_000;
  }
  return false;
}

function mergeAuthoritativeMessageWithLocalContent(
  authoritative: AgentMessage,
  local: AgentMessage,
): AgentMessage {
  const authoritativeBlocks = authoritative.contentBlocks ?? [];
  const localBlocks = local.contentBlocks ?? [];
  return {
    ...authoritative,
    contentBlocks: authoritativeBlocks.length > 0
      ? authoritativeBlocks
      : localBlocks.length > 0
      ? localBlocks
      : undefined,
  };
}

function normalizeMessageTimestamp(timestamp: number): number {
  return timestamp < 10_000_000_000 ? timestamp * 1_000 : timestamp;
}

function reconcileEquivalentUserMessages(messages: AgentMessage[]): AgentMessage[] {
  const authoritativeKeys = new Set(
    messages
      .filter((message) => message.role === "user" && !isOptimisticLocalUserMessage(message))
      .map(userMessageEquivalenceKey),
  );
  return messages.filter((message) =>
    message.role !== "user"
    || !isOptimisticLocalUserMessage(message)
    || !authoritativeKeys.has(userMessageEquivalenceKey(message))
  );
}

function isOptimisticLocalUserMessage(message: AgentMessage): boolean {
  return message.role === "user" && isOptimisticLocalMessage(message);
}

function userMessageEquivalenceKey(message: AgentMessage): string {
  return JSON.stringify([message.content.trim(), message.contentBlocks ?? null]);
}

function mergeMessages(prefix: AgentMessage[], existing: AgentMessage[]): AgentMessage[] {
  const seen = new Set<string>();
  const merged: AgentMessage[] = [];
  for (const message of [...prefix, ...existing]) {
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    merged.push(message);
  }
  return merged;
}

export async function hydrateDaemonThreadIntoLocalState({
  sessionId,
  fallbackTitle,
  workspaces,
  remoteThread,
  fetchThreadTodos: fetchThreadTodosForThread,
  createThread,
  addMessage,
  setThreadDaemonId,
  setThreadTodos,
  onThreadReady,
}: {
  sessionId?: string | null;
  fallbackTitle: string;
  workspaces: Workspace[];
  remoteThread: RemoteAgentThread;
  fetchThreadTodos: (threadId: string) => Promise<AgentTodoItem[]>;
  createThread: ReturnType<typeof useAgentStore.getState>["createThread"];
  addMessage: ReturnType<typeof useAgentStore.getState>["addMessage"];
  setThreadDaemonId: ReturnType<typeof useAgentStore.getState>["setThreadDaemonId"];
  setThreadTodos: ReturnType<typeof useAgentStore.getState>["setThreadTodos"];
  onThreadReady?: (localThreadId: string, remoteThreadId: string) => void;
}): Promise<string | null> {
  const location = findTaskWorkspaceLocation(workspaces, sessionId);
  const localThreadId = createThread({
    workspaceId: location?.workspaceId ?? null,
    surfaceId: location?.surfaceId ?? null,
    paneId: location?.paneId ?? null,
    title: remoteThread.title || fallbackTitle,
  });
  setThreadDaemonId(localThreadId, remoteThread.id);
  onThreadReady?.(localThreadId, remoteThread.id);

  for (const message of remoteThread.messages ?? []) {
    addMessage(localThreadId, buildHydratedRemoteMessage(localThreadId, message));
  }

  const todos = await fetchThreadTodosForThread(remoteThread.id).catch(() => []);
  setThreadTodos(localThreadId, todos);
  return localThreadId;
}

export function syncWelesHealth(
  event: any,
  setWelesHealth: Dispatch<SetStateAction<WelesHealthState | null>>,
  appendSystemMessage: (content: string) => void,
) {
  const state = typeof event.state === "string" ? event.state : "healthy";
  const reason = typeof event.reason === "string" ? event.reason : undefined;
  const checkedAt = typeof event.checked_at === "number" ? event.checked_at : Date.now();
  const nextHealth = { state, reason, checkedAt };
  setWelesHealth(nextHealth);
  if (state === "degraded") {
    appendSystemMessage(`WELES degraded\n\n${reason || "Daemon vitality checks require attention."}`);
  }
}

export function refreshGoalRuns(setGoalRunsForTrace: Dispatch<SetStateAction<GoalRun[]>>) {
  return (runs: GoalRun[]) => setGoalRunsForTrace(runs);
}
