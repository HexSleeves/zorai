import { CodeFileIcon } from "./CodeFileIcon";

export type WorkspaceGitAction = "stage" | "unstage" | "discard";

export function WorkspaceGitChangeRow({ entry, staged, onOpen, onReview, onAction }: {
  entry: ZoraiWorkspaceGitStatus;
  staged: boolean;
  onOpen: (path: string) => Promise<void>;
  onReview: (path: string, staged: boolean) => Promise<void>;
  onAction: (action: WorkspaceGitAction, path: string) => Promise<void>;
}) {
  const status = staged ? entry.indexStatus : entry.worktreeStatus || entry.indexStatus;
  const parent = entry.path.split(/[\\/]/).slice(0, -1).join("/");
  return <div className="zorai-workspace-change-row">
    <button type="button" className="zorai-workspace-change-path" onClick={() => void onOpen(entry.path)}><CodeFileIcon path={entry.path} /><span><strong>{entry.path.split(/[\\/]/).pop()}</strong>{parent ? <small>{parent}</small> : null}</span><em>{status.trim() || "?"}</em></button>
    <span className="zorai-workspace-change-actions">
      <button type="button" title="Review hunks" aria-label={`Review hunks for ${entry.path}`} onClick={() => void onReview(entry.path, staged)}>≡</button>
      <button type="button" title={staged ? "Unstage" : "Stage"} aria-label={`${staged ? "Unstage" : "Stage"} ${entry.path}`} onClick={() => void onAction(staged ? "unstage" : "stage", entry.path)}>{staged ? "−" : "+"}</button>
      {!staged && entry.worktreeStatus.trim() && entry.worktreeStatus !== "?" ? <button type="button" title="Discard changes" aria-label={`Discard changes in ${entry.path}`} onClick={() => void onAction("discard", entry.path)}>↶</button> : null}
    </span>
  </div>;
}

export type WorkspaceSourceControlPresentation = "auto" | "normal" | "narrow";

export function WorkspaceSourceControlChanges({ status, onOpen, onReview, onAction, onBulkAction, presentation = "auto" }: {
  status: ZoraiWorkspaceGitStatus[];
  onOpen: (path: string) => Promise<void>;
  onReview: (path: string, staged: boolean) => Promise<void>;
  onAction: (action: WorkspaceGitAction, path: string) => Promise<void>;
  onBulkAction: (action: "stage" | "unstage", entries: ZoraiWorkspaceGitStatus[]) => Promise<void>;
  presentation?: WorkspaceSourceControlPresentation;
}) {
  const staged = status.filter((entry) => entry.indexStatus.trim() && entry.indexStatus !== "?");
  const unstaged = status.filter((entry) => entry.worktreeStatus.trim() || entry.indexStatus === "?");
  if (staged.length === 0 && unstaged.length === 0) return null;
  return <div className={`zorai-workspace-source-control is-${presentation}`} data-presentation={presentation}>
    {staged.length > 0 ? <section><header><span>Staged Changes</span><button type="button" aria-label="Unstage all changes" onClick={() => void onBulkAction("unstage", staged)}>− All</button></header>{staged.slice(0, 500).map((entry) => <WorkspaceGitChangeRow key={`staged:${entry.path}`} entry={entry} staged onOpen={onOpen} onReview={onReview} onAction={onAction} />)}</section> : null}
    {unstaged.length > 0 ? <section><header><span>Changes</span><button type="button" aria-label="Stage all changes" onClick={() => void onBulkAction("stage", unstaged)}>＋ All</button></header>{unstaged.slice(0, 500).map((entry) => <WorkspaceGitChangeRow key={`change:${entry.path}`} entry={entry} staged={false} onOpen={onOpen} onReview={onReview} onAction={onAction} />)}</section> : null}
  </div>;
}
