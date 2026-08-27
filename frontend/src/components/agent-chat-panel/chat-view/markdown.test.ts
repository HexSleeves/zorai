import { describe, expect, it } from "vitest";
import { KATEX_DELIMITERS, markdownRenderMode, normalizeLatexDelimiters } from "./markdown";

describe("markdownRenderMode", () => {
  it("skips markdown while streaming so each token does not re-parse the whole bubble", () => {
    expect(markdownRenderMode(true)).toBe("plain");
    expect(markdownRenderMode(false)).toBe("markdown");
    expect(markdownRenderMode(undefined)).toBe("markdown");
  });
});

describe("normalizeLatexDelimiters", () => {
  it("normalizes model-style inline and display delimiters", () => {
    expect(normalizeLatexDelimiters("Inline \\(x^2\\) and display:\n\\[x+y=z\\]"))
      .toBe("Inline $x^2$ and display:\n$$x+y=z$$");
  });

  it("does not alter inline code or fenced code blocks", () => {
    const source = [
      "Use `\\(literal\\)` then \\(rendered\\).",
      "```tex",
      "\\[literal\\]",
      "```",
      "\\[rendered\\]",
    ].join("\n");
    expect(normalizeLatexDelimiters(source)).toBe([
      "Use `\\(literal\\)` then $rendered$.",
      "```tex",
      "\\[literal\\]",
      "```",
      "$$rendered$$",
    ].join("\n"));
  });
});

describe("KaTeX delimiters", () => {
  it("supports common model-generated inline and display LaTeX forms", () => {
    expect(KATEX_DELIMITERS).toEqual(expect.arrayContaining([
      { left: "$", right: "$", display: false },
      { left: "$$", right: "$$", display: true },
      { left: "\\(", right: "\\)", display: false },
      { left: "\\[", right: "\\]", display: true },
      { left: "\\begin{align}", right: "\\end{align}", display: true },
      { left: "\\begin{align*}", right: "\\end{align*}", display: true },
    ]));
  });

  it("checks double-dollar display math before single-dollar inline math", () => {
    const displayIndex = KATEX_DELIMITERS.findIndex(({ left }) => left === "$$");
    const inlineIndex = KATEX_DELIMITERS.findIndex(({ left }) => left === "$");
    expect(displayIndex).toBeGreaterThanOrEqual(0);
    expect(inlineIndex).toBeGreaterThan(displayIndex);
  });
});
