const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function escapeDesktopEntryValue(value) {
    return String(value)
        .replaceAll("\\", "\\\\")
        .replaceAll("\n", "\\n")
        .replaceAll("\r", "\\r")
        .replaceAll("\t", "\\t")
        .replaceAll(" ", "\\s");
}

function resolveLinuxDevLauncherPaths(options = {}) {
    const frontendDir = path.resolve(options.frontendDir || path.join(__dirname, ".."));
    const homeDir = options.homeDir || os.homedir();
    return {
        desktopFile: path.join(homeDir, ".local", "share", "applications", "zorai.desktop"),
        electronBinary: options.electronBinary || path.join(frontendDir, "node_modules", "electron", "dist", "electron"),
        icon: path.join(frontendDir, "assets", "icon.png"),
    };
}

function createLinuxDesktopEntry(options) {
    const electronBinary = escapeDesktopEntryValue(options.electronBinary);
    const frontendDir = escapeDesktopEntryValue(options.frontendDir);
    const icon = escapeDesktopEntryValue(options.icon);
    return [
        "[Desktop Entry]",
        "Name=Zorai (Development)",
        "Comment=Zorai Electron development application",
        `Exec=${electronBinary} ${frontendDir}`,
        `Icon=${icon}`,
        "Terminal=false",
        "Type=Application",
        "StartupWMClass=zorai",
        "Categories=Development;",
        "NoDisplay=true",
        "",
    ].join("\n");
}

function installLinuxDevLauncher(options = {}) {
    if (process.platform !== "linux" && !options.force) return null;
    const frontendDir = path.resolve(options.frontendDir || path.join(__dirname, ".."));
    const paths = resolveLinuxDevLauncherPaths({ ...options, frontendDir });
    if (!fs.existsSync(paths.icon)) {
        throw new Error(`Zorai development icon does not exist: ${paths.icon}`);
    }
    const entry = createLinuxDesktopEntry({ ...paths, frontendDir });
    fs.mkdirSync(path.dirname(paths.desktopFile), { recursive: true });
    if (!fs.existsSync(paths.desktopFile) || fs.readFileSync(paths.desktopFile, "utf8") !== entry) {
        fs.writeFileSync(paths.desktopFile, entry, { encoding: "utf8", mode: 0o644 });
    }
    return paths.desktopFile;
}

module.exports = {
    createLinuxDesktopEntry,
    escapeDesktopEntryValue,
    installLinuxDevLauncher,
    resolveLinuxDevLauncherPaths,
};
