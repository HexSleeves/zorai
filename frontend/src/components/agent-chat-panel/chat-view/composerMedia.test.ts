import { describe, expect, it } from "vitest";
import { collectClipboardFiles, readSpeechToTextContent, readSpeechToTextError } from "./composerMedia";

describe("speech-to-text result parsing", () => {
  it("reads a daemon plain-text payload that arrives as event data", () => {
    expect(readSpeechToTextContent("hello from mic")).toBe("hello from mic");
    expect(readSpeechToTextContent({ data: "hello from mic" })).toBe("hello from mic");
  });

  it("reads nested JSON transcription objects", () => {
    expect(readSpeechToTextContent({ text: "direct" })).toBe("direct");
    expect(readSpeechToTextContent({ data: { text: "nested" } })).toBe("nested");
    expect(readSpeechToTextContent({ data: { transcript: "legacy" } })).toBe("legacy");
  });

  it("surfaces bridge errors instead of treating them as empty transcripts", () => {
    expect(readSpeechToTextContent({ error: "missing audio" })).toBe("");
    expect(readSpeechToTextError({ error: "missing audio" })).toBe("missing audio");
    expect(readSpeechToTextError({ ok: false, message: "bridge down" })).toBe("bridge down");
  });
});

describe("collectClipboardFiles", () => {
  it("reads screenshot-style clipboard items when files is empty", () => {
    const pasted = new File([new Uint8Array([1, 2, 3])], "", { type: "image/png" });
    const clipboardData = {
      files: [],
      items: [{
        kind: "file",
        type: "image/png",
        getAsFile: () => pasted,
      }],
    } as unknown as DataTransfer;

    const files = collectClipboardFiles(clipboardData);
    expect(files).toHaveLength(1);
    expect(files[0]?.type).toBe("image/png");
    expect(files[0]?.name).toBe("pasted-image-1.png");
  });

  it("prefers DataTransfer.files when Chromium already populated that list", () => {
    const named = new File([new Uint8Array([9])], "shot.png", { type: "image/png" });
    const clipboardData = {
      files: [named],
      items: [{
        kind: "file",
        type: "image/png",
        getAsFile: () => named,
      }],
    } as unknown as DataTransfer;

    const files = collectClipboardFiles(clipboardData);
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe("shot.png");
  });
});
