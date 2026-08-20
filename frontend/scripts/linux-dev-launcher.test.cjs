const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
    createLinuxDesktopEntry,
    installLinuxDevLauncher,
    resolveLinuxDevLauncherPaths,
} = require("./linux-dev-launcher.cjs");

test("Linux dev launcher matches the Electron window identity", () => {
    const paths = resolveLinuxDevLauncherPaths({
        frontendDir: "/repo/frontend",
        homeDir: "/home/dev",
    });

    assert.deepEqual(paths, {
        desktopFile: "/home/dev/.local/share/applications/zorai-development.desktop",
        packagedDesktopFile: "/home/dev/.local/share/applications/zorai.desktop",
        electronBinary: "/repo/frontend/node_modules/electron/dist/electron",
        icon: "/repo/frontend/assets/icon.png",
    });

    const entry = createLinuxDesktopEntry({
        ...paths,
        frontendDir: "/repo/frontend",
    });

    assert.match(entry, /^\[Desktop Entry\]$/m);
    assert.match(entry, /^Name=Zorai \(Development\)$/m);
    assert.match(entry, /^Icon=\/repo\/frontend\/assets\/icon\.png$/m);
    assert.match(entry, /^StartupWMClass=zorai$/m);
    assert.match(entry, /^Exec="\/repo\/frontend\/node_modules\/electron\/dist\/electron" "\/repo\/frontend"$/m);
    assert.match(entry, /^NoDisplay=true$/m);
});

test("Linux dev launcher quotes Exec arguments so spaces survive parsing", () => {
    // Why: desktop files unescape \s to a space before splitting Exec. A path
    // encoded with \s is then extra argv, not one command and one app directory.
    const entry = createLinuxDesktopEntry({
        desktopFile: "/tmp/zorai-development.desktop",
        electronBinary: "/repo/Electron Dev/electron",
        frontendDir: "/repo/Zorai Dev",
        icon: "/repo/Zorai Dev/icon.png",
    });

    assert.match(entry, /^Icon=\/repo\/Zorai\\sDev\/icon\.png$/m);
    assert.match(entry, /^Exec="\/repo\/Electron Dev\/electron" "\/repo\/Zorai Dev"$/m);
    assert.doesNotMatch(entry, /Exec=.*\\s/);
});

test("install writes a development-specific desktop id and leaves packaged zorai.desktop alone", () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "zorai-launcher-"));
    const frontendDir = path.join(homeDir, "frontend");
    const icon = path.join(frontendDir, "assets", "icon.png");
    const applicationsDir = path.join(homeDir, ".local", "share", "applications");
    const packagedDesktopFile = path.join(applicationsDir, "zorai.desktop");
    const packagedEntry = "[Desktop Entry]\nName=zorai\nExec=/usr/bin/zorai\n";

    fs.mkdirSync(path.dirname(icon), { recursive: true });
    fs.writeFileSync(icon, "png");
    fs.mkdirSync(applicationsDir, { recursive: true });
    fs.writeFileSync(packagedDesktopFile, packagedEntry);

    const desktopFile = installLinuxDevLauncher({
        force: true,
        homeDir,
        frontendDir,
        electronBinary: "/usr/bin/electron",
    });

    assert.equal(desktopFile, path.join(applicationsDir, "zorai-development.desktop"));
    assert.equal(fs.readFileSync(packagedDesktopFile, "utf8"), packagedEntry);
    assert.match(fs.readFileSync(desktopFile, "utf8"), /^Name=Zorai \(Development\)$/m);
});

test("install removes a leftover development entry that was written as zorai.desktop", () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "zorai-launcher-"));
    const frontendDir = path.join(homeDir, "frontend");
    const icon = path.join(frontendDir, "assets", "icon.png");
    const applicationsDir = path.join(homeDir, ".local", "share", "applications");
    const packagedDesktopFile = path.join(applicationsDir, "zorai.desktop");

    fs.mkdirSync(path.dirname(icon), { recursive: true });
    fs.writeFileSync(icon, "png");
    fs.mkdirSync(applicationsDir, { recursive: true });
    fs.writeFileSync(packagedDesktopFile, [
        "[Desktop Entry]",
        "Name=Zorai (Development)",
        "Exec=/repo/frontend/node_modules/electron/dist/electron /repo/frontend",
        "NoDisplay=true",
        "",
    ].join("\n"));

    installLinuxDevLauncher({
        force: true,
        homeDir,
        frontendDir,
        electronBinary: "/usr/bin/electron",
    });

    assert.equal(fs.existsSync(packagedDesktopFile), false);
    assert.equal(fs.existsSync(path.join(applicationsDir, "zorai-development.desktop")), true);
});
