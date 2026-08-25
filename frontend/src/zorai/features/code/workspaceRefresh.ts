export type WorkspaceRootState = {
  entries: ZoraiWorkspaceEntry[];
  statuses: ZoraiWorkspaceGitStatus[];
  overview: ZoraiWorkspaceGitOverview | null;
  worktrees: ZoraiGitWorktree[];
  history: Array<{ hash: string; shortHash: string; author: string; date: string; subject: string }>;
  conflicts: Array<{ path: string }>;
};

export type WorkspaceRefreshBridge = Pick<ZoraiBridge,
  "workspaceGitStatus" |
  "workspaceGitOverview" |
  "workspaceGitListWorktrees" |
  "workspaceGitHistory" |
  "workspaceGitConflicts"
> & Required<Pick<ZoraiBridge, "workspaceListDirectory">>;

export async function loadWorkspaceRootState(bridge: WorkspaceRefreshBridge, root: string): Promise<WorkspaceRootState> {
  const [entries, statuses, overview, worktrees, history, conflicts] = await Promise.all([
    bridge.workspaceListDirectory(root, ""),
    bridge.workspaceGitStatus?.(root) ?? Promise.resolve([]),
    bridge.workspaceGitOverview?.(root) ?? Promise.resolve(null),
    bridge.workspaceGitListWorktrees?.(root) ?? Promise.resolve([]),
    bridge.workspaceGitHistory?.(root, { limit: 50 }) ?? Promise.resolve([]),
    bridge.workspaceGitConflicts?.(root) ?? Promise.resolve([]),
  ]);
  return { entries, statuses, overview, worktrees, history, conflicts };
}

export async function runWorkspacePathMutation<T>(mutate: () => Promise<T>, refreshRoot: () => Promise<void>): Promise<T> {
  const result = await mutate();
  await refreshRoot();
  return result;
}
