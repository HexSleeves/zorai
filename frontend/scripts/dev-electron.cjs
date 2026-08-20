const { spawn } = require("node:child_process");
const path = require("node:path");
const { installLinuxDevLauncher } = require("./linux-dev-launcher.cjs");

const frontendDir = path.join(__dirname, "..");
const electronBinary = require("electron");

try {
    installLinuxDevLauncher({ electronBinary, frontendDir });
} catch (error) {
    console.error("[zorai] Failed to install the Linux development launcher:", error?.message || String(error));
    process.exit(1);
}

const child = spawn(electronBinary, ["."], {
    cwd: frontendDir,
    stdio: "inherit",
    env: {
        ...process.env,
        ZORAI_ELECTRON_USE_DIST_IN_DEV: "1",
    },
});

child.on("error", (error) => {
    console.error("[zorai] Failed to launch Electron:", error?.message || String(error));
    process.exit(1);
});

child.on("exit", (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }
    process.exit(code ?? 0);
});
