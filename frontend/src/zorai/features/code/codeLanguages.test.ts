import { describe, expect, it } from "vitest";
import { languageForWorkspacePath } from "./codeLanguages";

describe("workspace language coverage", () => {
  it.each([
    ["a.tsx", "typescriptreact"], ["a.jsx", "javascriptreact"], ["a.mts", "typescript"], ["a.cjs", "javascript"],
    ["a.css", "css"], ["a.scss", "scss"], ["a.less", "less"], ["a.vue", "vue"], ["a.svelte", "svelte"],
    ["a.kt", "kotlin"], ["a.swift", "swift"], ["a.rb", "ruby"], ["a.php", "php"], ["a.cs", "csharp"],
    ["a.proto", "protobuf"], ["a.graphql", "graphql"], ["a.tf", "terraform"], ["Dockerfile", "dockerfile"],
  ])("maps %s to %s", (path, language) => expect(languageForWorkspacePath(path)).toBe(language));
});
