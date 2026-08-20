const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
    createLinuxDesktopEntry,
    resolveLinuxDevLauncherPaths,
} = require("./linux-dev-launcher.cjs");

test("Linux dev launcher matches the Electron window identity", () => {
    const paths = resolveLinuxDevLauncherPaths({
        frontendDir: "/repo/frontend",
        homeDir: "/home/dev",
    });

    assert.deepEqual(paths, {
        desktopFile: "/home/dev/.local/share/applications/zorai.desktop",
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
    assert.match(entry, /^Exec=\/repo\/frontend\/node_modules\/electron\/dist\/electron \/repo\/frontend$/m);
    assert.match(entry, /^NoDisplay=true$/m);
});

test("Linux dev launcher escapes reserved desktop-entry characters", () => {
    const entry = createLinuxDesktopEntry({
        desktopFile: "/tmp/zorai.desktop",
        electronBinary: "/repo/Electron Dev/electron",
        frontendDir: "/repo/Zorai Dev",
        icon: "/repo/Zorai Dev/icon.png",
    });

    assert.match(entry, /^Icon=\/repo\/Zorai\\sDev\/icon\.png$/m);
    assert.match(entry, /^Exec=\/repo\/Electron\\sDev\/electron \/repo\/Zorai\\sDev$/m);
});
