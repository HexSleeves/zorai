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

export type CodeEmptyStatePhase = "idle" | "opening" | "manual" | "opening-manual";

export type CodeEmptyStateModelState = {
  phase: CodeEmptyStatePhase;
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
    phase: "idle",
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

export function displayRootName(root: string | null): string {
  if (!root || !root.trim()) return "No repository open.";
  const segments = root.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? root;
}

export function createCodeEmptyStateController(deps: CodeEmptyStateDeps) {
  let state = initialCodeEmptyState(null);
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const listener of listeners) listener();
  };

  const setState = (next: CodeEmptyStateModelState) => {
    state = next;
    emit();
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
      if (state.busy) return;
      setState({ ...state, busy: true, manualOpen: false, error: null });
      try {
        const selection = await deps.selectFolder();
        if (selection.canceled || !selection.root) {
          setState({ ...state, busy: false });
          return;
        }
        setState({ ...state, busy: false, lastRoot: selection.root.root });
        deps.onRootSelected(selection.root, "picker");
      } catch (error) {
        const message = errorMessage(error);
        setState({ ...state, busy: false, error: message });
        deps.onError?.(message);
      }
    },

    toggleManual() {
      if (state.busy) return;
      setState({ ...state, manualOpen: !state.manualOpen, error: null });
    },

    setPathValue(value: string) {
      setState({ ...state, pathValue: value, error: null });
    },

    async submitPath() {
      if (state.busy) return;
      const pathValue = state.pathValue.trim();
      if (!pathValue) {
        setState({ ...state, error: "Enter a folder path." });
        return;
      }
      setState({ ...state, busy: true, error: null });
      try {
        const root = await deps.openPath(pathValue);
        setState({
          ...state,
          busy: false,
          manualOpen: false,
          pathValue: "",
          lastRoot: root.root,
        });
        deps.onRootSelected(root, "manual");
      } catch (error) {
        const message = errorMessage(error);
        setState({ ...state, busy: false, error: message });
        deps.onError?.(message);
      }
    },

    dismissError() {
      setState({ ...state, error: null });
    },

    dispose() {
      listeners.clear();
    },
  };
}

export type CodeEmptyStateController = ReturnType<typeof createCodeEmptyStateController>;
