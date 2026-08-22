const test = require('node:test');
const assert = require('node:assert/strict');
const { LspMessageReader, encodeLspMessage, languageServerSpec, normalizeDiagnostic } = require('./main/lsp-runtime.cjs');

test('LSP message reader handles split and concatenated JSON-RPC frames', () => {
    const messages = [];
    const reader = new LspMessageReader((message) => messages.push(message));
    const first = encodeLspMessage({ jsonrpc: '2.0', id: 1, result: { ready: true } });
    const second = encodeLspMessage({ jsonrpc: '2.0', method: 'window/logMessage', params: { message: 'ok' } });
    reader.push(first.subarray(0, 12));
    assert.equal(messages.length, 0);
    reader.push(Buffer.concat([first.subarray(12), second]));
    assert.equal(messages.length, 2);
    assert.equal(messages[0].result.ready, true);
    assert.equal(messages[1].params.message, 'ok');
});

test('LSP diagnostic normalization converts zero-based ranges for Monaco', () => {
    assert.deepEqual(normalizeDiagnostic({
        message: 'borrowed value moved',
        severity: 1,
        source: 'rustc',
        code: 'E0382',
        range: { start: { line: 9, character: 4 }, end: { line: 9, character: 12 } },
    }), {
        message: 'borrowed value moved',
        severity: 1,
        source: 'rustc',
        code: 'E0382',
        startLine: 10,
        startColumn: 5,
        endLine: 10,
        endColumn: 13,
    });
});

test('language server specifications cover Rust, Python, Go, and C++', () => {
    assert.equal(languageServerSpec('rust').candidates[0].command, 'rust-analyzer');
    assert.equal(languageServerSpec('python').candidates.length, 2);
    assert.equal(languageServerSpec('go').candidates[0].command, 'gopls');
    assert.equal(languageServerSpec('cpp').candidates[0].command, 'clangd');
    assert.equal(languageServerSpec('markdown'), null);
});
