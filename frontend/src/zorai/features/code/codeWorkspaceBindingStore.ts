import { create } from "zustand";
import { createStore } from "zustand/vanilla";
import {
  createJSONStorage,
  persist,
  type PersistOptions,
  type StateStorage,
} from "zustand/middleware";

export const CODE_WORKSPACE_BINDING_STORE_NAME = "zorai-code-workspace-bindings";
export const CODE_WORKSPACE_BINDING_STORE_VERSION = 1;

export type CodeWorkspaceBindings = {
  /** Canonical validated workspace root that was most recently opened. */
  lastRoot: string | null;
  /** Maps each canonical workspace root to its daemon thread id. */
  threadByRoot: Record<string, string>;
};

export type CodeWorkspaceBindingActions = {
  /** Associate a workspace root with a daemon thread id (replaces any prior mapping). */
  bindThreadToRoot: (root: string, threadId: string) => void;
  /** Remove the thread mapping for a root without touching the thread itself. */
  removeRootBinding: (root: string) => void;
  /** Close a root: drop its thread mapping and clear lastRoot when it matches. */
  closeRoot: (root: string) => void;
  setLastRoot: (root: string | null) => void;
  threadForRoot: (root: string) => string | null;
  /** Replace persisted bindings from an explicit hydrate source. */
  hydrate: (bindings: Partial<CodeWorkspaceBindings>) => void;
};

export type CodeWorkspaceBindingStore = CodeWorkspaceBindings & CodeWorkspaceBindingActions;

/**
 * Trim whitespace from a persisted root key. Renderer-side normalization is
 * intentionally trim + structure only: filesystem canonicalization
 * (`realpath`) is owned by the main-process `workspaceService.openWorkspace`,
 * which validates the directory and returns the canonical root. The renderer
 * must not pretend to filesystem-canonicalize.
 */
export function trimCodeWorkspaceRoot(root: unknown): string | null {
  if (typeof root !== "string") return null;
  const trimmed = root.trim();
  return trimmed || null;
}

export function normalizeCodeWorkspaceBindings(input: unknown): CodeWorkspaceBindings {
  const raw = (input ?? {}) as Partial<CodeWorkspaceBindings>;
  const threadByRoot: Record<string, string> = {};
  const rawThreadByRoot = raw.threadByRoot;
  if (rawThreadByRoot && typeof rawThreadByRoot === "object") {
    for (const [root, threadId] of Object.entries(rawThreadByRoot)) {
      const trimmedRoot = trimCodeWorkspaceRoot(root);
      if (trimmedRoot && typeof threadId === "string" && threadId.trim()) {
        threadByRoot[trimmedRoot] = threadId;
      }
    }
  }
  return {
    lastRoot: trimCodeWorkspaceRoot(raw.lastRoot),
    threadByRoot,
  };
}

/**
 * Explicit persist migration. Zustand invokes this only when the stored
 * version differs from `CODE_WORKSPACE_BINDING_STORE_VERSION`; older and
 * unknown payloads are normalized into the current shape (unknown fields are
 * dropped, roots are trimmed, malformed thread ids are ignored). A future
 * version bump folds its own transform in here.
 */
export function migrateCodeWorkspaceBindings(
  persistedState: unknown,
  _version: number,
): CodeWorkspaceBindings {
  return normalizeCodeWorkspaceBindings(persistedState);
}

