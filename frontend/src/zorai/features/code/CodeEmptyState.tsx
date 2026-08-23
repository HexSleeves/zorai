import { useEffect, useMemo, useRef, useState } from "react";
import { useCodeWorkspaceBindingStore } from "./codeWorkspaceBindingStore";
import {
  createMemoizedCodeEmptyStateController,
  type CodeEmptyStateController,
  type CodeEmptyStateControllerMemo,
  type ZoraiWorkspaceSelection,
  type ZoraiWorkspaceValidatedRoot,
} from "./codeEmptyStateModel";

export type CodeEmptyStateProps = {
  selectFolder?: () => Promise<ZoraiWorkspaceSelection>;
  openPath?: (rootPath: string) => Promise<ZoraiWorkspaceValidatedRoot>;
  onRootSelected?: (root: ZoraiWorkspaceValidatedRoot, source: "picker" | "manual") => void;
  onError?: (message: string) => void;
};

/** Stable no-op so an absent `onRootSelected` never changes identity across renders. */
const NOOP_ROOT_SELECTED = (_root: ZoraiWorkspaceValidatedRoot, _source: "picker" | "manual") => {};

function defaultSelectFolder(): Promise<ZoraiWorkspaceSelection> {
  const bridge = window.zorai;
  if (bridge?.workspaceSelectFolder) {
    return bridge.workspaceSelectFolder();
  }
  return Promise.resolve({ canceled: true, root: null });
}

function defaultOpenPath(rootPath: string): Promise<ZoraiWorkspaceValidatedRoot> {
  const bridge = window.zorai;
  if (!bridge?.workspaceOpen) {
    return Promise.reject(new Error("Workspace bridge is unavailable."));
  }
  return bridge.workspaceOpen(rootPath);
}

export function CodeEmptyState({
  selectFolder = defaultSelectFolder,
  openPath = defaultOpenPath,
  onRootSelected,
  onError,
}: CodeEmptyStateProps) {
  const lastRoot = useCodeWorkspaceBindingStore((state) => state.lastRoot);
  const controllerMemoRef = useRef<CodeEmptyStateControllerMemo | null>(null);
  const controller = useMemo<CodeEmptyStateController>(() => {
    const memo = createMemoizedCodeEmptyStateController(controllerMemoRef.current, {
      selectFolder,
      openPath,
      onRootSelected: onRootSelected ?? NOOP_ROOT_SELECTED,
      onError,
    });
    controllerMemoRef.current = memo;
    return memo.controller;
  }, [selectFolder, openPath, onRootSelected, onError]);
  const [state, setState] = useState(controller.getState);

  useEffect(() => {
    controller.setLastRoot(lastRoot);
  }, [controller, lastRoot]);

  useEffect(() => {
    const unsubscribe = controller.subscribe(() => setState(controller.getState()));
    return () => {
      unsubscribe();
      controller.dispose();
    };
  }, [controller]);

  return (
    <div className="zorai-code-empty">
      <strong>No repository open</strong>
      <span>
        Open a folder to start exploring files, diffs, and editor views. Explorer,
        search, and source control will render here once a repository root is bound.
      </span>

      {state.error && (
        <div className="zorai-code-empty-error" role="alert">
          {state.error}
        </div>
      )}

      <div className="zorai-code-empty-actions">
        <button
          type="button"
          className="zorai-code-open-folder"
          onClick={() => void controller.openFolder()}
          disabled={state.busy}
        >
          {state.busy ? "Opening…" : "Open Folder…"}
        </button>
      </div>

      <div className="zorai-code-empty-manual">
        <button
          type="button"
          className="zorai-code-manual-toggle"
          onClick={controller.toggleManual}
          aria-expanded={state.manualOpen}
          aria-controls="zorai-code-manual-path"
          aria-label="Open Path Manually"
          disabled={state.busy}
        >
          Open Path Manually
        </button>
        {state.manualOpen && (
          <form
            id="zorai-code-manual-path"
            className="zorai-code-manual-form"
            onSubmit={(event) => {
              event.preventDefault();
              void controller.submitPath();
            }}
          >
            <label htmlFor="zorai-code-path-input">Folder path</label>
            <input
              id="zorai-code-path-input"
              className="zorai-code-path-input"
              type="text"
              value={state.pathValue}
              onChange={(event) => controller.setPathValue(event.target.value)}
              placeholder="/path/to/repository"
              disabled={state.busy}
              autoFocus
              spellCheck={false}
            />
            <button
              type="submit"
              className="zorai-code-open-path"
              disabled={state.busy || !state.pathValue.trim()}
            >
              {state.busy ? "Opening…" : "Open"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
