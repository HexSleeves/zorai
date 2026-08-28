import { describe, expect, it } from "vitest";
import { KATEX_DELIMITERS, markdownRenderMode, protectMathSegments } from "./markdown";

describe("markdownRenderMode", () => {
  it("skips markdown while streaming so each token does not re-parse the whole bubble", () => {
    expect(markdownRenderMode(true)).toBe("plain");
    expect(markdownRenderMode(false)).toBe("markdown");
    expect(markdownRenderMode(undefined)).toBe("markdown");
  });
});

describe("protectMathSegments", () => {
  it("protects the entire multiline formula shown in the GUI regression", () => {
    const formula = [
      "\\[ \\widehat{\\Delta}_{p,c,g}",
      "= \\alpha_c \\Delta^{K562}_{p,g} + \\beta_c + R\\theta(p,c,g) \\]",
    ].join("\n");
    const protectedMath = protectMathSegments(`Baseline:\n\n${formula}\n\nwhere:`);

    expect(protectedMath.segments).toEqual([formula]);
    expect(protectedMath.content).not.toContain("\\widehat");
    expect(protectedMath.content).not.toContain("_{p,c,g}");
    expect(protectedMath.content).toContain("Baseline:");
    expect(protectedMath.content).toContain("where:");
  });

  it("does not extract inline code or fenced code blocks", () => {
    const source = [
      "Use `\\(literal\\)` then \\(rendered\\).",
      "```tex",
      "\\[literal\\]",
      "```",
      "\\[rendered\\]",
    ].join("\n");
    const protectedMath = protectMathSegments(source);
    expect(protectedMath.segments).toEqual(["\\(rendered\\)", "\\[rendered\\]"]);
    expect(protectedMath.content).toContain("`\\(literal\\)`");
    expect(protectedMath.content).toContain("```tex\n\\[literal\\]\n```");
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
