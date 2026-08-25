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
