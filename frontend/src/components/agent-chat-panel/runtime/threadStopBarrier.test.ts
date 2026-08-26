import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginThreadStopBarrier,
  completeThreadStopBarrier,
  hasThreadStopBarrier,
  resetThreadStopBarriersForTest,
  waitForThreadStopBarrier,
} from "./threadStopBarrier";

describe("threadStopBarrier", () => {
  afterEach(() => {
    vi.useRealTimers();
    resetThreadStopBarriersForTest();
  });

  it("keeps the next turn blocked until interruption completes", async () => {
    beginThreadStopBarrier("local-1");
    let resumed = false;
    const waiting = waitForThreadStopBarrier("local-1").then(() => {
      resumed = true;
    });

    await Promise.resolve();
    expect(resumed).toBe(false);
    expect(hasThreadStopBarrier("local-1")).toBe(true);

    completeThreadStopBarrier("local-1");
    await waiting;
    expect(resumed).toBe(true);
    expect(hasThreadStopBarrier("local-1")).toBe(false);
  });

  it("times out instead of permanently blocking a new turn", async () => {
    vi.useFakeTimers();
    beginThreadStopBarrier("local-1", 50);
    const waiting = waitForThreadStopBarrier("local-1");

    await vi.advanceTimersByTimeAsync(50);
    await waiting;
    expect(hasThreadStopBarrier("local-1")).toBe(false);
  });
});
