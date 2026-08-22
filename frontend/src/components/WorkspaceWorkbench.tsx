import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getBridge } from "@/lib/bridge";
import { useAgentStore } from "@/lib/agentStore";
import { useWorkspaceStore } from "@/lib/workspaceStore";
import { useWorkspaceContextStore } from "@/lib/workspaceContextStore";
import { extractWorkspaceSymbols } from "@/lib/workspaceSymbols";
import type { editor as MonacoEditorApi } from "monaco-editor";

const WorkspaceCodeEditor = lazy(() => import("@/components/WorkspaceCodeEditor").then((module) => ({ default: module.WorkspaceCodeEditor })));
const WorkspaceDiffEditor = lazy(() => import("@/components/WorkspaceCodeEditor").then((module) => ({ default: module.WorkspaceDiffEditor })));

type OpenDocument = ZoraiWorkspaceFile & { original: string; dirty: boolean; externalContent?: string; externalHash?: string };

type TreeNodeProps = {
  root: string;
  entry: ZoraiWorkspaceEntry;
  depth: number;
  status: Map<string, string>;
  onOpen: (path: string) => void;
};

function statusLabel(entry?: ZoraiWorkspaceGitStatus) {
  if (!entry) return "";
  if (entry.indexStatus === "?" && entry.worktreeStatus === "?") return "U";
  return (entry.worktreeStatus.trim() || entry.indexStatus.trim()).slice(0, 1);
}

function WorkspaceTreeNode({ root, entry, depth, status, onOpen }: TreeNodeProps) {
  const bridge = getBridge();
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<ZoraiWorkspaceEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const marker = status.get(entry.path) ?? "";

  const activate = async () => {
    if (!entry.isDirectory) {
      onOpen(entry.path);
      return;
    }
    if (!expanded && children.length === 0 && bridge?.workspaceListDirectory) {
      setLoading(true);
      try { setChildren(await bridge.workspaceListDirectory(root, entry.path)); } finally { setLoading(false); }
    }
    setExpanded((current) => !current);
  };

  return (
    <div>
      <button type="button" className="zorai-workspace-tree-row" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => void activate()}>
        <span className="zorai-workspace-chevron">{entry.isDirectory ? (expanded ? "⌄" : "›") : ""}</span>
        <span className="zorai-workspace-file-icon">{entry.isDirectory ? "▰" : "·"}</span>
        <span className="zorai-workspace-tree-name">{entry.name}</span>
        {marker ? <span className="zorai-workspace-git-marker">{marker}</span> : null}
      </button>
      {loading ? <div className="zorai-workspace-tree-loading" style={{ paddingLeft: 24 + depth * 14 }}>Loading…</div> : null}
      {expanded ? children.map((child) => (
        <WorkspaceTreeNode key={child.path} root={root} entry={child} depth={depth + 1} status={status} onOpen={onOpen} />
      )) : null}
    </div>
  );
}

