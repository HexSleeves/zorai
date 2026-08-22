const test = require('node:test');
const assert = require('node:assert/strict');
const { extractTests, frameworkForRoot, testCommand } = require('./main/test-runtime.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('test extraction covers Rust, Vitest, pytest, and Go', () => {
    assert.equal(extractTests('src/lib.rs', '#[tokio::test]\nasync fn rust_case() {}')[0].name, 'rust_case');
    assert.equal(extractTests('thing.test.ts', 'it("web case", () => {})')[0].name, 'web case');
    assert.equal(extractTests('test_model.py', 'def test_python_case():\n    pass')[0].selector, 'test_model.py::test_python_case');
    assert.equal(extractTests('server_test.go', 'func TestServer(t *testing.T) {}')[0].name, 'TestServer');
});

test('test commands use fixed executables and argument arrays', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zorai-tests-'));
    assert.deepEqual(testCommand(root, { framework: 'rust', selector: 'case' }), { command: 'cargo', args: ['test', 'case', '--', '--nocapture'] });
    assert.deepEqual(testCommand(root, { framework: 'python', path: 'test_a.py', selector: 'test_a.py::test_one' }), { command: 'python', args: ['-m', 'pytest', '-q', 'test_a.py::test_one'] });
    assert.equal(testCommand(root, { framework: 'javascript', path: 'a.test.ts', selector: 'one' }).command, 'npm');
    fs.rmSync(root, { recursive: true, force: true });
});

test('framework detection uses repository manifests', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zorai-tests-'));
    fs.writeFileSync(path.join(root, 'Cargo.toml'), '[package]');
    fs.writeFileSync(path.join(root, 'go.mod'), 'module example');
    assert.deepEqual(frameworkForRoot(root).map((item) => item.id), ['rust', 'go']);
    fs.rmSync(root, { recursive: true, force: true });
});
