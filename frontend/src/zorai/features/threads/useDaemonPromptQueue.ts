import { useEffect, useState } from "react";
import type { SendMessagePayload } from "@/components/agent-chat-panel/chat-view/types";
import { getBridge } from "@/lib/bridge";
import { pushToast } from "@/lib/toastStore";
import {
  createQueuedComposerId,
  readPromptQueueResponse,
  type QueuedComposerMessage,
} from "./composerQueue";
import { usePromptQueueStore, selectThreadPromptQueue } from "./promptQueueStore";

function applyQueueResponse(threadId: string, raw: unknown, expectedId?: string) {
  const parsed = readPromptQueueResponse(raw);
  usePromptQueueStore.getState().setQueue(threadId, parsed.prompts);
  if (parsed.error) {
    pushToast(parsed.error);
    return parsed;
  }
  if (expectedId && !parsed.prompts.some((item) => item.id === expectedId)) {
    pushToast("Queue is full or the daemon rejected that follow-up.");
  }
  return parsed;
}

export function useDaemonPromptQueue(daemonThreadId: string | null | undefined) {
  const queuedMessages = usePromptQueueStore((state) => selectThreadPromptQueue(state, daemonThreadId));
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    setEditingId(null);
    if (!daemonThreadId) return;
    const bridge = getBridge();
    if (!bridge?.agentListPromptQueue) return;
    let cancelled = false;
    void bridge.agentListPromptQueue(daemonThreadId).then((raw) => {
      if (cancelled) return;
      applyQueueResponse(daemonThreadId, raw);
    }).catch((error: unknown) => {
      if (!cancelled) {
        pushToast(error instanceof Error ? error.message : "Failed to load queued messages.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [daemonThreadId]);

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge?.onAgentEvent) return;
    return bridge.onAgentEvent((event: { type?: string; thread_id?: string; prompts?: unknown }) => {
      if (event?.type !== "prompt_queue_update") return;
      const threadId = typeof event.thread_id === "string" ? event.thread_id : null;
      if (!threadId) return;
      usePromptQueueStore.getState().applyDaemonUpdate(threadId, event.prompts);
    });
  }, []);

  const enqueue = async (payload: SendMessagePayload) => {
    if (!daemonThreadId) {
      pushToast("No daemon thread to queue against.");
      return false;
    }
    const bridge = getBridge();
    if (!bridge?.agentEnqueuePrompt) {
      pushToast("Queued messages require the daemon bridge.");
      return false;
    }
    const promptId = createQueuedComposerId();
    try {
      const raw = await bridge.agentEnqueuePrompt({
        threadId: daemonThreadId,
        content: payload.text,
        contentBlocksJson: payload.contentBlocksJson ?? null,
        promptId,
      });
      applyQueueResponse(daemonThreadId, raw, promptId);
      return true;
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Failed to queue message.");
      return false;
    }
  };

  const updateQueued = async (promptId: string, payload: SendMessagePayload) => {
    if (!daemonThreadId) return false;
    const bridge = getBridge();
    if (!bridge?.agentUpdateQueuedPrompt) {
      pushToast("Queued messages require the daemon bridge.");
      return false;
    }
    try {
      const raw = await bridge.agentUpdateQueuedPrompt({
        threadId: daemonThreadId,
        promptId,
        content: payload.text,
        contentBlocksJson: payload.contentBlocksJson ?? null,
      });
      applyQueueResponse(daemonThreadId, raw, promptId);
      setEditingId(null);
      return true;
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Failed to update queued message.");
      return false;
    }
  };

  const cancelQueued = async (promptId: string) => {
    if (!daemonThreadId) return;
    const bridge = getBridge();
    if (!bridge?.agentCancelQueuedPrompt) return;
    try {
      const raw = await bridge.agentCancelQueuedPrompt({
        threadId: daemonThreadId,
        promptId,
      });
      applyQueueResponse(daemonThreadId, raw);
      if (editingId === promptId) setEditingId(null);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Failed to cancel queued message.");
    }
  };

  const sendNow = async (promptId: string) => {
    if (!daemonThreadId) return;
    const bridge = getBridge();
    if (!bridge?.agentSendQueuedPromptNow) return;
    try {
      const raw = await bridge.agentSendQueuedPromptNow({
        threadId: daemonThreadId,
        promptId,
      });
      applyQueueResponse(daemonThreadId, raw);
      if (editingId === promptId) setEditingId(null);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Failed to send queued message.");
    }
  };

  return {
    queuedMessages,
    editingId,
    startEdit: (item: QueuedComposerMessage) => setEditingId(item.id),
    cancelEdit: () => setEditingId(null),
    enqueue,
    updateQueued,
    cancelQueued,
    sendNow,
  };
}
