const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { COMPANION_BINARIES, stageElectronResources } = require('./stage-electron-resources.cjs');

test('stages every companion binary and getting started document', () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zorai-stage-'));
    const frontendDir = path.join(repoRoot, 'frontend');
    const releaseDir = path.join(repoRoot, 'custom-release');
    fs.mkdirSync(frontendDir, { recursive: true });
    fs.mkdirSync(releaseDir, { recursive: true });
    fs.mkdirSync(path.join(repoRoot, 'docs'), { recursive: true });
    for (const binary of COMPANION_BINARIES) fs.writeFileSync(path.join(releaseDir, binary), binary);
    fs.writeFileSync(path.join(repoRoot, 'docs', 'getting-started.md'), '# Start');

    const result = stageElectronResources({ repoRoot, frontendDir, releaseBinDir: releaseDir, platform: 'linux' });
    assert.equal(result.staged.length, COMPANION_BINARIES.length);
    for (const binary of COMPANION_BINARIES) assert.equal(fs.readFileSync(path.join(frontendDir, 'dist', binary), 'utf8'), binary);
    assert.equal(fs.readFileSync(path.join(frontendDir, 'dist', 'GETTING_STARTED.md'), 'utf8'), '# Start');
    fs.rmSync(repoRoot, { recursive: true, force: true });
});

test('fails packaging when a companion binary is missing', () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zorai-stage-'));
    const frontendDir = path.join(repoRoot, 'frontend');
    const releaseDir = path.join(repoRoot, 'custom-release');
    fs.mkdirSync(frontendDir, { recursive: true });
    fs.mkdirSync(releaseDir, { recursive: true });
    for (const binary of COMPANION_BINARIES.slice(0, -1)) fs.writeFileSync(path.join(releaseDir, binary), binary);
    assert.throws(
        () => stageElectronResources({ repoRoot, frontendDir, releaseBinDir: releaseDir, platform: 'linux' }),
        /missing companion binaries: zorai-gateway/,
    );
    fs.rmSync(repoRoot, { recursive: true, force: true });
});
