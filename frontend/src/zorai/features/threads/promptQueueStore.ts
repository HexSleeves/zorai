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

function nextQueueForThread(
  state: PromptQueueState,
  threadId: string,
  prompts: QueuedComposerMessage[],
): PromptQueueState {
  const stored = prompts.length === 0 ? EMPTY_PROMPT_QUEUE : prompts;
  if (sameQueuedPrompts(state.byThreadId[threadId], stored)) return state;
  return { ...state, byThreadId: { ...state.byThreadId, [threadId]: stored } };
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
