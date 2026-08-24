import { describe, expect, it } from "vitest";
import { exceedsCodeFileLimit } from "./CodeLargeFileGate";

describe("large file gate", () => {
  it("uses a 5 MB boundary without rejecting exactly-at-limit files", () => {
    expect(exceedsCodeFileLimit(5 * 1024 * 1024, 5)).toBe(false);
    expect(exceedsCodeFileLimit(5 * 1024 * 1024 + 1, 5)).toBe(true);
  });
  it("normalizes configured limits into 1–100 MB", () => {
    expect(exceedsCodeFileLimit(1024 * 1024 + 1, 0)).toBe(true);
    expect(exceedsCodeFileLimit(100 * 1024 * 1024, 900)).toBe(false);
  });
});
