import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getBridge } from "@/lib/bridge";
import { useAgentStore } from "@/lib/agentStore";
import { useWorkspaceStore } from "@/lib/workspaceStore";
import { useWorkspaceContextStore } from "@/lib/workspaceContextStore";
import { extractWorkspaceSymbols } from "@/lib/workspaceSymbols";
import type { editor as MonacoEditorApi } from "monaco-editor";
import { CodeTabs } from "@/zorai/features/code/CodeTabs";
import { shouldRestoreWorkspaceDocument } from "@/zorai/features/code/workspaceDocumentRestore";
import { useWorkspaceEditorRequestStore } from "@/lib/workspaceEditorRequestStore";
import { preloadCodeEditor } from "@/zorai/features/code/codeEditorPreload";
import { CodeQuickOpen } from "@/zorai/features/code/CodeQuickOpen";
import { CodeCommandPalette } from "@/zorai/features/code/CodeCommandPalette";
import { CODE_COMMANDS, matchesCodeBinding, type CodeCommandId } from "@/zorai/features/code/codeCommands";
import { createCodeDocumentController } from "@/zorai/features/code/codeDocumentModel";
import { createCodeFileOpenTrace } from "@/zorai/features/code/codeEditorPerformance";

const WorkspaceCodeEditor = lazy(() => import("@/components/WorkspaceCodeEditor").then((module) => ({ default: module.WorkspaceCodeEditor })));
const WorkspaceDiffEditor = lazy(() => import("@/components/WorkspaceCodeEditor").then((module) => ({ default: module.WorkspaceDiffEditor })));

type OpenDocument = ZoraiWorkspaceFile & { original: string; dirty: boolean; gitBaseContent?: string; externalContent?: string; externalHash?: string };

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
      <button type="button" className="zorai-workspace-tree-row" style={{ paddingLeft: 8 + depth * 14 }} onPointerEnter={() => void preloadCodeEditor()} onFocus={() => void preloadCodeEditor()} onClick={() => void activate()}>
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

