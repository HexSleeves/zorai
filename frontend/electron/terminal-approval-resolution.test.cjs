const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createTerminalBridgeRuntime } = require("./main/terminal-bridge-runtime.cjs");

function createRuntime() {
  return createTerminalBridgeRuntime({
    cloneSessionPrefix: "clone:",
    fs: {},
    getCliPath: () => "/tmp/zorai",
    getChildProcessEnv: () => ({}),
    getMainWindow: () => null,
    logToFile: () => {},
    maxReattachHistoryBytes: 1024,
    maxTerminalHistoryBytes: 1024,
    path: require("node:path"),
    spawn: () => {
      const child = new EventEmitter();
      child.killed = false;
      child.stdin = {
        writable: true,
        writableEnded: false,
        destroyed: false,
        write: () => true,
        end: () => {},
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => { child.killed = true; };
      return child;
    },
    spawnDaemon: async () => {},
  });
}

test("resolving approval for a pane without a terminal bridge returns false instead of throwing", () => {
  const runtime = createRuntime();

  assert.doesNotThrow(() => {
    assert.equal(runtime.resolveManagedApproval(null, "pane_1", "approval-1", "approve-once"), false);
  });
});
