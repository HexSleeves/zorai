import { describe, expect, it } from "vitest";
import type { StateStorage } from "zustand/middleware";
import {
  CODE_WORKSPACE_BINDING_STORE_NAME,
  CODE_WORKSPACE_BINDING_STORE_VERSION,
  createCodeWorkspaceBindingStore,
} from "./codeWorkspaceBindingStore";

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
  const raw = storage.getItem(CODE_WORKSPACE_BINDING_STORE_NAME);
  return raw ? JSON.parse(raw) : null;
}

describe("codeWorkspaceBindingStore", () => {
  it("binds a root to a daemon thread and replaces the canonical mapping on rebind", () => {
    const store = createCodeWorkspaceBindingStore(createMemoryStorage());

    store.getState().bindThreadToRoot("/work/a", "thread-1");
    store.getState().bindThreadToRoot("/work/a", "thread-2");
    store.getState().bindThreadToRoot("/work/b", "thread-3");

    expect(store.getState().threadByRoot).toEqual({
      "/work/a": "thread-2",
      "/work/b": "thread-3",
    });
    expect(store.getState().threadForRoot("/work/a")).toBe("thread-2");
    expect(store.getState().threadForRoot("/work/missing")).toBeNull();
  });

  it("persists only data with version 1 and restores it into a fresh store", async () => {
    const storage = createMemoryStorage();
    const first = createCodeWorkspaceBindingStore(storage);

    first.getState().bindThreadToRoot("/work/a", "thread-1");
    first.getState().setLastRoot("/work/a");

    const persisted = readPersistedJson(storage);
    expect(persisted).toEqual({
      state: {
        lastRoot: "/work/a",
        threadByRoot: { "/work/a": "thread-1" },
      },
      version: 1,
    });
    expect(CODE_WORKSPACE_BINDING_STORE_VERSION).toBe(1);

    const second = createCodeWorkspaceBindingStore(storage);
    await second.persist.rehydrate();
    expect(second.getState().lastRoot).toBe("/work/a");
    expect(second.getState().threadForRoot("/work/a")).toBe("thread-1");
  });

  it("removes stale mappings without deleting the referenced thread", () => {
    const store = createCodeWorkspaceBindingStore(createMemoryStorage());

    store.getState().bindThreadToRoot("/work/a", "thread-1");
    store.getState().bindThreadToRoot("/work/b", "thread-2");
    store.getState().removeRootBinding("/work/a");

    expect(store.getState().threadByRoot).toEqual({ "/work/b": "thread-2" });
    expect(store.getState().threadForRoot("/work/a")).toBeNull();
    expect(store.getState().lastRoot).toBeNull();
  });

  it("keeps lastRoot untouched when removing a non-stale binding", () => {
    const store = createCodeWorkspaceBindingStore(createMemoryStorage());

    store.getState().setLastRoot("/work/a");
    store.getState().bindThreadToRoot("/work/b", "thread-2");
    store.getState().removeRootBinding("/work/b");

    expect(store.getState().threadByRoot).toEqual({});
    expect(store.getState().lastRoot).toBe("/work/a");
  });

  it("closes a root by dropping its mapping and clearing a matching lastRoot", () => {
    const store = createCodeWorkspaceBindingStore(createMemoryStorage());

    store.getState().setLastRoot("/work/a");
    store.getState().bindThreadToRoot("/work/a", "thread-1");
    store.getState().closeRoot("/work/a");

    expect(store.getState().threadByRoot).toEqual({});
    expect(store.getState().lastRoot).toBeNull();
  });

  it("closing a root that is not lastRoot only removes its mapping", () => {
    const store = createCodeWorkspaceBindingStore(createMemoryStorage());

    store.getState().setLastRoot("/work/a");
    store.getState().bindThreadToRoot("/work/b", "thread-2");
    store.getState().closeRoot("/work/b");

    expect(store.getState().threadByRoot).toEqual({});
    expect(store.getState().lastRoot).toBe("/work/a");
  });

  it("hydrates with explicit bindings and ignores malformed entries", () => {
    const store = createCodeWorkspaceBindingStore(createMemoryStorage());

    store.getState().hydrate({
      lastRoot: "  /work/a  ",
      threadByRoot: {
        "/work/a": "thread-1",
        "/work/empty": "   ",
        "/work/bad": 42 as unknown as string,
      },
    });

    expect(store.getState().lastRoot).toBe("/work/a");
    expect(store.getState().threadByRoot).toEqual({ "/work/a": "thread-1" });
  });

  it("ignores empty roots and thread ids in bind actions", () => {
    const store = createCodeWorkspaceBindingStore(createMemoryStorage());

    store.getState().bindThreadToRoot("   ", "thread-1");
    store.getState().bindThreadToRoot("/work/a", "   ");

    expect(store.getState().threadByRoot).toEqual({});
  });

  it("isolates the factory storage when no explicit storage is given", async () => {
    const first = createCodeWorkspaceBindingStore();
    first.getState().setLastRoot("/work/a");

    // A second factory instance must not see the first instance's state:
    // without explicit storage each factory gets its own in-memory storage
    // instead of falling through to renderer localStorage.
    const second = createCodeWorkspaceBindingStore();
    await second.persist.rehydrate();

    expect(second.getState().lastRoot).toBeNull();
    expect(second.getState().threadByRoot).toEqual({});
  });

  it("migrates older persisted payloads through normalization and rewrites the version", async () => {
    const storage = createMemoryStorage();
    storage.setItem(
      CODE_WORKSPACE_BINDING_STORE_NAME,
      JSON.stringify({
        state: {
          lastRoot: "  /work/old  ",
          threadByRoot: {
            " /work/old ": "thread-old",
            "/work/empty": "   ",
            "/work/bad": 42,
          },
          extraFutureField: "ignored",
        },
        version: 0,
      }),
    );

    const store = createCodeWorkspaceBindingStore(storage);
    await store.persist.rehydrate();

    expect(store.getState().lastRoot).toBe("/work/old");
    expect(store.getState().threadByRoot).toEqual({ "/work/old": "thread-old" });

    const persisted = readPersistedJson(storage);
    expect(persisted.version).toBe(CODE_WORKSPACE_BINDING_STORE_VERSION);
    expect(persisted.state).toEqual({
      lastRoot: "/work/old",
      threadByRoot: { "/work/old": "thread-old" },
    });
  });

  it("keeps renderer normalization trim-only and drops unknown persisted fields on rehydrate", async () => {
    const storage = createMemoryStorage();
    storage.setItem(
      CODE_WORKSPACE_BINDING_STORE_NAME,
      JSON.stringify({
        state: {
          lastRoot: "  /work/a  ",
          threadByRoot: { " /work/a ": "thread-1" },
          legacyField: "must not survive",
        },
        version: CODE_WORKSPACE_BINDING_STORE_VERSION,
      }),
    );

    const store = createCodeWorkspaceBindingStore(storage);
    await store.persist.rehydrate();

    expect(store.getState().lastRoot).toBe("/work/a");
    expect(store.getState().threadByRoot).toEqual({ "/work/a": "thread-1" });
  });
});
