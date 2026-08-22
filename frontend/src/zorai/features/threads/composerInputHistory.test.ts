import { describe, expect, it } from "vitest";
import {
  browseHistoryNext,
  browseHistoryPrevious,
  commitHistorySelection,
  composerHistoryKeyAction,
  createComposerInputHistory,
  rememberSubmittedPrompt,
} from "./composerInputHistory";

function submit(state: ReturnType<typeof createComposerInputHistory>, prompt: string) {
  return rememberSubmittedPrompt(state, prompt);
}

describe("composer input history", () => {
  it("recalls submitted prompts from an empty composer newest-first, like the TUI", () => {
    let state = createComposerInputHistory();
    state = submit(state, "first prompt");
    state = submit(state, "second prompt");

    let result = browseHistoryPrevious(state, "");
    expect(result.applied).toBe(true);
    expect(result.input).toBe("second prompt");

    result = browseHistoryPrevious(result.state, result.input);
    expect(result.input).toBe("first prompt");

    result = browseHistoryNext(result.state, result.input);
    expect(result.input).toBe("second prompt");

    result = browseHistoryNext(result.state, result.input);
    expect(result.input).toBe("");
  });

  it("does not replace a draft the operator is already typing", () => {
    let state = submit(createComposerInputHistory(), "sent prompt");
    const result = browseHistoryPrevious(state, "draft");

    expect(result.applied).toBe(false);
    expect(result.input).toBe("draft");
  });

  it("treats any non-arrow key as choosing the recalled prompt for normal editing", () => {
    let state = submit(createComposerInputHistory(), "sent prompt");
    const recalled = browseHistoryPrevious(state, "");
    state = commitHistorySelection(recalled.state);

    expect(browseHistoryPrevious(state, recalled.input).applied).toBe(false);
    expect(browseHistoryPrevious(state, recalled.input).input).toBe("sent prompt");
    expect(composerHistoryKeyAction({
      key: "ArrowLeft",
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      isComposing: false,
    })).toBe("commit");
  });

  it("maps unmodified up/down to history browse and ignores modifier-only keys", () => {
    expect(composerHistoryKeyAction({
      key: "ArrowUp",
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      isComposing: false,
    })).toBe("previous");
    expect(composerHistoryKeyAction({
      key: "ArrowDown",
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      isComposing: false,
    })).toBe("next");
    expect(composerHistoryKeyAction({
      key: "Shift",
      shiftKey: true,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      isComposing: false,
    })).toBe("none");
    expect(composerHistoryKeyAction({
      key: "ArrowUp",
      shiftKey: true,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      isComposing: false,
    })).toBe("commit");
  });
});
