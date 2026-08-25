import { create } from "zustand";

export type WorkspaceEditorView = "edit" | "diff";

export type WorkspaceEditorViewRequest = {
  threadId: string;
  path: string;
  view: WorkspaceEditorView;
  token: number;
};

type WorkspaceEditorRequestState = {
  request: WorkspaceEditorViewRequest | null;
  requestFileView: (threadId: string, path: string, view: WorkspaceEditorView) => void;
};

export const useWorkspaceEditorRequestStore = create<WorkspaceEditorRequestState>((set) => ({
  request: null,
  requestFileView: (threadId, path, view) => set({
    request: { threadId, path, view, token: Date.now() },
  }),
}));
