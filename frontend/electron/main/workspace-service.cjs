const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;
const GIT_MAX_BUFFER = 8 * 1024 * 1024;
const IGNORED_DIRECTORY_NAMES = new Set([
    '.git', 'node_modules', 'target', 'dist', 'build', '.venv', '__pycache__', '.next', '.cache',
]);

function workspaceError(code, message, details = {}) {
    const error = new Error(message);
    error.code = code;
    Object.assign(error, details);
    return error;
}

function sha256(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}

function isWithinRoot(root, target) {
    const relative = path.relative(root, target);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function canonicalWorkspaceRoot(rootPath) {
    if (typeof rootPath !== 'string' || !rootPath.trim()) {
        throw workspaceError('WORKSPACE_ROOT_REQUIRED', 'A workspace root is required.');
    }
    const resolved = path.resolve(rootPath.trim().replace(/^~(?=$|[\\/])/, require('os').homedir()));
    let canonical;
    try {
        canonical = fs.realpathSync.native(resolved);
    } catch {
        throw workspaceError('WORKSPACE_ROOT_NOT_FOUND', `Workspace root does not exist: ${resolved}`);
    }
    if (!fs.statSync(canonical).isDirectory()) {
        throw workspaceError('WORKSPACE_ROOT_NOT_DIRECTORY', `Workspace root is not a directory: ${canonical}`);
    }
    return canonical;
}

function resolveWorkspacePath(rootPath, relativePath = '', { allowMissing = false } = {}) {
    const root = canonicalWorkspaceRoot(rootPath);
    if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)) {
        throw workspaceError('WORKSPACE_PATH_INVALID', 'Workspace paths must be relative.');
    }
    const normalized = path.normalize(relativePath || '.');
    const candidate = path.resolve(root, normalized);
    if (!isWithinRoot(root, candidate)) {
        throw workspaceError('WORKSPACE_PATH_ESCAPE', `Path escapes workspace root: ${relativePath}`);
    }

    if (fs.existsSync(candidate)) {
        const canonical = fs.realpathSync.native(candidate);
        if (!isWithinRoot(root, canonical)) {
            throw workspaceError('WORKSPACE_SYMLINK_ESCAPE', `Symlink escapes workspace root: ${relativePath}`);
        }
        return { root, absolutePath: canonical, relativePath: path.relative(root, canonical) };
    }
    if (!allowMissing) {
        throw workspaceError('WORKSPACE_PATH_NOT_FOUND', `Workspace path does not exist: ${relativePath}`);
    }

    let existingParent = path.dirname(candidate);
    while (!fs.existsSync(existingParent)) {
        const next = path.dirname(existingParent);
        if (next === existingParent) break;
        existingParent = next;
    }
    const canonicalParent = fs.realpathSync.native(existingParent);
    if (!isWithinRoot(root, canonicalParent)) {
        throw workspaceError('WORKSPACE_SYMLINK_ESCAPE', `Parent symlink escapes workspace root: ${relativePath}`);
    }
    return { root, absolutePath: candidate, relativePath: path.relative(root, candidate) };
}

function languageForPath(filePath) {
    const byExtension = {
        '.c': 'c', '.cc': 'cpp', '.cpp': 'cpp', '.css': 'css', '.go': 'go', '.html': 'html',
        '.java': 'java', '.js': 'javascript', '.jsx': 'javascript', '.json': 'json', '.md': 'markdown',
        '.py': 'python', '.rs': 'rust', '.scss': 'scss', '.sh': 'shell', '.sql': 'sql', '.toml': 'toml',
        '.ts': 'typescript', '.tsx': 'typescript', '.xml': 'xml', '.yaml': 'yaml', '.yml': 'yaml',
    };
    return byExtension[path.extname(filePath).toLowerCase()] || 'plaintext';
}

function isProbablyBinary(buffer) {
    const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
    return sample.includes(0);
}

async function openWorkspace(rootPath) {
    const root = canonicalWorkspaceRoot(rootPath);
    const gitRoot = await resolveGitRoot(root);
    return {
        root,
        name: path.basename(root),
        gitRoot,
        isGitRepository: gitRoot === root,
    };
}

