import { describe, expect, it } from "vitest";
import { activateEditorTab, closeEditorTab, createFileTab, createSettingsTab, type CodeEditorTab } from "./codeEditorTabs";

const files = (): CodeEditorTab[] => [createFileTab("src/a.ts", true), createFileTab("src/b.ts", false)];

describe("Code editor special tabs", () => {
  it("creates at most one settings tab and keeps file paths typed separately", () => {
    const first = createSettingsTab(files());
    const second = createSettingsTab(first.tabs);
    expect(second.tabs.filter((tab) => tab.kind === "settings")).toHaveLength(1);
    expect(second.activeTabId).toBe("code-settings");
  });

  it("does not turn settings into an active filesystem path", () => {
    const result = activateEditorTab(createSettingsTab(files()).tabs, "code-settings");
    expect(result.activeFilePath).toBeNull();
  });

  it("restores the previous file after closing settings", () => {
    const opened = createSettingsTab(files(), "file:src/a.ts");
    const closed = closeEditorTab(opened.tabs, "code-settings", opened.previousFileTabId);
    expect(closed.activeTabId).toBe("file:src/a.ts");
  });

  it("can pin the settings tab without filesystem side effects", () => {
    const settings = createSettingsTab(files()).tabs.find((tab) => tab.kind === "settings");
    expect(settings).toEqual({ kind: "settings", id: "code-settings", label: "Code Settings", pinned: false });
  });
});
