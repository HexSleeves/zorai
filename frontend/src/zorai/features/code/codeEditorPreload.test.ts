import { describe, expect, it, vi } from "vitest";
import { createCodeEditorPreloader } from "./codeEditorPreload";

describe("code editor preloader", () => {
  it("deduplicates concurrent preload callers", async () => {
    let resolve!: () => void;
    const load = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    const preloader = createCodeEditorPreloader(load);
    const first = preloader.preload();
    const second = preloader.preload();
    expect(first).toBe(second);
    expect(load).toHaveBeenCalledTimes(1);
    resolve();
    await first;
    expect(preloader.state()).toBe("ready");
  });

  it("allows retry after failure", async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error("failed"))
      .mockResolvedValueOnce(undefined);
    const preloader = createCodeEditorPreloader(load);
    await expect(preloader.preload()).rejects.toThrow("failed");
    expect(preloader.state()).toBe("failed");
    await expect(preloader.preload()).resolves.toBeUndefined();
    expect(load).toHaveBeenCalledTimes(2);
    expect(preloader.state()).toBe("ready");
  });
});
