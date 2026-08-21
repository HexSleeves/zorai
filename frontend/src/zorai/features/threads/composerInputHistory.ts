import { type KeyboardEvent } from "react";

export type ComposerInputHistoryState = {
  entries: string[];
  cursor: number | null;
};

export type ComposerHistoryBrowseResult = {
  state: ComposerInputHistoryState;
  input: string;
  applied: boolean;
};

export function createComposerInputHistory(): ComposerInputHistoryState {
  return { entries: [], cursor: null };
}

export function rememberSubmittedPrompt(
  state: ComposerInputHistoryState,
  prompt: string,
): ComposerInputHistoryState {
  if (!prompt.trim()) return { ...state, cursor: null };
  return { entries: [...state.entries, prompt], cursor: null };
}

export function commitHistorySelection(
  state: ComposerInputHistoryState,
): ComposerInputHistoryState {
  return { ...state, cursor: null };
}

export function canBrowseSentHistory(
  state: ComposerInputHistoryState,
  input: string,
): boolean {
  return state.cursor !== null || input.length === 0;
}

export function browseHistoryPrevious(
  state: ComposerInputHistoryState,
  input: string,
): ComposerHistoryBrowseResult {
  if (state.entries.length === 0 || !canBrowseSentHistory(state, input)) {
    return { state, input, applied: false };
  }

  const nextCursor = state.cursor === null
    ? state.entries.length - 1
    : Math.max(0, state.cursor - 1);
  return {
    state: { ...state, cursor: nextCursor },
    input: state.entries[nextCursor] ?? "",
    applied: true,
  };
}

export function browseHistoryNext(
  state: ComposerInputHistoryState,
  input: string,
): ComposerHistoryBrowseResult {
  if (state.cursor === null) {
    return { state, input, applied: false };
  }

  const nextCursor = state.cursor + 1;
  if (nextCursor >= state.entries.length) {
    return {
      state: { ...state, cursor: state.entries.length },
      input: "",
      applied: true,
    };
  }
  return {
    state: { ...state, cursor: nextCursor },
    input: state.entries[nextCursor] ?? "",
    applied: true,
  };
}

export function composerHistoryKeyAction(event: {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
}): "previous" | "next" | "commit" | "none" {
  if (event.isComposing) return "none";
  const modified = event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
  if (!modified && event.key === "ArrowUp") return "previous";
  if (!modified && event.key === "ArrowDown") return "next";
  if (event.key === "Shift" || event.key === "Control" || event.key === "Alt" || event.key === "Meta") {
    return "none";
  }
  return "commit";
}

let sessionHistory = createComposerInputHistory();

export function resetComposerInputHistoryForTest(): void {
  sessionHistory = createComposerInputHistory();
}

export function useComposerInputHistory(
  input: string,
  setInput: (value: string) => void,
  inputRef: { current: HTMLTextAreaElement | null },
) {
  const remember = (prompt: string) => {
    sessionHistory = rememberSubmittedPrompt(sessionHistory, prompt);
  };

  const commit = () => {
    sessionHistory = commitHistorySelection(sessionHistory);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const action = composerHistoryKeyAction({
      key: event.key,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      isComposing: event.nativeEvent.isComposing,
    });
    if (action === "previous" || action === "next") {
      const result = action === "previous"
        ? browseHistoryPrevious(sessionHistory, input)
        : browseHistoryNext(sessionHistory, input);
      if (result.applied) {
        event.preventDefault();
        sessionHistory = result.state;
        setInput(result.input);
        requestAnimationFrame(() => {
          const el = inputRef.current;
          if (!el) return;
          el.setSelectionRange(result.input.length, result.input.length);
        });
      }
      return true;
    }
    if (action === "commit") commit();
    return false;
  };

  return { remember, commit, handleKeyDown };
}

