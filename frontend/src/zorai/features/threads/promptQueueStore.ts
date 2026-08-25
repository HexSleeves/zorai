import { create } from "zustand";
import {
  EMPTY_PROMPT_QUEUE,
  queuedPromptsFromDaemon,
  sameQueuedPrompts,
  type QueuedComposerMessage,
} from "./composerQueue";

type PromptQueueState = {
  byThreadId: Record<string, QueuedComposerMessage[]>;
  setQueue: (threadId: string, prompts: QueuedComposerMessage[]) => void;
  applyDaemonUpdate: (threadId: string, records: unknown) => void;
};

export const MAX_CACHED_PROMPT_QUEUES = 64;

function nextQueueForThread(
  state: PromptQueueState,
  threadId: string,
  prompts: QueuedComposerMessage[],
): PromptQueueState {
  const stored = prompts.length === 0 ? EMPTY_PROMPT_QUEUE : prompts;
  const current = state.byThreadId[threadId];
  const keys = Object.keys(state.byThreadId);
  const alreadyMostRecent = keys[keys.length - 1] === threadId;
  if (sameQueuedPrompts(current, stored) && alreadyMostRecent) return state;

  // Reinsert the touched thread at the end, then evict least-recently-used
  // entries so daemon events and thread switching cannot grow this cache forever.
  const byThreadId = { ...state.byThreadId };
  delete byThreadId[threadId];
  byThreadId[threadId] = current && sameQueuedPrompts(current, stored) ? current : stored;
  while (Object.keys(byThreadId).length > MAX_CACHED_PROMPT_QUEUES) {
    const oldestThreadId = Object.keys(byThreadId)[0];
    if (!oldestThreadId) break;
    delete byThreadId[oldestThreadId];
  }
  return { ...state, byThreadId };
}

export function selectThreadPromptQueue(
  state: PromptQueueState,
  threadId: string | null | undefined,
): QueuedComposerMessage[] {
  if (!threadId) return EMPTY_PROMPT_QUEUE;
  return state.byThreadId[threadId] ?? EMPTY_PROMPT_QUEUE;
}

export const usePromptQueueStore = create<PromptQueueState>((set) => ({
  byThreadId: {},
  setQueue: (threadId, prompts) => set((state) => nextQueueForThread(state, threadId, prompts)),
  applyDaemonUpdate: (threadId, records) => set((state) => (
    nextQueueForThread(state, threadId, queuedPromptsFromDaemon(records))
  )),
}));
