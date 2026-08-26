import { create } from "zustand";

type ThreadLoadingState = {
  pending: number;
  begin: () => void;
  end: () => void;
};

export const useThreadLoadingStore = create<ThreadLoadingState>((set) => ({
  pending: 0,
  begin: () => set((state) => ({ pending: state.pending + 1 })),
  end: () => set((state) => ({ pending: Math.max(0, state.pending - 1) })),
}));

export function beginThreadLoading(): () => void {
  useThreadLoadingStore.getState().begin();
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    useThreadLoadingStore.getState().end();
  };
}

export function shouldShowConversationSkeleton(input: {
  pending: number;
  hasActiveThread: boolean;
  loadedMessageCount: number;
  knownHistory: boolean;
}): boolean {
  if (input.pending > 0) return true;
  if (input.loadedMessageCount > 0) return false;
  if (!input.hasActiveThread) return false;
  return input.knownHistory;
}
