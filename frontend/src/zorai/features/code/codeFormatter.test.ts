import { describe, expect, it } from "vitest";
import { formatCodeText, prettierParserForLanguage } from "./codeFormatter";

describe("Code formatter", () => {
  it("maps supported Monaco languages to Prettier parsers", () => {
    expect(prettierParserForLanguage("typescript")).toBe("typescript");
    expect(prettierParserForLanguage("javascript")).toBe("babel");
    expect(prettierParserForLanguage("json")).toBe("json");
    expect(prettierParserForLanguage("rust")).toBeNull();
  });
  it("formats supported content without mutating input on failure", async () => {
    expect(await formatCodeText("const x={a:1}", "typescript")).toContain("const x = { a: 1 };");
    await expect(formatCodeText("fn main() {}", "rust")).rejects.toThrow("No formatter available");
  });
});
