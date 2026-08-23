import { useCallback, useEffect, useRef, useState } from "react";
import { WorkspaceWorkbench } from "@/components/WorkspaceWorkbench";
import { useAgentChatPanelRuntime } from "@/components/agent-chat-panel/runtime/context";
import { useAgentStore } from "@/lib/agentStore";
import { useWorkspaceContextStore } from "@/lib/workspaceContextStore";
import { openThreadTarget } from "../threads/openThreadTarget";
import { ThreadsView } from "../threads/ThreadsView";
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
  const runtime = useAgentChatPanelRuntime();
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  const bindRoot = useWorkspaceContextStore((state) => state.bindRoot);
  const lastRoot = useCodeWorkspaceBindingStore((state) => state.lastRoot);
  const [boundRoot, setBoundRoot] = useState<string | null>(lastRoot);
  const codeThreadLocalIdRef = useRef<string | null>(null);
  const restoringRootRef = useRef<string | null>(null);

  const activateRootThread = useCallback(async (root: ZoraiWorkspaceValidatedRoot) => {
    if (restoringRootRef.current === root.root) return;
    restoringRootRef.current = root.root;
    try {
      const activeRuntime = runtimeRef.current;
      await useWorkspaceContextStore.getState().hydrate();
      const bindings = useCodeWorkspaceBindingStore.getState();
      const mappedDaemonThreadId = bindings.threadForRoot(root.root);
      if (mappedDaemonThreadId && await openThreadTarget(activeRuntime, mappedDaemonThreadId)) {
        const local = useAgentStore.getState().threads.find((thread) => thread.daemonThreadId === mappedDaemonThreadId);
        if (local) {
          codeThreadLocalIdRef.current = local.id;
          bindRoot(local.id, root.root);
          return;
        }
      }

      if (mappedDaemonThreadId) bindings.removeRootBinding(root.root);
      const localId = activeRuntime.createThread({
        workspaceId: activeRuntime.activeWorkspace?.id ?? null,
        title: `Code · ${root.name}`,
      });
      codeThreadLocalIdRef.current = localId;
      activeRuntime.openThread(localId);
      bindRoot(localId, root.root);
    } finally {
      restoringRootRef.current = null;
    }
  }, [bindRoot]);

  useEffect(() => {
    const localId = codeThreadLocalIdRef.current;
    if (!boundRoot || !localId) return;
    const local = runtime.threads.find((thread) => thread.id === localId);
    if (!local?.daemonThreadId) return;
    const localContext = useWorkspaceContextStore.getState().byThreadId[localId];
    if (localContext?.root !== boundRoot) return;
    useCodeWorkspaceBindingStore.getState().bindThreadToRoot(boundRoot, local.daemonThreadId);
  }, [boundRoot, runtime.threads]);

  const handleRootSelected = useCallback<CodeOpenWorkspaceBoundary>(
    (root, source) => {
      useCodeWorkspaceBindingStore.getState().setLastRoot(root.root);
      setBoundRoot(root.root);
      void activateRootThread(root);
      onOpenWorkspace(root, source);
    },
    [activateRootThread, onOpenWorkspace],
  );

  useEffect(() => {
    if (!boundRoot || codeThreadLocalIdRef.current) return;
    const name = displayRootName(boundRoot);
    void activateRootThread({ root: boundRoot, name, gitRoot: null, isGitRepository: false });
  }, [activateRootThread, boundRoot]);

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
  const activeThreadId = useAgentStore((state) => state.activeThreadId);
  const activeThread = useAgentStore((state) => state.threads.find((thread) => thread.id === state.activeThreadId) ?? null);
  const workspace = useWorkspaceContextStore((state) => activeThreadId ? state.byThreadId[activeThreadId] ?? null : null);
  const activeFile = workspace?.activeFile?.split(/[\\/]/).slice(-1)[0] ?? null;
  const selection = workspace?.selection;

  return (
    <div className="zorai-code-agent-pane">
      <div className="zorai-code-context-chips" aria-label="Code Agent context">
        <span>{activeThread?.agent_name ? `Responder · ${activeThread.agent_name}` : "Code workspace"}</span>
        {workspace?.root ? <span title={workspace.root}>{displayRootName(workspace.root)}</span> : null}
        {activeFile ? <span title={workspace?.activeFile ?? undefined}>{activeFile}</span> : null}
        {selection ? <span>Selection {selection.startLine}:{selection.startColumn}–{selection.endLine}:{selection.endColumn}</span> : null}
      </div>
      <ThreadsView variant="compact" />
    </div>
  );
}
