const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PACKAGED_DESKTOP_FILE = "zorai.desktop";
const DEVELOPMENT_DESKTOP_FILE = "zorai-development.desktop";

function escapeDesktopString(value) {
    return String(value)
        .replaceAll("\\", "\\\\")
        .replaceAll("\n", "\\n")
        .replaceAll("\r", "\\r")
        .replaceAll("\t", "\\t");
}

function escapeDesktopEntryValue(value) {
    return escapeDesktopString(value).replaceAll(" ", "\\s");
}

function quoteDesktopExecArgument(value) {
    const escaped = String(value)
        .replaceAll("\\", "\\\\")
        .replaceAll("\"", "\\\"")
        .replaceAll("`", "\\`")
        .replaceAll("$", "\\$");
    return `"${escaped}"`;
}

function formatDesktopExec(argv) {
    return escapeDesktopString(argv.map(quoteDesktopExecArgument).join(" "));
}

function resolveLinuxDevLauncherPaths(options = {}) {
    const frontendDir = path.resolve(options.frontendDir || path.join(__dirname, ".."));
    const homeDir = options.homeDir || os.homedir();
    return {
        desktopFile: path.join(homeDir, ".local", "share", "applications", DEVELOPMENT_DESKTOP_FILE),
        packagedDesktopFile: path.join(homeDir, ".local", "share", "applications", PACKAGED_DESKTOP_FILE),
        electronBinary: options.electronBinary || path.join(frontendDir, "node_modules", "electron", "dist", "electron"),
        icon: path.join(frontendDir, "assets", "icon.png"),
    };
}

function createLinuxDesktopEntry(options) {
    const exec = formatDesktopExec([options.electronBinary, options.frontendDir]);
    const icon = escapeDesktopEntryValue(options.icon);
    return [
        "[Desktop Entry]",
        "Name=Zorai (Development)",
        "Comment=Zorai Electron development application",
        `Exec=${exec}`,
        `Icon=${icon}`,
        "Terminal=false",
        "Type=Application",
        "StartupWMClass=zorai",
        "Categories=Development;",
        "NoDisplay=true",
        "",
    ].join("\n");
}

function isDevelopmentDesktopEntry(contents) {
    return contents.includes("Name=Zorai (Development)");
}

function removeShadowingDevelopmentLauncher(packagedDesktopFile) {
    if (!fs.existsSync(packagedDesktopFile)) return;
    const contents = fs.readFileSync(packagedDesktopFile, "utf8");
    if (!isDevelopmentDesktopEntry(contents)) return;
    fs.unlinkSync(packagedDesktopFile);
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
    removeShadowingDevelopmentLauncher(paths.packagedDesktopFile);
    return paths.desktopFile;
}

module.exports = {
    createLinuxDesktopEntry,
    escapeDesktopEntryValue,
    installLinuxDevLauncher,
    resolveLinuxDevLauncherPaths,
};
