import { useCallback, useEffect, useMemo, useState } from "react";
import { useAgentChatPanelRuntime } from "@/components/agent-chat-panel/runtime/context";
import type { AgentThread } from "@/lib/agentStore";
import { useAgentStore } from "@/lib/agentStore";
import { useOperatorQuestionStore } from "@/lib/operatorQuestionStore";
import { useWorkspaceContextStore } from "@/lib/workspaceContextStore";
import { ThreadsView } from "../threads/ThreadsView";
import { classifyThreadActivityMessage } from "../threads/threadActivityModel";
import { openThreadTarget } from "../threads/openThreadTarget";
import { threadReadKey, useThreadReadStateStore } from "../threads/threadReadStateStore";
import { displayRootName } from "./codeEmptyStateModel";
import {
  actualThreadResponder,
  authoritativeThreadIdentity,
  projectThreadsForRoot,
  resolveCodeProjectThreadStatus,
  type CodeProjectThreadEntry,
} from "./codeProjectThreads";
import { useCodeWorkspaceBindingStore } from "./codeWorkspaceBindingStore";
import { CodeThreadHistoryMenu, type CodeThreadHistoryEntry } from "./CodeThreadHistoryMenu";

const ACTIVE_GOAL_STATUSES = new Set(["queued", "planning", "running", "paused"]);

export function CodeAgentPane() {
  const runtime = useAgentChatPanelRuntime();
  const activeThreadId = useAgentStore((state) => state.activeThreadId);
  const localThreads = useAgentStore((state) => state.threads);
  const activeThread = localThreads.find((thread) => thread.id === activeThreadId) ?? null;
  const contextsByThreadId = useWorkspaceContextStore((state) => state.byThreadId);
  const hydrated = useWorkspaceContextStore((state) => state.hydrated);
  const bindRoot = useWorkspaceContextStore((state) => state.bindRoot);
  const root = useCodeWorkspaceBindingStore((state) => state.lastRoot);
  const readState = useThreadReadStateStore((state) => state.lastReadAtByThread);
  const operatorQuestion = useOperatorQuestionStore((state) => state.question);
  const fetchThreadList = runtime.fetchThreadList;
  const [daemonThreads, setDaemonThreads] = useState<AgentThread[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await useWorkspaceContextStore.getState().hydrate();
      setDaemonThreads(await fetchThreadList({ includeInternal: true }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load project threads.");
    } finally {
      setLoading(false);
    }
  }, [fetchThreadList]);

  useEffect(() => {
    void refresh();
  }, [refresh, root]);

  useEffect(() => {
    if (!root || !activeThread?.daemonThreadId) return;
    const context = contextsByThreadId[activeThread.id];
    if (context?.root !== root) return;
    useCodeWorkspaceBindingStore.getState().bindThreadToRoot(root, activeThread.daemonThreadId);
  }, [activeThread, contextsByThreadId, root]);

  const entries = useMemo(() => {
    if (!hydrated) return [];
    return projectThreadsForRoot({
      root,
      localThreads,
      daemonThreads,
      contextsByLocalThreadId: contextsByThreadId,
    }).map((entry): CodeThreadHistoryEntry => ({
      ...entry,
      status: statusForEntry(entry, runtime, operatorQuestion?.threadId ?? null, readState),
    }));
  }, [contextsByThreadId, daemonThreads, hydrated, localThreads, operatorQuestion?.threadId, readState, root, runtime]);

  const createProjectThread = () => {
    if (!root) return;
    const responder = activeThread
      ? actualThreadResponder(activeThread)
      : { id: "swarog", name: "Svarog" };
    const localId = runtime.createThread({
      workspaceId: runtime.activeWorkspace?.id ?? null,
      title: `Code · ${displayRootName(root)}`,
      agentId: responder.id,
      agentName: responder.name,
    });
    bindRoot(localId, root);
    runtime.openThread(localId);
    setError(null);
  };

  const selectProjectThread = async (entry: CodeThreadHistoryEntry) => {
    setError(null);
    const target = entry.thread.daemonThreadId ?? entry.localThread.daemonThreadId;
    const opened = target
      ? await openThreadTarget(runtime, target)
      : (runtime.openThread(entry.localThread.id), true);
    if (!opened) {
      setError("This project thread is no longer available.");
      return;
    }
    if (root && target) {
      useCodeWorkspaceBindingStore.getState().bindThreadToRoot(root, target);
    }
  };

  const workspace = activeThreadId ? contextsByThreadId[activeThreadId] ?? null : null;
  const activeFile = workspace?.activeFile?.split(/[\\/]/).slice(-1)[0] ?? null;
  const selection = workspace?.selection;
  const currentIdentity = activeThread ? authoritativeThreadIdentity(activeThread) : null;

  return (
    <div className="zorai-code-agent-pane">
      <div className="zorai-code-context-chips" aria-label="Code Agent context">
        <span>{activeThread?.agent_name ? `Responder · ${actualThreadResponder(activeThread).name}` : "Code workspace"}</span>
        {root ? <span title={root}>{displayRootName(root)}</span> : null}
        {activeFile ? <span title={workspace?.activeFile ?? undefined}>{activeFile}</span> : null}
        {selection ? <span>Selection {selection.startLine}:{selection.startColumn}–{selection.endLine}:{selection.endColumn}</span> : null}
      </div>
      <ThreadsView
        variant="compact"
        compactHeaderActions={
          <CodeThreadHistoryMenu
            entries={entries}
            currentIdentity={currentIdentity}
            canCreate={Boolean(root)}
            loading={loading}
            error={error}
            onCreate={createProjectThread}
            onSelect={(entry) => void selectProjectThread(entry)}
            onRetry={() => void refresh()}
          />
        }
      />
    </div>
  );
}

