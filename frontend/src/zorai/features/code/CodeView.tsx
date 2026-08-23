import { useCallback, useState } from "react";
import { CodeEmptyState } from "./CodeEmptyState";
import { useCodeWorkspaceBindingStore } from "./codeWorkspaceBindingStore";
import {
  displayRootName,
  type ZoraiWorkspaceSelection,
  type ZoraiWorkspaceValidatedRoot,
} from "./codeEmptyStateModel";

const codeRailSections = [
  { id: "explorer", label: "Explorer" },
  { id: "search", label: "Search" },
  { id: "scm", label: "Source Control" },
] as const;

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
    <div className="zorai-rail-stack">
      <div className="zorai-section-label">Code</div>
      {codeRailSections.map((section) => (
        <div key={section.id} className="zorai-rail-card">
          <strong>{section.label}</strong>
          <span>
            {lastRoot
              ? section.id === "explorer"
                ? displayRootName(lastRoot)
                : "Available after root bind."
              : "No repository open."}
          </span>
        </div>
      ))}
    </div>
  );
}

export function CodeView({
  onOpenWorkspace = NOOP_OPEN_WORKSPACE,
  selectFolder,
  openPath,
}: CodeViewProps) {
  const [boundRoot, setBoundRoot] = useState<ZoraiWorkspaceValidatedRoot | null>(null);

  const handleRootSelected = useCallback<CodeOpenWorkspaceBoundary>(
    (root, source) => {
      useCodeWorkspaceBindingStore.getState().setLastRoot(root.root);
      setBoundRoot(root);
      onOpenWorkspace(root, source);
    },
    [onOpenWorkspace],
  );

  const handleCloseFolder = useCallback(() => {
    if (!boundRoot) return;
    useCodeWorkspaceBindingStore.getState().closeRoot(boundRoot.root);
    setBoundRoot(null);
  }, [boundRoot]);

  return (
    <section className="zorai-feature-surface zorai-code-surface">
      <div className="zorai-view-header">
        <div>
          <div className="zorai-kicker">Code</div>
          <h1>Code Agent</h1>
          {!boundRoot && (
            <p>
              The Code surface is where repository files, diffs, and editor views
              will live as a first-class Zorai destination.
            </p>
          )}
        </div>
      </div>
      {boundRoot ? (
        <div className="zorai-code-bound">
          <div className="zorai-code-bound-name">{boundRoot.name}</div>
          <div className="zorai-code-bound-path">{boundRoot.root}</div>
          {boundRoot.isGitRepository && boundRoot.gitRoot ? (
            <div className="zorai-code-bound-git">Git root: {boundRoot.gitRoot}</div>
          ) : (
            <div className="zorai-code-bound-git">Not a Git repository.</div>
          )}
          <button type="button" className="zorai-code-close-folder" onClick={handleCloseFolder}>
            Close folder
          </button>
        </div>
      ) : (
        <CodeEmptyState
          selectFolder={selectFolder}
          openPath={openPath}
          onRootSelected={handleRootSelected}
        />
      )}
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
