const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    listWorkspaceDirectory,
    parseUnifiedDiffHunks,
    readWorkspaceFile,
    resolveWorkspacePath,
    searchWorkspace,
    workspaceGitApplyHunk,
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

test('unified diff parser returns stable structured hunks', () => {
    const diff = [
        'diff --git a/file.txt b/file.txt',
        'index 1234567..7654321 100644',
        '--- a/file.txt',
        '+++ b/file.txt',
        '@@ -1,2 +1,2 @@ first',
        '-old one',
        '+new one',
        ' context',
        '@@ -10 +10,2 @@ second',
        ' line',
        '+added',
        '',
    ].join('\n');
    const hunks = parseUnifiedDiffHunks(diff, 'file.txt', false);
    assert.equal(hunks.length, 2);
    assert.equal(hunks[0].section, 'first');
    assert.equal(hunks[0].additions, 1);
    assert.equal(hunks[0].deletions, 1);
    assert.equal(hunks[1].newLines, 2);
    assert.equal(hunks[0].id.length, 64);
});

test('workspace git hunk actions stage, unstage, and discard only selected hunks', async () => {
    const root = tempWorkspace();
    const runGit = (...args) => require('node:child_process').execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    runGit('init', '-b', 'main');
    runGit('config', 'user.email', 'workspace-test@zorai.local');
    runGit('config', 'user.name', 'Workspace Test');
    const base = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n') + '\n';
    fs.writeFileSync(path.join(root, 'file.txt'), base);
    runGit('add', 'file.txt');
    runGit('commit', '-m', 'base');
    const modified = base.replace('line 2', 'line two').replace('line 18', 'line eighteen');
    fs.writeFileSync(path.join(root, 'file.txt'), modified);

    let hunks = parseUnifiedDiffHunks(await require('./main/workspace-service.cjs').workspaceGitDiff(root, 'file.txt'), 'file.txt', false);
    assert.equal(hunks.length, 2);
    let result = await workspaceGitApplyHunk(root, 'file.txt', hunks[0].id, 'stage');
    assert.equal(result.status[0].indexStatus, 'M');
    assert.equal(result.status[0].worktreeStatus, 'M');

    const stagedHunks = parseUnifiedDiffHunks(await require('./main/workspace-service.cjs').workspaceGitDiff(root, 'file.txt', { staged: true }), 'file.txt', true);
    assert.equal(stagedHunks.length, 1);
    result = await workspaceGitApplyHunk(root, 'file.txt', stagedHunks[0].id, 'unstage');
    assert.equal(result.status[0].indexStatus, ' ');

    hunks = parseUnifiedDiffHunks(await require('./main/workspace-service.cjs').workspaceGitDiff(root, 'file.txt'), 'file.txt', false);
    result = await workspaceGitApplyHunk(root, 'file.txt', hunks[0].id, 'discard');
    assert.equal(result.status[0].worktreeStatus, 'M');
    const disk = fs.readFileSync(path.join(root, 'file.txt'), 'utf8');
    assert.ok(disk.includes('line 2') || disk.includes('line 18'));
    assert.ok(disk.includes('line two') || disk.includes('line eighteen'));
    fs.rmSync(root, { recursive: true, force: true });
});

test('stale hunk IDs are rejected instead of applying an arbitrary patch', async () => {
    const root = tempWorkspace();
    const runGit = (...args) => require('node:child_process').execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    runGit('init', '-b', 'main');
    runGit('config', 'user.email', 'workspace-test@zorai.local');
    runGit('config', 'user.name', 'Workspace Test');
    fs.writeFileSync(path.join(root, 'file.txt'), 'base\n');
    runGit('add', 'file.txt');
    runGit('commit', '-m', 'base');
    fs.writeFileSync(path.join(root, 'file.txt'), 'changed\n');
    await assert.rejects(workspaceGitApplyHunk(root, 'file.txt', 'stale-id', 'stage'), { code: 'WORKSPACE_HUNK_STALE' });
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
