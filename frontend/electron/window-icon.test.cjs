const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadWindowIcon, resolveWindowFrameOptions, resolveWindowIcon } = require("./main/window-runtime.cjs");

test("Linux windows use the PNG app icon", () => {
    assert.equal(
        resolveWindowIcon({ electronDir: "/repo/frontend/electron", path, platform: "linux" }),
        "/repo/frontend/assets/icon.png",
    );
});

test("Windows windows use the ICO app icon", () => {
    assert.equal(
        resolveWindowIcon({ electronDir: "/repo/frontend/electron", path, platform: "win32" }),
        "/repo/frontend/assets/icon.ico",
    );
});

test("runtime icon is loaded into an Electron NativeImage", () => {
    const loadedImage = { isEmpty: () => false };
    let loadedPath = null;
    const nativeImage = {
        createFromPath(iconPath) {
            loadedPath = iconPath;
            return loadedImage;
        },
    };

    assert.equal(
        loadWindowIcon({
            electronDir: "/repo/frontend/electron",
            nativeImage,
            path,
            platform: "linux",
        }),
        loadedImage,
    );
    assert.equal(loadedPath, "/repo/frontend/assets/icon.png");
});

test("runtime icon loading fails loudly for an empty image", () => {
    assert.throws(
        () => loadWindowIcon({
            electronDir: "/repo/frontend/electron",
            nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
            path,
            platform: "linux",
        }),
        /Failed to load Electron window icon.*icon\.png/,
    );
});

test("Linux windows use native window-manager chrome", () => {
    assert.deepEqual(resolveWindowFrameOptions("linux"), {
        frame: true,
        titleBarStyle: "default",
    });
});

test("Windows keeps its native window frame", () => {
    assert.deepEqual(resolveWindowFrameOptions("win32"), {
        frame: true,
        titleBarStyle: "default",
    });
});

test("macOS preserves its existing hidden title bar", () => {
    assert.deepEqual(resolveWindowFrameOptions("darwin"), {
        frame: false,
        titleBarStyle: "hidden",
    });
});
