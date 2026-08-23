import { describe, expect, it } from "vitest";
import {
  CODE_FILE_OPEN_MARKS,
  createCodeFileOpenTrace,
  percentile,
  summarizeCodeFileOpenDurations,
} from "./codeEditorPerformance";

describe("code editor performance", () => {
  it("defines the approved ordered file-open marks", () => {
    expect(CODE_FILE_OPEN_MARKS).toEqual([
      "start", "tab-active", "ipc-start", "ipc-complete", "model-ready", "paint", "interactive",
    ]);
  });

  it("records ordered marks and derives phase durations without content", () => {
    const trace = createCodeFileOpenTrace({ root: "/work", path: "src/a.ts", cacheHit: false });
    trace.mark("start", 10);
    trace.mark("tab-active", 20);
    trace.mark("ipc-start", 21);
    trace.mark("ipc-complete", 70);
    trace.mark("model-ready", 90);
    trace.mark("paint", 110);
    trace.mark("interactive", 120);
    expect(trace.finish()).toMatchObject({ totalMs: 110, feedbackMs: 10, ipcMs: 49, modelMs: 20, paintMs: 20 });
    expect(JSON.stringify(trace.finish())).not.toContain("content");
  });

  it("keeps only a bounded recent record set", () => {
    for (let index = 0; index < 250; index += 1) {
      const trace = createCodeFileOpenTrace({ root: "/work", path: `${index}.ts`, cacheHit: true });
      trace.mark("start", index);
      trace.mark("interactive", index + 1);
      trace.finish();
    }
    expect(summarizeCodeFileOpenDurations().count).toBeLessThanOrEqual(200);
  });

  it("computes deterministic p50 and p95", () => {
    expect(percentile([1, 2, 3, 4, 100], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4, 100], 0.95)).toBe(100);
  });
});
