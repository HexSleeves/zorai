import { create } from "zustand";
import { readPersistedJson, scheduleJsonWrite } from "./persistence";

const WORKSPACE_CONTEXT_FILE = "thread-workspace-context.json";

export type WorkspaceSelection = {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};

export type ThreadWorkspaceContext = {
  root: string;
  activeFile: string | null;
  selection: WorkspaceSelection | null;
  attachedFiles: string[];
  openFiles: string[];
  updatedAt: number;
};

type WorkspaceContextState = {
  hydrated: boolean;
  byThreadId: Record<string, ThreadWorkspaceContext>;
  hydrate: () => Promise<void>;
  bindRoot: (threadId: string, root: string) => void;
  setActiveFile: (threadId: string, filePath: string | null) => void;
  setSelection: (threadId: string, selection: WorkspaceSelection | null) => void;
  toggleAttachedFile: (threadId: string, filePath: string) => void;
  closeFile: (threadId: string, filePath: string) => void;
};

function persist(byThreadId: Record<string, ThreadWorkspaceContext>) {
  scheduleJsonWrite(WORKSPACE_CONTEXT_FILE, { byThreadId }, 150);
}

function updateContext(
  state: WorkspaceContextState,
  threadId: string,
  updater: (current: ThreadWorkspaceContext) => ThreadWorkspaceContext,
) {
  const current = state.byThreadId[threadId];
  if (!current) return state;
  const byThreadId = { ...state.byThreadId, [threadId]: updater(current) };
  persist(byThreadId);
  return { ...state, byThreadId };
}

export const useWorkspaceContextStore = create<WorkspaceContextState>((set, get) => ({
  hydrated: false,
  byThreadId: {},
  hydrate: async () => {
    if (get().hydrated) return;
    const saved = await readPersistedJson<{ byThreadId?: Record<string, ThreadWorkspaceContext> }>(WORKSPACE_CONTEXT_FILE);
    set({ hydrated: true, byThreadId: saved?.byThreadId ?? {} });
  },
  bindRoot: (threadId, root) => set((state) => {
    const previous = state.byThreadId[threadId];
    const byThreadId = {
      ...state.byThreadId,
      [threadId]: previous?.root === root
        ? previous
        : {
          root,
          activeFile: null,
          selection: null,
          attachedFiles: [],
          openFiles: [],
          updatedAt: Date.now(),
        },
    };
    persist(byThreadId);
    return { byThreadId };
  }),
  setActiveFile: (threadId, filePath) => set((state) => updateContext(state, threadId, (current) => ({
    ...current,
    activeFile: filePath,
    openFiles: filePath && !current.openFiles.includes(filePath) ? [...current.openFiles, filePath] : current.openFiles,
    updatedAt: Date.now(),
  }))),
  setSelection: (threadId, selection) => set((state) => updateContext(state, threadId, (current) => ({
    ...current,
    selection,
    updatedAt: Date.now(),
  }))),
  toggleAttachedFile: (threadId, filePath) => set((state) => updateContext(state, threadId, (current) => ({
    ...current,
    attachedFiles: current.attachedFiles.includes(filePath)
      ? current.attachedFiles.filter((entry) => entry !== filePath)
      : [...current.attachedFiles, filePath],
    updatedAt: Date.now(),
  }))),
  closeFile: (threadId, filePath) => set((state) => updateContext(state, threadId, (current) => {
    const openFiles = current.openFiles.filter((entry) => entry !== filePath);
    return {
      ...current,
      openFiles,
      activeFile: current.activeFile === filePath ? openFiles[openFiles.length - 1] ?? null : current.activeFile,
      selection: current.activeFile === filePath ? null : current.selection,
      updatedAt: Date.now(),
    };
  })),
}));
