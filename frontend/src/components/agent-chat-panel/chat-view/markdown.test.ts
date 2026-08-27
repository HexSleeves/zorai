import { describe, expect, it } from "vitest";
import { KATEX_DELIMITERS, markdownRenderMode, protectLatexDelimiters } from "./markdown";

describe("markdownRenderMode", () => {
  it("skips markdown while streaming so each token does not re-parse the whole bubble", () => {
    expect(markdownRenderMode(true)).toBe("plain");
    expect(markdownRenderMode(false)).toBe("markdown");
    expect(markdownRenderMode(undefined)).toBe("markdown");
  });
});

describe("protectLatexDelimiters", () => {
  it("protects model-style delimiters without converting them to dollar syntax", () => {
    const protectedText = protectLatexDelimiters("Inline \\(x^2\\) and display:\n\\[x+y=z\\]");
    expect(protectedText).not.toContain("\\(");
    expect(protectedText).not.toContain("\\[");
    expect(protectedText).not.toContain("$");
    expect(protectedText).toContain("x^2");
    expect(protectedText).toContain("x+y=z");
  });

  it("does not alter inline code or fenced code blocks", () => {
    const source = [
      "Use `\\(literal\\)` then \\(rendered\\).",
      "```tex",
      "\\[literal\\]",
      "```",
      "\\[rendered\\]",
    ].join("\n");
    const protectedText = protectLatexDelimiters(source);
    expect(protectedText).toContain("`\\(literal\\)`");
    expect(protectedText).toContain("```tex\n\\[literal\\]\n```");
    expect(protectedText).not.toContain("then \\(rendered\\)");
    expect(protectedText).not.toContain("```\n\\[rendered\\]");
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
