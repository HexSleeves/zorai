import { useCallback, useState } from "react";
import { WorkspaceWorkbench } from "@/components/WorkspaceWorkbench";
import { CodeEmptyState } from "./CodeEmptyState";
import { useCodeWorkspaceBindingStore } from "./codeWorkspaceBindingStore";
import {
  displayRootName,
  type ZoraiWorkspaceSelection,
  type ZoraiWorkspaceValidatedRoot,
} from "./codeEmptyStateModel";

/**
 * Typed callback boundary for the GLM lifecycle task. The GLM task owns
 * daemon-to-local thread resolution and thread creation for a selected root;
 * this slice only surfaces the validated root through the callback.
 */
export type CodeOpenWorkspaceBoundary = (
  root: ZoraiWorkspaceValidatedRoot,
  source: "picker" | "manual",
) => void;

export type CodeViewProps = {
  onOpenWorkspace?: CodeOpenWorkspaceBoundary;
  selectFolder?: () => Promise<ZoraiWorkspaceSelection>;
  openPath?: (rootPath: string) => Promise<ZoraiWorkspaceValidatedRoot>;
};

/**
 * Stable module-level default. An inline `() => {}` default would recreate
 * `handleRootSelected` below on every CodeView render, which in turn recreates
 * CodeEmptyState's memoized controller and wipes `manualOpen`/`pathValue` on
 * unrelated ZoraiShell rerenders (Context/Agent toggles).
 */
const NOOP_OPEN_WORKSPACE: CodeOpenWorkspaceBoundary = () => {};

export function CodeRail() {
  const lastRoot = useCodeWorkspaceBindingStore((state) => state.lastRoot);

  return (
    <div className="zorai-code-explorer">
      <div className="zorai-code-project" title={lastRoot ?? undefined}>
        <strong>{lastRoot ? displayRootName(lastRoot) : "No folder open"}</strong>
      </div>
      <div id="zorai-code-explorer-host" className="zorai-code-explorer-scroll" aria-label="Code Explorer" />
    </div>
  );
}

export function CodeView({
  onOpenWorkspace = NOOP_OPEN_WORKSPACE,
  selectFolder,
  openPath,
}: CodeViewProps) {
  const lastRoot = useCodeWorkspaceBindingStore((state) => state.lastRoot);
  const [boundRoot, setBoundRoot] = useState<string | null>(lastRoot);

  const handleRootSelected = useCallback<CodeOpenWorkspaceBoundary>(
    (root, source) => {
      useCodeWorkspaceBindingStore.getState().setLastRoot(root.root);
      setBoundRoot(root.root);
      onOpenWorkspace(root, source);
    },
    [onOpenWorkspace],
  );

  return boundRoot ? (
    <WorkspaceWorkbench openedRoot={boundRoot} />
  ) : (
    <section className="zorai-code-surface zorai-code-surface--empty">
      <CodeEmptyState
        selectFolder={selectFolder}
        openPath={openPath}
        onRootSelected={handleRootSelected}
      />
    </section>
  );
}

export function CodeAgentPane() {
  return (
    <div className="zorai-context-summary">
      <div className="zorai-section-label">Code Agent</div>
      <div className="zorai-context-block">
        <strong>Agent</strong>
        <span>
          Code-aware agent context will render here once a repository is open.
        </span>
      </div>
    </div>
  );
}
