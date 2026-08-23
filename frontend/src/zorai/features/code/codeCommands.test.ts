import { describe, expect, it } from "vitest";
import {
  CODE_COMMANDS,
  codeCommandById,
  codeCommandConflicts,
  displayCodeBinding,
  matchesCodeBinding,
} from "./codeCommands";

const REQUIRED = [
  "file.save", "file.saveAll", "file.reload", "file.quickOpen", "search.file", "search.replace",
  "search.project", "navigation.line", "navigation.definition", "navigation.references",
  "edit.deleteLine", "edit.duplicate", "edit.moveUp", "edit.moveDown", "edit.uppercase", "edit.lowercase",
  "edit.commentLine", "edit.commentBlock", "edit.selectNext", "edit.selectAllOccurrences",
  "edit.formatDocument", "edit.formatSelection", "edit.trimWhitespace", "edit.insertLineAbove",
  "edit.insertLineBelow", "edit.joinLines", "edit.sortAscending", "edit.sortDescending",
  "view.toggleExplorer", "view.toggleAgent", "view.settings", "view.commandPalette",
] as const;

describe("Code command registry", () => {
  it("contains unique ids and the approved command inventory", () => {
    expect(new Set(CODE_COMMANDS.map((command) => command.id)).size).toBe(CODE_COMMANDS.length);
    for (const id of REQUIRED) expect(codeCommandById(id)).toBeDefined();
  });

  it("normalizes CtrlCmd display per platform", () => {
    expect(displayCodeBinding("CtrlCmd+Shift+P", "darwin")).toBe("Cmd+Shift+P");
    expect(displayCodeBinding("CtrlCmd+Shift+P", "linux")).toBe("Ctrl+Shift+P");
  });

  it("matches Code bindings from keyboard events", () => {
    expect(matchesCodeBinding("CtrlCmd+S", { key: "s", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe(true);
    expect(matchesCodeBinding("Shift+Alt+ArrowDown", { key: "ArrowDown", ctrlKey: false, metaKey: false, altKey: true, shiftKey: true })).toBe(true);
  });

  it("reports duplicate active Code bindings", () => {
    expect(codeCommandConflicts({ "file.save": "CtrlCmd+S", "file.reload": "CtrlCmd+S" })).toEqual([
      { binding: "CtrlCmd+S", commandIds: ["file.reload", "file.save"] },
    ]);
  });
});
