"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const electronDir = __dirname;
const handlers = fs.readFileSync(path.join(electronDir, "main", "agent-ipc-handlers.cjs"), "utf8");
const preload = fs.readFileSync(path.join(electronDir, "preload.cjs"), "utf8");
const queryRuntime = fs.readFileSync(path.join(electronDir, "agent-query-runtime.cjs"), "utf8");

test("Electron registers MLflow tracing query handlers", () => {
    for (const channel of [
        "agent-get-mlflow-tracing-status",
        "agent-test-mlflow-tracing-connection",
        "agent-send-mlflow-tracing-test-trace",
        "agent-list-mlflow-tracing-headers",
        "agent-set-mlflow-tracing-header",
        "agent-delete-mlflow-tracing-header",
    ]) {
        assert.match(handlers, new RegExp(`ipcMain\\.handle\\('${channel}'`));
        assert.match(preload, new RegExp(`ipcRenderer\\.invoke\\('${channel}'`));
    }
});

test("MLflow tracing replies are recognized query response types", () => {
    for (const responseType of [
        "mlflow-tracing-status",
        "mlflow-tracing-test-result",
        "mlflow-tracing-headers",
    ]) {
        assert.ok(queryRuntime.includes(`'${responseType}'`));
    }
});

test("header values are only sent to the daemon and never returned by list/delete methods", () => {
    assert.match(handlers, /type: 'set-mlflow-tracing-header', name, value/);
    assert.match(handlers, /type: 'list-mlflow-tracing-headers'/);
    assert.doesNotMatch(handlers, /list-mlflow-tracing-headers'[^\n]+value/);
});
