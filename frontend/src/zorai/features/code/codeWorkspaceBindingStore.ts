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

export function normalizeCodeWorkspaceRoot(root: unknown): string | null {
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
      const normalizedRoot = normalizeCodeWorkspaceRoot(root);
      if (normalizedRoot && typeof threadId === "string" && threadId.trim()) {
        threadByRoot[normalizedRoot] = threadId;
      }
    }
  }
  return {
    lastRoot: normalizeCodeWorkspaceRoot(raw.lastRoot),
    threadByRoot,
  };
}

function createCodeWorkspaceBindingActions(
  set: (partial: Partial<CodeWorkspaceBindings>) => void,
  get: () => CodeWorkspaceBindingStore,
): CodeWorkspaceBindingActions {
  return {
    bindThreadToRoot(root, threadId) {
      const normalizedRoot = normalizeCodeWorkspaceRoot(root);
      const normalizedThreadId = typeof threadId === "string" ? threadId.trim() : "";
      if (!normalizedRoot || !normalizedThreadId) return;
      set({
        threadByRoot: {
          ...get().threadByRoot,
          [normalizedRoot]: normalizedThreadId,
        },
      });
    },

    removeRootBinding(root) {
      const normalizedRoot = normalizeCodeWorkspaceRoot(root);
      if (!normalizedRoot) return;
      const { threadByRoot } = get();
      if (!(normalizedRoot in threadByRoot)) return;
      const next = { ...threadByRoot };
      delete next[normalizedRoot];
      set({ threadByRoot: next });
    },

    closeRoot(root) {
      const normalizedRoot = normalizeCodeWorkspaceRoot(root);
      if (!normalizedRoot) return;
      const { threadByRoot, lastRoot } = get();
      const next = { ...threadByRoot };
      delete next[normalizedRoot];
      set({
        threadByRoot: next,
        lastRoot: lastRoot === normalizedRoot ? null : lastRoot,
      });
    },

    setLastRoot(root) {
      set({ lastRoot: normalizeCodeWorkspaceRoot(root) });
    },

    threadForRoot(root) {
      const normalizedRoot = normalizeCodeWorkspaceRoot(root);
      if (!normalizedRoot) return null;
      return get().threadByRoot[normalizedRoot] ?? null;
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

function createCodeWorkspaceBindingPersistConfig(
  storage: StateStorage,
): PersistOptions<CodeWorkspaceBindingStore, CodeWorkspaceBindings> {
  return {
    name: CODE_WORKSPACE_BINDING_STORE_NAME,
    version: CODE_WORKSPACE_BINDING_STORE_VERSION,
    storage: createJSONStorage<CodeWorkspaceBindings>(() => storage),
    partialize: (state: CodeWorkspaceBindingStore): CodeWorkspaceBindings => ({
      lastRoot: state.lastRoot,
      threadByRoot: state.threadByRoot,
    }),
    merge: (persisted: unknown, current: CodeWorkspaceBindingStore): CodeWorkspaceBindingStore => ({
      ...current,
      ...normalizeCodeWorkspaceBindings(persisted),
    }),
  };
}

/** Vanilla store factory used by tests and explicit hydration flows. */
export function createCodeWorkspaceBindingStore(storage?: StateStorage) {
  const finalStorage =
    storage ??
    (typeof localStorage !== "undefined" ? localStorage : createRawMemoryStorage());
  return createStore<CodeWorkspaceBindingStore>()(
    persist(
      (set, get) => ({
        ...createInitialCodeWorkspaceBindings(),
        ...createCodeWorkspaceBindingActions(set, get),
      }),
      createCodeWorkspaceBindingPersistConfig(finalStorage),
    ),
  );
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

export const useCodeWorkspaceBindingStore = create<CodeWorkspaceBindingStore>()(
  persist(
    (set, get) => ({
      ...createInitialCodeWorkspaceBindings(),
      ...createCodeWorkspaceBindingActions(set, get),
    }),
    {
      name: CODE_WORKSPACE_BINDING_STORE_NAME,
      version: CODE_WORKSPACE_BINDING_STORE_VERSION,
      storage: createJSONStorage<CodeWorkspaceBindings>(
        () => (typeof localStorage !== "undefined" ? localStorage : createRawMemoryStorage()),
      ),
      partialize: (state) => ({
        lastRoot: state.lastRoot,
        threadByRoot: state.threadByRoot,
      }),
      merge: (persisted, current) => ({
        ...current,
        ...normalizeCodeWorkspaceBindings(persisted),
      }),
    },
  ),
);
