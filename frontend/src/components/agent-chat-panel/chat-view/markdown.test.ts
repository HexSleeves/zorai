import { describe, expect, it } from "vitest";
import { markdownRenderMode } from "./markdown";

describe("markdownRenderMode", () => {
  it("skips markdown while streaming so each token does not re-parse the whole bubble", () => {
    expect(markdownRenderMode(true)).toBe("plain");
    expect(markdownRenderMode(false)).toBe("markdown");
    expect(markdownRenderMode(undefined)).toBe("markdown");
  });
});
