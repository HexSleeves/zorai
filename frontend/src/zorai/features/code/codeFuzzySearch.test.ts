import { describe, expect, it } from "vitest";
import { parseQuickOpenQuery, rankFuzzyItems } from "./codeFuzzySearch";

describe("Code fuzzy search", () => {
  it("parses path line and column suffix", () => {
    expect(parseQuickOpenQuery("src/App.tsx:42:7")).toEqual({ query: "src/App.tsx", line: 42, column: 7 });
    expect(parseQuickOpenQuery("README.md")).toEqual({ query: "README.md", line: null, column: null });
  });

  it("ranks exact, prefix, recent and open matches", () => {
    const result = rankFuzzyItems("app", [
      { id: "a", label: "src/application.ts", searchText: "src/application.ts", recent: false, open: false },
      { id: "b", label: "App.tsx", searchText: "src/App.tsx", recent: true, open: true },
      { id: "c", label: "mapping.ts", searchText: "src/mapping.ts", recent: false, open: false },
    ]);
    expect(result.map((item) => item.id)).toEqual(["b", "a", "c"]);
  });
});
