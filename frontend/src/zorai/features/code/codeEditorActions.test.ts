import { describe, expect, it } from "vitest";
import { transformSelectedText, transformSelectedLines } from "./codeEditorActions";

describe("code editor text transforms", () => {
  it("changes selection case", () => {
    expect(transformSelectedText("Ab c", "uppercase")).toBe("AB C");
    expect(transformSelectedText("Ab C", "lowercase")).toBe("ab c");
  });

  it("sorts selected lines", () => {
    expect(transformSelectedLines("b\na\nc", "ascending")).toBe("a\nb\nc");
    expect(transformSelectedLines("b\na\nc", "descending")).toBe("c\nb\na");
  });

  it("trims trailing whitespace", () => {
    expect(transformSelectedLines("a  \n b\t\n", "trim")).toBe("a\n b\n");
  });
});
