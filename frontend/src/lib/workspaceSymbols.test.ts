import { describe, expect, it } from "vitest";
import { extractWorkspaceSymbols } from "./workspaceSymbols";

describe("extractWorkspaceSymbols", () => {
  it("extracts common Rust, TypeScript, Python, and Go symbols with positions", () => {
    const symbols = extractWorkspaceSymbols([
      "pub struct Forge {}",
      "export interface WorkspaceApi {}",
      "export const openFile = async () => true;",
      "def train_model(data):",
      "func (s *Server) Listen() {}",
    ].join("\n"));
    expect(symbols.map(({ name, kind, line }) => ({ name, kind, line }))).toEqual([
      { name: "Forge", kind: "struct", line: 1 },
      { name: "WorkspaceApi", kind: "interface", line: 2 },
      { name: "openFile", kind: "function", line: 3 },
      { name: "train_model", kind: "function", line: 4 },
      { name: "Listen", kind: "function", line: 5 },
    ]);
  });

  it("respects the symbol limit", () => {
    expect(extractWorkspaceSymbols("fn one() {}\nfn two() {}", 1)).toHaveLength(1);
  });
});
