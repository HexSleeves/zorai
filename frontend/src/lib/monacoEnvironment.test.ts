import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("bundled Monaco syntax tokenizers", () => {
  it("bundles both the CSS language service and its Monarch syntax grammar", () => {
    const sourcePath = fileURLToPath(new URL("./monacoEnvironment.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain('monaco-editor/esm/vs/language/css/monaco.contribution');
    expect(source).toContain('monaco-editor/esm/vs/basic-languages/css/css.contribution');
    expect(source).toContain('monaco-editor/esm/vs/basic-languages/scss/scss.contribution');
    expect(source).toContain('monaco-editor/esm/vs/basic-languages/less/less.contribution');
  });
});
