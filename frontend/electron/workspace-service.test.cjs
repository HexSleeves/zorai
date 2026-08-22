const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    listWorkspaceDirectory,
    parseGitWorktreeList,
    parseUnifiedDiffHunks,
    readWorkspaceFile,
    resolveWorkspacePath,
    searchWorkspace,
    workspaceGitApplyHunk,
    workspaceGitCommit,
    workspaceGitCreateWorktree,
    workspaceGitDiscard,
    workspaceGitIntegrateWorktree,
    workspaceGitRemoveWorktree,
    workspaceGitReviewWorktree,
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

test('workspace commit requires staged changes and creates only a local commit', async () => {
    const root = tempWorkspace();
    const runGit = (...args) => require('node:child_process').execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    runGit('init', '-b', 'main');
    runGit('config', 'user.email', 'workspace-test@zorai.local');
    runGit('config', 'user.name', 'Workspace Test');
    fs.writeFileSync(path.join(root, 'file.txt'), 'base\n');
    runGit('add', 'file.txt');
    runGit('commit', '-m', 'base');
    fs.writeFileSync(path.join(root, 'file.txt'), 'next\n');
    await assert.rejects(workspaceGitCommit(root, 'not staged'), { code: 'WORKSPACE_NOTHING_STAGED' });
    await require('./main/workspace-service.cjs').workspaceGitStage(root, 'file.txt');
    const committed = await workspaceGitCommit(root, 'workspace commit');
    assert.equal(committed.subject, 'workspace commit');
    assert.equal(committed.commit.length, 40);
    assert.deepEqual(committed.status, []);
    assert.equal(runGit('remote').trim(), '');
    fs.rmSync(root, { recursive: true, force: true });
});

test('workspace commit validates the message before invoking git', async () => {
    const root = tempWorkspace();
    require('node:child_process').execFileSync('git', ['init', '-b', 'main'], { cwd: root });
    await assert.rejects(workspaceGitCommit(root, '   '), { code: 'WORKSPACE_COMMIT_MESSAGE_REQUIRED' });
    fs.rmSync(root, { recursive: true, force: true });
});

test('git worktree porcelain parser returns branch and state metadata', () => {
    const parsed = parseGitWorktreeList('worktree /repo\nHEAD abc123\nbranch refs/heads/main\n\nworktree /repo-worktrees/feature\nHEAD def456\ndetached\nlocked reason\n');
    assert.deepEqual(parsed, [
        { path: '/repo', head: 'abc123', branch: 'main', detached: false, bare: false, locked: false, prunable: false },
        { path: '/repo-worktrees/feature', head: 'def456', branch: null, detached: true, bare: false, locked: true, prunable: false },
    ]);
});

test('managed worktree creation and clean removal stay inside sibling container', async () => {
    const parent = tempWorkspace();
    const root = path.join(parent, 'repo');
    fs.mkdirSync(root);
    const runGit = (...args) => require('node:child_process').execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    runGit('init', '-b', 'main');
    runGit('config', 'user.email', 'workspace-test@zorai.local');
    runGit('config', 'user.name', 'Workspace Test');
    fs.writeFileSync(path.join(root, 'file.txt'), 'base\n');
    runGit('add', 'file.txt');
    runGit('commit', '-m', 'base');
    const created = await workspaceGitCreateWorktree(root, { name: 'safe-feature', branch: 'feature/safe', baseRef: 'HEAD' });
    assert.equal(created.root, path.join(parent, 'repo-worktrees', 'safe-feature'));
    assert.equal(fs.existsSync(created.root), true);
    const remaining = await workspaceGitRemoveWorktree(root, created.root);
    assert.equal(remaining.some((entry) => entry.path === created.root), false);
    assert.equal(fs.existsSync(created.root), false);
    fs.rmSync(parent, { recursive: true, force: true });
});

test('managed worktree removal refuses dirty worktrees', async () => {
    const parent = tempWorkspace();
    const root = path.join(parent, 'repo');
    fs.mkdirSync(root);
    const runGit = (...args) => require('node:child_process').execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    runGit('init', '-b', 'main');
    runGit('config', 'user.email', 'workspace-test@zorai.local');
    runGit('config', 'user.name', 'Workspace Test');
    fs.writeFileSync(path.join(root, 'file.txt'), 'base\n');
    runGit('add', 'file.txt');
    runGit('commit', '-m', 'base');
    const created = await workspaceGitCreateWorktree(root, { name: 'dirty-feature', branch: 'feature/dirty' });
    fs.writeFileSync(path.join(created.root, 'file.txt'), 'dirty\n');
    await assert.rejects(workspaceGitRemoveWorktree(root, created.root), { code: 'WORKSPACE_WORKTREE_DIRTY' });
    assert.equal(fs.existsSync(created.root), true);
    runGit('worktree', 'remove', '--force', created.root);
    fs.rmSync(parent, { recursive: true, force: true });
});

