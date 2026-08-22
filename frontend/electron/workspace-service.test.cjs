const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    listWorkspaceDirectory,
    readWorkspaceFile,
    resolveWorkspacePath,
    searchWorkspace,
    workspaceGitDiscard,
    workspaceGitStage,
    workspaceGitUnstage,
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

test('workspace search is bounded, ignores heavy directories, and reports locations', async () => {
    const root = tempWorkspace();
    fs.mkdirSync(path.join(root, 'src'));
    fs.mkdirSync(path.join(root, 'node_modules'));
    fs.writeFileSync(path.join(root, 'src', 'main.ts'), 'first line\nconst workspaceNeedle = true;\n');
    fs.writeFileSync(path.join(root, 'node_modules', 'ignored.js'), 'workspaceNeedle');
    const results = await searchWorkspace(root, 'workspaceNeedle', { maxResults: 10 });
    assert.deepEqual(results, [{
        path: path.join('src', 'main.ts'),
        line: 2,
        column: 7,
        preview: 'const workspaceNeedle = true;',
    }]);
    fs.rmSync(root, { recursive: true, force: true });
});

test('workspace git operations stage, unstage, and discard tracked changes', async () => {
    const root = tempWorkspace();
    const runGit = (...args) => require('node:child_process').execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    runGit('init');
    runGit('config', 'user.email', 'workspace-test@zorai.local');
    runGit('config', 'user.name', 'Workspace Test');
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'base\n');
    runGit('add', 'tracked.txt');
    runGit('commit', '-m', 'base');
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'modified\n');

    let status = await workspaceGitStage(root, 'tracked.txt');
    assert.equal(status[0].indexStatus, 'M');
    status = await workspaceGitUnstage(root, 'tracked.txt');
    assert.equal(status[0].worktreeStatus, 'M');
    status = await workspaceGitDiscard(root, 'tracked.txt');
    assert.deepEqual(status, []);
    assert.equal(fs.readFileSync(path.join(root, 'tracked.txt'), 'utf8'), 'base\n');
    fs.rmSync(root, { recursive: true, force: true });
});

test('workspace git discard refuses untracked deletion', async () => {
    const root = tempWorkspace();
    require('node:child_process').execFileSync('git', ['init'], { cwd: root });
    fs.writeFileSync(path.join(root, 'untracked.txt'), 'keep');
    await assert.rejects(workspaceGitDiscard(root, 'untracked.txt'), { code: 'WORKSPACE_DISCARD_UNTRACKED' });
    assert.equal(fs.readFileSync(path.join(root, 'untracked.txt'), 'utf8'), 'keep');
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
