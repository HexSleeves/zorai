import { describe, expect, it } from "vitest";
import { languageForWorkspacePath } from "./codeLanguages";

describe("workspace language coverage", () => {
  it.each([
    ["a.tsx", "typescriptreact"], ["a.jsx", "javascriptreact"], ["a.mts", "typescript"], ["a.cjs", "javascript"],
    ["a.css", "css"], ["a.scss", "scss"], ["a.less", "less"], ["a.vue", "vue"], ["a.svelte", "svelte"],
    ["a.kt", "kotlin"], ["a.swift", "swift"], ["a.rb", "ruby"], ["a.php", "php"], ["a.cs", "csharp"],
    ["a.proto", "protobuf"], ["a.graphql", "graphql"], ["a.tf", "terraform"], ["Dockerfile", "dockerfile"],
    ["settings.jsonc", "jsonc"], ["tsconfig.json", "jsonc"], ["deno.jsonc", "jsonc"], ["Containerfile", "dockerfile"],
    ["GNUmakefile", "makefile"], [".bashrc", "shell"], [".editorconfig", "ini"], ["vite.config.ts", "typescript"],
    ["eslint.config.mjs", "javascript"],
  ])("maps %s to %s", (path, language) => expect(languageForWorkspacePath(path)).toBe(language));

  it("falls back to plaintext for unknown file types", () => {
    expect(languageForWorkspacePath("README.unknown-format")).toBe("plaintext");
  });

  it("keeps JSONC mapping for nested and dotted special filenames under directories", () => {
    expect(languageForWorkspacePath("packages/app/tsconfig.json")).toBe("jsonc");
    expect(languageForWorkspacePath("tools/deno/deno.jsonc")).toBe("jsonc");
    expect(languageForWorkspacePath(".prettierrc")).toBe("jsonc");
    expect(languageForWorkspacePath("configs/.eslintrc")).toBe("jsonc");
    expect(languageForWorkspacePath("windows\\absolute\\path\\tsconfig.json")).toBe("jsonc");
    expect(languageForWorkspacePath("Docs/SETTINGS.JSON")).toBe("json");
    expect(languageForWorkspacePath("src/vite.config.ts")).toBe("typescript");
  });
});
