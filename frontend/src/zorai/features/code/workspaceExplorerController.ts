export type WorkspaceExplorerSnapshot = {
  expandedPaths: ReadonlySet<string>;
  childrenByPath: ReadonlyMap<string, ZoraiWorkspaceEntry[]>;
  loadingPaths: ReadonlySet<string>;
  errorByPath: ReadonlyMap<string, string>;
};

export type WorkspaceExplorerController = {
  getSnapshot: () => WorkspaceExplorerSnapshot;
  subscribe: (listener: () => void) => () => void;
  toggle: (path: string) => Promise<void>;
  refreshExpanded: () => Promise<void>;
};

export function createWorkspaceExplorerLoader(
  bridge: Pick<ZoraiBridge, "workspaceListDirectory"> | null | undefined,
  root: string,
): (path: string) => Promise<ZoraiWorkspaceEntry[]> {
  return async (path) => {
    if (!bridge?.workspaceListDirectory) return [];
    return bridge.workspaceListDirectory(root, path);
  };
}

export function createWorkspaceExplorerController(
  loadDirectory: (path: string) => Promise<ZoraiWorkspaceEntry[]>,
): WorkspaceExplorerController {
  let snapshot: WorkspaceExplorerSnapshot = {
    expandedPaths: new Set(),
    childrenByPath: new Map(),
    loadingPaths: new Set(),
    errorByPath: new Map(),
  };
  const listeners = new Set<() => void>();
  const publish = (next: WorkspaceExplorerSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  const load = async (path: string) => {
    publish({ ...snapshot, loadingPaths: new Set([...snapshot.loadingPaths, path]), errorByPath: new Map([...snapshot.errorByPath].filter(([key]) => key !== path)) });
    try {
      const children = await loadDirectory(path);
      publish({ ...snapshot, childrenByPath: new Map(snapshot.childrenByPath).set(path, children) });
    } catch (reason: any) {
      publish({ ...snapshot, errorByPath: new Map(snapshot.errorByPath).set(path, reason?.message ?? String(reason)) });
    } finally {
      const loadingPaths = new Set(snapshot.loadingPaths);
      loadingPaths.delete(path);
      publish({ ...snapshot, loadingPaths });
    }
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async toggle(path) {
      if (snapshot.expandedPaths.has(path)) {
        const expandedPaths = new Set(snapshot.expandedPaths);
        expandedPaths.delete(path);
        publish({ ...snapshot, expandedPaths });
        return;
      }
      const previousChildren = snapshot.childrenByPath.get(path);
      await load(path);
      if (!snapshot.childrenByPath.has(path) && previousChildren === undefined && snapshot.errorByPath.has(path)) return;
      publish({ ...snapshot, expandedPaths: new Set([...snapshot.expandedPaths, path]) });
    },
    async refreshExpanded() {
      await Promise.all([...snapshot.expandedPaths].map((path) => load(path)));
    },
  };
}
