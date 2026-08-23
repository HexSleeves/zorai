import { describe, expect, it } from "vitest";
import {
  createCodeEmptyStateController,
  initialCodeEmptyState,
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
      states.push(controller.getState().phase);
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
});