async function listWorkspaceDirectory(rootPath, relativePath = '', options = {}) {
    const resolved = resolveWorkspacePath(rootPath, relativePath);
    const stats = fs.statSync(resolved.absolutePath);
    if (!stats.isDirectory()) throw workspaceError('WORKSPACE_NOT_DIRECTORY', `${relativePath} is not a directory.`);
    const includeIgnored = options.includeIgnored === true;
    const entries = await fs.promises.readdir(resolved.absolutePath, { withFileTypes: true });
    return entries
        .filter((entry) => includeIgnored || !IGNORED_DIRECTORY_NAMES.has(entry.name))
        .map((entry) => {
            const absolutePath = path.join(resolved.absolutePath, entry.name);
            let itemStats = null;
            try { itemStats = fs.statSync(absolutePath); } catch { itemStats = null; }
            return {
                name: entry.name,
                path: path.relative(resolved.root, absolutePath),
                isDirectory: entry.isDirectory(),
                isSymbolicLink: entry.isSymbolicLink(),
                sizeBytes: itemStats?.size ?? null,
                modifiedAt: itemStats?.mtimeMs ?? null,
            };
        })
        .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
}

async function readWorkspaceFile(rootPath, relativePath, options = {}) {
    const resolved = resolveWorkspacePath(rootPath, relativePath);
    const stats = await fs.promises.stat(resolved.absolutePath);
    if (!stats.isFile()) throw workspaceError('WORKSPACE_NOT_FILE', `${relativePath} is not a file.`);
    const maxBytes = Math.max(1, Math.min(Number(options.maxBytes) || DEFAULT_MAX_FILE_BYTES, 16 * 1024 * 1024));
    if (stats.size > maxBytes) {
        throw workspaceError('WORKSPACE_FILE_TOO_LARGE', `File is ${stats.size} bytes; limit is ${maxBytes}.`, { sizeBytes: stats.size, maxBytes });
    }
    const buffer = await fs.promises.readFile(resolved.absolutePath);
    if (isProbablyBinary(buffer)) {
        throw workspaceError('WORKSPACE_BINARY_FILE', 'Binary files cannot be opened in the text editor.');
    }
    const content = buffer.toString('utf8');
    return {
        path: resolved.relativePath,
        content,
        hash: sha256(buffer),
        sizeBytes: buffer.length,
        modifiedAt: stats.mtimeMs,
        language: languageForPath(resolved.absolutePath),
    };
}

async function writeWorkspaceFile(rootPath, relativePath, content, expectedHash = null) {
    if (typeof content !== 'string') throw workspaceError('WORKSPACE_CONTENT_INVALID', 'File content must be text.');
    const resolved = resolveWorkspacePath(rootPath, relativePath, { allowMissing: true });
    let currentHash = null;
    if (fs.existsSync(resolved.absolutePath)) {
        const current = await fs.promises.readFile(resolved.absolutePath);
        currentHash = sha256(current);
        if (expectedHash !== null && expectedHash !== currentHash) {
            throw workspaceError('WORKSPACE_WRITE_CONFLICT', 'File changed since it was opened.', { currentHash, expectedHash });
        }
    } else if (expectedHash !== null) {
        throw workspaceError('WORKSPACE_WRITE_CONFLICT', 'File was removed since it was opened.', { currentHash: null, expectedHash });
    }
    await fs.promises.mkdir(path.dirname(resolved.absolutePath), { recursive: true });
    const tempPath = path.join(path.dirname(resolved.absolutePath), `.${path.basename(resolved.absolutePath)}.zorai-${process.pid}-${Date.now()}.tmp`);
    try {
        await fs.promises.writeFile(tempPath, content, { encoding: 'utf8', flag: 'wx' });
        await fs.promises.rename(tempPath, resolved.absolutePath);
    } finally {
        await fs.promises.rm(tempPath, { force: true }).catch(() => {});
    }
    return readWorkspaceFile(resolved.root, resolved.relativePath, { maxBytes: Math.max(DEFAULT_MAX_FILE_BYTES, Buffer.byteLength(content)) });
}

async function createWorkspaceDirectory(rootPath, relativePath) {
    const resolved = resolveWorkspacePath(rootPath, relativePath, { allowMissing: true });
    await fs.promises.mkdir(resolved.absolutePath, { recursive: false });
    return { path: resolved.relativePath };
}

async function renameWorkspacePath(rootPath, fromRelativePath, toRelativePath) {
    const from = resolveWorkspacePath(rootPath, fromRelativePath);
    const to = resolveWorkspacePath(rootPath, toRelativePath, { allowMissing: true });
    if (from.root !== to.root) throw workspaceError('WORKSPACE_ROOT_MISMATCH', 'Rename must remain in one workspace.');
    await fs.promises.rename(from.absolutePath, to.absolutePath);
    return { from: from.relativePath, to: to.relativePath };
}

async function deleteWorkspacePath(rootPath, relativePath, options = {}) {
    const resolved = resolveWorkspacePath(rootPath, relativePath);
    if (!resolved.relativePath) throw workspaceError('WORKSPACE_DELETE_ROOT', 'The workspace root cannot be deleted.');
    const stats = await fs.promises.stat(resolved.absolutePath);
    if (stats.isDirectory() && options.recursive !== true) {
        throw workspaceError('WORKSPACE_RECURSIVE_REQUIRED', 'Deleting a directory requires recursive confirmation.');
    }
    await fs.promises.rm(resolved.absolutePath, { recursive: options.recursive === true, force: false });
    return true;
}

