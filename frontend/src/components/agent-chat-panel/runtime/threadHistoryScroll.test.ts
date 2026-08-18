import { afterEach, describe, expect, it } from "vitest";
import {
  resetThreadHistoryScrollStateForTest,
  resolveThreadHistoryScrollAction,
  setFollowThreadHistoryBottom,
  shouldFollowThreadHistoryBottom,
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

  it("collapses to the latest window only after the operator returns to the bottom", () => {
    setFollowThreadHistoryBottom(false);

    const action = resolveThreadHistoryScrollAction({
      scrollTop: 1576,
      scrollHeight: 2000,
      clientHeight: 400,
    });

    expect(action).toBe("trim-latest");
    expect(shouldFollowThreadHistoryBottom()).toBe(true);
  });
});
