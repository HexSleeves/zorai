import { describe, expect, it } from "vitest";
import { languageForWorkspacePath } from "./codeLanguages";

describe("workspace language coverage", () => {
  it.each([
    ["a.tsx", "typescript"], ["a.jsx", "javascript"], ["a.mts", "typescript"], ["a.cjs", "javascript"],
    ["a.css", "css"], ["a.scss", "scss"], ["a.less", "less"], ["a.vue", "html"], ["a.svelte", "html"],
    ["a.kt", "kotlin"], ["a.swift", "swift"], ["a.rb", "ruby"], ["a.php", "php"], ["a.cs", "csharp"], ["a.groovy", "java"],
    ["a.proto", "proto"], ["a.graphql", "graphql"], ["a.tf", "hcl"], ["a.toml", "ini"], ["a.zig", "cpp"], ["Dockerfile", "dockerfile"],
    ["settings.jsonc", "json"], ["tsconfig.json", "json"], ["deno.jsonc", "json"], ["Containerfile", "dockerfile"],
    ["GNUmakefile", "shell"], [".bashrc", "shell"], [".editorconfig", "ini"], ["vite.config.ts", "typescript"],
    ["eslint.config.mjs", "javascript"],
  ])("maps %s to %s", (path, language) => expect(languageForWorkspacePath(path)).toBe(language));

  it("falls back to plaintext for unknown file types", () => {
    expect(languageForWorkspacePath("README.unknown-format")).toBe("plaintext");
  });

  it("maps JSON-with-comments files to Monaco's registered JSON mode", () => {
    expect(languageForWorkspacePath("packages/app/tsconfig.json")).toBe("json");
    expect(languageForWorkspacePath("tools/deno/deno.jsonc")).toBe("json");
    expect(languageForWorkspacePath(".prettierrc")).toBe("json");
    expect(languageForWorkspacePath("configs/.eslintrc")).toBe("json");
    expect(languageForWorkspacePath("windows\\absolute\\path\\tsconfig.json")).toBe("json");
    expect(languageForWorkspacePath("Docs/SETTINGS.JSON")).toBe("json");
    expect(languageForWorkspacePath("src/vite.config.ts")).toBe("typescript");
  });
});
