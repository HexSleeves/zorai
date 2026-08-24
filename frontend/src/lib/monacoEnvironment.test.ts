import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("bundled Monaco syntax tokenizers", () => {
  it("bundles a tokenizer for every Monaco language ID advertised by the workspace", () => {
    const sourcePath = fileURLToPath(new URL("./monacoEnvironment.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain('monaco-editor/esm/vs/language/css/monaco.contribution');
    expect(source).toContain('monaco-editor/esm/vs/basic-languages/css/css.contribution');
    expect(source).toContain('monaco-editor/esm/vs/basic-languages/scss/scss.contribution');
    expect(source).toContain('monaco-editor/esm/vs/basic-languages/less/less.contribution');
    for (const language of [
      "typescript", "javascript", "html", "csharp", "dart", "dockerfile", "elixir", "fsharp",
      "graphql", "hcl", "ini", "kotlin", "lua", "mdx", "objective-c", "perl", "php", "protobuf",
      "r", "ruby", "swift", "xml", "rust", "python", "go", "shell", "yaml", "markdown", "sql", "java", "cpp",
    ]) {
      expect(source).toContain(`monaco-editor/esm/vs/basic-languages/${language}/${language}.contribution`);
    }
  });
});
