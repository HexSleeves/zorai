export type CodeTabDescriptor = {
  path: string;
  label: string;
  dirty: boolean;
  pinned: boolean;
  active: boolean;
};

export function selectVisibleCodeTabs(
  tabs: CodeTabDescriptor[],
  availableWidth: number,
  tabWidth = 150,
  overflowButtonWidth = 36,
): { visible: CodeTabDescriptor[]; hidden: CodeTabDescriptor[] } {
  if (tabs.length === 0) return { visible: [], hidden: [] };
  const capacity = Math.max(1, Math.floor((Math.max(0, availableWidth) - overflowButtonWidth) / tabWidth));
  if (capacity >= tabs.length) return { visible: tabs, hidden: [] };

  const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.active));
  const start = Math.min(Math.max(0, activeIndex - capacity + 1), tabs.length - capacity);
  const visible = tabs.slice(start, start + capacity);
  const visiblePaths = new Set(visible.map((tab) => tab.path));
  return { visible, hidden: tabs.filter((tab) => !visiblePaths.has(tab.path)) };
}

export function shouldConsumeCodeTabWheel(scrollWidth: number, clientWidth: number): boolean {
  return scrollWidth > clientWidth;
}
