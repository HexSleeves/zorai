import { afterEach, describe, expect, it } from "vitest";
import {
  composerDraftIsImageCommand,
  readComposerDraftInput,
  resetComposerDraftStoreForTest,
  useComposerDraftStore,
  writeComposerDraftInput,
} from "./composerDraftStore";

describe("composer draft store", () => {
  afterEach(() => {
    resetComposerDraftStoreForTest();
  });

  it("keeps draft text outside React panel state so typing can skip thread rerenders", () => {
    writeComposerDraftInput("hello");
    expect(readComposerDraftInput()).toBe("hello");

    writeComposerDraftInput((current) => `${current} world`);
    expect(useComposerDraftStore.getState().input).toBe("hello world");
  });

  it("treats /image as a command without depending on every later character", () => {
    expect(composerDraftIsImageCommand("hello")).toBe(false);
    expect(composerDraftIsImageCommand("/image")).toBe(true);
    expect(composerDraftIsImageCommand("/image forest")).toBe(true);
    expect(composerDraftIsImageCommand(" /image forest")).toBe(true);
  });
});
