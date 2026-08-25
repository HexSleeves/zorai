import { describe, expect, it } from "vitest";
import type { StateStorage } from "zustand/middleware";
import {
  THREAD_READ_STATE_STORE_NAME,
  THREAD_READ_STATE_STORE_VERSION,
  createThreadReadStateStore,
  threadReadKey,
} from "./threadReadStateStore";

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
  const raw = storage.getItem(THREAD_READ_STATE_STORE_NAME);
  return raw ? JSON.parse(raw) : null;
}

describe("threadReadKey", () => {
  it("prefers daemon identity when the thread is daemon-linked", () => {
    expect(threadReadKey({ id: "local-1", daemonThreadId: "thread_d1" })).toBe("daemon:thread_d1");
  });

  it("falls back to local identity before daemon linkage", () => {
    expect(threadReadKey({ id: "local-1", daemonThreadId: null })).toBe("local:local-1");
    expect(threadReadKey({ id: "local-1" })).toBe("local:local-1");
  });

  it("treats blank daemon ids as unlinked", () => {
    expect(threadReadKey({ id: "local-1", daemonThreadId: "   " })).toBe("local:local-1");
  });

  it("returns null when no usable identity exists", () => {
    expect(threadReadKey({ id: "", daemonThreadId: null })).toBeNull();
    expect(threadReadKey(null)).toBeNull();
    expect(threadReadKey(undefined)).toBeNull();
  });

  it("trims surrounding whitespace from identities", () => {
    expect(threadReadKey({ id: " local-1 ", daemonThreadId: " thread_d1 " })).toBe("daemon:thread_d1");
  });
});

describe("markRead", () => {
  it("records the newest timestamp and stays monotonic per thread", () => {
    const store = createThreadReadStateStore(createMemoryStorage());

    store.getState().markRead("local:a", 100);
    store.getState().markRead("local:a", 90);

    expect(store.getState().lastReadAtByThread["local:a"]).toBe(100);

    store.getState().markRead("local:a", 120);
    expect(store.getState().lastReadAtByThread["local:a"]).toBe(120);
  });

  it("keeps per-thread timestamps independent", () => {
    const store = createThreadReadStateStore(createMemoryStorage());

    store.getState().markRead("local:a", 100);
    store.getState().markRead("daemon:b", 40);

    expect(store.getState().lastReadAtByThread).toEqual({
      "local:a": 100,
      "daemon:b": 40,
    });
  });

  it("ignores blank keys and invalid timestamps", () => {
    const store = createThreadReadStateStore(createMemoryStorage());

    store.getState().markRead("   ", 100);
    store.getState().markRead("local:a", Number.NaN);
    store.getState().markRead("local:a", Number.POSITIVE_INFINITY);
    store.getState().markRead("local:a", -5);
    store.getState().markRead("local:a", "100" as unknown as number);

    expect(store.getState().lastReadAtByThread).toEqual({});
  });

  it("exposes lastReadAt with null for unknown threads", () => {
    const store = createThreadReadStateStore(createMemoryStorage());

    store.getState().markRead("local:a", 100);

    expect(store.getState().lastReadAt("local:a")).toBe(100);
    expect(store.getState().lastReadAt("local:missing")).toBeNull();
    expect(store.getState().lastReadAt("  ")).toBeNull();
  });
});

describe("migrateThreadKey", () => {
  it("moves the local read timestamp onto the daemon key and drops the local key", () => {
    const store = createThreadReadStateStore(createMemoryStorage());

    store.getState().markRead("local:a", 100);
    store.getState().migrateThreadKey("local:a", "daemon:d");

    expect(store.getState().lastReadAtByThread).toEqual({ "daemon:d": 100 });
  });

  it("keeps the maximum timestamp when the daemon key already has one", () => {
    const store = createThreadReadStateStore(createMemoryStorage());

    store.getState().markRead("local:a", 100);
    store.getState().markRead("daemon:d", 80);
    store.getState().migrateThreadKey("local:a", "daemon:d");

    expect(store.getState().lastReadAtByThread).toEqual({ "daemon:d": 100 });

    store.getState().markRead("local:b", 60);
    store.getState().migrateThreadKey("local:b", "daemon:d");

    expect(store.getState().lastReadAtByThread).toEqual({ "daemon:d": 100 });
  });

  it("is a no-op when the source key is absent or keys are blank", () => {
    const store = createThreadReadStateStore(createMemoryStorage());

    store.getState().markRead("daemon:d", 80);
    store.getState().migrateThreadKey("local:missing", "daemon:d");
    store.getState().migrateThreadKey("   ", "daemon:d");
    store.getState().migrateThreadKey("local:a", "   ");

    expect(store.getState().lastReadAtByThread).toEqual({ "daemon:d": 80 });
  });
});