function statusForEntry(
  entry: CodeProjectThreadEntry,
  runtime: ReturnType<typeof useAgentChatPanelRuntime>,
  questionThreadId: string | null,
  readState: Record<string, number>,
) {
  const identities = new Set([entry.localThread.id, entry.thread.daemonThreadId, entry.localThread.daemonThreadId].filter(Boolean));
  const messages = runtime.allMessagesByThread[entry.localThread.id] ?? [];
  let working = entry.localThread.id === runtime.activeThreadId && runtime.isStreamingResponse;
  let latestCompletionAt: number | null = null;
  for (const message of messages) {
    if (message.role === "assistant" && !message.isStreaming) {
      latestCompletionAt = Math.max(latestCompletionAt ?? 0, message.createdAt);
    }
    const activity = classifyThreadActivityMessage(message);
    if (activity?.kind !== "operation") continue;
    if (activity.operations.some((operation) => operation.state === "accepted" || operation.state === "started")) {
      working = true;
    }
    if (activity.operations.some((operation) => operation.state === "completed" || operation.state === "failed")) {
      latestCompletionAt = Math.max(latestCompletionAt ?? 0, message.createdAt);
    }
  }

  let needsOperatorAction = Boolean(questionThreadId && identities.has(questionThreadId));
  for (const goal of runtime.goalRunsForTrace) {
    const goalThreads = [goal.thread_id, goal.root_thread_id, goal.active_thread_id, ...(goal.execution_thread_ids ?? [])];
    if (!goalThreads.some((threadId) => threadId && identities.has(threadId))) continue;
    if (goal.status === "awaiting_approval") needsOperatorAction = true;
    if (ACTIVE_GOAL_STATUSES.has(goal.status)) working = true;
    if (goal.completed_at) latestCompletionAt = Math.max(latestCompletionAt ?? 0, goal.completed_at);
  }

  const key = threadReadKey(entry.thread);
  return resolveCodeProjectThreadStatus({
    needsOperatorAction,
    working,
    latestCompletionAt,
    lastReadAt: key ? readState[key] ?? null : null,
  });
}
