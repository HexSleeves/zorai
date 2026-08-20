const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const preloadPath = path.join(__dirname, "preload.cjs");
const handlerPath = path.join(__dirname, "main", "agent-ipc-handlers.cjs");
const preloadSrc = fs.readFileSync(preloadPath, "utf8");
const { registerAgentIpcHandlers } = require(handlerPath);

function createHandlerHarness() {
  const handlers = new Map();
  const commands = [];
  const ipcMain = {
    handle(name, handler) {
      handlers.set(name, handler);
    },
  };

  registerAgentIpcHandlers(
    ipcMain,
    {
      sendAgentCommand: (command) => commands.push(command),
      sendAgentQuery: async () => ({ ok: true }),
    },
    {
      logToFile: () => {},
      openAICodexAuthHandlers: {
        status: async () => ({ available: false }),
        login: async () => ({ available: false }),
        logout: async () => ({ ok: true }),
      },
    },
  );

  return { handlers, commands };
}

test("preload forwards an optional target agent when sending a message", () => {
  assert.match(
    preloadSrc,
    /agentSendMessage:\s*\(threadId, content, sessionId, contextMessages, contentBlocksJson, targetAgentId\)\s*=>\s*ipcRenderer\.invoke\('agent-send-message', threadId, content, sessionId, contextMessages, contentBlocksJson, targetAgentId\)/,
  );
});

test("agent send-message IPC forwards the selected agent to the daemon", async () => {
  const { handlers, commands } = createHandlerHarness();

  await handlers.get("agent-send-message")(
    null,
    "local-thread-1",
    "Review this",
    null,
    null,
    null,
    "reviewer",
  );

  assert.deepEqual(commands, [{
    type: "send-message",
    thread_id: "local-thread-1",
    content: "Review this",
    session_id: null,
    target_agent_id: "reviewer",
  }]);
});
