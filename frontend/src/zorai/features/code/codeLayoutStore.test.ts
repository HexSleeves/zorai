import { describe, expect, it } from "vitest";
import type { StateStorage } from "zustand/middleware";
import { CODE_LAYOUT_STORE_NAME, CODE_LAYOUT_STORE_VERSION, createCodeLayoutStore } from "./codeLayoutStore";
import {
  CODE_AGENT_DEFAULT_WIDTH,
  CODE_AGENT_MAX_WIDTH,
  CODE_AGENT_MIN_WIDTH,
  CODE_EXPLORER_DEFAULT_WIDTH,
  CODE_EXPLORER_MAX_WIDTH,
  CODE_EXPLORER_MIN_WIDTH,
} from "./codeLayoutModel";

function createMemoryStorage(): StateStorage {
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

function readPersistedJson(storage: StateStorage) {
  const raw = storage.getItem(CODE_LAYOUT_STORE_NAME);
  return raw ? JSON.parse(raw) : null;
}

describe("codeLayoutStore", () => {
  it("starts with the default preferred widths", () => {
    const store = createCodeLayoutStore(createMemoryStorage());

    expect(store.getState().explorerPreferredWidth).toBe(CODE_EXPLORER_DEFAULT_WIDTH);
    expect(store.getState().agentPreferredWidth).toBe(CODE_AGENT_DEFAULT_WIDTH);
  });

  it("persists updated preferred widths and restores them into a fresh store", async () => {
    const storage = createMemoryStorage();
    const first = createCodeLayoutStore(storage);

    first.getState().setExplorerPreferredWidth(410);
    first.getState().setAgentPreferredWidth(500);

    const persisted = readPersistedJson(storage);
    expect(persisted).toEqual({
      state: {
        explorerPreferredWidth: 410,
        agentPreferredWidth: 500,
      },
      version: 1,
    });
    expect(CODE_LAYOUT_STORE_VERSION).toBe(1);

    const rehydrated = createCodeLayoutStore(storage);
    await rehydrated.persist.rehydrate();
    expect(rehydrated.getState()).toMatchObject({
      explorerPreferredWidth: 410,
      agentPreferredWidth: 500,
    });
  });

  it("clamps setter inputs into the panel min/max range", () => {
    const store = createCodeLayoutStore(createMemoryStorage());

    store.getState().setExplorerPreferredWidth(9999);
    store.getState().setAgentPreferredWidth(-50);

    expect(store.getState().explorerPreferredWidth).toBe(CODE_EXPLORER_MAX_WIDTH);
    expect(store.getState().agentPreferredWidth).toBe(CODE_AGENT_MIN_WIDTH);

    store.getState().setExplorerPreferredWidth(10);
    store.getState().setAgentPreferredWidth(9999);

    expect(store.getState().explorerPreferredWidth).toBe(CODE_EXPLORER_MIN_WIDTH);
    expect(store.getState().agentPreferredWidth).toBe(CODE_AGENT_MAX_WIDTH);
  });

  it("resets both widths to their defaults", () => {
    const store = createCodeLayoutStore(createMemoryStorage());

    store.getState().setExplorerPreferredWidth(410);
    store.getState().setAgentPreferredWidth(500);
    store.getState().resetCodeLayout();

    expect(store.getState().explorerPreferredWidth).toBe(CODE_EXPLORER_DEFAULT_WIDTH);
    expect(store.getState().agentPreferredWidth).toBe(CODE_AGENT_DEFAULT_WIDTH);
  });

  it("normalizes malformed persisted widths back to defaults", async () => {
    const storage = createMemoryStorage();
    storage.setItem(
      CODE_LAYOUT_STORE_NAME,
      JSON.stringify({
        state: {
          explorerPreferredWidth: "huge",
          agentPreferredWidth: null,
        },
        version: 1,
      }),
    );

    const store = createCodeLayoutStore(storage);
    await store.persist.rehydrate();

    expect(store.getState().explorerPreferredWidth).toBe(CODE_EXPLORER_DEFAULT_WIDTH);
    expect(store.getState().agentPreferredWidth).toBe(CODE_AGENT_DEFAULT_WIDTH);
  });

  it("constrains persisted out-of-range widths into the valid range", async () => {
    const storage = createMemoryStorage();
    storage.setItem(
      CODE_LAYOUT_STORE_NAME,
      JSON.stringify({
        state: {
          explorerPreferredWidth: 700,
          agentPreferredWidth: 12,
        },
        version: 1,
      }),
    );

    const store = createCodeLayoutStore(storage);
    await store.persist.rehydrate();

    expect(store.getState().explorerPreferredWidth).toBe(CODE_EXPLORER_MAX_WIDTH);
    expect(store.getState().agentPreferredWidth).toBe(CODE_AGENT_MIN_WIDTH);
  });

  it("persists only the preferred widths and no actions", async () => {
    const storage = createMemoryStorage();
    const store = createCodeLayoutStore(storage);
    store.getState().setExplorerPreferredWidth(350);

    const persisted = readPersistedJson(storage);
    expect(persisted.state).toEqual({
      explorerPreferredWidth: 350,
      agentPreferredWidth: 320,
    });
  });

  it("isolates the factory storage when no explicit storage is given", async () => {
    const first = createCodeLayoutStore();
    first.getState().setExplorerPreferredWidth(410);

    const second = createCodeLayoutStore();
    await second.persist.rehydrate();

    expect(second.getState().explorerPreferredWidth).toBe(CODE_EXPLORER_DEFAULT_WIDTH);
  });

  it("migrates older persisted payloads through normalization and rewrites the version", async () => {
    const storage = createMemoryStorage();
    storage.setItem(
      CODE_LAYOUT_STORE_NAME,
      JSON.stringify({
        state: {
          explorerPreferredWidth: "stale",
          agentPreferredWidth: 460,
          extraFutureField: "ignored",
        },
        version: 0,
      }),
    );

    const store = createCodeLayoutStore(storage);
    await store.persist.rehydrate();

    expect(store.getState().explorerPreferredWidth).toBe(CODE_EXPLORER_DEFAULT_WIDTH);
    expect(store.getState().agentPreferredWidth).toBe(460);

    const persisted = readPersistedJson(storage);
    expect(persisted.version).toBe(CODE_LAYOUT_STORE_VERSION);
  });
});