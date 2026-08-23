import { describe, expect, it } from "vitest";
import { selectVisibleCodeTabs, shouldConsumeCodeTabWheel, type CodeTabDescriptor } from "./codeTabsModel";

function tabs(count: number, active: number): CodeTabDescriptor[] {
  return Array.from({ length: count }, (_, index) => ({
    path: `/file-${index}.ts`,
    label: `file-${index}.ts`,
    dirty: index === 1,
    pinned: index === 2,
    active: index === active,
  }));
}

describe("Code tabs model", () => {
  it("keeps every tab visible when capacity allows", () => {
    expect(selectVisibleCodeTabs(tabs(3, 1), 900).hidden).toEqual([]);
  });

  it("keeps the active tab visible and exposes the remainder as overflow", () => {
    const result = selectVisibleCodeTabs(tabs(8, 7), 486, 150, 36);
    expect(result.visible).toHaveLength(3);
    expect(result.visible.some((tab) => tab.active)).toBe(true);
    expect(result.hidden).toHaveLength(5);
  });

  it("consumes wheel events only when horizontal overflow exists", () => {
    expect(shouldConsumeCodeTabWheel(800, 500)).toBe(true);
    expect(shouldConsumeCodeTabWheel(500, 500)).toBe(false);
    expect(shouldConsumeCodeTabWheel(400, 500)).toBe(false);
  });
});
