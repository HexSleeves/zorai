const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const preloadPath = path.join(__dirname, "preload.cjs");
const handlerPath = path.join(__dirname, "main", "agent-ipc-handlers.cjs");
const preloadSrc = fs.readFileSync(preloadPath, "utf8");
const { registerAgentIpcHandlers } = require(handlerPath);
const {
  AGENT_QUERY_RESPONSE_TYPES,
  isAgentQueryResponseType,
} = require(path.join(__dirname, "agent-query-runtime.cjs"));

function createHandlerHarness() {
  const handlers = new Map();
  const commands = [];
  const queries = [];
  const ipcMain = {
    handle(name, handler) {
      handlers.set(name, handler);
    },
  };

  registerAgentIpcHandlers(
    ipcMain,
    {
      sendAgentCommand: (command) => commands.push(command),
      sendAgentQuery: async (command, responseType, timeoutMs) => {
        queries.push({ command, responseType, timeoutMs });
        return { ok: true, thread_id: command.thread_id ?? null };
      },
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

  return { handlers, commands, queries };
}

test("agent query runtime recognizes thread collaboration query responses", () => {
  assert.ok(AGENT_QUERY_RESPONSE_TYPES.includes("operation-status"));
  assert.ok(AGENT_QUERY_RESPONSE_TYPES.includes("thread-handoff-result"));
  assert.equal(isAgentQueryResponseType("operation-status"), true);
  assert.equal(isAgentQueryResponseType("thread-handoff-result"), true);
});

test("preload exposes thread collaboration bridge methods", () => {
  assert.match(
    preloadSrc,
    /agentHandoffThread:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\('agent-handoff-thread', payload\)/,
  );
  assert.match(
    preloadSrc,
    /agentGetOperationStatus:\s*\(id\)\s*=>\s*ipcRenderer\.invoke\('agent-get-operation-status', id\)/,
  );
  assert.match(
    preloadSrc,
    /agentCancelOperation:\s*\(id\)\s*=>\s*ipcRenderer\.invoke\('agent-cancel-operation', id\)/,
  );
});

test("handoff IPC sends exact user-requested query contract", async () => {
  const { handlers, queries } = createHandlerHarness();

  const result = await handlers.get("agent-handoff-thread")(null, {
    threadId: "thread-1",
    action: "push_handoff",
    targetAgentId: "rarog",
    reason: "need concierge continuity",
    summary: "Take over this thread.",
    sessionId: "session-1",
  });

  assert.deepEqual(result, { ok: true, thread_id: "thread-1" });
  assert.deepEqual(queries, [{
    command: {
      type: "handoff-thread",
      thread_id: "thread-1",
      action: "push_handoff",
      target_agent_id: "rarog",
      reason: "need concierge continuity",
      summary: "Take over this thread.",
      requested_by: "user",
      session_id: "session-1",
    },
    responseType: "thread-handoff-result",
    timeoutMs: 30000,
  }]);
});

test("handoff IPC accepts the runtime switcher's snake-case target field", async () => {
  const { handlers, queries } = createHandlerHarness();

  await handlers.get("agent-handoff-thread")(null, {
    threadId: "thread-1",
    action: "push_handoff",
    target_agent_id: "swarog",
    reason: "runtime switch",
    summary: "Switch this thread to Svarog.",
  });

  assert.equal(queries[0].command.target_agent_id, "swarog");
});

test("operation status IPC sends exact query contract", async () => {
  const { handlers, queries } = createHandlerHarness();

  await handlers.get("agent-get-operation-status")(null, "op-1");

  assert.deepEqual(queries, [{
    command: {
      type: "get-operation-status",
      operation_id: "op-1",
    },
    responseType: "operation-status",
    timeoutMs: 30000,
  }]);
});

test("cancel operation IPC routes through cancel-task command payload", async () => {
  const { handlers, commands } = createHandlerHarness();

  const result = await handlers.get("agent-cancel-operation")(null, "op-1");

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(commands, [{ type: "cancel-task", task_id: "op-1" }]);
});

test("participant suggestion IPC forwards explicit force send", async () => {
  const { handlers, commands } = createHandlerHarness();

  await handlers.get("agent-send-participant-suggestion")(null, {
    threadId: "thread-1",
    suggestionId: "suggestion-1",
    sessionId: "session-1",
    forceSend: true,
  });

  assert.deepEqual(commands, [{
    type: "send-participant-suggestion",
    thread_id: "thread-1",
    suggestion_id: "suggestion-1",
    session_id: "session-1",
    force_send: true,
  }]);
});

test("participant suggestion IPC defaults force send to false", async () => {
  const { handlers, commands } = createHandlerHarness();

  await handlers.get("agent-send-participant-suggestion")(null, {
    threadId: "thread-1",
    suggestionId: "suggestion-1",
  });

  assert.deepEqual(commands, [{
    type: "send-participant-suggestion",
    thread_id: "thread-1",
    suggestion_id: "suggestion-1",
    session_id: null,
    force_send: false,
  }]);
});
