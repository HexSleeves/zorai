import type { SendMessagePayload } from "@/components/agent-chat-panel/chat-view/types";

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
