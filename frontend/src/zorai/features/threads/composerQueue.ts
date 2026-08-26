import type { SendMessagePayload } from "@/components/agent-chat-panel/chat-view/types";
import type { AgentContentBlock, AgentMessage } from "@/lib/agentStore/types";

export type QueuedComposerMessage = SendMessagePayload & { id: string };

export type DaemonQueuedPromptRecord = {
  id: string;
  thread_id: string;
  content: string;
  content_blocks_json?: string | null;
};

let queuedComposerSerial = 0;

export function createQueuedComposerId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  queuedComposerSerial += 1;
  return `queued_${Date.now()}_${queuedComposerSerial}`;
}

export function createQueuedComposerMessage(payload: SendMessagePayload): QueuedComposerMessage {
  return { ...payload, id: createQueuedComposerId() };
}

export function queuedComposerLabel(payload: SendMessagePayload): string {
  const text = payload.text.trim();
  return text || "(attachment)";
}

export function shouldApplyPromptQueueSnapshot(
  daemonEventRevisionAtRequest: number,
  currentDaemonEventRevision: number,
): boolean {
  return currentDaemonEventRevision === daemonEventRevisionAtRequest;
}

function queuedContentBlocks(contentBlocksJson: string | null | undefined): AgentContentBlock[] | undefined {
  if (!contentBlocksJson) return undefined;
  try {
    const parsed = JSON.parse(contentBlocksJson);
    return Array.isArray(parsed) ? parsed as AgentContentBlock[] : undefined;
  } catch {
    return undefined;
  }
}

export function reconcileSentQueuedPromptMessages(
  messages: AgentMessage[],
  threadId: string,
  prompt: QueuedComposerMessage,
  createdAt = Date.now(),
  insertionBoundary = messages.length,
): AgentMessage[] {
  const localMessageId = `queued-prompt:${prompt.id}`;
  if (messages.some((message) => message.id === localMessageId)) return messages;

  const contentBlocks = prompt.localContentBlocks ?? queuedContentBlocks(prompt.contentBlocksJson);
  const authoritativeIndex = messages.findIndex((message) =>
    message.role === "user"
    && !message.id.startsWith("queued-prompt:")
    && message.content.trim() === prompt.text.trim()
    && Math.abs(normalizeComposerTimestamp(message.createdAt) - normalizeComposerTimestamp(createdAt)) <= 120_000
  );
  if (authoritativeIndex >= 0) {
    if (!contentBlocks?.length || messages[authoritativeIndex].contentBlocks?.length) return messages;
    const reconciled = [...messages];
    reconciled[authoritativeIndex] = {
      ...messages[authoritativeIndex],
      contentBlocks,
    };
    return reconciled;
  }

  const userMessage: AgentMessage = {
    id: localMessageId,
    threadId,
    createdAt,
    role: "user",
    content: prompt.text,
    contentBlocks,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    isCompactionSummary: false,
  };

  // The boundary is captured when Send now is clicked. Existing messages,
  // including the assistant being interrupted, stay before the queued prompt;
  // any new stream messages that race the IPC reply stay after it.
  const insertionIndex = Math.max(0, Math.min(insertionBoundary, messages.length));
  return [
    ...messages.slice(0, insertionIndex),
    userMessage,
    ...messages.slice(insertionIndex),
  ];
}

function normalizeComposerTimestamp(timestamp: number): number {
  return timestamp < 10_000_000_000 ? timestamp * 1_000 : timestamp;
}

export const EMPTY_PROMPT_QUEUE: QueuedComposerMessage[] = [];

export function queuedPromptsFromDaemon(raw: unknown): QueuedComposerMessage[] {
  if (!Array.isArray(raw)) return EMPTY_PROMPT_QUEUE;
  const prompts = raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as DaemonQueuedPromptRecord;
    if (typeof record.id !== "string" || typeof record.content !== "string") return [];
    return [{
      id: record.id,
      text: record.content,
      contentBlocksJson: record.content_blocks_json ?? null,
    }];
  });
  return prompts.length === 0 ? EMPTY_PROMPT_QUEUE : prompts;
}

export function sameQueuedPrompts(
  left: QueuedComposerMessage[] | undefined,
  right: QueuedComposerMessage[],
): boolean {
  if (left === right) return true;
  if (!left || left.length !== right.length) return false;
  return left.every((item, index) => {
    const other = right[index];
    return other != null
      && item.id === other.id
      && item.text === other.text
      && (item.contentBlocksJson ?? null) === (other.contentBlocksJson ?? null);
  });
}

export function readPromptQueueResponse(raw: unknown): {
  threadId: string | null;
  prompts: QueuedComposerMessage[];
  error?: string;
} {
  const data = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return {
    threadId: typeof data.thread_id === "string" ? data.thread_id : null,
    prompts: queuedPromptsFromDaemon(data.prompts),
    error: typeof data.error === "string" ? data.error : undefined,
  };
}