test('reviewed worktree integration cherry-picks only the refreshed commit list', async () => {
    const parent = tempWorkspace();
    const root = path.join(parent, 'repo');
    fs.mkdirSync(root);
    const runGit = (cwd, ...args) => require('node:child_process').execFileSync('git', args, { cwd, encoding: 'utf8' });
    runGit(root, 'init', '-b', 'main');
    runGit(root, 'config', 'user.email', 'workspace-test@zorai.local');
    runGit(root, 'config', 'user.name', 'Workspace Test');
    fs.writeFileSync(path.join(root, 'file.txt'), 'base\n');
    runGit(root, 'add', 'file.txt');
    runGit(root, 'commit', '-m', 'base');
    const created = await workspaceGitCreateWorktree(root, { name: 'review-feature', branch: 'zorai/task-review' });
    fs.writeFileSync(path.join(created.root, 'file.txt'), 'reviewed\n');
    runGit(created.root, 'add', 'file.txt');
    runGit(created.root, 'commit', '-m', 'reviewed change');
    const review = await workspaceGitReviewWorktree(root, created.root);
    assert.equal(review.canIntegrate, true);
    assert.equal(review.commits.length, 1);
    assert.equal(review.files[0].path, 'file.txt');
    await assert.rejects(workspaceGitIntegrateWorktree(root, created.root, ['stale']), { code: 'WORKSPACE_INTEGRATION_STALE' });
    const integrated = await workspaceGitIntegrateWorktree(root, created.root, review.commits.map((commit) => commit.hash));
    assert.equal(fs.readFileSync(path.join(root, 'file.txt'), 'utf8'), 'reviewed\n');
    assert.deepEqual(integrated.status, []);
    assert.equal(fs.existsSync(created.root), true);
    runGit(root, 'worktree', 'remove', created.root);
    fs.rmSync(parent, { recursive: true, force: true });
});

test('reviewed integration refuses a dirty target worktree', async () => {
    const parent = tempWorkspace();
    const root = path.join(parent, 'repo');
    fs.mkdirSync(root);
    const runGit = (cwd, ...args) => require('node:child_process').execFileSync('git', args, { cwd, encoding: 'utf8' });
    runGit(root, 'init', '-b', 'main');
    runGit(root, 'config', 'user.email', 'workspace-test@zorai.local');
    runGit(root, 'config', 'user.name', 'Workspace Test');
    fs.writeFileSync(path.join(root, 'file.txt'), 'base\n');
    runGit(root, 'add', 'file.txt');
    runGit(root, 'commit', '-m', 'base');
    const created = await workspaceGitCreateWorktree(root, { name: 'dirty-target-feature', branch: 'zorai/task-dirty-target' });
    fs.writeFileSync(path.join(created.root, 'new.txt'), 'isolated\n');
    runGit(created.root, 'add', 'new.txt');
    runGit(created.root, 'commit', '-m', 'isolated change');
    const review = await workspaceGitReviewWorktree(root, created.root);
    fs.writeFileSync(path.join(root, 'file.txt'), 'dirty target\n');
    await assert.rejects(workspaceGitIntegrateWorktree(root, created.root, review.commits.map((commit) => commit.hash)), { code: 'WORKSPACE_TARGET_DIRTY' });
    runGit(root, 'restore', 'file.txt');
    runGit(root, 'worktree', 'remove', created.root);
    fs.rmSync(parent, { recursive: true, force: true });
});

test('binary and oversized files are rejected from text context', async () => {
    const root = tempWorkspace();
    fs.writeFileSync(path.join(root, 'binary.bin'), Buffer.from([1, 0, 2]));
    fs.writeFileSync(path.join(root, 'large.txt'), 'abcdef');
    await assert.rejects(readWorkspaceFile(root, 'binary.bin'), { code: 'WORKSPACE_BINARY_FILE' });
    await assert.rejects(readWorkspaceFile(root, 'large.txt', { maxBytes: 3 }), { code: 'WORKSPACE_FILE_TOO_LARGE' });
    fs.rmSync(root, { recursive: true, force: true });
});
