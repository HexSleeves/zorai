const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const frontendDir = path.join(__dirname, "..");
const packageConfig = JSON.parse(
    fs.readFileSync(path.join(frontendDir, "package.json"), "utf8"),
);

function includedBuildFiles() {
    return Array.isArray(packageConfig.build?.files) ? packageConfig.build.files : [];
}

test("Electron packages the runtime window icons", () => {
    const files = includedBuildFiles();

    assert.ok(
        files.includes("assets/icon.png"),
        "Linux BrowserWindow icon must be included in app.asar",
    );
    assert.ok(
        files.includes("assets/icon.ico"),
        "Windows BrowserWindow icon must be included in app.asar",
    );
});

test("configured platform icons exist and are package inputs", () => {
    const files = includedBuildFiles();
    const platformIcons = [
        packageConfig.build?.linux?.icon,
        packageConfig.build?.win?.icon,
        packageConfig.build?.mac?.icon,
    ];

    for (const icon of platformIcons) {
        assert.equal(typeof icon, "string");
        assert.ok(fs.existsSync(path.join(frontendDir, icon)), `${icon} must exist`);
    }

    for (const runtimeIcon of ["assets/icon.png", "assets/icon.ico"]) {
        assert.ok(files.includes(runtimeIcon), `${runtimeIcon} must be packaged for runtime use`);
    }
});
