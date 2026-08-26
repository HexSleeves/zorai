import { create } from "zustand";

export type WorkspaceEditorView = "edit" | "diff";

export type WorkspaceEditorViewRequest = {
  threadId: string;
  path: string;
  view: WorkspaceEditorView;
  /** True when `path` is an absolute host path outside the bound workspace. */
  external?: boolean;
  token: number;
};

type WorkspaceEditorRequestState = {
  request: WorkspaceEditorViewRequest | null;
  requestFileView: (threadId: string, path: string, view: WorkspaceEditorView, options?: { external?: boolean }) => void;
};

const issueToken = () => globalThis.performance?.now?.() ?? Math.random();

export const useWorkspaceEditorRequestStore = create<WorkspaceEditorRequestState>((set) => ({
  request: null,
  requestFileView: (threadId, path, view, options) => set({
    request: {
      threadId,
      path,
      view,
      external: options?.external === true ? true : undefined,
      token: issueToken(),
    },
  }),
}));
