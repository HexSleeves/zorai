const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { registerCoreIpcHandlers } = require("./main/core-ipc-handlers.cjs");
const workspaceService = require("./main/workspace-service.cjs");

function createHarness({ dialogResult, useRealWorkspaceService = false } = {}) {
  const handlers = new Map();
  const dialogCalls = [];
  const openWorkspaceCalls = [];

  const ipcMain = {
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
  };

  registerCoreIpcHandlers(ipcMain, {
    dialog: {
      async showOpenDialog(options) {
        dialogCalls.push(options);
        return dialogResult;
      },
    },
    ...(useRealWorkspaceService
      ? { workspaceService }
      : {
          workspaceService: {
            async openWorkspace(rootPath) {
              openWorkspaceCalls.push(rootPath);
              return {
                root: rootPath,
                name: path.basename(rootPath),
                gitRoot: null,
                isGitRepository: false,
              };
            },
          },
        }),
    terminalBridgeRuntime: {
      startTerminalBridge: async () => ({}),
      sendTerminalInput: async () => true,
      executeManagedCommand: async () => true,
      resolveManagedApproval: async () => true,
      searchManagedHistory: async () => [],
      generateManagedSkill: async () => ({}),
      findManagedSymbol: async () => [],
      listSnapshots: async () => [],
      restoreSnapshot: async () => ({}),
      cloneTerminalSession: async () => ({}),
      resizeTerminalSession: async () => true,
    },
    pluginHandlers: {
      async listInstalled() {
        return [];
      },
      async listDaemon() {
        return { plugins: [] };
      },
      async getDaemon() {
        return { plugin: null, settings_schema: null };
      },
      async enableDaemon() {
        return { ok: true };
      },
      async disableDaemon() {
        return { ok: true };
      },
      async installDaemon() {
        return { ok: true };
      },
      async uninstallDaemon() {
        return { ok: true };
      },
      async getSettings() {
        return { plugin_name: "", settings: [] };
      },
      async updateSettings() {
        return { ok: true };
      },
      async testConnection() {
        return { plugin_name: "", success: false, message: "" };
      },
      async startOAuth() {
        return { name: "", url: "" };
      },
    },
  });

  return { handlers, dialogCalls, openWorkspaceCalls };
}

test("workspace-select-folder registers a native directory picker handler in the main process", () => {
  const { handlers } = createHarness({
    dialogResult: { canceled: false, filePaths: ["/tmp/example"], bookmarks: [] },
  });
  assert.equal(typeof handlers.get("workspace-select-folder"), "function");
});

test("workspace-select-folder opens showOpenDialog with openDirectory only", async () => {
  const { handlers, dialogCalls } = createHarness({
    dialogResult: { canceled: false, filePaths: ["/tmp/example"], bookmarks: [] },
  });

  const result = await handlers.get("workspace-select-folder")({});

  assert.equal(dialogCalls.length, 1);
  assert.deepEqual(dialogCalls[0].properties, ["openDirectory"]);
  assert.equal(result.canceled, false);
  assert.equal(result.root.name, "example");
});

test("workspace-select-folder returns canceled with null root when the picker is dismissed", async () => {
  const { handlers, dialogCalls, openWorkspaceCalls } = createHarness({
    dialogResult: { canceled: true, filePaths: [], bookmarks: [] },
  });

  const result = await handlers.get("workspace-select-folder")({});

  assert.deepEqual(result, { canceled: true, root: null });
  assert.equal(openWorkspaceCalls.length, 0);
  assert.equal(dialogCalls.length, 1);
});

test("workspace-select-folder treats an empty selection like cancellation", async () => {
  const { handlers, openWorkspaceCalls } = createHarness({
    dialogResult: { canceled: false, filePaths: [], bookmarks: [] },
  });

  const result = await handlers.get("workspace-select-folder")({});

  assert.deepEqual(result, { canceled: true, root: null });
  assert.equal(openWorkspaceCalls.length, 0);
});

test("workspace-select-folder passes the picked path through workspaceService.openWorkspace", async () => {
  const { handlers, openWorkspaceCalls } = createHarness({
    dialogResult: { canceled: false, filePaths: ["/tmp/example"], bookmarks: [] },
  });

  const result = await handlers.get("workspace-select-folder")({});

  assert.deepEqual(openWorkspaceCalls, ["/tmp/example"]);
  assert.equal(result.canceled, false);
  assert.equal(result.root.root, "/tmp/example");
});

test("workspace-select-folder returns validated canonical metadata for a real directory", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zorai-folder-select-"));
  const { handlers } = createHarness({
    dialogResult: { canceled: false, filePaths: [root], bookmarks: [] },
    useRealWorkspaceService: true,
  });

  const result = await handlers.get("workspace-select-folder")({});

  assert.equal(result.canceled, false);
  assert.equal(result.root.root, fs.realpathSync.native(root));
  assert.equal(result.root.name, path.basename(root));
  assert.equal(typeof result.root.gitRoot, "object");
  assert.equal(typeof result.root.isGitRepository, "boolean");

  fs.rmSync(root, { recursive: true, force: true });
});
