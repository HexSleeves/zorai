const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const FRONTEND_DIR = path.join(__dirname, "..");
const BUILD_LINUX_DIR = path.join(FRONTEND_DIR, "build", "linux");
const AFTER_INSTALL = path.join(BUILD_LINUX_DIR, "after-install.sh");
const AFTER_REMOVE = path.join(BUILD_LINUX_DIR, "after-remove.sh");
const PACKAGE_CONFIG = JSON.parse(
    fs.readFileSync(path.join(FRONTEND_DIR, "package.json"), "utf8"),
);
const ELECTRON_BUILDER_MACROS = new Set(["executable", "sanitizedProductName", "productFilename"]);
const MACRO_PATTERN = /\$\{([a-zA-Z]+)\}/g;

function interpolate(source, options) {
    return source.replace(MACRO_PATTERN, (match, name) => {
        if (!(name in options)) {
            throw new Error(`Macro ${name} is not defined`);
        }
        return options[name];
    });
}

function listedMacros(source) {
    return [...source.matchAll(MACRO_PATTERN)].map((match) => match[1]);
}

function renderDebScripts() {
    const options = {
        executable: "zorai",
        sanitizedProductName: "zorai",
        productFilename: "zorai",
    };
    return {
        afterInstall: interpolate(fs.readFileSync(AFTER_INSTALL, "utf8"), options),
        afterRemove: interpolate(fs.readFileSync(AFTER_REMOVE, "utf8"), options),
    };
}

test("deb maintainer scripts are configured on deb, not linux", () => {
    assert.equal(PACKAGE_CONFIG.build?.linux?.afterInstall, undefined);
    assert.equal(PACKAGE_CONFIG.build?.linux?.afterRemove, undefined);
    assert.equal(
        PACKAGE_CONFIG.build?.deb?.afterInstall,
        "build/linux/after-install.sh",
    );
    assert.equal(
        PACKAGE_CONFIG.build?.deb?.afterRemove,
        "build/linux/after-remove.sh",
    );
});

test("electron-builder 25 schema accepts the current build field on every platform", () => {
    const validateSchema = require("@develar/schema-utils");
    const scheme = require("app-builder-lib/scheme.json");
    validateSchema(scheme, PACKAGE_CONFIG.build, {
        name: "electron-builder 25.1.8",
    });
});

test("deb install scripts only use electron-builder linux macros", () => {
    for (const file of [AFTER_INSTALL, AFTER_REMOVE]) {
        for (const name of listedMacros(fs.readFileSync(file, "utf8"))) {
            assert.ok(
                ELECTRON_BUILDER_MACROS.has(name),
                `${path.basename(file)} uses unknown electron-builder macro \${${name}}`,
            );
        }
    }
});

test("deb postinst always sets chrome-sandbox to root-owned setuid 4755", () => {
    const { afterInstall } = renderDebScripts();

    assert.match(afterInstall, /chown root:root "\$SANDBOX"/);
    assert.match(afterInstall, /chmod 4755 "\$SANDBOX"/);
    assert.match(afterInstall, /SANDBOX='\/opt\/zorai\/chrome-sandbox'/);
    assert.doesNotMatch(afterInstall, /chmod 0755/);
    assert.doesNotMatch(afterInstall, /unshare --user/);
});

test("deb postinst installs an Ubuntu userns AppArmor profile for the packaged binary", () => {
    const { afterInstall, afterRemove } = renderDebScripts();

    assert.match(afterInstall, /apparmor_restrict_unprivileged_userns/);
    assert.match(
        afterInstall,
        /profile zorai \/opt\/zorai\/zorai flags=\(unconfined\) \{/,
    );
    assert.match(afterInstall, /^\s+userns,$/m);
    assert.match(afterRemove, /\/etc\/apparmor\.d\/opt\.zorai\.zorai/);
    assert.match(afterRemove, /apparmor_parser -R/);
});
