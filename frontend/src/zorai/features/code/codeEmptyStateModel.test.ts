import { describe, expect, it } from "vitest";
import {
  createCodeEmptyStateController,
  createMemoizedCodeEmptyStateController,
  initialCodeEmptyState,
  normalizeInvokeError,
  type CodeEmptyStateDeps,
  type ZoraiWorkspaceValidatedRoot,
} from "./codeEmptyStateModel";

const sampleRoot: ZoraiWorkspaceValidatedRoot = {
  root: "/work/example",
  name: "example",
  gitRoot: "/work/example",
  isGitRepository: true,
};

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createDeps(overrides: Partial<CodeEmptyStateDeps> = {}): CodeEmptyStateDeps {
  return {
    selectFolder: async () => ({ canceled: false, root: sampleRoot }),
    openPath: async () => sampleRoot,
    onRootSelected: () => {},
    ...overrides,
  };
}

describe("codeEmptyState model", () => {
  it("starts idle with no textbox and no error", () => {
    const deps = createDeps();
    const controller = createCodeEmptyStateController(deps);

    expect(controller.getState()).toEqual(initialCodeEmptyState(null));
    expect(controller.getState().manualOpen).toBe(false);
  });

  it("opens the native picker and surfaces the selected canonical root", async () => {
    const roots: Array<{ root: ZoraiWorkspaceValidatedRoot; source: "picker" | "manual" }> = [];
    const controller = createCodeEmptyStateController(
      createDeps({
        onRootSelected: (root, source) => {
          roots.push({ root, source });
        },
      }),
    );

    const pending = controller.openFolder();
    expect(controller.getState().busy).toBe(true);
    expect(controller.getState().manualOpen).toBe(false);
    await pending;

    expect(roots).toEqual([{ root: sampleRoot, source: "picker" }]);
    expect(controller.getState().busy).toBe(false);
    expect(controller.getState().lastRoot).toBe("/work/example");
  });

  it("keeps the empty state when the picker is canceled", async () => {
    let onRootSelectedCalls = 0;
    const controller = createCodeEmptyStateController(
      createDeps({
        selectFolder: async () => ({ canceled: true, root: null }),
        onRootSelected: () => {
          onRootSelectedCalls += 1;
        },
      }),
    );

    await controller.openFolder();

    expect(onRootSelectedCalls).toBe(0);
    expect(controller.getState().busy).toBe(false);
    expect(controller.getState().lastRoot).toBeNull();
  });

  it("records a picker failure as an error without selecting a root", async () => {
    let onErrorCalls: string[] = [];
    const controller = createCodeEmptyStateController(
      createDeps({
        selectFolder: async () => {
          throw new Error("dialog exploded");
        },
        onError: (message) => {
          onErrorCalls.push(message);
        },
      }),
    );

    await controller.openFolder();

    expect(onErrorCalls).toEqual(["dialog exploded"]);
    expect(controller.getState().error).toBe("dialog exploded");
    expect(controller.getState().busy).toBe(false);
  });

  it("toggles the manual path disclosure without showing a textbox initially", () => {
    const controller = createCodeEmptyStateController(createDeps());

    expect(controller.getState().manualOpen).toBe(false);
    controller.toggleManual();
    expect(controller.getState().manualOpen).toBe(true);
    controller.toggleManual();
    expect(controller.getState().manualOpen).toBe(false);
  });

  it("rejects an empty manual path with an inline error", async () => {
    let onRootSelectedCalls = 0;
    const controller = createCodeEmptyStateController(
      createDeps({
        onRootSelected: () => {
          onRootSelectedCalls += 1;
        },
      }),
    );

    controller.toggleManual();
    await controller.submitPath();

    expect(onRootSelectedCalls).toBe(0);
    expect(controller.getState().error).toBe("Enter a folder path.");
    expect(controller.getState().busy).toBe(false);
  });

  it("validates a manual path through workspaceOpen and surfaces the canonical root", async () => {
    const openedPaths: string[] = [];
    const roots: Array<{ root: ZoraiWorkspaceValidatedRoot; source: "picker" | "manual" }> = [];
    const controller = createCodeEmptyStateController(
      createDeps({
        openPath: async (rootPath) => {
          openedPaths.push(rootPath);
          return sampleRoot;
        },
        onRootSelected: (root, source) => {
          roots.push({ root, source });
        },
      }),
    );

    controller.toggleManual();
    controller.setPathValue("/work/example");
    await controller.submitPath();

    expect(openedPaths).toEqual(["/work/example"]);
    expect(roots).toEqual([{ root: sampleRoot, source: "manual" }]);
    expect(controller.getState().manualOpen).toBe(false);
    expect(controller.getState().pathValue).toBe("");
    expect(controller.getState().lastRoot).toBe("/work/example");
    expect(controller.getState().error).toBeNull();
  });

  it("records a manual path failure as an inline error", async () => {
    const controller = createCodeEmptyStateController(
      createDeps({
        openPath: async () => {
          throw new Error("WORKSPACE_ROOT_NOT_FOUND: /missing");
        },
      }),
    );

    controller.toggleManual();
    controller.setPathValue("/missing");
    await controller.submitPath();

    expect(controller.getState().error).toBe("WORKSPACE_ROOT_NOT_FOUND: /missing");
    expect(controller.getState().manualOpen).toBe(true);
    expect(controller.getState().busy).toBe(false);

    controller.dismissError();
    expect(controller.getState().error).toBeNull();
  });

  it("notifies subscribers on state changes", async () => {
    const controller = createCodeEmptyStateController(createDeps());
    const states: string[] = [];
    const unsubscribe = controller.subscribe(() => {
      states.push(controller.getState().lastRoot ?? "(none)");
    });

    controller.toggleManual();
    await controller.openFolder();
    unsubscribe();
    controller.setLastRoot("/work/other");

    expect(states).not.toHaveLength(0);
    expect(controller.getState().lastRoot).toBe("/work/other");
  });

  it("does not allow overlapping picker flows", async () => {
    let resolveSelect: ((value: { canceled: boolean; root: ZoraiWorkspaceValidatedRoot | null }) => void) | null = null;
    let onRootSelectedCalls = 0;
    const controller = createCodeEmptyStateController(
      createDeps({
        selectFolder: () =>
          new Promise((resolve) => {
            resolveSelect = resolve;
          }),
        onRootSelected: () => {
          onRootSelectedCalls += 1;
        },
      }),
    );

    const first = controller.openFolder();
    const second = controller.openFolder();
    expect(controller.getState().busy).toBe(true);

    resolveSelect?.({ canceled: false, root: sampleRoot });
    await Promise.all([first, second]);
    await flushPromises();

    expect(onRootSelectedCalls).toBe(1);
    expect(controller.getState().busy).toBe(false);
  });

  it("normalizes Electron invoke wrapper text out of surfaced errors", () => {
    const invocations: Array<{ fn: () => string; expect: string }> = [
      {
        fn: () => normalizeInvokeError(new Error("Error invoking remote method 'workspace-open': Workspace root does not exist: /missing")),
        expect: "Workspace root does not exist: /missing",
      },
      {
        fn: () => normalizeInvokeError(new Error("Error invoking remote method 'workspace-select-folder': dialog exploded")),
        expect: "dialog exploded",
      },
      {
        fn: () => normalizeInvokeError(new Error("plain failure")),
        expect: "plain failure",
      },
      {
        fn: () => normalizeInvokeError("non-error value"),
        expect: "non-error value",
      },
    ];

    for (const { fn, expect: expected } of invocations) {
      expect(fn()).toBe(expected);
    }
  });

  it("cleans the Electron invoke wrapper before storing and reporting manual path errors", async () => {
    const controller = createCodeEmptyStateController(
      createDeps({
        openPath: async () => {
          throw new Error("Error invoking remote method 'workspace-open': Workspace root does not exist: /missing");
        },
      }),
    );

    controller.toggleManual();
    controller.setPathValue("/missing");
    await controller.submitPath();

    expect(controller.getState().error).toBe("Workspace root does not exist: /missing");
    expect(controller.getState().manualOpen).toBe(true);
    expect(controller.getState().busy).toBe(false);
  });

  it("reuses the controller across rerenders with unchanged functional props", () => {
    const selectFolder = async () => ({ canceled: true, root: null });
    const openPath = async () => sampleRoot;
    const onRootSelected = () => {};
    const deps: CodeEmptyStateDeps = { selectFolder, openPath, onRootSelected };

    const first = createMemoizedCodeEmptyStateController(null, deps);
    first.controller.toggleManual();
    first.controller.setPathValue("/work/typed");

    // Simulates a React rerender that passes the exact same callback refs.
    const second = createMemoizedCodeEmptyStateController(first, deps);

    expect(second.controller).toBe(first.controller);
    expect(second.controller.getState().manualOpen).toBe(true);
    expect(second.controller.getState().pathValue).toBe("/work/typed");
  });

  it("keeps disclosure and typed input when rerendered with equal-but-new dep objects", () => {
    const selectFolder = async () => ({ canceled: true, root: null });
    const openPath = async () => sampleRoot;
    const onRootSelected = () => {};
    const onError = () => {};

    const first = createMemoizedCodeEmptyStateController(null, {
      selectFolder,
      openPath,
      onRootSelected,
      onError,
    });
    first.controller.toggleManual();
    first.controller.setPathValue("/work/typed");

    // A rerender builds fresh dep objects but keeps functional identities.
    const second = createMemoizedCodeEmptyStateController(first, {
      selectFolder,
      openPath,
      onRootSelected,
      onError,
    });

    expect(second.controller).toBe(first.controller);
    expect(second.controller.getState().manualOpen).toBe(true);
    expect(second.controller.getState().pathValue).toBe("/work/typed");
    expect(second.controller.isDisposed()).toBe(false);
  });

  it("recreates the controller when a functional prop identity changes", () => {
    const selectFolder = async () => ({ canceled: true, root: null });
    const openPath = async () => sampleRoot;
    const onRootSelected = () => {};

    const first = createMemoizedCodeEmptyStateController(null, {
      selectFolder,
      openPath,
      onRootSelected,
    });
    first.controller.toggleManual();
    first.controller.setPathValue("/work/typed");

    // A fresh callback (e.g. an inline `() => {}` default) must create a new
    // controller and therefore a fresh disclosure/input state.
    const second = createMemoizedCodeEmptyStateController(first, {
      selectFolder,
      openPath,
      onRootSelected: () => {},
    });

    expect(second.controller).not.toBe(first.controller);
    expect(second.controller.getState().manualOpen).toBe(false);
    expect(second.controller.getState().pathValue).toBe("");
  });

  it("ignores functional prop changes that keep the same identities in a different key order", () => {
    const selectFolder = async () => ({ canceled: true, root: null });
    const openPath = async () => sampleRoot;
    const onRootSelected = () => {};
    const onError = undefined;

    const first = createMemoizedCodeEmptyStateController(null, {
      onError,
      selectFolder,
      onRootSelected,
      openPath,
    });
    first.controller.toggleManual();

    const second = createMemoizedCodeEmptyStateController(first, {
      openPath,
      onRootSelected,
      onError,
      selectFolder,
    });

    expect(second.controller).toBe(first.controller);
    expect(second.controller.getState().manualOpen).toBe(true);
  });

  it("does not emit or select a root after dispose while the picker is in flight", async () => {
    let resolveSelect: ((value: { canceled: boolean; root: ZoraiWorkspaceValidatedRoot | null }) => void) | null = null;
    let onRootSelectedCalls = 0;
    let onErrorCalls = 0;
    const controller = createCodeEmptyStateController(
      createDeps({
        selectFolder: () =>
          new Promise((resolve) => {
            resolveSelect = resolve;
          }),
        onRootSelected: () => {
          onRootSelectedCalls += 1;
        },
        onError: () => {
          onErrorCalls += 1;
        },
      }),
    );
    let subscriberCalls = 0;
    controller.subscribe(() => {
      subscriberCalls += 1;
    });

    const pending = controller.openFolder();
    expect(controller.getState().busy).toBe(true);

    controller.dispose();
    resolveSelect?.({ canceled: false, root: sampleRoot });
    await pending;
    await flushPromises();

    expect(controller.isDisposed()).toBe(true);
    expect(controller.getState().busy).toBe(true);
    expect(controller.getState().lastRoot).toBeNull();
    expect(onRootSelectedCalls).toBe(0);
    expect(onErrorCalls).toBe(0);
    // One emit happened for the pre-dispose busy transition; nothing after.
    expect(subscriberCalls).toBe(1);
  });

  it("does not emit or surface errors after dispose while manual open is in flight", async () => {
    let rejectOpen: ((error: Error) => void) | null = null;
    let onErrorCalls: string[] = [];
    let onRootSelectedCalls = 0;
    const controller = createCodeEmptyStateController(
      createDeps({
        openPath: () =>
          new Promise((_resolve, reject) => {
            rejectOpen = reject;
          }),
        onRootSelected: () => {
          onRootSelectedCalls += 1;
        },
        onError: (message) => {
          onErrorCalls.push(message);
        },
      }),
    );
    let subscriberCalls = 0;
    controller.subscribe(() => {
      subscriberCalls += 1;
    });

    controller.toggleManual();
    controller.setPathValue("/work/example");
    const pending = controller.submitPath();

    controller.dispose();
    rejectOpen?.(new Error("Error invoking remote method 'workspace-open': Workspace root does not exist: /missing"));
    await pending;
    await flushPromises();

    expect(controller.isDisposed()).toBe(true);
    expect(controller.getState().error).toBeNull();
    expect(onErrorCalls).toEqual([]);
    expect(onRootSelectedCalls).toBe(0);
    // toggleManual, setPathValue, and submitPath each emitted before disposal.
    expect(subscriberCalls).toBe(3);
  });

  it("stops accepting interaction after dispose", () => {
    const controller = createCodeEmptyStateController(createDeps());

    controller.dispose();
    controller.toggleManual();
    controller.setPathValue("/work/ignored");
    controller.dismissError();

    expect(controller.getState().manualOpen).toBe(false);
    expect(controller.getState().pathValue).toBe("");
  });
});
