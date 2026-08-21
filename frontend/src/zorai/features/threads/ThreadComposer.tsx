import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { useAgentChatPanelRuntime } from "@/components/agent-chat-panel/runtime/context";
import {
  blobToBase64,
  buildAttachmentSendPayload,
  collectMediaRecorderBlob,
  mediaRecorderOptions,
  readComposerAttachment,
  readSpeechToTextContent,
  readSpeechToTextError,
  stopMediaTracks,
} from "@/components/agent-chat-panel/chat-view/composerMedia";
import type { ComposerAttachment } from "@/components/agent-chat-panel/chat-view/types";
import { useAgentStore } from "@/lib/agentStore";
import { useComposerInputHistory } from "./composerInputHistory";
import { applyComposerTextareaSize } from "./composerTextareaSize";
import {
  createQueuedComposerMessage,
  queuedComposerLabel,
  shouldDispatchQueuedFollowUp,
  type QueuedComposerMessage,
} from "./composerQueue";
import { getBridge } from "@/lib/bridge";
import { pushToast } from "@/lib/toastStore";
import { activeThreadBudgetExceededNotice } from "./threadBudgetNotice";

export function ThreadComposer() {
  const runtime = useAgentChatPanelRuntime();
  const agentSettings = useAgentStore((state) => state.agentSettings);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [dropActive, setDropActive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [queuedMessages, setQueuedMessages] = useState<QueuedComposerMessage[]>([]);
  const [sendNowMessage, setSendNowMessage] = useState<QueuedComposerMessage | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const discardCaptureRef = useRef(false);
  const awaitingStreamStartRef = useRef(false);
  const history = useComposerInputHistory(runtime.input, runtime.setInput, runtime.inputRef);
  const budgetNotice = activeThreadBudgetExceededNotice(
    runtime.activeThread?.daemonThreadId,
    runtime.messages,
    runtime.spawnedAgentTree,
  );
  const canSend = Boolean(runtime.input.trim() || attachments.length > 0);
  const ttsAvailable = agentSettings.audio_tts_enabled && Boolean(getBridge()?.agentTextToSpeech);
  const updateAgentSetting = useAgentStore((state) => state.updateAgentSetting);
  const voiceCaptureAvailable = agentSettings.audio_stt_enabled
    && typeof window !== "undefined"
    && typeof MediaRecorder !== "undefined"
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && Boolean(getBridge()?.agentSpeechToText);

  useEffect(() => {
    return () => {
      discardCaptureRef.current = true;
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
      stopMediaTracks(mediaStreamRef.current);
      mediaRecorderRef.current = null;
      mediaStreamRef.current = null;
    };
  }, []);

  useEffect(() => {
    const el = runtime.inputRef.current;
    if (el) applyComposerTextareaSize(el);
  }, [runtime.input]);

  const appendFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const loaded = await Promise.all(files.map((file) => readComposerAttachment(file)));
    setAttachments((current) => [...current, ...loaded.filter((item): item is ComposerAttachment => Boolean(item))]);
  };

  const sendCurrentInput = () => {
    if (budgetNotice || runtime.isStreamingResponse) return;
    const payload = buildAttachmentSendPayload(runtime.input, attachments);
    if (!payload.text && !payload.contentBlocksJson) return;
    history.remember(payload.text);
    runtime.sendMessage(payload);
    runtime.setInput("");
    setAttachments([]);
  };

  const queueCurrentInput = () => {
    if (budgetNotice) return;
    const payload = buildAttachmentSendPayload(runtime.input, attachments);
    if (!payload.text && !payload.contentBlocksJson) return;
    history.remember(payload.text);
    setQueuedMessages((current) => [...current, createQueuedComposerMessage(payload)]);
    runtime.setInput("");
    setAttachments([]);
  };

  const removeQueuedMessage = (index: number) => {
    setQueuedMessages((current) => current.filter((_, i) => i !== index));
  };

  const sendQueuedMessageNow = (index: number) => {
    if (budgetNotice) return;
    const queued = queuedMessages[index];
    if (!queued) return;
    setQueuedMessages((current) => current.filter((_, i) => i !== index));
    if (runtime.isStreamingResponse) {
      setSendNowMessage(queued);
      runtime.stopStreaming(runtime.activeThreadId);
      return;
    }
    awaitingStreamStartRef.current = true;
    runtime.sendMessage(queued);
  };

  useEffect(() => {
    if (budgetNotice) return;
    if (runtime.isStreamingResponse) {
      awaitingStreamStartRef.current = false;
      return;
    }
    if (!shouldDispatchQueuedFollowUp({
      isStreaming: runtime.isStreamingResponse,
      awaitingStreamStart: awaitingStreamStartRef.current,
      hasSendNow: Boolean(sendNowMessage),
      queueLength: queuedMessages.length,
    })) {
      return;
    }
    awaitingStreamStartRef.current = true;
    if (sendNowMessage) {
      const payload = sendNowMessage;
      setSendNowMessage(null);
      runtime.sendMessage(payload);
      return;
    }
    const [next, ...rest] = queuedMessages;
    if (!next) {
      awaitingStreamStartRef.current = false;
      return;
    }
    setQueuedMessages(rest);
    runtime.sendMessage(next);
  }, [budgetNotice, queuedMessages, runtime.isStreamingResponse, runtime.sendMessage, sendNowMessage]);

  // Ctrl+M toggles voice recording from anywhere in the thread surface
  // (including while typing in the textarea — that's where you want it most).
  const toggleRecordingRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!event.ctrlKey || event.shiftKey || event.metaKey || event.altKey) return;
      if (event.code !== "KeyM") return;
      if (!voiceCaptureAvailable) return;
      event.preventDefault();
      void toggleRecordingRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [voiceCaptureAvailable]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (history.handleKeyDown(event)) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (runtime.isStreamingResponse) {
        queueCurrentInput();
      } else {
        sendCurrentInput();
      }
    }
  };

  const toggleRecording = async () => {
    if (isTranscribing) return;
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
        if (discardCaptureRef.current) return;
        if (blob.size === 0) {
          pushToast("No audio captured. Hold Mic a moment longer, then stop.");
          return;
        }
        const bridge = getBridge();
        if (!bridge?.agentSpeechToText) {
          pushToast("Speech-to-text is unavailable.");
          return;
        }
        const mimeType = blob.type || "audio/webm";
        const base64Audio = await blobToBase64(blob);
        const result = await bridge.agentSpeechToText(base64Audio, mimeType, {
          provider: agentSettings.audio_stt_provider,
          model: agentSettings.audio_stt_model,
          language: agentSettings.audio_stt_language || undefined,
        });
        if (discardCaptureRef.current) return;
        const error = readSpeechToTextError(result);
        if (error) {
          pushToast(error);
          return;
        }
        const transcript = readSpeechToTextContent(result);
        if (!transcript) {
          pushToast("Transcription was empty.");
          return;
        }
        runtime.setInput((current) => (current.trim() ? `${current.trimEnd()} ${transcript}` : transcript));
      } catch (error) {
        console.error("speech-to-text failed", error);
        if (!discardCaptureRef.current) {
          pushToast(error instanceof Error ? error.message : "Speech-to-text failed.");
        }
      } finally {
        if (!discardCaptureRef.current) {
          setIsTranscribing(false);
        }
      }
      return;
    }
    const bridge = getBridge();
    if (!bridge?.agentSpeechToText || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      return;
    }
    try {
      discardCaptureRef.current = false;
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
      pushToast(error instanceof Error ? error.message : "Microphone capture failed.");
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDropActive(false);
    void appendFiles(Array.from(event.dataTransfer.files ?? []));
  };

  toggleRecordingRef.current = toggleRecording;

  return (
    <div
      className={["zorai-thread-composer", dropActive ? "zorai-thread-composer--drop" : ""].filter(Boolean).join(" ")}
      onDragOver={(event) => {
        event.preventDefault();
        setDropActive(true);
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={onDrop}
    >
      {attachments.length > 0 ? (
        <div className="zorai-thread-attachments">
          {attachments.map((attachment) => (
            <span key={attachment.id} className="zorai-status-pill">
              {attachment.name}
              <button
                type="button"
                className="zorai-ghost-button"
                onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
              >
                Remove
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {budgetNotice ? (
        <p className="zorai-composer-budget-notice" role="alert">{budgetNotice}</p>
      ) : null}

      {queuedMessages.length > 0 ? (
        <div className="zorai-composer-queue">
          {queuedMessages.map((queued, index) => (
            <div key={queued.id} className="zorai-composer-queue__chip">
              <span className="zorai-composer-queue__label">Queued {index + 1}</span>
              <span className="zorai-composer-queue__text">{queuedComposerLabel(queued)}</span>
              <button
                type="button"
                className="zorai-composer-queue__send-now"
                title="Interrupt the current response and send this message now"
                onClick={() => sendQueuedMessageNow(index)}
              >
                Send now
              </button>
              <button
                type="button"
                className="zorai-composer-queue__remove"
                aria-label="Remove queued message"
                onClick={() => removeQueuedMessage(index)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="zorai-composer-box">
        <textarea
          ref={runtime.inputRef}
          value={runtime.input}
          onChange={(event) => {
            history.commit();
            runtime.setInput(event.target.value);
            applyComposerTextareaSize(event.currentTarget);
          }}
          onClick={() => history.commit()}
          onKeyDown={handleKeyDown}
          placeholder={isTranscribing ? "Transcribing..." : isRecording ? "Recording..." : runtime.isStreamingResponse ? "Queue a follow-up…" : "Message Zorai..."}
          rows={3}
        />

        <div className="zorai-composer-actions">
          <div className="zorai-composer-actions__left">
            <input
              ref={fileInputRef}
              type="file"
              hidden
              multiple
              onChange={(event) => {
                void appendFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
            <button
              type="button"
              className="zorai-composer-icon-button"
              title="Attach files"
              aria-label="Attach files"
              onClick={() => fileInputRef.current?.click()}
            >
              <ComposerIcon kind="attach" />
            </button>
            {voiceCaptureAvailable ? (
              <button
                type="button"
                className={["zorai-composer-icon-button", isRecording ? "zorai-composer-icon-button--recording" : ""].filter(Boolean).join(" ")}
                title={isRecording ? "Stop recording (Ctrl+M)" : isTranscribing ? "Transcribing…" : "Record voice message (Ctrl+M)"}
                aria-label={isRecording ? "Stop recording" : "Record voice message"}
                disabled={isTranscribing}
                onClick={() => void toggleRecording()}
              >
                <ComposerIcon kind="mic" />
                {isRecording ? <span className="zorai-composer-rec-dot" aria-hidden="true" /> : null}
              </button>
            ) : null}
            {ttsAvailable ? (
              <button
                type="button"
                role="switch"
                aria-checked={agentSettings.audio_tts_auto_speak}
                className={[
                  "zorai-composer-icon-button zorai-composer-autoplay",
                  agentSettings.audio_tts_auto_speak ? "zorai-composer-icon-button--toggled" : "",
                ].filter(Boolean).join(" ")}
                title={agentSettings.audio_tts_auto_speak ? "Auto-play new replies: ON — click to disable" : "Auto-play new replies: OFF — click to enable"}
                aria-label="Toggle auto-play of new assistant replies"
                onClick={() => {
                  const next = !agentSettings.audio_tts_auto_speak;
                  updateAgentSetting("audio_tts_auto_speak", next);
                  pushToast(next ? "Auto-play enabled — new replies will be read aloud." : "Auto-play disabled.", "info");
                }}
              >
                <ComposerIcon kind="autoplay" />
                <span className="zorai-composer-autoplay__state" aria-hidden="true">
                  {agentSettings.audio_tts_auto_speak ? "on" : "off"}
                </span>
              </button>
            ) : null}
          </div>

          <div className="zorai-composer-actions__right">
            {runtime.isStreamingResponse ? (
              <>
                <button
                  type="button"
                  className="zorai-composer-icon-button zorai-composer-icon-button--queue"
                  title="Queue message (send when the agent finishes)"
                  aria-label="Queue message"
                  disabled={!canSend}
                  onClick={queueCurrentInput}
                >
                  <ComposerIcon kind="queue" />
                </button>
                <button
                  type="button"
                  className="zorai-composer-icon-button zorai-composer-icon-button--stop"
                  title="Stop generating"
                  aria-label="Stop generating"
                  onClick={() => runtime.stopStreaming(runtime.activeThreadId)}
                >
                  <ComposerIcon kind="stop" />
                </button>
              </>
            ) : (
              <button
                type="button"
                className="zorai-composer-icon-button zorai-composer-icon-button--send"
                title="Send message (Enter)"
                aria-label="Send message"
                onClick={sendCurrentInput}
                disabled={!canSend}
              >
                <ComposerIcon kind="send" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className={["zorai-thread-composer__footer", budgetNotice ? "zorai-thread-composer__footer--budget" : ""].filter(Boolean).join(" ")}>
        <span>
          {budgetNotice ?? "Enter sends. Shift+Enter adds a new line. Up/Down recalls sent messages when empty. Ctrl+M records. Ctrl+L reads."}
        </span>
      </div>
    </div>
  );
}

function ComposerIcon({ kind }: { kind: "attach" | "mic" | "send" | "stop" | "queue" | "autoplay" }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (kind === "attach") {
    return (
      <svg {...common}>
        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
      </svg>
    );
  }
  if (kind === "mic") {
    return (
      <svg {...common}>
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
    );
  }
  if (kind === "send") {
    return (
      <svg {...common}>
        <line x1="12" y1="19" x2="12" y2="5" />
        <polyline points="5 12 12 5 19 12" />
      </svg>
    );
  }
  if (kind === "stop") {
    return (
      <svg {...common}>
        <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (kind === "autoplay") {
    return (
      <svg {...common}>
        <polygon points="6 3 20 12 6 21 6 3" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15.5 14" />
    </svg>
  );
}
