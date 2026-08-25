import { memo, useEffect, useState } from "react";
import { assistantMessageHasVisibleContent } from "@/components/agent-chat-panel/chat-view/helpers";
import { MarkdownContent } from "@/components/agent-chat-panel/chat-view/markdown";
import type { AgentMessage } from "@/lib/agentStore";
import { AttachmentTiles } from "./attachmentTiles";
import { splitMessageAttachments } from "./messageAttachments";

export function isMessageFromCurrentViewSession(message: AgentMessage, mountedAt: number): boolean {
  const createdAt = message.createdAt < 10_000_000_000
    ? message.createdAt * 1000
    : message.createdAt;
  return createdAt >= mountedAt;
}

export function isRetryableErrorMessage(message: AgentMessage): boolean {
  if (message.role !== "assistant" || message.isStreaming) return false;
  return /^error\s*:/i.test(message.content.trim());
}

export function shouldOfferMessageRetry(
  message: AgentMessage,
  latestAssistantMessageId: string | undefined,
  mountedAt: number,
  hasUserMessage: boolean,
): boolean {
  return Boolean(hasUserMessage)
    && message.id === latestAssistantMessageId
    && isMessageFromCurrentViewSession(message, mountedAt)
    && isRetryableErrorMessage(message);
}

export const NativeThreadMessageBubble = memo(function NativeThreadMessageBubble({
  message,
  threadAgentName,
  onPin,
  onUnpin,
  ttsEnabled,
  speaking,
  speechLoading,
  speechQueued,
  onSpeak,
  onRetry,
  onFeedback,
  onRegenerate,
  onDelete,
}: {
  message: AgentMessage;
  threadAgentName?: string;
  onPin: () => void | Promise<void>;
  onUnpin: () => void | Promise<void>;
  ttsEnabled: boolean;
  speaking: boolean;
  speechLoading: boolean;
  speechQueued: boolean;
  onSpeak: () => void;
  onRetry?: () => void;
  onFeedback?: (reaction: "up" | "down" | null) => void | Promise<void>;
  onRegenerate?: () => void;
  onDelete?: () => void;
}) {
  const [retryDismissed, setRetryDismissed] = useState(false);
  const [copied, setCopied] = useState(false);
  const fromUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const author = message.authorAgentName ?? (fromUser ? "You" : message.role === "assistant" ? (threadAgentName ?? "Zorai") : message.role);
  const tokenText = message.totalTokens > 0 ? `${message.totalTokens.toLocaleString()} tokens` : null;
  const { displayText, tiles } = splitMessageAttachments(message.content, message.contentBlocks);
  const hasVisibleContent = assistantMessageHasVisibleContent(displayText);
  const shouldRenderContent = hasVisibleContent || !message.reasoning;

  return (
    <article id={`zorai-message-${message.id}`} className={["zorai-message", fromUser ? "zorai-message--user" : "", message.pinnedForCompaction ? "zorai-message--pinned" : ""].filter(Boolean).join(" ")}>
      <div className="zorai-message__meta">
        <strong>{author}</strong>
        <span>{formatTime(message.createdAt)}{tokenText ? ` / ${tokenText}` : ""}</span>
      </div>
      {message.reasoning ? (
        <ThreadReasoningBlock content={message.reasoning} streaming={Boolean(message.isStreaming)} />
      ) : null}
      {tiles.length > 0 ? <AttachmentTiles items={tiles} /> : null}
      {shouldRenderContent ? (
        <div className="zorai-message__content">
          {hasVisibleContent ? (
            <MarkdownContent content={displayText} streaming={Boolean(message.isStreaming)} />
          ) : null}
        </div>
      ) : null}
      {hasVisibleContent && message.toolCalls && message.toolCalls.length > 0 ? (
        <div className="zorai-message__tools">{message.toolCalls.length} tool calls</div>
      ) : null}
      {onRetry && !retryDismissed ? (
        <div className="zorai-message-retry" role="alert">
          <div>
            <strong>{isRateLimitError(message.content) ? "Provider rate limit" : "Agent request failed"}</strong>
            <span>Retry the last message?</span>
          </div>
          <div className="zorai-message-retry__actions">
            <button
              type="button"
              className="zorai-primary-button"
              onClick={() => {
                setRetryDismissed(true);
                onRetry();
              }}
            >
              Yes, retry
            </button>
            <button type="button" className="zorai-ghost-button" onClick={() => setRetryDismissed(true)}>No</button>
          </div>
        </div>
      ) : null}
      <div className="zorai-message__actions">
        {hasVisibleContent ? (
          <button
            type="button"
            className="zorai-ghost-button zorai-message-action"
            title={copied ? "Copied" : "Copy message"}
            aria-label={copied ? "Copied" : "Copy message"}
            onClick={() => {
              try {
                navigator.clipboard.writeText(displayText || message.content);
              } catch {
                // Ignore clipboard failures.
              }
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            }}
          >
            <MessageActionIcon kind={copied ? "copied" : "copy"} />
          </button>
        ) : null}
        {isAssistant && onFeedback && !message.isStreaming ? (
          <>
            <button
              type="button"
              className={["zorai-ghost-button zorai-message-action", message.feedback === "up" ? "zorai-button--active" : ""].filter(Boolean).join(" ")}
              title={message.feedback === "up" ? "Clear positive feedback" : "Good response"}
              aria-label={message.feedback === "up" ? "Clear positive feedback" : "Good response"}
              onClick={() => { void onFeedback(message.feedback === "up" ? null : "up"); }}
            >
              <MessageActionIcon kind="thumb-up" filled={message.feedback === "up"} />
            </button>
            <button
              type="button"
              className={["zorai-ghost-button zorai-message-action", message.feedback === "down" ? "zorai-button--active" : ""].filter(Boolean).join(" ")}
              title={message.feedback === "down" ? "Clear negative feedback" : "Bad response"}
              aria-label={message.feedback === "down" ? "Clear negative feedback" : "Bad response"}
              onClick={() => { void onFeedback(message.feedback === "down" ? null : "down"); }}
            >
              <MessageActionIcon kind="thumb-down" filled={message.feedback === "down"} />
            </button>
          </>
        ) : null}
        {isAssistant && onRegenerate && !message.isStreaming ? (
          <button
            type="button"
            className="zorai-ghost-button zorai-message-action"
            title="Regenerate response"
            aria-label="Regenerate response"
            onClick={onRegenerate}
          >
            <MessageActionIcon kind="regenerate" />
          </button>
        ) : null}
        {ttsEnabled && hasVisibleContent ? (
          <button
            type="button"
            className={["zorai-ghost-button zorai-message-action", speaking ? "zorai-button--active" : ""].filter(Boolean).join(" ")}
            disabled={speechLoading}
            title={speechLoading ? "Synthesizing speech…" : speechQueued ? "Queued for playback" : speaking ? "Stop speech (Ctrl+L)" : "Read aloud (Ctrl+L plays latest)"}
            aria-label={speechLoading ? "Synthesizing speech" : speechQueued ? "Queued for playback" : speaking ? "Stop speech" : "Read aloud"}
            onClick={onSpeak}
          >
            <MessageActionIcon kind="speak" animated={speechLoading || speaking || speechQueued} />
          </button>
        ) : null}
        {message.pinnedForCompaction ? (
          <button type="button" className="zorai-ghost-button zorai-message-action zorai-button--active" title="Unpin from compaction" aria-label="Unpin from compaction" onClick={() => void onUnpin()}>
            <MessageActionIcon kind="pin" filled />
          </button>
        ) : (
          <button type="button" className="zorai-ghost-button zorai-message-action" title="Pin for compaction" aria-label="Pin for compaction" onClick={() => void onPin()}>
            <MessageActionIcon kind="pin" />
          </button>
        )}
        {onDelete ? (
          <button
            type="button"
            className="zorai-ghost-button zorai-message-action"
            title="Delete message"
            aria-label="Delete message"
            onClick={onDelete}
          >
            <MessageActionIcon kind="delete" />
          </button>
        ) : null}
      </div>
    </article>
  );
}, (previous, next) => (
  previous.message === next.message
  && previous.threadAgentName === next.threadAgentName
  && previous.ttsEnabled === next.ttsEnabled
  && previous.speaking === next.speaking
  && previous.speechLoading === next.speechLoading
  && previous.speechQueued === next.speechQueued
  && previous.onRetry === next.onRetry
  && previous.onFeedback === next.onFeedback
  && previous.onRegenerate === next.onRegenerate
  && previous.onDelete === next.onDelete
));