export function WorkspaceWorkbench({ openedRoot }: { openedRoot?: string | null } = {}) {
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
  const togglePinnedFile = useWorkspaceContextStore((state) => state.togglePinnedFile);
  const moveOpenFile = useWorkspaceContextStore((state) => state.moveOpenFile);
  const setIsolateAgentTasks = useWorkspaceContextStore((state) => state.setIsolateAgentTasks);
  const setIsolatedWorktreeState = useWorkspaceContextStore((state) => state.setIsolatedWorktreeState);
  const [rootInput, setRootInput] = useState(context?.root ?? activeWorkspace?.cwd ?? "");
  const [rootEntries, setRootEntries] = useState<ZoraiWorkspaceEntry[]>([]);
  const [gitStatus, setGitStatus] = useState<ZoraiWorkspaceGitStatus[]>([]);
  const [gitOverview, setGitOverview] = useState<ZoraiWorkspaceGitOverview | null>(null);
  const [gitHistory, setGitHistory] = useState<Array<{ hash: string; shortHash: string; author: string; date: string; subject: string }>>([]);
  const [commitDetail, setCommitDetail] = useState<{ hash: string; author: string; date: string; subject: string; body: string; files: Array<{ status: string; path: string }> } | null>(null);
  const [gitConflicts, setGitConflicts] = useState<Array<{ path: string }>>([]);
  const [gitWorktrees, setGitWorktrees] = useState<ZoraiGitWorktree[]>([]);
  const [worktreeReviews, setWorktreeReviews] = useState<Record<string, ZoraiWorktreeReview>>({});
  const [worktreeName, setWorktreeName] = useState("");
  const [worktreeBranch, setWorktreeBranch] = useState("");
  const [worktreeBaseRef, setWorktreeBaseRef] = useState("HEAD");
  const [commitMessage, setCommitMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [reviewedChange, setReviewedChange] = useState<{ path: string; staged: boolean; hunks: ZoraiWorkspaceGitHunk[] } | null>(null);
  const [documents, setDocuments] = useState<Record<string, OpenDocument>>({});
  const documentControllerRef = useRef(createCodeDocumentController({ maxCachedDocuments: 32 }));
  const [diff, setDiff] = useState<string | null>(null);
  const [mode, setMode] = useState<"edit" | "diff" | "external">("edit");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [codeOverlay, setCodeOverlay] = useState<"quickOpen" | "commands" | null>(null);
  const workspaceSyncTimer = useRef<number | null>(null);
  const [daemonContextLoadedFor, setDaemonContextLoadedFor] = useState<string | null>(null);
  const [newPath, setNewPath] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ path: string; line: number; column: number; preview: string }>>([]);
  const [agentChanges, setAgentChanges] = useState<ZoraiWorkContextEntry[]>([]);
  const [operationSnapshots, setOperationSnapshots] = useState<Record<string, { available: boolean; revertible: boolean; stale_paths: string[]; retained_bytes: number; reason: string | null }>>({});
  const [lspStatus, setLspStatus] = useState<{ available: boolean; command?: string | null; reason?: string } | null>(null);
  const [diagnosticsByPath, setDiagnosticsByPath] = useState<Record<string, ZoraiLspDiagnostic[]>>({});
  const [workspaceTests, setWorkspaceTests] = useState<ZoraiWorkspaceTest[]>([]);
  const [testRun, setTestRun] = useState<{ runId: string; status: "running" | "passed" | "failed" | "cancelled" | "error"; output: string; durationMs?: number; evidence?: ZoraiWorkspaceTestEvidence } | null>(null);
  const lspVersionRef = useRef<Record<string, number>>({});
  const lspChangeTimer = useRef<number | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const monacoEditorRef = useRef<MonacoEditorApi.IStandaloneCodeEditor | null>(null);
  const pendingNavigationRef = useRef<{ path: string; line: number; column: number } | null>(null);
  const saveCommandRef = useRef<() => Promise<void>>(async () => {});
  const reloadCommandRef = useRef<() => Promise<void>>(async () => {});
  const handledEditorRequestTokenRef = useRef(0);
  const editorRequest = useWorkspaceEditorRequestStore((state) => state.request);
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
  const testProblems = useMemo(() => testRun?.evidence?.results.filter((result) => result.status === "failed" && result.location) ?? [], [testRun?.evidence]);
  const workspaceDiagnostics = useMemo(() => Object.entries(diagnosticsByPath).flatMap(([path, diagnostics]) => diagnostics.map((diagnostic) => ({ path, ...diagnostic }))), [diagnosticsByPath]);
  const statusMap = useMemo(() => new Map(gitStatus.map((entry) => [entry.path, statusLabel(entry)])), [gitStatus]);

  const refreshRoot = useCallback(async (root = context?.root) => {
    if (!root || !bridge?.workspaceListDirectory) return;
    const [entries, statuses, overview, worktrees, history, conflicts] = await Promise.all([
      bridge.workspaceListDirectory(root, ""),
      bridge.workspaceGitStatus?.(root) ?? Promise.resolve([]),
      bridge.workspaceGitOverview?.(root) ?? Promise.resolve(null),
      bridge.workspaceGitListWorktrees?.(root) ?? Promise.resolve([]),
      bridge.workspaceGitHistory?.(root, { limit: 50 }) ?? Promise.resolve([]),
      bridge.workspaceGitConflicts?.(root) ?? Promise.resolve([]),
    ]);
    setRootEntries(entries);
    setGitStatus(statuses);
    setGitOverview(overview);
    setGitWorktrees(worktrees);
    setGitHistory(history);
    setGitConflicts(conflicts);
  }, [bridge, context?.root]);

  useEffect(() => { void useWorkspaceContextStore.getState().hydrate(); }, []);
  useEffect(() => {
    const path = context?.activeFile;
    const root = context?.root;
    if (!path || !root || !bridge?.workspaceReadFile || !shouldRestoreWorkspaceDocument(path, documents)) return;
    let cancelled = false;
    void bridge.workspaceReadFile(root, path).then((file) => {
      if (cancelled) return;
      setDocuments((current) => current[path]
        ? current
        : { ...current, [path]: { ...file, original: file.content, dirty: false } });
    }).catch((reason: any) => {
      if (!cancelled) setError(reason?.message ?? String(reason));
    });
    return () => { cancelled = true; };
  }, [bridge, context?.activeFile, context?.root, documents]);
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
            isolatedWorktreeStates: daemonContext.isolated_worktree_states ?? current?.isolatedWorktreeStates ?? {},
            pinnedFiles: current?.pinnedFiles ?? [],
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
        isolated_worktree_states: context.isolatedWorktreeStates,
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
  // Document open/close follows identity; incremental content changes use the debounced effect below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // Primitive document fields intentionally drive incremental synchronization.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDocument?.content, activeDocument?.language, activeDocument?.path, bridge, context?.root, lspStatus?.available]);

  useEffect(() => {
    if (!context?.root || !bridge?.workspaceTestsDiscover) {
      setWorkspaceTests([]);
      return;
    }
    void bridge.workspaceTestsDiscover(context.root, { maxTests: 2000 }).then((result) => setWorkspaceTests(result.tests)).catch(() => setWorkspaceTests([]));
  }, [bridge, context?.root]);
  useEffect(() => {
    if (!bridge?.onWorkspaceTestEvent) return;
    const unsubscribe = bridge.onWorkspaceTestEvent((event) => {
      setTestRun((current) => {
        if (!current || current.runId !== event.runId) return current;
        if (event.type === "output") return { ...current, output: `${current.output}${event.text ?? ""}`.slice(-500000) };
        return { ...current, status: event.status ?? "error", output: event.output ?? current.output, durationMs: event.durationMs, evidence: event.evidence };
      });
    });
    return () => { if (typeof unsubscribe === "function") unsubscribe(); };
  }, [bridge]);

  const runWorkspaceTest = async (test?: ZoraiWorkspaceTest) => {
    if (!context?.root || !bridge?.workspaceTestsRun) return;
    const framework = test?.framework ?? workspaceTests[0]?.framework;
    if (!framework) return;
    try {
      const started = await bridge.workspaceTestsRun(context.root, { framework, path: test?.path, selector: test?.selector });
      setTestRun({ runId: started.runId, status: "running", output: `$ ${started.command} ${started.args.join(" ")}\n` });
      setError(null);
    } catch (reason: any) { setError(reason?.message ?? String(reason)); }
  };

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

  const openFile = async (filePath: string, location?: { line: number; column: number }, view: "edit" | "diff" = "edit") => {
    if (!activeThreadId || !context?.root || !bridge?.workspaceReadFile) return;
    const controller = documentControllerRef.current;
    const cacheHit = Boolean(controller.get(context.root, filePath));
    const trace = createCodeFileOpenTrace({ root: context.root, path: filePath, cacheHit });
    trace.mark("start");
    setActiveFile(activeThreadId, filePath);
    trace.mark("tab-active");
    try {
      setError(null);
      if (location) pendingNavigationRef.current = { path: filePath, ...location };
      let nextDocument = documents[filePath];
      if (!nextDocument) {
        trace.mark("ipc-start");
        const entry = await controller.open(context.root, filePath, async () => {
          const file = await bridge.workspaceReadFile!(context.root, filePath);
          trace.mark("ipc-complete");
          return {
            root: context.root,
            path: file.path,
            content: file.content,
            original: file.content,
            hash: file.hash,
            language: file.language,
            byteSize: file.sizeBytes,
            modifiedAt: file.modifiedAt,
            lineCount: file.content.split("\n").length,
          };
        });
        if (!entry) return;
        nextDocument = {
          path: entry.path,
          content: entry.content,
          hash: entry.hash,
          language: entry.language,
          sizeBytes: entry.byteSize,
          modifiedAt: entry.modifiedAt,
          original: entry.original,
          dirty: entry.dirty,
        };
        setDocuments((current) => current[filePath] ? current : { ...current, [filePath]: nextDocument! });
      }
      trace.mark("model-ready");
      if (view === "diff") {
        await enterDiffView(filePath, nextDocument);
        return;
      }
      setMode("edit");
      if (location && nextDocument) {
        requestAnimationFrame(() => {
          trace.mark("paint");
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
          trace.mark("interactive");
          trace.finish({ byteSize: new TextEncoder().encode(nextDocument!.content).byteLength, lineCount: nextDocument!.content.split("\n").length, language: nextDocument!.language });
        });
      } else {
        requestAnimationFrame(() => {
          trace.mark("paint");
          trace.mark("interactive");
          trace.finish({ byteSize: new TextEncoder().encode(nextDocument!.content).byteLength, lineCount: nextDocument!.content.split("\n").length, language: nextDocument!.language });
        });
      }
    } catch (reason: any) { setError(reason?.message ?? String(reason)); }
  };

  const enterDiffView = async (filePath: string, document: OpenDocument) => {
    if (!context?.root) return;
    const gitBase = bridge?.workspaceGitShow
      ? await bridge.workspaceGitShow(context.root, filePath).catch(() => "")
      : "";
    const patch = bridge?.workspaceGitDiff
      ? await bridge.workspaceGitDiff(context.root, filePath, { againstHead: true, includeUntracked: true }).catch(() => "")
      : "";
    setDocuments((current) => ({
      ...current,
      [filePath]: { ...(current[filePath] ?? document), gitBaseContent: gitBase },
    }));
    setDiff(patch);
    setMode("diff");
  };

  const showDiff = async () => {
    if (!activeDocument) return;
    await enterDiffView(activeDocument.path, activeDocument);
  };

  useEffect(() => {
    if (!editorRequest || editorRequest.threadId !== activeThreadId) return;
    if (editorRequest.token === handledEditorRequestTokenRef.current) return;
    handledEditorRequestTokenRef.current = editorRequest.token;
    void openFile(editorRequest.path, undefined, editorRequest.view);
  }, [activeThreadId, editorRequest]);

  const save = async () => {
    if (!activeThreadId || !context?.root || !activeDocument || !bridge?.workspaceWriteFile) return;
    setSaving(true);
    try {
      const saved = await bridge.workspaceWriteFile(context.root, activeDocument.path, activeDocument.content, activeDocument.hash);
      setDocuments((current) => ({ ...current, [saved.path]: { ...saved, original: saved.content, dirty: false } }));
      documentControllerRef.current.invalidate(context.root, activeDocument.path);
      await documentControllerRef.current.open(context.root, saved.path, async () => ({
        root: context.root,
        path: saved.path,
        content: saved.content,
        original: saved.content,
        hash: saved.hash,
        language: saved.language,
        byteSize: saved.sizeBytes,
        modifiedAt: saved.modifiedAt,
        lineCount: saved.content.split("\n").length,
      }));
      await refreshRoot();
      setError(null);
    } catch (reason: any) {
      setError(reason?.code === "WORKSPACE_WRITE_CONFLICT"
        ? "Save conflict: the file changed on disk. Review or reopen it before overwriting."
        : reason?.message ?? String(reason));
    } finally { setSaving(false); }
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
    if (!activeThreadId || !context?.root || !bridge?.workspaceGitIntegrateWorktree) return;
    const review = worktreeReviews[worktreePath];
    if (!review?.canIntegrate) return;
    if (!window.confirm(`Integrate ${review.commits.length} reviewed commit(s) into the current worktree? Conflicts will be aborted automatically.`)) return;
    try {
      const result = await bridge.workspaceGitIntegrateWorktree(context.root, worktreePath, review.commits.map((commit) => commit.hash));
      setGitOverview(result.overview);
      setGitStatus(result.status);
      setWorktreeReviews((current) => ({ ...current, [worktreePath]: result.review }));
      setIsolatedWorktreeState(activeThreadId, worktreePath, "integrated");
      await refreshRoot();
      setError(null);
    } catch (reason: any) { setError(reason?.message ?? String(reason)); }
  };

  useEffect(() => {
    if (!bridge?.agentGetFileOperationSnapshot || operationGroups.length === 0) {
      setOperationSnapshots({});
      return;
    }
    let cancelled = false;
    void Promise.all(operationGroups.slice(0, 50).map(async ([operationId]) => {
      try {
        const response = await bridge.agentGetFileOperationSnapshot!(operationId);
        return [operationId, response.status] as const;
      } catch { return null; }
    })).then((results) => {
      if (!cancelled) setOperationSnapshots(Object.fromEntries(results.filter((result): result is readonly [string, any] => result !== null)));
    });
    return () => { cancelled = true; };
  }, [bridge, operationGroups]);

  const revertAgentOperation = async (operationId: string) => {
    if (!bridge?.agentRevertFileOperation) return;
    if (!window.confirm(`Revert every file change from operation ${operationId}? This is allowed only if no later edit changed those files.`)) return;
    try {
      const result = await bridge.agentRevertFileOperation(operationId);
      if (result?.ok === false || result?.error) throw new Error(result.error || "Operation revert failed.");
      if (activeDocument) await reloadActiveFile();
      await refreshRoot();
      if (activeDaemonThreadId && bridge.agentGetWorkContext) {
        const response: any = await bridge.agentGetWorkContext(activeDaemonThreadId);
        const workContext = response?.context ?? response;
        setAgentChanges(Array.isArray(workContext?.entries) ? workContext.entries : []);
      }
      setError(null);
    } catch (reason: any) { setError(reason?.message ?? String(reason)); }
  };

  const inspectCommit = async (hash: string) => {
    if (!context?.root || !bridge?.workspaceGitCommitDetail) return;
    try { setCommitDetail(await bridge.workspaceGitCommitDetail(context.root, hash)); }
    catch (reason: any) { setError(reason?.message ?? String(reason)); }
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

  saveCommandRef.current = save;
  reloadCommandRef.current = reloadActiveFile;

  const runCodeCommand = useCallback((id: CodeCommandId) => {
    if (id === "file.quickOpen") { setCodeOverlay("quickOpen"); return; }
    if (id === "view.commandPalette") { setCodeOverlay("commands"); return; }
    if (id === "file.save") { void saveCommandRef.current(); return; }
    if (id === "file.reload") { void reloadCommandRef.current(); return; }
    if (id === "search.project") {
      const input = document.querySelector<HTMLInputElement>(".zorai-workspace-search-row input");
      input?.focus();
      return;
    }
    const action = monacoEditorRef.current?.getAction(id);
    if (action) void action.run();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = CODE_COMMANDS.find((item) => item.defaultKeybinding && matchesCodeBinding(item.defaultKeybinding, event));
      if (!command) return;
      event.preventDefault();
      event.stopPropagation();
      runCodeCommand(command.id);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [runCodeCommand]);

  const explorerFiles = useMemo(() => {
    const paths: string[] = [];
    const visit = (entries: ZoraiWorkspaceEntry[]) => {
      for (const entry of entries) if (!entry.isDirectory) paths.push(entry.path);
    };
    visit(rootEntries);
    return [...(context?.openFiles ?? []), ...paths];
  }, [context?.openFiles, rootEntries]);

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

  useEffect(() => {
    const root = openedRoot?.trim();
    if (!root || root === context?.root) return;
    setRootInput(root);
    if (!activeThreadId || !bridge?.workspaceOpen) return;
    void bridge.workspaceOpen(root).then(async (opened) => {
      bindRoot(activeThreadId, opened.root);
      setRootInput(opened.root);
      await refreshRoot(opened.root);
    }).catch((reason: any) => setError(reason?.message ?? String(reason)));
  }, [activeThreadId, bindRoot, bridge, context?.root, openedRoot, refreshRoot]);

  const [explorerPortalHost, setExplorerPortalHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setExplorerPortalHost(document.getElementById("zorai-code-explorer-host"));
  }, []);

  if (!activeThreadId) return <div className="zorai-tool-empty"><strong>Select a thread</strong><span>Workspace roots and editor context are bound to an agent thread.</span></div>;

  const explorer = (
      <aside className="zorai-workspace-explorer">
        {!explorerPortalHost ? (
          <div className="zorai-workspace-root-form">
            <input value={rootInput} onChange={(event) => setRootInput(event.target.value)} placeholder="/path/to/repository" onKeyDown={(event) => { if (event.key === "Enter") void openRoot(); }} />
            <button type="button" onClick={() => void openRoot()}>Open</button>
          </div>
        ) : null}
        {context?.root ? (
          <>
            {!explorerPortalHost ? (
              <div className="zorai-workspace-explorer-heading"><strong>{context.root.split(/[\\/]/).slice(-1)[0]}</strong><button type="button" onClick={() => void refreshRoot()}>↻</button></div>
            ) : null}
            <details className="zorai-code-open-editors">
              <summary>Open Editors ({context.openFiles.length})</summary>
              {context.openFiles.map((filePath) => (
                <button type="button" key={filePath} className={filePath === context.activeFile ? "active" : ""} onClick={() => void openFile(filePath)}>{filePath.split(/[\\/]/).slice(-1)[0]}</button>
              ))}
            </details>
            <details className="zorai-code-files" open>
              <summary>Files</summary>
              <div className="zorai-workspace-tree" role="tree" aria-label="Workspace files">{rootEntries.map((entry) => <WorkspaceTreeNode key={entry.path} root={context.root} entry={entry} depth={0} status={statusMap} onOpen={(path) => void openFile(path)} />)}</div>
            </details>
            <details className="zorai-code-workspace-actions">
              <summary>Workspace Actions</summary>
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
            </details>
            {workspaceTests.length > 0 ? (
              <details className="zorai-workspace-tests">
                <summary>Tests ({workspaceTests.length})</summary>
                <div className="zorai-workspace-test-actions">
                  <button type="button" disabled={testRun?.status === "running"} onClick={() => void runWorkspaceTest()}>Run all</button>
                  {testRun?.status === "running" ? <button type="button" onClick={() => bridge?.workspaceTestsCancel?.(testRun.runId)}>Stop</button> : null}
                  {testRun ? <span className={`status-${testRun.status}`}>{testRun.status}{testRun.evidence ? ` · ✓${testRun.evidence.passed} ✗${testRun.evidence.failed} ↷${testRun.evidence.skipped}` : ""}{testRun.durationMs ? ` · ${testRun.durationMs}ms` : ""}</span> : null}
                  {testRun?.evidence?.failed ? <button type="button" disabled={testRun.status === "running"} onClick={() => {
                    const failed = testRun.evidence?.results.find((result) => result.status === "failed");
                    const known = workspaceTests.find((test) => test.name === failed?.name || failed?.name.endsWith(test.name));
                    if (known) void runWorkspaceTest(known);
                    else void runWorkspaceTest();
                  }}>Rerun failed</button> : null}
                </div>
                {workspaceTests.slice(0, 500).map((test) => (
                  <div key={test.id}>
                    <button type="button" onClick={() => void openFile(test.path, { line: test.line, column: 1 })}><span>{test.framework}</span><strong>{test.name}</strong><code>{test.path}:{test.line}</code></button>
                    <button type="button" disabled={testRun?.status === "running"} onClick={() => void runWorkspaceTest(test)}>Run</button>
                  </div>
                ))}
                {testRun?.output ? <pre>{testRun.output}</pre> : null}
              </details>
            ) : null}
            {isolatedTaskWorktrees.length > 0 ? (
              <details className="zorai-workspace-isolated-reviews">
                <summary>Awaiting isolated review ({isolatedTaskWorktrees.length})</summary>
                {isolatedTaskWorktrees.map((worktree) => {
                  const review = worktreeReviews[worktree.path];
                  const lifecycle = context.isolatedWorktreeStates[worktree.path] ?? (review?.commits.length === 0 ? "integrated" : "awaiting_review");
                  return (
                    <div key={worktree.path}>
                      <button type="button" onClick={() => switchThreadWorktree(worktree.path)}><strong>{worktree.branch}</strong><span>{worktree.path}</span></button>
                      <em>{lifecycle.replace("_", " ")} · {review ? `${review.commits.length} commit(s) · ${review.files.length} file(s) · source ${review.source.clean ? "clean" : "dirty"} · target ${review.target.clean ? "clean" : "dirty"}` : "Loading review…"}</em>
                      {review?.commits.map((commit) => <code key={commit.hash}>{commit.hash.slice(0, 8)} · {commit.subject}</code>)}
                      {review?.canIntegrate && lifecycle === "awaiting_review" ? <button type="button" className="zorai-workspace-integrate-button" onClick={() => void integrateIsolatedWorktree(worktree.path)}>Integrate reviewed commits</button> : null}
                      <span className="zorai-workspace-lifecycle-actions">
                        <button type="button" onClick={() => setIsolatedWorktreeState(activeThreadId, worktree.path, "retained")}>Retain</button>
                        <button type="button" onClick={() => setIsolatedWorktreeState(activeThreadId, worktree.path, "rejected")}>Reject</button>
                        <button type="button" onClick={() => setIsolatedWorktreeState(activeThreadId, worktree.path, "awaiting_review")}>Review</button>
                      </span>
                    </div>
                  );
                })}
              </details>
            ) : null}
            {testProblems.length > 0 ? (
              <details className="zorai-workspace-problems">
                <summary>Test failures ({testProblems.length})</summary>
                {testProblems.map((result, index) => (
                  <button type="button" key={`${result.name}:${index}`} onClick={() => result.location && void openFile(result.location.path, { line: result.location.line, column: result.location.column })}>
                    <span className="severity-1">T</span><strong>{result.name}: {result.message ?? "Test failed"}</strong><code>{result.location?.path}:{result.location?.line}</code>
                  </button>
                ))}
              </details>
            ) : null}
            {workspaceDiagnostics.length > 0 ? (
              <details className="zorai-workspace-problems">
                <summary>Problems ({workspaceDiagnostics.length})</summary>
                {workspaceDiagnostics.slice(0, 500).map((diagnostic, index) => (
                  <button type="button" key={`${diagnostic.path}:${diagnostic.startLine}:${diagnostic.startColumn}:${diagnostic.code ?? index}`} onClick={() => void openFile(diagnostic.path, { line: diagnostic.startLine, column: diagnostic.startColumn })}>
                    <span className={`severity-${diagnostic.severity}`}>{diagnostic.severity === 1 ? "E" : diagnostic.severity === 2 ? "W" : "I"}</span>
                    <strong>{diagnostic.message}</strong>
                    <code>{diagnostic.path}:{diagnostic.startLine}{diagnostic.source ? ` · ${diagnostic.source}` : ""}</code>
                  </button>
                ))}
              </details>
            ) : null}
            {gitConflicts.length > 0 ? (
              <details className="zorai-workspace-conflicts">
                <summary>Merge conflicts ({gitConflicts.length})</summary>
                {gitConflicts.map((conflict) => <button type="button" key={conflict.path} onClick={() => void openFile(conflict.path)}>{conflict.path}</button>)}
                <span>Resolve in the editor, then stage the file explicitly.</span>
              </details>
            ) : null}
            {gitHistory.length > 0 ? (
              <details className="zorai-workspace-history">
                <summary>History ({gitHistory.length})</summary>
                {gitHistory.slice(0, 100).map((commit) => <button type="button" key={commit.hash} onClick={() => void inspectCommit(commit.hash)}><code>{commit.shortHash}</code><strong>{commit.subject}</strong><span>{commit.author}</span></button>)}
                {commitDetail ? <article><header>{commitDetail.subject}</header><span>{commitDetail.hash} · {commitDetail.author} · {commitDetail.date}</span>{commitDetail.body ? <pre>{commitDetail.body}</pre> : null}{commitDetail.files.map((file) => <button type="button" key={`${file.status}:${file.path}`} onClick={() => void openFile(file.path)}>{file.status} {file.path}</button>)}</article> : null}
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
                {gitWorktrees.slice(0, 200).map((worktree) => (
                  <div key={worktree.path} className={worktree.path === context.root ? "active" : ""}>
                    <button type="button" className="zorai-workspace-worktree-path" onClick={() => switchThreadWorktree(worktree.path)}><strong>{worktree.branch || "detached"}</strong><span>{worktree.path}</span></button>
                    {worktree.path !== context.root && worktree.path.includes("-worktrees") ? <button type="button" onClick={() => void removeManagedWorktree(worktree.path)}>Remove</button> : null}
                  </div>
                ))}
              </details>
            ) : null}
            {gitOverview?.isRepository ? (
              <details className="zorai-code-source-control">
                <summary>Source Control ({gitOverview.stagedFiles + gitOverview.unstagedFiles})</summary>
                <div className="zorai-workspace-git-overview">
                  <span><strong>{gitOverview.branch || "detached HEAD"}</strong>{gitOverview.upstream ? ` · ${gitOverview.upstream}` : " · no upstream"}</span>
                  <span>↑{gitOverview.ahead} ↓{gitOverview.behind} · {gitOverview.stagedFiles} staged · {gitOverview.unstagedFiles} unstaged</span>
                  <textarea value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder="Commit message" rows={2} maxLength={4096} />
                  <button type="button" disabled={committing || !commitMessage.trim() || gitOverview.stagedFiles === 0} onClick={() => void commitStagedChanges()}>{committing ? "Committing…" : "Commit staged"}</button>
                </div>
              </details>
            ) : null}
            {gitStatus.length > 0 ? (
              <details className="zorai-workspace-source-control">
                <summary>Source Control ({gitStatus.length})</summary>
                {gitStatus.slice(0, 500).map((entry) => (
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
              <details className="zorai-workspace-operation-changes">
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
                    <footer>
                      {operationSnapshots[operationId]?.available ? <span>{Math.round(operationSnapshots[operationId].retained_bytes / 1024)} KiB retained{operationSnapshots[operationId].reason ? ` · ${operationSnapshots[operationId].reason}` : ""}</span> : <span>Snapshot unavailable</span>}
                      <button type="button" disabled={!operationSnapshots[operationId]?.revertible} onClick={() => void revertAgentOperation(operationId)}>Revert operation</button>
                    </footer>
                  </article>
                ))}
              </details>
            ) : null}
            {agentChanges.length > 0 ? (
              <details className="zorai-workspace-agent-changes">
                <summary>Agent changes ({agentChanges.length})</summary>
                {agentChanges.slice(0, 40).map((entry) => (
                  <button type="button" key={`${entry.path}:${entry.updated_at}:${entry.source}`} onClick={() => void openFile(entry.path)}>
                    <strong>{entry.path}</strong>
                    <span>{entry.change_kind ?? entry.kind ?? "changed"} · {entry.source}</span>
                  </button>
                ))}
              </details>
            ) : null}

          </>
        ) : <div className="zorai-workspace-empty">Open a folder to bind it to this thread.</div>}
      </aside>
  );

  const editor = (
      <section className="zorai-workspace-editor-area">
        <CodeTabs
          tabs={(context?.openFiles ?? []).map((filePath) => ({
            path: filePath,
            label: filePath.split(/[\\/]/).slice(-1)[0],
            dirty: Boolean(documents[filePath]?.dirty),
            pinned: Boolean(context?.pinnedFiles.includes(filePath)),
            active: filePath === context?.activeFile,
          }))}
          onActivate={(filePath) => void openFile(filePath)}
          onClose={(filePath) => closeFile(activeThreadId, filePath)}
          onTogglePin={(filePath) => togglePinnedFile(activeThreadId, filePath)}
          onMove={(filePath, direction) => moveOpenFile(activeThreadId, filePath, direction)}
        />
        {activeDocument ? (
          <>
            {/* <nav className="zorai-workspace-breadcrumbs" aria-label="File breadcrumbs">
              {activeDocument.path.split(/[\\/]/).map((part, index, parts) => <span key={`${index}:${part}`}>{part}{index < parts.length - 1 ? " › " : ""}</span>)}
            </nav> */}
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
                <Suspense fallback={<div className="zorai-workspace-diff-grid"><pre>{activeDocument.gitBaseContent ?? activeDocument.original}</pre><pre>{activeDocument.content}</pre></div>}>
                  <WorkspaceDiffEditor original={activeDocument.gitBaseContent ?? activeDocument.original} modified={activeDocument.content} language={activeDocument.language} />
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
                    testResults={(testRun?.evidence?.results ?? []).map((result) => {
                      const known = workspaceTests.find((test) => test.name === result.name || result.name.endsWith(test.name));
                      const location = result.location?.path === activeDocument.path ? result.location : known?.path === activeDocument.path ? { line: known.line } : null;
                      return location ? { line: location.line, status: result.status, message: result.message } : null;
                    }).filter((result): result is { line: number; status: "passed" | "failed" | "skipped"; message: string | null } => result !== null)}
                    lsp={context?.root && lspStatus ? { root: context.root, path: activeDocument.path, language: activeDocument.language, available: lspStatus.available } : undefined}
                    onNavigateLocation={(targetPath, line, column) => void openFile(targetPath, { line, column })}
                    onSelect={recordEditorSelection}
                    onChange={(value) => {
                      if (context?.root) documentControllerRef.current.updateContent(context.root, activeDocument.path, value);
                      setDocuments((current) => ({ ...current, [activeDocument.path]: { ...activeDocument, content: value, dirty: value !== activeDocument.original } }));
                    }}
                  />
                </Suspense>
              )}
            </div>
            <div className="zorai-workspace-statusbar">
              <span>{activeDocument.path}</span>
              <span>{activeDocument.language}{lspStatus ? ` · LSP ${lspStatus.available ? lspStatus.command ?? "ready" : "unavailable"}` : ""}</span>
            </div>
            {mode === "diff" && diff !== null ? <details className="zorai-workspace-raw-diff"><summary>Git patch</summary><pre>{diff || "No working-tree diff for this file."}</pre></details> : null}
          </>
        ) : (
          <>
            <nav className="zorai-workspace-breadcrumbs zorai-workspace-breadcrumbs--empty" aria-label="File breadcrumbs">
              <span>No file selected</span>
            </nav>
            <div className="zorai-tool-empty zorai-code-editor-empty"><strong>Workspace editor</strong><span>Select a text file from Explorer. File contents are loaded on demand and never injected implicitly.</span></div>
            <div className="zorai-workspace-statusbar">
              <span>Ready · Select a file from Explorer</span>
              <span>No language mode</span>
            </div>
          </>
        )}
        {codeOverlay === "quickOpen" ? (
          <CodeQuickOpen
            files={explorerFiles}
            onOpen={(path, line, column) => void openFile(path, line ? { line, column: column ?? 1 } : undefined)}
            onClose={() => setCodeOverlay(null)}
          />
        ) : null}
        {codeOverlay === "commands" ? (
          <CodeCommandPalette onRun={runCodeCommand} onClose={() => setCodeOverlay(null)} />
        ) : null}
        {error ? <div className="zorai-workspace-error">{error}</div> : null}
      </section>
  );

  return (
    <div className={explorerPortalHost ? "zorai-workspace-workbench zorai-workspace-workbench--portaled" : "zorai-workspace-workbench"}>
      {explorerPortalHost ? createPortal(explorer, explorerPortalHost) : explorer}
      {editor}
    </div>
  );
}
