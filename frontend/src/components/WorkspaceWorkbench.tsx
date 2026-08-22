import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getBridge } from "@/lib/bridge";
import { useAgentStore } from "@/lib/agentStore";
import { useWorkspaceStore } from "@/lib/workspaceStore";
import { useWorkspaceContextStore } from "@/lib/workspaceContextStore";

type OpenDocument = ZoraiWorkspaceFile & { original: string; dirty: boolean };

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
  const activeWorkspace = useWorkspaceStore((state) => state.activeWorkspace());
  const context = useWorkspaceContextStore((state) => activeThreadId ? state.byThreadId[activeThreadId] : undefined);
  const bindRoot = useWorkspaceContextStore((state) => state.bindRoot);
  const setActiveFile = useWorkspaceContextStore((state) => state.setActiveFile);
  const setSelection = useWorkspaceContextStore((state) => state.setSelection);
  const toggleAttachedFile = useWorkspaceContextStore((state) => state.toggleAttachedFile);
  const closeFile = useWorkspaceContextStore((state) => state.closeFile);
  const [rootInput, setRootInput] = useState(context?.root ?? activeWorkspace?.cwd ?? "");
  const [rootEntries, setRootEntries] = useState<ZoraiWorkspaceEntry[]>([]);
  const [gitStatus, setGitStatus] = useState<ZoraiWorkspaceGitStatus[]>([]);
  const [documents, setDocuments] = useState<Record<string, OpenDocument>>({});
  const [diff, setDiff] = useState<string | null>(null);
  const [mode, setMode] = useState<"edit" | "diff">("edit");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newPath, setNewPath] = useState("");
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const activeDocument = context?.activeFile ? documents[context.activeFile] : undefined;
  const statusMap = useMemo(() => new Map(gitStatus.map((entry) => [entry.path, statusLabel(entry)])), [gitStatus]);

  const refreshRoot = useCallback(async (root = context?.root) => {
    if (!root || !bridge?.workspaceListDirectory) return;
    const [entries, statuses] = await Promise.all([
      bridge.workspaceListDirectory(root, ""),
      bridge.workspaceGitStatus?.(root) ?? Promise.resolve([]),
    ]);
    setRootEntries(entries);
    setGitStatus(statuses);
  }, [bridge, context?.root]);

  useEffect(() => { void useWorkspaceContextStore.getState().hydrate(); }, []);
  useEffect(() => {
    if (context?.root) {
      setRootInput(context.root);
      void refreshRoot(context.root).catch((reason) => setError(reason?.message ?? String(reason)));
    }
  }, [context?.root, refreshRoot]);

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

  const openFile = async (filePath: string) => {
    if (!activeThreadId || !context?.root || !bridge?.workspaceReadFile) return;
    try {
      setError(null);
      if (!documents[filePath]) {
        const file = await bridge.workspaceReadFile(context.root, filePath);
        setDocuments((current) => ({ ...current, [filePath]: { ...file, original: file.content, dirty: false } }));
      }
      setActiveFile(activeThreadId, filePath);
      setMode("edit");
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

  const updateSelection = () => {
    if (!activeThreadId || !editorRef.current || !activeDocument) return;
    const textarea = editorRef.current;
    const beforeStart = textarea.value.slice(0, textarea.selectionStart);
    const beforeEnd = textarea.value.slice(0, textarea.selectionEnd);
    const startLine = beforeStart.split("\n").length;
    const endLine = beforeEnd.split("\n").length;
    const startColumn = beforeStart.length - beforeStart.lastIndexOf("\n");
    const endColumn = beforeEnd.length - beforeEnd.lastIndexOf("\n");
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
            <div className="zorai-workspace-create-row">
              <input value={newPath} onChange={(event) => setNewPath(event.target.value)} placeholder="relative/path" />
              <button type="button" title="New file" onClick={() => void createPath("file")}>+F</button>
              <button type="button" title="New directory" onClick={() => void createPath("directory")}>+D</button>
            </div>
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
              <span>{activeDocument.path}</span>
              <div>
                <button type="button" onClick={() => toggleAttachedFile(activeThreadId, activeDocument.path)}>{context?.attachedFiles.includes(activeDocument.path) ? "Detach context" : "Attach context"}</button>
                <button type="button" onClick={() => void showDiff()}>Diff</button>
                <button type="button" onClick={() => void reloadActiveFile()}>Reload</button>
                <button type="button" onClick={() => void renameActiveFile()}>Rename</button>
                <button type="button" onClick={() => void deleteActiveFile()}>Delete</button>
                <button type="button" disabled={!activeDocument.dirty || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button>
              </div>
            </div>
            <div className="zorai-workspace-editor">
              {mode === "diff" ? (
                <div className="zorai-workspace-diff-grid">
                  <pre aria-label="Saved file">{activeDocument.original}</pre>
                  <pre aria-label="Edited file">{activeDocument.content}</pre>
                </div>
              ) : (
                <textarea
                  ref={editorRef}
                  className="zorai-workspace-code-editor"
                  value={activeDocument.content}
                  spellCheck={false}
                  aria-label={`Edit ${activeDocument.path}`}
                  onSelect={updateSelection}
                  onKeyDown={(event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
                      event.preventDefault();
                      void save();
                    }
                    if (event.key === "Tab") {
                      event.preventDefault();
                      const target = event.currentTarget;
                      const start = target.selectionStart;
                      const end = target.selectionEnd;
                      const next = `${target.value.slice(0, start)}  ${target.value.slice(end)}`;
                      setDocuments((current) => ({ ...current, [activeDocument.path]: { ...activeDocument, content: next, dirty: next !== activeDocument.original } }));
                      requestAnimationFrame(() => { target.selectionStart = target.selectionEnd = start + 2; });
                    }
                  }}
                  onChange={(event) => {
                    const value = event.target.value;
                    setDocuments((current) => ({ ...current, [activeDocument.path]: { ...activeDocument, content: value, dirty: value !== activeDocument.original } }));
                  }}
                />
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