function formatThoughtDuration(startedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - startedAt) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function ThreadReasoningBlock({ content, streaming }: { content: string; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!streaming) {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [streaming]);

  const durationText = streaming
    ? formatThoughtDuration(startedAt, now)
    : formatStaticThoughtDuration(content);

  return (
    <details
      className={`zorai-message__reasoning ${streaming ? "zorai-message__reasoning--streaming" : ""}`}
      data-streaming={streaming ? "true" : undefined}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="zorai-message__reasoning-toggle">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
          <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" />
        </svg>
        <span>Thought for {durationText || "a moment"}</span>
        {streaming ? <span className="zorai-message__reasoning-pulse" aria-hidden="true" /> : null}
      </summary>
      {open ? (
        <div>
          <MarkdownContent content={content} streaming={streaming} />
        </div>
      ) : null}
    </details>
  );
}

function formatStaticThoughtDuration(content: string): string {
  const words = content.trim().split(/\s+/).filter(Boolean).length;
  if (words <= 0) {
    return "";
  }
  const seconds = Math.max(1, Math.round(words / 12));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function MessageActionIcon({ kind, filled = false, animated = false }: { kind: "speak" | "pin" | "copy" | "copied" | "thumb-up" | "thumb-down" | "regenerate" | "delete"; filled?: boolean; animated?: boolean }) {
  if (kind === "speak") {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill={filled ? "currentColor" : "none"} />
        <path className={animated ? "zorai-speak-wave zorai-speak-wave--1" : undefined} d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        <path className={animated ? "zorai-speak-wave zorai-speak-wave--2" : undefined} d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      </svg>
    );
  }
  if (kind === "pin") {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 17v5" />
        <path d="M9 3h6l-1 7 3 3v2H7v-2l3-3-1-7z" />
      </svg>
    );
  }
  if (kind === "copy") {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="9" y="9" width="13" height="13" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
    );
  }
  if (kind === "copied") {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }
  if (kind === "thumb-up") {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M7 10v12" />
        <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
      </svg>
    );
  }
  if (kind === "thumb-down") {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M17 14V2" />
        <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" />
      </svg>
    );
  }
  if (kind === "regenerate") {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <path d="M21 3v6h-6" />
      </svg>
    );
  }
  if (kind === "delete") {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 6h18" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <line x1="10" y1="11" x2="10" y2="17" />
        <line x1="14" y1="11" x2="14" y2="17" />
      </svg>
    );
  }
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 14V2" />
      <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" />
    </svg>
  );
}

function isRateLimitError(content: string): boolean {
  return /\b429\b|rate[ -]?limit|quota/i.test(content);
}

function formatTime(timestamp: number): string {
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "pending";
}
