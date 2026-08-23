export type ZoraiWorkspaceValidatedRoot = {
  root: string;
  name: string;
  gitRoot: string | null;
  isGitRepository: boolean;
};

export type ZoraiWorkspaceSelection = {
  canceled: boolean;
  root: ZoraiWorkspaceValidatedRoot | null;
};

export type CodeEmptyStateModelState = {
  /** Whether the secondary "Open Path Manually" disclosure is expanded. */
  manualOpen: boolean;
  pathValue: string;
  busy: boolean;
  error: string | null;
  lastRoot: string | null;
};

export type CodeEmptyStateDeps = {
  selectFolder: () => Promise<ZoraiWorkspaceSelection>;
  openPath: (rootPath: string) => Promise<ZoraiWorkspaceValidatedRoot>;
  onRootSelected: (root: ZoraiWorkspaceValidatedRoot, source: "picker" | "manual") => void;
  onError?: (message: string) => void;
};

export function initialCodeEmptyState(lastRoot: string | null): CodeEmptyStateModelState {
  return {
    manualOpen: false,
    pathValue: "",
    busy: false,
    error: null,
    lastRoot,
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Strip the wrapper text Electron's `ipcRenderer.invoke` prepends to rejected
 * IPC calls, e.g. "Error invoking remote method 'workspace-open': <msg>".
 * The main-process message (already user-readable, e.g. WORKSPACE_ROOT_NOT_FOUND)
 * is surfaced alone.
 */
export function normalizeInvokeError(error: unknown): string {
  return errorMessage(error).replace(/^Error invoking remote method '[^']+':\s*/, "");
}

export function displayRootName(root: string | null): string {
  if (!root || !root.trim()) return "No repository open.";
  const segments = root.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? root;
}

export function createCodeEmptyStateController(deps: CodeEmptyStateDeps) {
  let state = initialCodeEmptyState(null);
  let disposed = false;
  const listeners = new Set<() => void>();

  const emit = () => {
    if (disposed) return;
    for (const listener of listeners) listener();
  };

  const setState = (next: CodeEmptyStateModelState) => {
    if (disposed) return;
    state = next;
    emit();
  };

  const reportFailure = (message: string) => {
    if (disposed) return;
    setState({ ...state, busy: false, error: message });
    deps.onError?.(message);
  };

  return {
    getState: () => state,

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    setLastRoot(root: string | null) {
      setState({ ...state, lastRoot: root });
    },

    async openFolder() {
      if (state.busy || disposed) return;
      setState({ ...state, busy: true, manualOpen: false, error: null });
      try {
        const selection = await deps.selectFolder();
        if (disposed) return;
        if (selection.canceled || !selection.root) {
          setState({ ...state, busy: false });
          return;
        }
        setState({ ...state, busy: false, lastRoot: selection.root.root });
        if (disposed) return;
        deps.onRootSelected(selection.root, "picker");
      } catch (error) {
        reportFailure(normalizeInvokeError(error));
      }
    },

    toggleManual() {
      if (state.busy || disposed) return;
      setState({ ...state, manualOpen: !state.manualOpen, error: null });
    },

    setPathValue(value: string) {
      if (disposed) return;
      setState({ ...state, pathValue: value, error: null });
    },

    async submitPath() {
      if (state.busy || disposed) return;
      const pathValue = state.pathValue.trim();
      if (!pathValue) {
        setState({ ...state, error: "Enter a folder path." });
        return;
      }
      setState({ ...state, busy: true, error: null });
      try {
        const root = await deps.openPath(pathValue);
        if (disposed) return;
        setState({
          ...state,
          busy: false,
          manualOpen: false,
          pathValue: "",
          lastRoot: root.root,
        });
        if (disposed) return;
        deps.onRootSelected(root, "manual");
      } catch (error) {
        reportFailure(normalizeInvokeError(error));
      }
    },

    dismissError() {
      if (disposed) return;
      setState({ ...state, error: null });
    },

    dispose() {
      disposed = true;
      listeners.clear();
    },

    isDisposed() {
      return disposed;
    },
  };
}

export type CodeEmptyStateController = ReturnType<typeof createCodeEmptyStateController>;

/**
 * Memoization seam for the component-level controller lifecycle. A controller
 * keeps its disclosure (`manualOpen`), typed `pathValue`, and identity across
 * rerenders as long as every functional dep has a stable identity. Recreating
 * a controller (e.g. because a parent passes a fresh `() => {}` default) wipes
 * that local UI state, so the seam exists to be provable in tests without a
 * DOM environment.
 */
export type CodeEmptyStateControllerMemo = {
  controller: CodeEmptyStateController;
  deps: CodeEmptyStateDeps;
};

export function codeEmptyStateDepsEqual(
  left: CodeEmptyStateDeps,
  right: CodeEmptyStateDeps,
): boolean {
  return (
    left.selectFolder === right.selectFolder &&
    left.openPath === right.openPath &&
    left.onRootSelected === right.onRootSelected &&
    left.onError === right.onError
  );
}

export function createMemoizedCodeEmptyStateController(
  previous: CodeEmptyStateControllerMemo | null,
  deps: CodeEmptyStateDeps,
): CodeEmptyStateControllerMemo {
  if (previous && codeEmptyStateDepsEqual(previous.deps, deps)) {
    return previous;
  }
  return { controller: createCodeEmptyStateController(deps), deps };
}
