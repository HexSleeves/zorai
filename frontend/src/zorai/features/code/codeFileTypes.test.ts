import { describe, expect, it } from "vitest";
import { fileTypeForPath } from "./codeFileTypes";

describe("Code file types", () => {
  it.each([
    ["app.tsx", "react"], ["app.jsx", "react"], ["main.ts", "typescript"], ["index.js", "javascript"],
    ["theme.css", "css"], ["theme.scss", "sass"], ["page.html", "html"], ["main.rs", "rust"],
    ["main.py", "python"], ["main.go", "go"], ["Main.java", "java"], ["data.json", "json"],
    ["Dockerfile", "docker"], ["package.json", "node"], ["Cargo.toml", "rust"], [".gitignore", "git"],
  ])("classifies %s as %s", (path, expected) => expect(fileTypeForPath(path).id).toBe(expected));

  it("falls back to a neutral file icon", () => {
    expect(fileTypeForPath("unknown.blob").id).toBe("file");
  });
});
