import { create } from "zustand";
import { createStore } from "zustand/vanilla";
import {
  createJSONStorage,
  persist,
  type PersistOptions,
  type StateStorage,
} from "zustand/middleware";
import {
  CODE_AGENT_DEFAULT_WIDTH,
  CODE_EXPLORER_DEFAULT_WIDTH,
  clampCodePanelWidth,
  codePanelDefaultWidth,
  type CodePanelName,
} from "./codeLayoutModel";

export const CODE_LAYOUT_STORE_NAME = "zorai-code-layout";
export const CODE_LAYOUT_STORE_VERSION = 1;

export type CodeLayoutState = {
  /** Preferred Explorer panel width; the shell clamps it to the viewport via the layout model. */
  explorerPreferredWidth: number;
  /** Preferred Agent panel width; the shell clamps it to the viewport via the layout model. */
  agentPreferredWidth: number;
};

export type CodeLayoutActions = {
  setExplorerPreferredWidth: (width: number) => void;
  setAgentPreferredWidth: (width: number) => void;
  /** Restore both panels to their default widths. */
  resetCodeLayout: () => void;
};

export type CodeLayoutStore = CodeLayoutState & CodeLayoutActions;

function normalizePanelWidth(value: unknown, panel: CodePanelName): number {
  if (typeof value !== "number") return codePanelDefaultWidth(panel);
  return clampCodePanelWidth(panel, value);
}

/** Coerce any persisted payload into the current store shape. Malformed and out-of-range values fall back to valid widths. */
export function normalizeCodeLayoutWidths(input: unknown): CodeLayoutState {
  const raw = (input ?? {}) as Partial<CodeLayoutState>;
  return {
    explorerPreferredWidth: normalizePanelWidth(raw.explorerPreferredWidth, "explorer"),
    agentPreferredWidth: normalizePanelWidth(raw.agentPreferredWidth, "agent"),
  };
}

/**
 * Explicit persist migration. Zustand invokes this only when the stored
 * version differs from `CODE_LAYOUT_STORE_VERSION`; older and unknown payloads
 * are normalized into the current shape (unknown fields are dropped, malformed
 * widths become defaults). A future version bump folds its own transform in
 * here.
 */
export function migrateCodeLayoutWidths(
  persistedState: unknown,
  _version: number,
): CodeLayoutState {
  return normalizeCodeLayoutWidths(persistedState);
}

function createCodeLayoutActions(
  set: (partial: Partial<CodeLayoutState>) => void,
): CodeLayoutActions {
  return {
    setExplorerPreferredWidth(width) {
      set({ explorerPreferredWidth: clampCodePanelWidth("explorer", width) });
    },

    setAgentPreferredWidth(width) {
      set({ agentPreferredWidth: clampCodePanelWidth("agent", width) });
    },

    resetCodeLayout() {
      set({
        explorerPreferredWidth: CODE_EXPLORER_DEFAULT_WIDTH,
        agentPreferredWidth: CODE_AGENT_DEFAULT_WIDTH,
      });
    },
  };
}

function createInitialCodeLayout(): CodeLayoutState {
  return {
    explorerPreferredWidth: CODE_EXPLORER_DEFAULT_WIDTH,
    agentPreferredWidth: CODE_AGENT_DEFAULT_WIDTH,
  };
}

/**
 * Single persist config builder shared by the vanilla factory and the exported
 * global hook so name/version/partialize/merge/migrate cannot drift apart.
 */
function createCodeLayoutPersistConfig(
  getStorage: () => StateStorage,
): PersistOptions<CodeLayoutStore, CodeLayoutState> {
  return {
    name: CODE_LAYOUT_STORE_NAME,
    version: CODE_LAYOUT_STORE_VERSION,
    storage: createJSONStorage<CodeLayoutState>(getStorage),
    partialize: (state: CodeLayoutStore): CodeLayoutState => ({
      explorerPreferredWidth: state.explorerPreferredWidth,
      agentPreferredWidth: state.agentPreferredWidth,
    }),
    merge: (persisted: unknown, current: CodeLayoutStore): CodeLayoutStore => ({
      ...current,
      ...normalizeCodeLayoutWidths(persisted),
    }),
    migrate: migrateCodeLayoutWidths,
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
export function createCodeLayoutStore(storage?: StateStorage) {
  const resolvedStorage = storage ?? createRawMemoryStorage();
  return createStore<CodeLayoutStore>()(
    persist(
      (set) => ({
        ...createInitialCodeLayout(),
        ...createCodeLayoutActions(set),
      }),
      createCodeLayoutPersistConfig(() => resolvedStorage),
    ),
  );
}

export const useCodeLayoutStore = create<CodeLayoutStore>()(
  persist(
    (set) => ({
      ...createInitialCodeLayout(),
      ...createCodeLayoutActions(set),
    }),
    createCodeLayoutPersistConfig(() =>
      typeof localStorage !== "undefined" ? localStorage : createRawMemoryStorage(),
    ),
  ),
);