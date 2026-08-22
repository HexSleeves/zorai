const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { canonicalWorkspaceRoot, isWithinRoot } = require('./workspace-service.cjs');

const IGNORED = new Set(['.git', 'node_modules', 'target', 'dist', 'build', '.venv', '__pycache__', '.next', '.cache']);
const MAX_FILES = 10000;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

function frameworkForRoot(root) {
    const frameworks = [];
    if (fs.existsSync(path.join(root, 'Cargo.toml'))) frameworks.push({ id: 'rust', label: 'Rust', command: 'cargo' });
    if (fs.existsSync(path.join(root, 'package.json'))) frameworks.push({ id: 'javascript', label: 'JavaScript / TypeScript', command: 'npm' });
    if (fs.existsSync(path.join(root, 'pyproject.toml')) || fs.existsSync(path.join(root, 'pytest.ini')) || fs.existsSync(path.join(root, 'setup.cfg'))) frameworks.push({ id: 'python', label: 'Python', command: 'python' });
    if (fs.existsSync(path.join(root, 'go.mod'))) frameworks.push({ id: 'go', label: 'Go', command: 'go' });
    return frameworks;
}

function extractTests(relativePath, content) {
    const normalized = relativePath.replace(/\\/g, '/');
    const lines = content.split(/\r?\n/);
    const tests = [];
    const add = (framework, name, line, selector) => tests.push({ id: `${framework}:${normalized}:${line}:${name}`, framework, path: normalized, name, line, selector });
    if (normalized.endsWith('.rs')) {
        for (let index = 0; index < lines.length; index += 1) {
            if (!/^\s*#\[(?:tokio::)?test(?:\([^)]*\))?\]/.test(lines[index])) continue;
            for (let cursor = index + 1; cursor < Math.min(lines.length, index + 8); cursor += 1) {
                const match = lines[cursor].match(/^\s*(?:async\s+)?fn\s+([A-Za-z_][\w]*)/);
                if (match) { add('rust', match[1], cursor + 1, match[1]); break; }
            }
        }
    } else if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(normalized)) {
        for (let index = 0; index < lines.length; index += 1) {
            const match = lines[index].match(/\b(?:it|test)\s*\(\s*["'`]([^"'`]+)["'`]/);
            if (match) add('javascript', match[1], index + 1, match[1]);
        }
    } else if (normalized.endsWith('.py')) {
        for (let index = 0; index < lines.length; index += 1) {
            const match = lines[index].match(/^\s*(?:async\s+)?def\s+(test_[A-Za-z0-9_]*)\s*\(/);
            if (match) add('python', match[1], index + 1, `${normalized}::${match[1]}`);
        }
    } else if (normalized.endsWith('_test.go')) {
        for (let index = 0; index < lines.length; index += 1) {
            const match = lines[index].match(/^\s*func\s+(Test[A-Za-z0-9_]*)\s*\(/);
            if (match) add('go', match[1], index + 1, match[1]);
        }
    }
    return tests;
}

async function discoverWorkspaceTests(rootPath, options = {}) {
    const root = canonicalWorkspaceRoot(rootPath);
    const maxTests = Math.max(1, Math.min(Number(options.maxTests) || 2000, 10000));
    const pending = [root];
    const tests = [];
    let filesVisited = 0;
    while (pending.length && filesVisited < MAX_FILES && tests.length < maxTests) {
        const directory = pending.pop();
        let entries;
        try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); } catch { continue; }
        for (const entry of entries) {
            if (filesVisited >= MAX_FILES || tests.length >= maxTests) break;
            if (IGNORED.has(entry.name) || entry.isSymbolicLink()) continue;
            const absolute = path.join(directory, entry.name);
            if (entry.isDirectory()) { pending.push(absolute); continue; }
            if (!entry.isFile() || !(/\.rs$|\.(?:test|spec)\.[cm]?[jt]sx?$|\.py$|_test\.go$/.test(entry.name))) continue;
            filesVisited += 1;
            let stats;
            try { stats = await fs.promises.stat(absolute); } catch { continue; }
            if (stats.size > MAX_FILE_BYTES) continue;
            const content = await fs.promises.readFile(absolute, 'utf8').catch(() => null);
            if (content === null || content.includes('\0')) continue;
            tests.push(...extractTests(path.relative(root, absolute), content).slice(0, maxTests - tests.length));
        }
    }
    return { root, frameworks: frameworkForRoot(root), tests, truncated: filesVisited >= MAX_FILES || tests.length >= maxTests };
}

function testCommand(root, request) {
    const framework = request.framework;
    const selector = typeof request.selector === 'string' ? request.selector : '';
    const relativePath = typeof request.path === 'string' ? request.path : '';
    if (relativePath) {
        const absolute = path.resolve(root, relativePath);
        if (!isWithinRoot(root, absolute)) throw new Error('Test path escapes workspace root.');
    }
    if (framework === 'rust') return { command: 'cargo', args: selector ? ['test', selector, '--', '--nocapture'] : ['test', '--', '--nocapture'] };
    if (framework === 'python') return { command: 'python', args: ['-m', 'pytest', '-q', selector || relativePath || '.'] };
    if (framework === 'go') return { command: 'go', args: selector ? ['test', './...', '-run', `^${selector}$`, '-v'] : ['test', './...', '-v'] };
    if (framework === 'javascript') {
        const args = ['run', 'test:unit', '--'];
        if (relativePath) args.push(relativePath.replace(/\\/g, '/'));
        if (selector) args.push('-t', selector);
        return { command: 'npm', args };
    }
    throw new Error(`Unsupported test framework: ${framework}`);
}

function createTestRuntime(emitEvent) {
    const runs = new Map();
    return {
        discover: discoverWorkspaceTests,
        run(webContents, rootPath, request = {}) {
            const root = canonicalWorkspaceRoot(rootPath);
            const spec = testCommand(root, request);
            const runId = randomUUID();
            const startedAt = Date.now();
            const child = spawn(spec.command, spec.args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
            const output = [];
            let outputBytes = 0;
            const append = (stream, chunk) => {
                if (outputBytes >= MAX_OUTPUT_BYTES) return;
                const text = chunk.toString('utf8');
                outputBytes += Buffer.byteLength(text);
                const event = { runId, type: 'output', stream, text: outputBytes > MAX_OUTPUT_BYTES ? `${text.slice(0, Math.max(0, text.length - (outputBytes - MAX_OUTPUT_BYTES)))}\n[output truncated]\n` : text };
                output.push(event.text);
                if (!webContents.isDestroyed()) emitEvent(webContents, event);
            };
            child.stdout.on('data', (chunk) => append('stdout', chunk));
            child.stderr.on('data', (chunk) => append('stderr', chunk));
            child.once('error', (error) => {
                const event = { runId, type: 'finished', status: 'error', exitCode: null, durationMs: Date.now() - startedAt, error: error.message, output: output.join('') };
                if (!webContents.isDestroyed()) emitEvent(webContents, event);
                runs.delete(runId);
            });
            child.once('exit', (code, signal) => {
                const cancelled = runs.get(runId)?.cancelled === true;
                const event = { runId, type: 'finished', status: cancelled ? 'cancelled' : code === 0 ? 'passed' : 'failed', exitCode: code, signal, durationMs: Date.now() - startedAt, output: output.join('') };
                if (!webContents.isDestroyed()) emitEvent(webContents, event);
                runs.delete(runId);
            });
            runs.set(runId, { child, cancelled: false, root, request, spec, startedAt });
            return { runId, command: spec.command, args: spec.args, startedAt };
        },
        cancel(runId) {
            const run = runs.get(runId);
            if (!run) return false;
            run.cancelled = true;
            run.child.kill('SIGTERM');
            setTimeout(() => { if (!run.child.killed) run.child.kill('SIGKILL'); }, 1000);
            return true;
        },
        stopAll() {
            for (const run of runs.values()) run.child.kill('SIGTERM');
            runs.clear();
        },
    };
}

module.exports = { createTestRuntime, discoverWorkspaceTests, extractTests, frameworkForRoot, testCommand };
