const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    listWorkspaceDirectory,
    readWorkspaceFile,
    resolveWorkspacePath,
    writeWorkspaceFile,
} = require('./main/workspace-service.cjs');

function tempWorkspace() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'zorai-workspace-'));
}

test('workspace paths cannot escape their attached root', () => {
    const root = tempWorkspace();
    assert.throws(() => resolveWorkspacePath(root, '../outside.txt'), { code: 'WORKSPACE_PATH_ESCAPE' });
    fs.rmSync(root, { recursive: true, force: true });
});

test('workspace paths reject symlinks escaping the attached root', () => {
    const root = tempWorkspace();
    const outside = tempWorkspace();
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    fs.symlinkSync(outside, path.join(root, 'outside'));
    assert.throws(() => resolveWorkspacePath(root, 'outside/secret.txt'), { code: 'WORKSPACE_SYMLINK_ESCAPE' });
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
});

test('workspace writes are atomic and reject stale editor hashes', async () => {
    const root = tempWorkspace();
    fs.writeFileSync(path.join(root, 'note.txt'), 'first');
    const opened = await readWorkspaceFile(root, 'note.txt');
    const saved = await writeWorkspaceFile(root, 'note.txt', 'second', opened.hash);
    assert.equal(saved.content, 'second');
    assert.notEqual(saved.hash, opened.hash);
    await assert.rejects(
        writeWorkspaceFile(root, 'note.txt', 'stale overwrite', opened.hash),
        { code: 'WORKSPACE_WRITE_CONFLICT' },
    );
    assert.equal(fs.readFileSync(path.join(root, 'note.txt'), 'utf8'), 'second');
    fs.rmSync(root, { recursive: true, force: true });
});

test('workspace tree is lazy, sorted, and hides heavy directories by default', async () => {
    const root = tempWorkspace();
    fs.mkdirSync(path.join(root, 'src'));
    fs.mkdirSync(path.join(root, 'node_modules'));
    fs.writeFileSync(path.join(root, 'z.txt'), 'z');
    const entries = await listWorkspaceDirectory(root, '');
    assert.deepEqual(entries.map((entry) => entry.name), ['src', 'z.txt']);
    fs.rmSync(root, { recursive: true, force: true });
});

test('binary and oversized files are rejected from text context', async () => {
    const root = tempWorkspace();
    fs.writeFileSync(path.join(root, 'binary.bin'), Buffer.from([1, 0, 2]));
    fs.writeFileSync(path.join(root, 'large.txt'), 'abcdef');
    await assert.rejects(readWorkspaceFile(root, 'binary.bin'), { code: 'WORKSPACE_BINARY_FILE' });
    await assert.rejects(readWorkspaceFile(root, 'large.txt', { maxBytes: 3 }), { code: 'WORKSPACE_FILE_TOO_LARGE' });
    fs.rmSync(root, { recursive: true, force: true });
});