describe("persistence and hydration", () => {
  it("persists only read timestamps with version 1 and restores into a fresh store", async () => {
    const storage = createMemoryStorage();
    const first = createThreadReadStateStore(storage);

    first.getState().markRead("daemon:d1", 100);
    first.getState().markRead("local:l1", 50);

    const persisted = readPersistedJson(storage);
    expect(persisted).toEqual({
      state: {
        lastReadAtByThread: { "daemon:d1": 100, "local:l1": 50 },
      },
      version: 1,
    });
    expect(THREAD_READ_STATE_STORE_VERSION).toBe(1);

    const second = createThreadReadStateStore(storage);
    await second.persist.rehydrate();
    expect(second.getState().lastReadAtByThread).toEqual({
      "daemon:d1": 100,
      "local:l1": 50,
    });
  });

  it("normalizes malformed persisted payloads and keeps only valid entries", async () => {
    const storage = createMemoryStorage();
    storage.setItem(
      THREAD_READ_STATE_STORE_NAME,
      JSON.stringify({
        state: {
          lastReadAtByThread: {
            "daemon:good": 100,
            " daemon:trimmed ": 40,
            "daemon:nan": "not-a-number",
            "daemon:infinite": Number.POSITIVE_INFINITY,
            "daemon:negative": -1,
            "": 70,
            "   ": 70,
          },
          legacyField: "must not survive",
        },
        version: 0,
      }),
    );

    const store = createThreadReadStateStore(storage);
    await store.persist.rehydrate();

    expect(store.getState().lastReadAtByThread).toEqual({
      "daemon:good": 100,
      "daemon:trimmed": 40,
    });

    const persisted = readPersistedJson(storage);
    expect(persisted.version).toBe(THREAD_READ_STATE_STORE_VERSION);
    expect(persisted.state).toEqual({
      lastReadAtByThread: { "daemon:good": 100, "daemon:trimmed": 40 },
    });
  });

  it("survives non-object persisted state and unreadable JSON", async () => {
    const brokenJson = createMemoryStorage();
    brokenJson.setItem(THREAD_READ_STATE_STORE_NAME, "{not json");
    const store = createThreadReadStateStore(brokenJson);
    await store.persist.rehydrate();
    expect(store.getState().lastReadAtByThread).toEqual({});

    const scalarState = createMemoryStorage();
    scalarState.setItem(
      THREAD_READ_STATE_STORE_NAME,
      JSON.stringify({ state: 42, version: 1 }),
    );
    const scalarStore = createThreadReadStateStore(scalarState);
    await scalarStore.persist.rehydrate();
    expect(scalarStore.getState().lastReadAtByThread).toEqual({});
  });

  it("normalizes malformed payloads in current-version merges as well", async () => {
    const storage = createMemoryStorage();
    storage.setItem(
      THREAD_READ_STATE_STORE_NAME,
      JSON.stringify({
        state: { lastReadAtByThread: { "daemon:ok": 90, "daemon:bad": null } },
        version: THREAD_READ_STATE_STORE_VERSION,
      }),
    );

    const store = createThreadReadStateStore(storage);
    await store.persist.rehydrate();

    expect(store.getState().lastReadAtByThread).toEqual({ "daemon:ok": 90 });
  });

  it("isolates the factory storage when no explicit storage is given", async () => {
    const first = createThreadReadStateStore();
    first.getState().markRead("local:a", 100);

    const second = createThreadReadStateStore();
    await second.persist.rehydrate();

    expect(second.getState().lastReadAtByThread).toEqual({});
  });
});

describe("prune", () => {
  it("drops entries for threads that are no longer known", () => {
    const store = createThreadReadStateStore(createMemoryStorage());

    store.getState().markRead("daemon:keep", 100);
    store.getState().markRead("local:gone", 90);
    store.getState().prune(["daemon:keep"]);

    expect(store.getState().lastReadAtByThread).toEqual({ "daemon:keep": 100 });
  });

  it("clears everything when no known keys are given", () => {
    const store = createThreadReadStateStore(createMemoryStorage());

    store.getState().markRead("daemon:a", 100);
    store.getState().prune([]);

    expect(store.getState().lastReadAtByThread).toEqual({});
  });

  it("ignores unknown keys in the known list and trims them", () => {
    const store = createThreadReadStateStore(createMemoryStorage());

    store.getState().markRead("daemon:a", 100);
    store.getState().prune([" daemon:a ", "daemon:never-seen", 42 as unknown as string]);

    expect(store.getState().lastReadAtByThread).toEqual({ "daemon:a": 100 });
  });
});
