export type CodeFileTab = { kind: "file"; id: string; path: string; label: string; dirty: boolean; pinned: boolean };
export type CodeSettingsTab = { kind: "settings"; id: "code-settings"; label: "Code Settings"; pinned: boolean };
export type CodeEditorTab = CodeFileTab | CodeSettingsTab;

export function createFileTab(path: string, pinned: boolean, dirty = false): CodeFileTab {
  return { kind: "file", id: `file:${path}`, path, label: path.split(/[\\/]/).pop() ?? path, dirty, pinned };
}

export function createSettingsTab(tabs: CodeEditorTab[], previousActiveTabId?: string | null) {
  const existing = tabs.find((tab) => tab.kind === "settings");
  return {
    tabs: existing ? tabs : [...tabs, { kind: "settings", id: "code-settings", label: "Code Settings", pinned: false }],
    activeTabId: "code-settings" as const,
    previousFileTabId: previousActiveTabId?.startsWith("file:") ? previousActiveTabId : tabs.find((tab) => tab.kind === "file")?.id ?? null,
  };
}

export function activateEditorTab(tabs: CodeEditorTab[], tabId: string) {
  const tab = tabs.find((candidate) => candidate.id === tabId);
  return { activeTabId: tab?.id ?? null, activeFilePath: tab?.kind === "file" ? tab.path : null };
}

export function closeEditorTab(tabs: CodeEditorTab[], tabId: string, previousFileTabId?: string | null) {
  const tab = tabs.find((candidate) => candidate.id === tabId);
  if (tab?.pinned) return { tabs, activeTabId: tabId };
  const remaining = tabs.filter((candidate) => candidate.id !== tabId);
  const remainingFiles = remaining.filter((candidate): candidate is CodeFileTab => candidate.kind === "file");
  const restored = previousFileTabId && remaining.some((candidate) => candidate.id === previousFileTabId)
    ? previousFileTabId
    : remainingFiles[remainingFiles.length - 1]?.id ?? null;
  return { tabs: remaining, activeTabId: restored };
}