async function resolveGitRoot(targetPath) {
    try {
        const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: targetPath, encoding: 'utf8', timeout: 5000 });
        return fs.realpathSync.native(stdout.trim());
    } catch { return null; }
}

async function searchWorkspace(rootPath, query, options = {}) {
    const root = canonicalWorkspaceRoot(rootPath);
    const needle = typeof query === 'string' ? query.trim() : '';
    if (!needle) return [];
    const caseSensitive = options.caseSensitive === true;
    const comparableNeedle = caseSensitive ? needle : needle.toLowerCase();
    const maxResults = Math.max(1, Math.min(Number(options.maxResults) || 100, 500));
    const maxFiles = Math.max(1, Math.min(Number(options.maxFiles) || 5000, 20000));
    const results = [];
    const pending = [root];
    let visitedFiles = 0;

    while (pending.length > 0 && results.length < maxResults && visitedFiles < maxFiles) {
        const directory = pending.pop();
        let entries;
        try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); } catch { continue; }
        for (const entry of entries) {
            if (results.length >= maxResults || visitedFiles >= maxFiles) break;
            if (IGNORED_DIRECTORY_NAMES.has(entry.name) || entry.isSymbolicLink()) continue;
            const absolutePath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                pending.push(absolutePath);
                continue;
            }
            if (!entry.isFile()) continue;
            visitedFiles += 1;
            let stats;
            try { stats = await fs.promises.stat(absolutePath); } catch { continue; }
            if (stats.size > 1024 * 1024) continue;
            let buffer;
            try { buffer = await fs.promises.readFile(absolutePath); } catch { continue; }
            if (isProbablyBinary(buffer)) continue;
            const lines = buffer.toString('utf8').split(/\r?\n/);
            for (let lineIndex = 0; lineIndex < lines.length && results.length < maxResults; lineIndex += 1) {
                const comparableLine = caseSensitive ? lines[lineIndex] : lines[lineIndex].toLowerCase();
                const columnIndex = comparableLine.indexOf(comparableNeedle);
                if (columnIndex < 0) continue;
                results.push({
                    path: path.relative(root, absolutePath),
                    line: lineIndex + 1,
                    column: columnIndex + 1,
                    preview: lines[lineIndex].trim().slice(0, 240),
                });
            }
        }
    }
    return results;
}

async function workspaceGitStatus(rootPath) {
    const root = canonicalWorkspaceRoot(rootPath);
    const gitRoot = await resolveGitRoot(root);
    if (!gitRoot || !isWithinRoot(gitRoot, root)) return [];
    const { stdout } = await execFileAsync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
        cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: GIT_MAX_BUFFER,
    });
    const records = stdout.split('\0').filter(Boolean);
    const result = [];
    for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        const indexStatus = record[0];
        const worktreeStatus = record[1];
        let filePath = record.slice(3);
        let previousPath = null;
        if (indexStatus === 'R' || indexStatus === 'C') {
            previousPath = filePath;
            filePath = records[index + 1] || filePath;
            index += 1;
        }
        result.push({ path: filePath, previousPath, indexStatus, worktreeStatus });
    }
    return result;
}

async function workspaceGitDiff(rootPath, relativePath = null, options = {}) {
    const root = canonicalWorkspaceRoot(rootPath);
    const gitRoot = await resolveGitRoot(root);
    if (!gitRoot) return '';
    const args = ['diff', '--no-ext-diff', '--no-color'];
    if (options.staged === true) args.push('--cached');
    if (relativePath) {
        const resolved = resolveWorkspacePath(root, relativePath, { allowMissing: true });
        args.push('--', path.relative(gitRoot, resolved.absolutePath));
    }
    const { stdout } = await execFileAsync('git', args, {
        cwd: gitRoot, encoding: 'utf8', timeout: 10000, maxBuffer: GIT_MAX_BUFFER,
    }).catch((error) => ({ stdout: typeof error?.stdout === 'string' ? error.stdout : '' }));
    return stdout;
}

module.exports = {
    canonicalWorkspaceRoot,
    createWorkspaceDirectory,
    deleteWorkspacePath,
    isWithinRoot,
    listWorkspaceDirectory,
    openWorkspace,
    readWorkspaceFile,
    renameWorkspacePath,
    resolveWorkspacePath,
    searchWorkspace,
    sha256,
    workspaceGitDiff,
    workspaceGitStatus,
    writeWorkspaceFile,
};
