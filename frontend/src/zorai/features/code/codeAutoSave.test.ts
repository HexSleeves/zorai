import { describe, expect, it, vi } from "vitest";
import { applyCodeSaveTransforms, createCodeAutoSaveController } from "./codeAutoSave";

describe("Code autosave", () => {
  it("applies whitespace and final-newline transforms deterministically", () => {
    expect(applyCodeSaveTransforms("a  \n b\t", { trimTrailingWhitespace: true, finalNewline: true })).toBe("a\n b\n");
    expect(applyCodeSaveTransforms("a\n", { trimTrailingWhitespace: false, finalNewline: false })).toBe("a\n");
  });

  it("debounces after-delay saves and resets after further edits", () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => true);
    const controller = createCodeAutoSaveController(save);
    controller.schedule("a.ts", 1000);
    vi.advanceTimersByTime(700);
    controller.schedule("a.ts", 1000);
    vi.advanceTimersByTime(999);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("cancels pending saves and isolates timers per document", () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => true);
    const controller = createCodeAutoSaveController(save);
    controller.schedule("a.ts", 100);
    controller.schedule("b.ts", 100);
    controller.cancel("a.ts");
    vi.runAllTimers();
    expect(save).toHaveBeenCalledWith("b.ts");
    expect(save).not.toHaveBeenCalledWith("a.ts");
    vi.useRealTimers();
  });
});