function createCodeWorkspaceBindingActions(
  set: (partial: Partial<CodeWorkspaceBindings>) => void,
  get: () => CodeWorkspaceBindingStore,
): CodeWorkspaceBindingActions {
  return {
    bindThreadToRoot(root, threadId) {
      const trimmedRoot = trimCodeWorkspaceRoot(root);
      const trimmedThreadId = typeof threadId === "string" ? threadId.trim() : "";
      if (!trimmedRoot || !trimmedThreadId) return;
      set({
        threadByRoot: {
          ...get().threadByRoot,
          [trimmedRoot]: trimmedThreadId,
        },
      });
    },

    removeRootBinding(root) {
      const trimmedRoot = trimCodeWorkspaceRoot(root);
      if (!trimmedRoot) return;
      const { threadByRoot } = get();
      if (!(trimmedRoot in threadByRoot)) return;
      const next = { ...threadByRoot };
      delete next[trimmedRoot];
      set({ threadByRoot: next });
    },

    closeRoot(root) {
      const trimmedRoot = trimCodeWorkspaceRoot(root);
      if (!trimmedRoot) return;
      const { threadByRoot, lastRoot } = get();
      const next = { ...threadByRoot };
      delete next[trimmedRoot];
      set({
        threadByRoot: next,
        lastRoot: lastRoot === trimmedRoot ? null : lastRoot,
      });
    },

    setLastRoot(root) {
      set({ lastRoot: trimCodeWorkspaceRoot(root) });
    },

    threadForRoot(root) {
      const trimmedRoot = trimCodeWorkspaceRoot(root);
      if (!trimmedRoot) return null;
      return get().threadByRoot[trimmedRoot] ?? null;
    },

    hydrate(bindings) {
      const normalized = normalizeCodeWorkspaceBindings(bindings);
      set({
        lastRoot: normalized.lastRoot,
        threadByRoot: normalized.threadByRoot,
      });
    },
  };
}

function createInitialCodeWorkspaceBindings(): CodeWorkspaceBindings {
  return { lastRoot: null, threadByRoot: {} };
}

/**
 * Single persist config builder shared by the vanilla factory and the exported
 * global hook so name/version/partialize/merge/migrate cannot drift apart.
 */
function createCodeWorkspaceBindingPersistConfig(
  getStorage: () => StateStorage,
): PersistOptions<CodeWorkspaceBindingStore, CodeWorkspaceBindings> {
  return {
    name: CODE_WORKSPACE_BINDING_STORE_NAME,
    version: CODE_WORKSPACE_BINDING_STORE_VERSION,
    storage: createJSONStorage<CodeWorkspaceBindings>(getStorage),
    partialize: (state: CodeWorkspaceBindingStore): CodeWorkspaceBindings => ({
      lastRoot: state.lastRoot,
      threadByRoot: state.threadByRoot,
    }),
    merge: (persisted: unknown, current: CodeWorkspaceBindingStore): CodeWorkspaceBindingStore => ({
      ...current,
      ...normalizeCodeWorkspaceBindings(persisted),
    }),
    migrate: migrateCodeWorkspaceBindings,
  };
}

function createRawMemoryStorage(): StateStorage {
  const values = new Map<string, string>();
  return {
    getItem: (name) => values.get(name) ?? null,
    setItem: (name, value) => {
      values.set(name, value);
    },
    removeItem: (name) => {
      values.delete(name);
    },
  };
}

/**
 * Vanilla store factory used by tests and explicit hydration flows. Without an
 * explicit storage it always uses a fresh isolated in-memory storage so the
 * factory never writes renderer-localStorage; only the exported global hook
 * below persists through localStorage.
 */
export function createCodeWorkspaceBindingStore(storage?: StateStorage) {
  const resolvedStorage = storage ?? createRawMemoryStorage();
  return createStore<CodeWorkspaceBindingStore>()(
    persist(
      (set, get) => ({
        ...createInitialCodeWorkspaceBindings(),
        ...createCodeWorkspaceBindingActions(set, get),
      }),
      createCodeWorkspaceBindingPersistConfig(() => resolvedStorage),
    ),
  );
}

export const useCodeWorkspaceBindingStore = create<CodeWorkspaceBindingStore>()(
  persist(
    (set, get) => ({
      ...createInitialCodeWorkspaceBindings(),
      ...createCodeWorkspaceBindingActions(set, get),
    }),
    createCodeWorkspaceBindingPersistConfig(() =>
      typeof localStorage !== "undefined" ? localStorage : createRawMemoryStorage(),
    ),
  ),
);
