const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const handlerSource = readFileSync(path.join(__dirname, "main", "agent-ipc-handlers.cjs"), "utf8");
const preloadSource = readFileSync(path.join(__dirname, "preload.cjs"), "utf8");

test("agent run IPC forwards an optional parent thread scope", () => {
  assert.match(handlerSource, /parent_thread_id: typeof parentThreadId/);
  assert.match(handlerSource, /type: 'list-runs'/);
  assert.match(preloadSource, /agentListRuns: \(parentThreadId\)/);
  assert.match(preloadSource, /ipcRenderer\.invoke\('agent-list-runs', parentThreadId\)/);
});
