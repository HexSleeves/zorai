import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumeThreadHistoryScroll,
  resetThreadHistoryPagination,
  resetThreadHistoryScrollStateForTest,
  resolveThreadHistoryScrollAction,
  setFollowThreadHistoryBottom,
  shouldFollowThreadHistoryBottom,
  THREAD_HISTORY_OLDER_LOAD_DEBOUNCE_MS,
} from "./threadHistoryScroll";

describe("resolveThreadHistoryScrollAction", () => {
  afterEach(() => {
    resetThreadHistoryScrollStateForTest();
  });

  it("does not load older history or trim when the thread still fits on screen", () => {
    const action = resolveThreadHistoryScrollAction({
      scrollTop: 0,
      scrollHeight: 400,
      clientHeight: 400,
    });

    expect(action).toBe("none");
    expect(shouldFollowThreadHistoryBottom()).toBe(true);
  });

  it("loads older history only when the operator has scrolled away from the latest window", () => {
    const action = resolveThreadHistoryScrollAction({
      scrollTop: 8,
      scrollHeight: 2000,
      clientHeight: 400,
    });

    expect(action).toBe("load-older");
    expect(shouldFollowThreadHistoryBottom()).toBe(false);
  });

  it("returns to bottom-follow mode without trimming loaded history", () => {
    setFollowThreadHistoryBottom(false);

    const action = resolveThreadHistoryScrollAction({
      scrollTop: 1576,
      scrollHeight: 2000,
      clientHeight: 400,
    });

    expect(action).toBe("none");
    expect(shouldFollowThreadHistoryBottom()).toBe(true);
  });
});

describe("consumeThreadHistoryScroll", () => {
  afterEach(() => {
    vi.useRealTimers();
    resetThreadHistoryScrollStateForTest();
  });

  it("never invokes a trim callback when expanded tool content reaches the bottom", () => {
    const trimLatest = vi.fn(() => true);
    const onTrimmed = vi.fn();

    consumeThreadHistoryScroll({
      scroller: makeScroller(9_600, 10_000, 400),
      ...({ trimLatest, onTrimmed } as any),
    });

    expect(trimLatest).not.toHaveBeenCalled();
    expect(onTrimmed).not.toHaveBeenCalled();
    expect(shouldFollowThreadHistoryBottom()).toBe(true);
  });

  it("debounces older loads and ignores extra top events while a fetch is in flight", async () => {
    vi.useFakeTimers();
    const scroller = makeScroller(8);
    let resolveLoad: (value: boolean) => void = () => {};
    const loadOlder = vi.fn(() => new Promise<boolean>((resolve) => {
      resolveLoad = resolve;
    }));

    consumeThreadHistoryScroll({ scroller, loadOlder });
    consumeThreadHistoryScroll({ scroller, loadOlder });
    expect(loadOlder).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(THREAD_HISTORY_OLDER_LOAD_DEBOUNCE_MS);
    expect(loadOlder).toHaveBeenCalledTimes(1);

    consumeThreadHistoryScroll({ scroller, loadOlder });
    await vi.advanceTimersByTimeAsync(THREAD_HISTORY_OLDER_LOAD_DEBOUNCE_MS);
    expect(loadOlder).toHaveBeenCalledTimes(1);

    resolveLoad(true);
    await Promise.resolve();
  });

  it("stops paging once an older fetch finds no new messages until the operator leaves the top", async () => {
    vi.useFakeTimers();
    const scroller = makeScroller(8);
    const loadOlder = vi.fn(async () => false);

    consumeThreadHistoryScroll({ scroller, loadOlder });
    await vi.advanceTimersByTimeAsync(THREAD_HISTORY_OLDER_LOAD_DEBOUNCE_MS);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);

    consumeThreadHistoryScroll({ scroller, loadOlder });
    await vi.advanceTimersByTimeAsync(THREAD_HISTORY_OLDER_LOAD_DEBOUNCE_MS);
    expect(loadOlder).toHaveBeenCalledTimes(1);

    consumeThreadHistoryScroll({ scroller: makeScroller(200), loadOlder });
    consumeThreadHistoryScroll({ scroller, loadOlder });
    await vi.advanceTimersByTimeAsync(THREAD_HISTORY_OLDER_LOAD_DEBOUNCE_MS);
    expect(loadOlder).toHaveBeenCalledTimes(2);
  });

  it("continues paging while prepended tool rows do not move the viewport away from the top", async () => {
    vi.useFakeTimers();
    const scroller = makeScroller(0);
    const loadOlder = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    consumeThreadHistoryScroll({ scroller, loadOlder });
    await vi.advanceTimersByTimeAsync(THREAD_HISTORY_OLDER_LOAD_DEBOUNCE_MS);
    await vi.runAllTimersAsync();

    expect(loadOlder).toHaveBeenCalledTimes(2);
  });

  it("resets exhausted pagination when the active thread changes", async () => {
    vi.useFakeTimers();
    const scroller = makeScroller(8);
    const loadOlder = vi.fn(async () => false);

    consumeThreadHistoryScroll({ scroller, loadOlder });
    await vi.advanceTimersByTimeAsync(THREAD_HISTORY_OLDER_LOAD_DEBOUNCE_MS);
    await Promise.resolve();

    resetThreadHistoryPagination();
    consumeThreadHistoryScroll({ scroller, loadOlder });
    await vi.advanceTimersByTimeAsync(THREAD_HISTORY_OLDER_LOAD_DEBOUNCE_MS);

    expect(loadOlder).toHaveBeenCalledTimes(2);
  });
});

function makeScroller(scrollTop: number, scrollHeight = 2000, clientHeight = 400): HTMLElement {
  return { scrollTop, scrollHeight, clientHeight } as HTMLElement;
}
