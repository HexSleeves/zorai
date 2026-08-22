const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { canonicalWorkspaceRoot, isWithinRoot } = require('./workspace-service.cjs');

const DEFAULT_DEBOUNCE_MS = 100;
const DEFAULT_MAX_DIRECTORIES = 2048;
const IGNORED_DIRECTORY_NAMES = new Set([
    '.git', 'node_modules', 'target', 'dist', 'build', '.venv', '__pycache__', '.next', '.cache',
]);

function createWorkspaceWatcher(rootPath, onBatch, options = {}) {
    if (typeof onBatch !== 'function') throw new Error('Workspace watcher callback is required.');
    const root = canonicalWorkspaceRoot(rootPath);
    const subscriptionId = randomUUID();
    const debounceMs = Math.max(25, Math.min(Number(options.debounceMs) || DEFAULT_DEBOUNCE_MS, 2000));
    const maxDirectories = Math.max(1, Math.min(Number(options.maxDirectories) || DEFAULT_MAX_DIRECTORIES, 10000));
    const watchers = new Map();
    const pending = new Map();
    let closed = false;
    let flushTimer = null;

    function flush() {
        flushTimer = null;
        if (closed || pending.size === 0) return;
        const changes = [...pending.values()]
            .sort((left, right) => left.path.localeCompare(right.path));
        pending.clear();
        onBatch({ subscriptionId, root, changes, emittedAt: Date.now() });
    }

    function enqueue(absolutePath, eventType) {
        const resolved = path.resolve(absolutePath);
        if (!isWithinRoot(root, resolved)) return;
        const relativePath = path.relative(root, resolved);
        if (!relativePath || relativePath.split(path.sep).some((part) => IGNORED_DIRECTORY_NAMES.has(part))) return;
        pending.set(relativePath, {
            path: relativePath,
            eventType: eventType === 'rename' ? 'rename' : 'change',
            observedAt: Date.now(),
        });
        if (flushTimer !== null) clearTimeout(flushTimer);
        flushTimer = setTimeout(flush, debounceMs);
    }

    function watchDirectory(directory) {
        if (closed || watchers.has(directory) || watchers.size >= maxDirectories) return;
        let watcher;
        try {
            watcher = fs.watch(directory, { persistent: false }, (eventType, filename) => {
                if (closed || !filename) return;
                const absolutePath = path.join(directory, filename.toString());
                enqueue(absolutePath, eventType);
                if (eventType === 'rename') {
                    setTimeout(() => discoverDirectories(absolutePath), debounceMs);
                }
            });
        } catch {
            return;
        }
        watcher.on('error', () => {
            watcher.close();
            watchers.delete(directory);
        });
        watchers.set(directory, watcher);
    }

    function discoverDirectories(startPath) {
        if (closed || watchers.size >= maxDirectories) return;
        let stats;
        try { stats = fs.statSync(startPath); } catch { return; }
        if (!stats.isDirectory()) return;
        const canonical = (() => {
            try { return fs.realpathSync.native(startPath); } catch { return null; }
        })();
        if (!canonical || !isWithinRoot(root, canonical)) return;
        if (IGNORED_DIRECTORY_NAMES.has(path.basename(canonical))) return;
        watchDirectory(canonical);
        if (watchers.size >= maxDirectories) return;
        let entries;
        try { entries = fs.readdirSync(canonical, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            if (watchers.size >= maxDirectories) break;
            if (!entry.isDirectory() || entry.isSymbolicLink() || IGNORED_DIRECTORY_NAMES.has(entry.name)) continue;
            discoverDirectories(path.join(canonical, entry.name));
        }
    }

    discoverDirectories(root);

    return {
        subscriptionId,
        root,
        get watchedDirectoryCount() { return watchers.size; },
        close() {
            if (closed) return;
            closed = true;
            if (flushTimer !== null) clearTimeout(flushTimer);
            flushTimer = null;
            pending.clear();
            for (const watcher of watchers.values()) watcher.close();
            watchers.clear();
        },
    };
}

module.exports = { createWorkspaceWatcher };
