import type { SendMessagePayload } from "@/components/agent-chat-panel/chat-view/types";

export type QueuedComposerMessage = SendMessagePayload & { id: string };

let queuedComposerSerial = 0;

export function createQueuedComposerMessage(payload: SendMessagePayload): QueuedComposerMessage {
  queuedComposerSerial += 1;
  return { ...payload, id: `queued_${queuedComposerSerial}` };
}

export function queuedComposerLabel(payload: SendMessagePayload): string {
  const text = payload.text.trim();
  return text || "(attachment)";
}

export function shouldDispatchQueuedFollowUp(params: {
  isStreaming: boolean;
  awaitingStreamStart: boolean;
  hasSendNow: boolean;
  queueLength: number;
}): boolean {
  if (params.isStreaming || params.awaitingStreamStart) {
    return false;
  }
  return params.hasSendNow || params.queueLength > 0;
}
