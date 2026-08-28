import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { ComposerAttachment } from "./types";
import { blobToBase64, collectClipboardFiles, collectMediaRecorderBlob, mediaRecorderOptions, readComposerAttachment, readSpeechToTextContent, readSpeechToTextError, stopMediaTracks } from "./composerMedia";
import { useAgentStore } from "@/lib/agentStore";
import { applyManagedSecurityLevel, managedSecurityLevels } from "@/zorai/features/threads/threadRuntimeActions";
import { useComposerDraftStore } from "@/zorai/features/threads/composerDraftStore";

function deriveImageComposerState(input: string): { isImageMode: boolean; displayValue: string } {
  const trimmed = input.trimStart();
  if (trimmed === "/image") {
    return { isImageMode: true, displayValue: "" };
  }
  if (trimmed.startsWith("/image ")) {
    return {
      isImageMode: true,
      displayValue: trimmed.slice("/image".length).trimStart(),
    };
  }
  return { isImageMode: false, displayValue: input };
}

export function ChatComposer({
  input: inputProp,
  setInput: setInputProp,
  attachments,
  setAttachments,
  inputRef,
  onKeyDown,
  agentSettings,
  isStreamingResponse,
  isSynthesizingSpeech,
  onStopStreaming,
  onSend,
  canStartGoalRun,
  onStartGoalRun,
  onUpdateReasoningEffort,
}: {
  input?: string;
  setInput?: React.Dispatch<React.SetStateAction<string>>;
  attachments: ComposerAttachment[];
  setAttachments: React.Dispatch<React.SetStateAction<ComposerAttachment[]>>;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onKeyDown: (event: React.KeyboardEvent) => void;
  agentSettings: {
    enabled: boolean;
    chatFontFamily: string;
    reasoning_effort: string;
    audio_stt_enabled: boolean;
    audio_stt_provider: string;
    audio_stt_model: string;
    audio_stt_language: string;
    audio_tts_enabled: boolean;
    audio_tts_provider: string;
    audio_tts_model: string;
    audio_tts_voice: string;
    audio_tts_auto_speak: boolean;
  };
  isStreamingResponse: boolean;
  isSynthesizingSpeech: boolean;
  onStopStreaming: () => void;
  onSend: () => void;
  canStartGoalRun: boolean;
  onStartGoalRun: () => void;
  onUpdateReasoningEffort: (value: string) => void;
}) {
  const storeInput = useComposerDraftStore((state) => state.input);
  const storeSetInput = useComposerDraftStore((state) => state.setInput);
  const input = inputProp ?? storeInput;
  const setInput = setInputProp ?? storeSetInput;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const managedSecurityLevel = useAgentStore((state) => state.agentSettings.managed_security_level);
  const [dropActive, setDropActive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
      stopMediaTracks(mediaStreamRef.current);
      mediaRecorderRef.current = null;
      mediaStreamRef.current = null;
    };
  }, []);

  const appendFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const loaded = await Promise.all(files.map((file) => readComposerAttachment(file)));
    setAttachments((current) => [...current, ...loaded.filter((item): item is ComposerAttachment => Boolean(item))]);
  };

  const handleAttachmentSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    await appendFiles(files);
    event.target.value = "";
  };

  const voiceCaptureAvailable = agentSettings.enabled
    && agentSettings.audio_stt_enabled
    && typeof window !== "undefined"
    && typeof MediaRecorder !== "undefined"
    && !!navigator.mediaDevices?.getUserMedia
    && !!(window.zorai?.agentSpeechToText || window.zorai?.agentSpeechToText);
  const { isImageMode, displayValue } = deriveImageComposerState(input);
  const composerPlaceholder = !agentSettings.enabled
    ? "Agent disabled — enable in Settings > Agent"
    : isImageMode
      ? "Describe the image to generate..."
      : isSynthesizingSpeech
      ? "Preparing speech..."
      : "Type a message... (Enter to send, Ctrl+Enter for newline)";

  const toggleRecording = async () => {
    if (isTranscribing) {
      return;
    }
    const bridge = window.zorai ?? window.zorai;
    if (isRecording) {
      const recorder = mediaRecorderRef.current;
      setIsRecording(false);
      setIsTranscribing(true);
      try {
        const blob = recorder
          ? await collectMediaRecorderBlob(recorder, recordedChunksRef.current)
          : new Blob();
        stopMediaTracks(mediaStreamRef.current);
        mediaRecorderRef.current = null;
        mediaStreamRef.current = null;
        recordedChunksRef.current = [];
        if (blob.size === 0) {
          return;
        }
        const mimeType = blob.type || "audio/webm";
        const base64Audio = await blobToBase64(blob);
        const result = await bridge?.agentSpeechToText?.(base64Audio, mimeType, {
          provider: agentSettings.audio_stt_provider,
          model: agentSettings.audio_stt_model,
          language: agentSettings.audio_stt_language || undefined,
        });
        const error = readSpeechToTextError(result);
        if (error) {
          console.error("speech-to-text failed", error);
          return;
        }
        const transcript = readSpeechToTextContent(result);
        if (transcript) {
          setInput((current) => current.trim() ? `${current.trimEnd()} ${transcript}` : transcript);
        }
      } catch (error) {
        console.error("speech-to-text failed", error);
      } finally {
        setIsTranscribing(false);
      }
      return;
    }
    if (!bridge?.agentSpeechToText || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      recordedChunksRef.current = [];
      const recorder = new MediaRecorder(stream, mediaRecorderOptions());
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };
      recorder.start(200);
      setIsRecording(true);
    } catch (error) {
      console.error("microphone capture failed", error);
      stopMediaTracks(mediaStreamRef.current);
      mediaStreamRef.current = null;
      mediaRecorderRef.current = null;
      setIsRecording(false);
    }
  };

  return (
    <div
      className={dropActive ? "acp-composer acp-composer--drop" : "acp-composer"}
      onDragOver={(event) => {
        if (!agentSettings.enabled) return;
        if (event.dataTransfer?.files?.length) {
          event.preventDefault();
          setDropActive(true);
        }
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(event) => {
        if (!agentSettings.enabled) return;
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length === 0) return;
        event.preventDefault();
        setDropActive(false);
        void appendFiles(files);
      }}
    >
      <div className="acp-composer__input-row">
        <span
          className={isImageMode ? "acp-composer__glyph acp-composer__glyph--image" : "acp-composer__glyph"}
        >
          {isImageMode ? "🖼" : ">"}
        </span>
        <textarea
          ref={inputRef}
          value={displayValue}
          onChange={(event) => {
            if (isImageMode) {
              const nextValue = event.target.value;
              setInput(nextValue.length > 0 ? `/image ${nextValue}` : "");
              return;
            }
            setInput(event.target.value);
          }}
          onPaste={(event) => {
            const files = collectClipboardFiles(event.clipboardData);
            if (files.length > 0) {
              event.preventDefault();
              void appendFiles(files);
            }
          }}
          onKeyDown={onKeyDown}
          rows={3}
          placeholder={composerPlaceholder}
          disabled={!agentSettings.enabled}
          className="acp-composer__textarea"
          style={{ fontFamily: agentSettings.chatFontFamily }}
        />
      </div>

      {attachments.length > 0 && (
        <div className="acp-composer__attachments">
          {attachments.map((attachment) => (
            <div key={attachment.id} className="acp-composer__attachment">
              <span>{attachment.kind === "image" ? "🖼" : attachment.kind === "audio" ? "🔊" : "📄"} {attachment.name}</span>
              <button
                type="button"
                className="acp-composer__attachment-remove"
                onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="acp-composer__footer">
        <div className="acp-composer__controls">
          <div className="acp-composer__effort">
            <span className="acp-composer__effort-label">Reasoning effort</span>
            <select
              value={agentSettings.reasoning_effort}
              onChange={(event) => onUpdateReasoningEffort(event.target.value)}
              title="Reasoning effort"
              className="acp-composer__effort-select"
            >
              <option value="none">off</option>
              <option value="minimal">minimal</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="xhigh">xhigh</option>
              <option value="max">max</option>
            </select>
          </div>
          <div className="acp-composer__effort">
            <span className="acp-composer__effort-label">Mode</span>
            <select
              value={managedSecurityLevel}
              onChange={(event) => {
                void applyManagedSecurityLevel(event.target.value as typeof managedSecurityLevel);
              }}
              title="Managed security mode"
              aria-label="Managed security mode"
              className="acp-composer__effort-select"
            >
              {managedSecurityLevels().map((level) => (
                <option key={level} value={level}>{level}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="acp-composer__actions">
          {voiceCaptureAvailable && (
            <button
              type="button"
              onClick={() => {
                void toggleRecording();
              }}
              disabled={!agentSettings.enabled || isTranscribing}
              className={[
                "acp-btn",
                "acp-composer__btn",
                isRecording ? "acp-composer__btn--recording" : "acp-btn--ghost",
              ].join(" ")}
              title={isRecording ? "Stop recording" : isTranscribing ? "Transcribing..." : "Record voice message"}
            >
              {isRecording ? "Stop" : isTranscribing ? "..." : "Mic"}
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,audio/*,.txt,.md,.markdown,.json,.yaml,.yml,.toml,.ini,.cfg,.conf,.rs,.ts,.tsx,.js,.jsx,.py,.sh,.sql,.csv,.log"
            multiple
            onChange={handleAttachmentSelect}
            className="acp-composer__hidden-input"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!agentSettings.enabled}
            className="acp-btn acp-btn--ghost acp-composer__btn"
          >
            Attach
          </button>
          {canStartGoalRun && (
            <button
              type="button"
              onClick={onStartGoalRun}
              disabled={!agentSettings.enabled || !input.trim()}
              className="acp-btn acp-btn--mission acp-composer__btn"
            >
              Goal Run
            </button>
          )}
          {isStreamingResponse && (
            <button
              type="button"
              onClick={onStopStreaming}
              className="acp-btn acp-btn--danger acp-composer__btn"
            >
              Stop
            </button>
          )}
          <button
            type="button"
            onClick={onSend}
            disabled={!agentSettings.enabled || (!input.trim() && attachments.length === 0)}
            className="acp-btn acp-btn--primary acp-composer__btn"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