export function WorkspaceWorkbench() {
  const bridge = getBridge();
  const activeThreadId = useAgentStore((state) => state.activeThreadId);
  const activeDaemonThreadId = useAgentStore((state) => state.threads.find((thread) => thread.id === state.activeThreadId)?.daemonThreadId ?? state.activeThreadId);
  const activeWorkspace = useWorkspaceStore((state) => state.activeWorkspace());
  const context = useWorkspaceContextStore((state) => activeThreadId ? state.byThreadId[activeThreadId] : undefined);
  const bindRoot = useWorkspaceContextStore((state) => state.bindRoot);
  const setActiveFile = useWorkspaceContextStore((state) => state.setActiveFile);
  const setSelection = useWorkspaceContextStore((state) => state.setSelection);
  const toggleAttachedFile = useWorkspaceContextStore((state) => state.toggleAttachedFile);
  const closeFile = useWorkspaceContextStore((state) => state.closeFile);
  const setIsolateAgentTasks = useWorkspaceContextStore((state) => state.setIsolateAgentTasks);
  const [rootInput, setRootInput] = useState(context?.root ?? activeWorkspace?.cwd ?? "");
  const [rootEntries, setRootEntries] = useState<ZoraiWorkspaceEntry[]>([]);
  const [gitStatus, setGitStatus] = useState<ZoraiWorkspaceGitStatus[]>([]);
  const [gitOverview, setGitOverview] = useState<ZoraiWorkspaceGitOverview | null>(null);
  const [gitWorktrees, setGitWorktrees] = useState<ZoraiGitWorktree[]>([]);
  const [worktreeReviews, setWorktreeReviews] = useState<Record<string, ZoraiWorktreeReview>>({});
  const [worktreeName, setWorktreeName] = useState("");
  const [worktreeBranch, setWorktreeBranch] = useState("");
  const [worktreeBaseRef, setWorktreeBaseRef] = useState("HEAD");
  const [commitMessage, setCommitMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [reviewedChange, setReviewedChange] = useState<{ path: string; staged: boolean; hunks: ZoraiWorkspaceGitHunk[] } | null>(null);
  const [documents, setDocuments] = useState<Record<string, OpenDocument>>({});
  const [diff, setDiff] = useState<string | null>(null);
  const [mode, setMode] = useState<"edit" | "diff" | "external">("edit");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const workspaceSyncTimer = useRef<number | null>(null);
  const [daemonContextLoadedFor, setDaemonContextLoadedFor] = useState<string | null>(null);
  const [newPath, setNewPath] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ path: string; line: number; column: number; preview: string }>>([]);
  const [agentChanges, setAgentChanges] = useState<ZoraiWorkContextEntry[]>([]);
  const [lspStatus, setLspStatus] = useState<{ available: boolean; command?: string | null; reason?: string } | null>(null);
  const [diagnosticsByPath, setDiagnosticsByPath] = useState<Record<string, ZoraiLspDiagnostic[]>>({});
  const lspVersionRef = useRef<Record<string, number>>({});
  const lspChangeTimer = useRef<number | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const monacoEditorRef = useRef<MonacoEditorApi.IStandaloneCodeEditor | null>(null);
  const pendingNavigationRef = useRef<{ path: string; line: number; column: number } | null>(null);
  const activeDocument = context?.activeFile ? documents[context.activeFile] : undefined;
  const isolatedTaskWorktrees = useMemo(() => gitWorktrees.filter((worktree) => /\/zorai\/(?:goal|task)-/.test(worktree.branch ?? "")), [gitWorktrees]);
  const operationGroups = useMemo(() => {
    const groups = new Map<string, ZoraiWorkContextEntry[]>();
    for (const entry of agentChanges.filter((change) => change.operation_id)) {
      const key = entry.operation_id as string;
      groups.set(key, [...(groups.get(key) ?? []), entry]);
    }
    return [...groups.entries()].sort((left, right) => Math.max(...right[1].map((entry) => entry.updated_at)) - Math.max(...left[1].map((entry) => entry.updated_at)));
  }, [agentChanges]);
  const symbols = useMemo(() => activeDocument ? extractWorkspaceSymbols(activeDocument.content) : [], [activeDocument]);
  const workspaceDiagnostics = useMemo(() => Object.entries(diagnosticsByPath).flatMap(([path, diagnostics]) => diagnostics.map((diagnostic) => ({ path, ...diagnostic }))), [diagnosticsByPath]);
  const statusMap = useMemo(() => new Map(gitStatus.map((entry) => [entry.path, statusLabel(entry)])), [gitStatus]);

  const refreshRoot = useCallback(async (root = context?.root) => {
    if (!root || !bridge?.workspaceListDirectory) return;
    const [entries, statuses, overview, worktrees] = await Promise.all([
      bridge.workspaceListDirectory(root, ""),
      bridge.workspaceGitStatus?.(root) ?? Promise.resolve([]),
      bridge.workspaceGitOverview?.(root) ?? Promise.resolve(null),
      bridge.workspaceGitListWorktrees?.(root) ?? Promise.resolve([]),
    ]);
    setRootEntries(entries);
    setGitStatus(statuses);
    setGitOverview(overview);
    setGitWorktrees(worktrees);
  }, [bridge, context?.root]);

  useEffect(() => { void useWorkspaceContextStore.getState().hydrate(); }, []);
  useEffect(() => {
    if (!activeThreadId || !activeDaemonThreadId || daemonContextLoadedFor === activeDaemonThreadId || !bridge?.agentGetThreadWorkspaceContext) return;
    setDaemonContextLoadedFor(activeDaemonThreadId);
    void bridge.agentGetThreadWorkspaceContext(activeDaemonThreadId).then((response: any) => {
      const daemonContext = response?.context;
      if (!daemonContext || typeof daemonContext.root !== "string" || !daemonContext.root.trim()) return;
      const current = useWorkspaceContextStore.getState().byThreadId[activeThreadId];
      if (!current || (daemonContext.updated_at ?? 0) > current.updatedAt) {
        useWorkspaceContextStore.setState((state) => ({
          byThreadId: { ...state.byThreadId, [activeThreadId]: {
            root: daemonContext.root,
            activeFile: daemonContext.active_file ?? null,
            selection: daemonContext.selection ? {
              startLine: daemonContext.selection.start_line,
              startColumn: daemonContext.selection.start_column,
              endLine: daemonContext.selection.end_line,
              endColumn: daemonContext.selection.end_column,
            } : null,
            attachedFiles: daemonContext.attached_files ?? [],
            openFiles: daemonContext.open_files ?? [],
            updatedAt: daemonContext.updated_at ?? Date.now(),
            isolateAgentTasks: daemonContext.isolate_agent_tasks ?? false,
          } },
        }));
      }
    }).catch(() => {});
  }, [activeDaemonThreadId, activeThreadId, bridge, daemonContextLoadedFor]);
  useEffect(() => {
    if (!activeThreadId || !activeDaemonThreadId || !context || !bridge?.agentSetThreadWorkspaceContext) return;
    if (workspaceSyncTimer.current !== null) window.clearTimeout(workspaceSyncTimer.current);
    workspaceSyncTimer.current = window.setTimeout(() => {
      void bridge.agentSetThreadWorkspaceContext!(activeDaemonThreadId, {
        root: context.root,
        active_file: context.activeFile,
        selection: context.selection ? {
          start_line: context.selection.startLine,
          start_column: context.selection.startColumn,
          end_line: context.selection.endLine,
          end_column: context.selection.endColumn,
        } : null,
        attached_files: context.attachedFiles,
        open_files: context.openFiles,
        updated_at: context.updatedAt,
        isolate_agent_tasks: context.isolateAgentTasks,
      }).catch(() => {});
    }, 350);
    return () => {
      if (workspaceSyncTimer.current !== null) window.clearTimeout(workspaceSyncTimer.current);
    };
  }, [activeDaemonThreadId, activeThreadId, bridge, context]);
  useEffect(() => {
    if (context?.root) {
      setRootInput(context.root);
      void refreshRoot(context.root).catch((reason) => setError(reason?.message ?? String(reason)));
    }
  }, [context?.root, refreshRoot]);
  useEffect(() => {
    if (!activeDaemonThreadId || !bridge?.agentGetWorkContext) {
      setAgentChanges([]);
      return;
    }
    const loadChanges = () => {
      void bridge.agentGetWorkContext!(activeDaemonThreadId).then((response: any) => {
        const workContext = response?.context ?? response;
        setAgentChanges(Array.isArray(workContext?.entries) ? workContext.entries : []);
      }).catch(() => {});
    };
    loadChanges();
    const timer = window.setInterval(loadChanges, 3000);
    return () => window.clearInterval(timer);
  }, [activeDaemonThreadId, bridge]);
  useEffect(() => {
    if (!context?.root || !bridge?.workspaceWatchStart || !bridge?.onWorkspaceFilesChanged) return;
    let subscriptionId: string | null = null;
    let disposed = false;
    const unsubscribe = bridge.onWorkspaceFilesChanged((batch) => {
      if (batch.root !== context.root || (subscriptionId && batch.subscriptionId !== subscriptionId)) return;
      void refreshRoot().catch(() => {});
      const activeChange = activeDocument && batch.changes.some((change) => change.path === activeDocument.path);
      if (!activeChange || !activeDocument || !bridge.workspaceReadFile) return;
      void bridge.workspaceReadFile(context.root, activeDocument.path).then((diskFile) => {
        if (diskFile.hash === activeDocument.hash) return;
        if (activeDocument.dirty) {
          setDocuments((current) => ({ ...current, [activeDocument.path]: { ...activeDocument, externalContent: diskFile.content, externalHash: diskFile.hash } }));
          setError(`External change detected in ${activeDocument.path}. Compare or reload before saving.`);
        } else {
          setDocuments((current) => ({ ...current, [diskFile.path]: { ...diskFile, original: diskFile.content, dirty: false } }));
        }
      }).catch(() => {});
    });
    void bridge.workspaceWatchStart(context.root, { debounceMs: 120 }).then((subscription) => {
      if (disposed) {
        void bridge.workspaceWatchStop?.(subscription.subscriptionId);
        return;
      }
      subscriptionId = subscription.subscriptionId;
    }).catch(() => {});
    return () => {
      disposed = true;
      if (typeof unsubscribe === "function") unsubscribe();
      if (subscriptionId) void bridge.workspaceWatchStop?.(subscriptionId);
    };
  }, [activeDocument, bridge, context?.root, refreshRoot]);
  useEffect(() => {
    if (!context?.root || !activeDocument || !bridge?.workspaceReadFile || bridge.workspaceWatchStart) return;
    const timer = window.setInterval(() => {
      void bridge.workspaceReadFile!(context.root, activeDocument.path).then((diskFile) => {
        if (diskFile.hash === activeDocument.hash || diskFile.hash === activeDocument.externalHash) return;
        if (activeDocument.dirty) {
          setDocuments((current) => ({ ...current, [activeDocument.path]: {
            ...activeDocument,
            externalContent: diskFile.content,
            externalHash: diskFile.hash,
          } }));
          setError(`External change detected in ${activeDocument.path}. Compare or reload before saving.`);
        } else {
          setDocuments((current) => ({ ...current, [diskFile.path]: { ...diskFile, original: diskFile.content, dirty: false } }));
        }
      }).catch(() => {});
    }, 2500);
    return () => window.clearInterval(timer);
  }, [activeDocument, bridge, context?.root]);

  useEffect(() => {
    const pending = pendingNavigationRef.current;
    if (!pending || activeDocument?.path !== pending.path || mode !== "edit") return;
    const monacoEditor = monacoEditorRef.current;
    if (monacoEditor) {
      monacoEditor.focus();
      monacoEditor.setPosition({ lineNumber: pending.line, column: pending.column });
      monacoEditor.revealPositionInCenter({ lineNumber: pending.line, column: pending.column });
      pendingNavigationRef.current = null;
      return;
    }
    const textarea = editorRef.current;
    if (!textarea) return;
    const lines = textarea.value.split("\n");
    const lineIndex = Math.max(0, Math.min(pending.line - 1, lines.length - 1));
    const offset = lines.slice(0, lineIndex).reduce((total, line) => total + line.length + 1, 0) + Math.max(0, pending.column - 1);
    textarea.focus();
    textarea.setSelectionRange(offset, offset);
    const lineHeight = Number.parseFloat(window.getComputedStyle(textarea).lineHeight) || 20;
    textarea.scrollTop = Math.max(0, lineIndex * lineHeight - textarea.clientHeight / 3);
    pendingNavigationRef.current = null;
  }, [activeDocument?.path, mode]);

  useEffect(() => {
    if (!context?.root || !bridge?.onWorkspaceLspDiagnostics) return;
    const unsubscribe = bridge.onWorkspaceLspDiagnostics((payload) => {
      if (payload.root !== context.root) return;
      setDiagnosticsByPath((current) => ({ ...current, [payload.path]: payload.diagnostics }));
    });
    return () => { if (typeof unsubscribe === "function") unsubscribe(); };
  }, [bridge, context?.root]);
  useEffect(() => {
    if (!context?.root || !activeDocument || !bridge?.workspaceLspOpen) {
      setLspStatus(null);
      return;
    }
    const version = (lspVersionRef.current[activeDocument.path] ?? 0) + 1;
    lspVersionRef.current[activeDocument.path] = version;
    let disposed = false;
    void bridge.workspaceLspOpen(context.root, activeDocument.path, activeDocument.language, activeDocument.content, version).then((result) => {
      if (!disposed) setLspStatus({ available: result.available, command: result.command ?? null, reason: result.reason });
    }).catch((reason) => { if (!disposed) setLspStatus({ available: false, reason: reason?.message ?? String(reason) }); });
    return () => {
      disposed = true;
      void bridge.workspaceLspClose?.(context.root, activeDocument.path, activeDocument.language);
    };
  }, [activeDocument?.language, activeDocument?.path, bridge, context?.root]);
  useEffect(() => {
    if (!context?.root || !activeDocument || !lspStatus?.available || !bridge?.workspaceLspChange) return;
    if (lspChangeTimer.current !== null) window.clearTimeout(lspChangeTimer.current);
    lspChangeTimer.current = window.setTimeout(() => {
      const version = (lspVersionRef.current[activeDocument.path] ?? 0) + 1;
      lspVersionRef.current[activeDocument.path] = version;
      void bridge.workspaceLspChange!(context.root, activeDocument.path, activeDocument.language, activeDocument.content, version).catch(() => {});
    }, 250);
    return () => { if (lspChangeTimer.current !== null) window.clearTimeout(lspChangeTimer.current); };
  }, [activeDocument?.content, activeDocument?.language, activeDocument?.path, bridge, context?.root, lspStatus?.available]);

  const openRoot = async () => {
    if (!activeThreadId || !bridge?.workspaceOpen) return;
    try {
      setError(null);
      const opened = await bridge.workspaceOpen(rootInput);
      bindRoot(activeThreadId, opened.root);
      setRootInput(opened.root);
      await refreshRoot(opened.root);
    } catch (reason: any) { setError(reason?.message ?? String(reason)); }
  };

  const openFile = async (filePath: string, location?: { line: number; column: number }) => {
    if (!activeThreadId || !context?.root || !bridge?.workspaceReadFile) return;
    try {
      setError(null);
      if (location) pendingNavigationRef.current = { path: filePath, ...location };
      if (!documents[filePath]) {
        const file = await bridge.workspaceReadFile(context.root, filePath);
        setDocuments((current) => ({ ...current, [filePath]: { ...file, original: file.content, dirty: false } }));
      }
      setActiveFile(activeThreadId, filePath);
      setMode("edit");
      if (location && documents[filePath]) {
        requestAnimationFrame(() => {
          const monacoEditor = monacoEditorRef.current;
          if (monacoEditor) {
            monacoEditor.focus();
            monacoEditor.setPosition({ lineNumber: location.line, column: location.column });
            monacoEditor.revealPositionInCenter({ lineNumber: location.line, column: location.column });
            pendingNavigationRef.current = null;
            return;
          }
          const textarea = editorRef.current;
          if (!textarea) return;
          const lines = textarea.value.split("\n");
          const lineIndex = Math.max(0, Math.min(location.line - 1, lines.length - 1));
          const offset = lines.slice(0, lineIndex).reduce((total, line) => total + line.length + 1, 0) + Math.max(0, location.column - 1);
          textarea.focus();
          textarea.setSelectionRange(offset, offset);
          pendingNavigationRef.current = null;
        });
      }
    } catch (reason: any) { setError(reason?.message ?? String(reason)); }
  };

  const save = async () => {
    if (!activeThreadId || !context?.root || !activeDocument || !bridge?.workspaceWriteFile) return;
    setSaving(true);
    try {
      const saved = await bridge.workspaceWriteFile(context.root, activeDocument.path, activeDocument.content, activeDocument.hash);
      setDocuments((current) => ({ ...current, [saved.path]: { ...saved, original: saved.content, dirty: false } }));
      await refreshRoot();
      setError(null);
    } catch (reason: any) {
      setError(reason?.code === "WORKSPACE_WRITE_CONFLICT"
        ? "Save conflict: the file changed on disk. Review or reopen it before overwriting."
        : reason?.message ?? String(reason));
    } finally { setSaving(false); }
  };

  const showDiff = async () => {
    if (!context?.root || !activeDocument || !bridge?.workspaceGitDiff) return;
    setDiff(await bridge.workspaceGitDiff(context.root, activeDocument.path));
    setMode("diff");
  };

  useEffect(() => {
    if (!context?.root || !bridge?.workspaceGitReviewWorktree || isolatedTaskWorktrees.length === 0) {
      setWorktreeReviews({});
      return;
    }
    let cancelled = false;
    void Promise.all(isolatedTaskWorktrees.map(async (worktree) => {
      try { return [worktree.path, await bridge.workspaceGitReviewWorktree!(context.root, worktree.path)] as const; }
      catch { return null; }
    })).then((results) => {
      if (!cancelled) setWorktreeReviews(Object.fromEntries(results.filter((result): result is readonly [string, ZoraiWorktreeReview] => result !== null)));
    });
    return () => { cancelled = true; };
  }, [bridge, context?.root, isolatedTaskWorktrees]);

  const integrateIsolatedWorktree = async (worktreePath: string) => {
    if (!context?.root || !bridge?.workspaceGitIntegrateWorktree) return;
    const review = worktreeReviews[worktreePath];
    if (!review?.canIntegrate) return;
    if (!window.confirm(`Integrate ${review.commits.length} reviewed commit(s) into the current worktree? Conflicts will be aborted automatically.`)) return;
    try {
      const result = await bridge.workspaceGitIntegrateWorktree(context.root, worktreePath, review.commits.map((commit) => commit.hash));
      setGitOverview(result.overview);
      setGitStatus(result.status);
      setWorktreeReviews((current) => ({ ...current, [worktreePath]: result.review }));
      await refreshRoot();
      setError(null);
    } catch (reason: any) { setError(reason?.message ?? String(reason)); }
  };

  const createManagedWorktree = async () => {
    if (!activeThreadId || !context?.root || !bridge?.workspaceGitCreateWorktree) return;
    try {
      const created = await bridge.workspaceGitCreateWorktree(context.root, { name: worktreeName, branch: worktreeBranch, baseRef: worktreeBaseRef });
      setGitWorktrees(created.worktrees);
      setWorktreeName("");
      setWorktreeBranch("");
      if (window.confirm(`Worktree created at ${created.root}. Switch this thread to it now?`)) {
        bindRoot(activeThreadId, created.root);
        setDocuments({});
      }
      setError(null);
    } catch (reason: any) { setError(reason?.message ?? String(reason)); }
  };

  const removeManagedWorktree = async (worktreePath: string) => {
    if (!context?.root || !bridge?.workspaceGitRemoveWorktree) return;
    if (!window.confirm(`Remove clean worktree ${worktreePath}? The branch will be kept.`)) return;
    try {
      setGitWorktrees(await bridge.workspaceGitRemoveWorktree(context.root, worktreePath));
      setError(null);
    } catch (reason: any) { setError(reason?.message ?? String(reason)); }
  };

  const switchThreadWorktree = (worktreePath: string) => {
    if (!activeThreadId || worktreePath === context?.root) return;
    bindRoot(activeThreadId, worktreePath);
    setDocuments({});
    setReviewedChange(null);
  };

  const commitStagedChanges = async () => {
    if (!context?.root || !bridge?.workspaceGitCommit || !commitMessage.trim()) return;
    setCommitting(true);
    try {
      const result = await bridge.workspaceGitCommit(context.root, commitMessage);
      setGitStatus(result.status);
      setGitOverview(result.overview);
      setCommitMessage("");
      setReviewedChange(null);
      setError(null);
    } catch (reason: any) { setError(reason?.message ?? String(reason)); }
    finally { setCommitting(false); }
  };

  const reviewHunks = async (filePath: string, staged: boolean) => {
    if (!context?.root || !bridge?.workspaceGitHunks) return;
    try {
      setReviewedChange({ path: filePath, staged, hunks: await bridge.workspaceGitHunks(context.root, filePath, { staged }) });
      setError(null);
    } catch (reason: any) { setError(reason?.message ?? String(reason)); }
  };

  const applyHunkAction = async (hunk: ZoraiWorkspaceGitHunk, action: "stage" | "unstage" | "discard") => {
    if (!context?.root || !bridge?.workspaceGitApplyHunk) return;
    if (action === "discard" && !window.confirm(`Discard this hunk from ${hunk.path}? This cannot be undone.`)) return;
    try {
      const result = await bridge.workspaceGitApplyHunk(context.root, hunk.path, hunk.id, action);
      setGitStatus(result.status);
      setReviewedChange((current) => current ? { ...current, hunks: result.hunks } : current);
      if (action === "discard" && activeDocument?.path === hunk.path) await reloadActiveFile();
      setError(null);
    } catch (reason: any) { setError(reason?.code === "WORKSPACE_HUNK_STALE" ? "The diff changed. Refresh hunks and try again." : reason?.message ?? String(reason)); }
  };

  const runGitAction = async (action: "stage" | "unstage" | "discard", filePath: string) => {
    if (!context?.root) return;
    if (action === "discard" && !window.confirm(`Discard all unstaged changes in ${filePath}? This cannot be undone.`)) return;
    try {
      const nextStatus = action === "stage"
        ? await bridge?.workspaceGitStage?.(context.root, filePath)
        : action === "unstage"
          ? await bridge?.workspaceGitUnstage?.(context.root, filePath)
          : await bridge?.workspaceGitDiscard?.(context.root, filePath);
      if (nextStatus) setGitStatus(nextStatus);
      if (action === "discard" && activeDocument?.path === filePath) await reloadActiveFile();
      setError(null);
    } catch (reason: any) { setError(reason?.message ?? String(reason)); }
  };

  const runSearch = async () => {
    if (!context?.root || !searchQuery.trim() || !bridge?.workspaceSearch) {
      setSearchResults([]);
      return;
    }
    try {
      setSearchResults(await bridge.workspaceSearch(context.root, searchQuery, { maxResults: 100 }));
      setError(null);
    } catch (reason: any) { setError(reason?.message ?? String(reason)); }
  };

  const createPath = async (kind: "file" | "directory") => {
    if (!activeThreadId || !context?.root || !newPath.trim()) return;
    try {
      if (kind === "directory") {
        await bridge?.workspaceCreateDirectory?.(context.root, newPath.trim());
      } else {
        const created = await bridge?.workspaceWriteFile?.(context.root, newPath.trim(), "", null);
        if (created) {
          setDocuments((current) => ({ ...current, [created.path]: { ...created, original: "", dirty: false } }));
          setActiveFile(activeThreadId, created.path);
        }
      }
      setNewPath("");
      await refreshRoot();
    } catch (reason: any) { setError(reason?.message ?? String(reason)); }
  };

  const reloadActiveFile = async () => {
    if (!context?.root || !activeDocument || !bridge?.workspaceReadFile) return;
    if (activeDocument.dirty && !window.confirm(`Discard unsaved changes in ${activeDocument.path}?`)) return;
    try {
      const reloaded = await bridge.workspaceReadFile(context.root, activeDocument.path);
      setDocuments((current) => ({ ...current, [reloaded.path]: { ...reloaded, original: reloaded.content, dirty: false } }));
      setError(null);
    } catch (reason: any) { setError(reason?.message ?? String(reason)); }
  };

  const renameActiveFile = async () => {
    if (!activeThreadId || !context?.root || !activeDocument || !bridge?.workspaceRenamePath) return;
    const nextPath = window.prompt("Rename workspace path", activeDocument.path)?.trim();
    if (!nextPath || nextPath === activeDocument.path) return;
    try {
      await bridge.workspaceRenamePath(context.root, activeDocument.path, nextPath);
      const renamed = await bridge.workspaceReadFile?.(context.root, nextPath);
      setDocuments((current) => {
        const next = { ...current };
        delete next[activeDocument.path];
        if (renamed) next[nextPath] = { ...renamed, original: renamed.content, dirty: false };
        return next;
      });
      closeFile(activeThreadId, activeDocument.path);
      if (renamed) setActiveFile(activeThreadId, nextPath);
      await refreshRoot();
    } catch (reason: any) { setError(reason?.message ?? String(reason)); }
  };

  const deleteActiveFile = async () => {
    if (!activeThreadId || !context?.root || !activeDocument || !bridge?.workspaceDeletePath) return;
    if (!window.confirm(`Delete ${activeDocument.path}?`)) return;
    try {
      await bridge.workspaceDeletePath(context.root, activeDocument.path, { recursive: false });
      setDocuments((current) => {
        const next = { ...current };
        delete next[activeDocument.path];
        return next;
      });
      closeFile(activeThreadId, activeDocument.path);
      await refreshRoot();
    } catch (reason: any) { setError(reason?.message ?? String(reason)); }
  };

  const recordEditorSelection = (startLine: number, startColumn: number, endLine: number, endColumn: number) => {
    if (!activeThreadId) return;
    setSelection(activeThreadId, { startLine, startColumn, endLine, endColumn });
  };

  if (!activeThreadId) return <div className="zorai-tool-empty"><strong>Select a thread</strong><span>Workspace roots and editor context are bound to an agent thread.</span></div>;

  return (
    <div className="zorai-workspace-workbench">
      <aside className="zorai-workspace-explorer">
        <div className="zorai-workspace-root-form">
          <input value={rootInput} onChange={(event) => setRootInput(event.target.value)} placeholder="/path/to/repository" onKeyDown={(event) => { if (event.key === "Enter") void openRoot(); }} />
          <button type="button" onClick={() => void openRoot()}>Open</button>
        </div>
        {context?.root ? (
          <>
            <div className="zorai-workspace-explorer-heading"><strong>{context.root.split(/[\\/]/).slice(-1)[0]}</strong><button type="button" onClick={() => void refreshRoot()}>↻</button></div>
            <label className="zorai-workspace-isolation-toggle"><input type="checkbox" checked={context.isolateAgentTasks} onChange={(event) => setIsolateAgentTasks(activeThreadId, event.target.checked)} /><span>Isolate agent tasks in worktrees</span></label>
            <div className="zorai-workspace-create-row">
              <input value={newPath} onChange={(event) => setNewPath(event.target.value)} placeholder="relative/path" />
              <button type="button" title="New file" onClick={() => void createPath("file")}>+F</button>
              <button type="button" title="New directory" onClick={() => void createPath("directory")}>+D</button>
            </div>
            <div className="zorai-workspace-search-row">
              <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search workspace" onKeyDown={(event) => { if (event.key === "Enter") void runSearch(); }} />
              <button type="button" onClick={() => void runSearch()}>⌕</button>
            </div>
            {isolatedTaskWorktrees.length > 0 ? (
              <details className="zorai-workspace-isolated-reviews" open>
                <summary>Awaiting isolated review ({isolatedTaskWorktrees.length})</summary>
                {isolatedTaskWorktrees.map((worktree) => {
                  const review = worktreeReviews[worktree.path];
                  return (
                    <div key={worktree.path}>
                      <button type="button" onClick={() => switchThreadWorktree(worktree.path)}><strong>{worktree.branch}</strong><span>{worktree.path}</span></button>
                      <em>{review ? `${review.commits.length} commit(s) · ${review.files.length} file(s) · source ${review.source.clean ? "clean" : "dirty"} · target ${review.target.clean ? "clean" : "dirty"}` : "Loading review…"}</em>
                      {review?.commits.map((commit) => <code key={commit.hash}>{commit.hash.slice(0, 8)} · {commit.subject}</code>)}
                      {review?.canIntegrate ? <button type="button" className="zorai-workspace-integrate-button" onClick={() => void integrateIsolatedWorktree(worktree.path)}>Integrate reviewed commits</button> : null}
                    </div>
                  );
                })}
              </details>
            ) : null}
            {workspaceDiagnostics.length > 0 ? (
              <details className="zorai-workspace-problems" open>
                <summary>Problems ({workspaceDiagnostics.length})</summary>
                {workspaceDiagnostics.map((diagnostic, index) => (
                  <button type="button" key={`${diagnostic.path}:${diagnostic.startLine}:${diagnostic.startColumn}:${diagnostic.code ?? index}`} onClick={() => void openFile(diagnostic.path, { line: diagnostic.startLine, column: diagnostic.startColumn })}>
                    <span className={`severity-${diagnostic.severity}`}>{diagnostic.severity === 1 ? "E" : diagnostic.severity === 2 ? "W" : "I"}</span>
                    <strong>{diagnostic.message}</strong>
                    <code>{diagnostic.path}:{diagnostic.startLine}{diagnostic.source ? ` · ${diagnostic.source}` : ""}</code>
                  </button>
                ))}
              </details>
            ) : null}
            {gitOverview?.isRepository ? (
              <details className="zorai-workspace-worktrees">
                <summary>Worktrees ({gitWorktrees.length})</summary>
                <div className="zorai-workspace-worktree-create">
                  <input value={worktreeName} onChange={(event) => setWorktreeName(event.target.value)} placeholder="folder-name" />
                  <input value={worktreeBranch} onChange={(event) => setWorktreeBranch(event.target.value)} placeholder="feature/branch" />
                  <input value={worktreeBaseRef} onChange={(event) => setWorktreeBaseRef(event.target.value)} placeholder="base ref" />
                  <button type="button" disabled={!worktreeName.trim() || !worktreeBranch.trim()} onClick={() => void createManagedWorktree()}>Create</button>
                </div>
                {gitWorktrees.map((worktree) => (
                  <div key={worktree.path} className={worktree.path === context.root ? "active" : ""}>
                    <button type="button" className="zorai-workspace-worktree-path" onClick={() => switchThreadWorktree(worktree.path)}><strong>{worktree.branch || "detached"}</strong><span>{worktree.path}</span></button>
                    {worktree.path !== context.root && worktree.path.includes("-worktrees") ? <button type="button" onClick={() => void removeManagedWorktree(worktree.path)}>Remove</button> : null}
                  </div>
                ))}
              </details>
            ) : null}
            {gitOverview?.isRepository ? (
              <div className="zorai-workspace-git-overview">
                <span><strong>{gitOverview.branch || "detached HEAD"}</strong>{gitOverview.upstream ? ` · ${gitOverview.upstream}` : " · no upstream"}</span>
                <span>↑{gitOverview.ahead} ↓{gitOverview.behind} · {gitOverview.stagedFiles} staged · {gitOverview.unstagedFiles} unstaged</span>
                <textarea value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder="Commit message" rows={2} maxLength={4096} />
                <button type="button" disabled={committing || !commitMessage.trim() || gitOverview.stagedFiles === 0} onClick={() => void commitStagedChanges()}>{committing ? "Committing…" : "Commit staged"}</button>
              </div>
            ) : null}
            {gitStatus.length > 0 ? (
              <details className="zorai-workspace-source-control">
                <summary>Source Control ({gitStatus.length})</summary>
                {gitStatus.map((entry) => (
                  <div key={`${entry.path}:${entry.indexStatus}:${entry.worktreeStatus}`}>
                    <button type="button" className="zorai-workspace-change-path" onClick={() => void openFile(entry.path)}>
                      <strong>{entry.path}</strong><span>{entry.indexStatus}{entry.worktreeStatus}</span>
                    </button>
                    <span className="zorai-workspace-change-actions">
                      {entry.worktreeStatus.trim() || entry.indexStatus === "?" ? <button type="button" onClick={() => void reviewHunks(entry.path, false)}>Hunks</button> : null}
                      {entry.indexStatus.trim() && entry.indexStatus !== "?" ? <button type="button" onClick={() => void reviewHunks(entry.path, true)}>Staged hunks</button> : null}
                      {entry.worktreeStatus.trim() || entry.indexStatus === "?" ? <button type="button" onClick={() => void runGitAction("stage", entry.path)}>Stage</button> : null}
                      {entry.indexStatus.trim() && entry.indexStatus !== "?" ? <button type="button" onClick={() => void runGitAction("unstage", entry.path)}>Unstage</button> : null}
                      {entry.worktreeStatus.trim() && entry.worktreeStatus !== "?" ? <button type="button" onClick={() => void runGitAction("discard", entry.path)}>Discard</button> : null}
                    </span>
                  </div>
                ))}
              </details>
            ) : null}
            {searchResults.length > 0 ? <div className="zorai-workspace-search-results">{searchResults.map((result) => <button type="button" key={`${result.path}:${result.line}:${result.column}`} onClick={() => void openFile(result.path, { line: result.line, column: result.column })}><strong>{result.path}:{result.line}</strong><span>{result.preview}</span></button>)}</div> : null}
            {reviewedChange ? (
              <div className="zorai-workspace-hunk-review">
                <div className="zorai-workspace-hunk-heading">
                  <strong>{reviewedChange.staged ? "Staged" : "Unstaged"} hunks · {reviewedChange.path}</strong>
                  <button type="button" onClick={() => void reviewHunks(reviewedChange.path, reviewedChange.staged)}>↻</button>
                  <button type="button" onClick={() => setReviewedChange(null)}>×</button>
                </div>
                {reviewedChange.hunks.length === 0 ? <span className="zorai-workspace-empty">No matching hunks.</span> : reviewedChange.hunks.map((hunk) => (
                  <article key={hunk.id}>
                    <header><code>{hunk.header}</code><span>+{hunk.additions} −{hunk.deletions}</span></header>
                    {hunk.section ? <strong>{hunk.section}</strong> : null}
                    <pre>{hunk.preview}</pre>
                    <footer>
                      {reviewedChange.staged ? <button type="button" onClick={() => void applyHunkAction(hunk, "unstage")}>Unstage hunk</button> : <button type="button" onClick={() => void applyHunkAction(hunk, "stage")}>Stage hunk</button>}
                      {!reviewedChange.staged ? <button type="button" onClick={() => void applyHunkAction(hunk, "discard")}>Discard hunk</button> : null}
                    </footer>
                  </article>
                ))}
              </div>
            ) : null}
            {operationGroups.length > 0 ? (
              <details className="zorai-workspace-operation-changes" open>
                <summary>Agent operations ({operationGroups.length})</summary>
                {operationGroups.slice(0, 30).map(([operationId, entries]) => (
                  <article key={operationId}>
                    <header><code>{operationId}</code><span>{entries[0]?.source}</span></header>
                    {entries.map((entry) => (
                      <button type="button" key={`${operationId}:${entry.path}`} onClick={() => void openFile(entry.path)}>
                        <strong>{entry.path}</strong>
                        <span>{entry.before_hash ? entry.before_hash.slice(0, 8) : "∅"} → {entry.after_hash ? entry.after_hash.slice(0, 8) : "∅"}{entry.task_id ? ` · task ${entry.task_id}` : ""}{entry.goal_run_id ? ` · goal ${entry.goal_run_id}` : ""}</span>
                      </button>
                    ))}
                  </article>
                ))}
              </details>
            ) : null}
            {agentChanges.length > 0 ? (
              <details className="zorai-workspace-agent-changes" open>
                <summary>Agent changes ({agentChanges.length})</summary>
                {agentChanges.slice(0, 40).map((entry) => (
                  <button type="button" key={`${entry.path}:${entry.updated_at}:${entry.source}`} onClick={() => void openFile(entry.path)}>
                    <strong>{entry.path}</strong>
                    <span>{entry.change_kind ?? entry.kind ?? "changed"} · {entry.source}</span>
                  </button>
                ))}
              </details>
            ) : null}
            <div className="zorai-workspace-tree">{rootEntries.map((entry) => <WorkspaceTreeNode key={entry.path} root={context.root} entry={entry} depth={0} status={statusMap} onOpen={(path) => void openFile(path)} />)}</div>
          </>
        ) : <div className="zorai-workspace-empty">Open a folder to bind it to this thread.</div>}
      </aside>

      <section className="zorai-workspace-editor-area">
        <div className="zorai-workspace-tabs">
          {(context?.openFiles ?? []).map((filePath) => {
            const document = documents[filePath];
            return <button type="button" key={filePath} className={filePath === context?.activeFile ? "active" : ""} onClick={() => setActiveFile(activeThreadId, filePath)}>{filePath.split(/[\\/]/).slice(-1)[0]}{document?.dirty ? " ●" : ""}<span onClick={(event) => { event.stopPropagation(); closeFile(activeThreadId, filePath); }}>×</span></button>;
          })}
        </div>
        {activeDocument ? (
          <>
            <div className="zorai-workspace-actionbar">
              <span>{activeDocument.path}{lspStatus ? ` · LSP ${lspStatus.available ? lspStatus.command ?? "ready" : "unavailable"}` : ""}</span>
              <div>
                <button type="button" onClick={() => toggleAttachedFile(activeThreadId, activeDocument.path)}>{context?.attachedFiles.includes(activeDocument.path) ? "Detach context" : "Attach context"}</button>
                <button type="button" onClick={() => void showDiff()}>Diff</button>
                {activeDocument.externalContent !== undefined ? <button type="button" onClick={() => setMode("external")}>External diff</button> : null}
                <button type="button" onClick={() => void reloadActiveFile()}>Reload</button>
                <button type="button" onClick={() => void renameActiveFile()}>Rename</button>
                <button type="button" onClick={() => void deleteActiveFile()}>Delete</button>
                <button type="button" disabled={!activeDocument.dirty || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button>
              </div>
            </div>
            {symbols.length > 0 ? (
              <details className="zorai-workspace-symbols">
                <summary>Outline ({symbols.length})</summary>
                {symbols.map((symbol) => <button type="button" key={`${symbol.line}:${symbol.column}:${symbol.name}`} onClick={() => activeDocument && void openFile(activeDocument.path, { line: symbol.line, column: symbol.column })}><span>{symbol.kind}</span><strong>{symbol.name}</strong><code>{symbol.line}</code></button>)}
              </details>
            ) : null}
            <div className="zorai-workspace-editor">
              {mode === "diff" ? (
                <Suspense fallback={<div className="zorai-workspace-diff-grid"><pre>{activeDocument.original}</pre><pre>{activeDocument.content}</pre></div>}>
                  <WorkspaceDiffEditor original={activeDocument.original} modified={activeDocument.content} language={activeDocument.language} />
                </Suspense>
              ) : mode === "external" ? (
                <Suspense fallback={<div className="zorai-workspace-diff-grid"><pre>{activeDocument.content}</pre><pre>{activeDocument.externalContent}</pre></div>}>
                  <WorkspaceDiffEditor original={activeDocument.content} modified={activeDocument.externalContent ?? ""} language={activeDocument.language} />
                </Suspense>
              ) : (
                <Suspense fallback={<div className="zorai-workspace-editor-loading">Loading Monaco editor…</div>}>
                  <WorkspaceCodeEditor
                    path={activeDocument.path}
                    value={activeDocument.content}
                    language={activeDocument.language}
                    textareaRef={editorRef}
                    onMount={(editor) => { monacoEditorRef.current = editor; }}
                    onSave={() => void save()}
                    diagnostics={diagnosticsByPath[activeDocument.path] ?? []}
                    lsp={context?.root && lspStatus ? { root: context.root, path: activeDocument.path, language: activeDocument.language, available: lspStatus.available } : undefined}
                    onNavigateLocation={(targetPath, line, column) => void openFile(targetPath, { line, column })}
                    onSelect={recordEditorSelection}
                    onChange={(value) => setDocuments((current) => ({ ...current, [activeDocument.path]: { ...activeDocument, content: value, dirty: value !== activeDocument.original } }))}
                  />
                </Suspense>
              )}
            </div>
            {mode === "diff" && diff !== null ? <details className="zorai-workspace-raw-diff"><summary>Git patch</summary><pre>{diff || "No working-tree diff for this file."}</pre></details> : null}
          </>
        ) : <div className="zorai-tool-empty"><strong>Workspace editor</strong><span>Select a text file from Explorer. File contents are loaded on demand and never injected implicitly.</span></div>}
        {error ? <div className="zorai-workspace-error">{error}</div> : null}
      </section>
    </div>
  );
}
