const fs = require('node:fs');
const path = require('node:path');

const COMPANION_BINARIES = [
    'zorai-daemon',
    'zorai',
    'zoi',
    'zorai-tui',
    'zorai-mcp',
    'zorai-gateway',
];

function platformReleaseDirectory(platform) {
    if (platform === 'win32') return 'windows';
    if (platform === 'darwin') return 'macos';
    return 'linux';
}

function candidateBinaryDirectories(repoRoot, options = {}) {
    const candidates = [];
    if (options.releaseBinDir) candidates.push(path.resolve(options.releaseBinDir));
    if (options.cargoTarget) candidates.push(path.join(repoRoot, 'target', options.cargoTarget, 'release'));
    candidates.push(path.join(repoRoot, 'target', 'release'));
    candidates.push(path.join(repoRoot, 'dist-release', platformReleaseDirectory(options.platform ?? process.platform)));
    return [...new Set(candidates)];
}

function findCompanionBinary(binary, directories, extension) {
    const filename = `${binary}${extension}`;
    return directories.map((directory) => path.join(directory, filename)).find((candidate) => fs.existsSync(candidate)) ?? null;
}

function stageElectronResources(options = {}) {
    const frontendDir = path.resolve(options.frontendDir ?? path.join(__dirname, '..'));
    const repoRoot = path.resolve(options.repoRoot ?? path.join(frontendDir, '..'));
    const distDir = path.join(frontendDir, 'dist');
    const platform = options.platform ?? process.platform;
    const extension = platform === 'win32' ? '.exe' : '';
    const directories = candidateBinaryDirectories(repoRoot, {
        platform,
        cargoTarget: options.cargoTarget ?? process.env.CARGO_BUILD_TARGET,
        releaseBinDir: options.releaseBinDir ?? process.env.ZORAI_RELEASE_BIN_DIR,
    });

    fs.mkdirSync(distDir, { recursive: true });
    const staged = [];
    const missing = [];
    for (const binary of COMPANION_BINARIES) {
        const source = findCompanionBinary(binary, directories, extension);
        if (!source) {
            missing.push(`${binary}${extension}`);
            continue;
        }
        const destination = path.join(distDir, `${binary}${extension}`);
        fs.copyFileSync(source, destination);
        staged.push({ binary, source, destination });
    }

    if (missing.length > 0) {
        const searched = directories.map((directory) => `  - ${directory}`).join('\n');
        throw new Error(
            `Cannot package a complete zorai desktop app; missing companion binaries: ${missing.join(', ')}.\n`
            + `Build them first with \`cargo build --release\`, or set ZORAI_RELEASE_BIN_DIR.\nSearched:\n${searched}`,
        );
    }

    const gettingStarted = path.join(repoRoot, 'docs', 'getting-started.md');
    if (fs.existsSync(gettingStarted)) {
        fs.copyFileSync(gettingStarted, path.join(distDir, 'GETTING_STARTED.md'));
    }

    return { frontendDir, repoRoot, distDir, staged };
}

if (require.main === module) {
    try {
        const result = stageElectronResources();
        console.log(`[zorai] Staged ${result.staged.length} companion binaries for Electron packaging.`);
        for (const item of result.staged) {
            console.log(`  ${path.basename(item.destination)} <- ${item.source}`);
        }
    } catch (error) {
        console.error(`[zorai] ${error?.message || String(error)}`);
        process.exitCode = 1;
    }
}

module.exports = {
    COMPANION_BINARIES,
    candidateBinaryDirectories,
    findCompanionBinary,
    platformReleaseDirectory,
    stageElectronResources,
};
