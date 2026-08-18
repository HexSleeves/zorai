import { describe, expect, it } from "vitest";
import { readSpeechToTextContent, readSpeechToTextError } from "./composerMedia";

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
