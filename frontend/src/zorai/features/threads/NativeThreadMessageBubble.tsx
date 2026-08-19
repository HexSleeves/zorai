import { memo, useState } from "react";
import { MarkdownContent } from "@/components/agent-chat-panel/chat-view/markdown";
import type { AgentMessage } from "@/lib/agentStore";

export function isMessageFromCurrentViewSession(message: AgentMessage, mountedAt: number): boolean {
  const createdAt = message.createdAt < 10_000_000_000
    ? message.createdAt * 1000
    : message.createdAt;
  return createdAt >= mountedAt;
}

export function isRetryableErrorMessage(message: AgentMessage): boolean {
  if (message.role !== "assistant" || message.isStreaming) return false;
  const content = message.content.trim();
  return /^error\s*:/i.test(content)
    || /\b429\b|rate[ -]?limit|quota|temporar(?:y|ily) unavailable|timeout|timed out|connection (?:reset|closed)/i.test(content);
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
}) {
  const [retryDismissed, setRetryDismissed] = useState(false);
  const fromUser = message.role === "user";
  const author = message.authorAgentName ?? (fromUser ? "You" : message.role === "assistant" ? (threadAgentName ?? "Zorai") : message.role);
  const tokenText = message.totalTokens > 0 ? `${message.totalTokens.toLocaleString()} tokens` : null;
  const hasVisibleContent = message.content.trim().length > 0;
  const shouldRenderContent = hasVisibleContent || !message.reasoning;

  return (
    <article id={`zorai-message-${message.id}`} className={["zorai-message", fromUser ? "zorai-message--user" : "", message.pinnedForCompaction ? "zorai-message--pinned" : ""].filter(Boolean).join(" ")}>
      <div className="zorai-message__meta">
        <strong>{author}</strong>
        <span>{formatTime(message.createdAt)}{tokenText ? ` / ${tokenText}` : ""}</span>
      </div>
      {message.reasoning ? (
        <details className="zorai-message__reasoning">
          <summary className="zorai-message__reasoning-toggle">Reasoning</summary>
          <div><MarkdownContent content={message.reasoning} /></div>
        </details>
      ) : null}
      {shouldRenderContent ? (
        <div className="zorai-message__content">
          {hasVisibleContent ? <MarkdownContent content={message.content} /> : null}
        </div>
      ) : null}
      {message.toolCalls && message.toolCalls.length > 0 ? (
        <div className="zorai-message__tools">{message.toolCalls.length} tool calls</div>
      ) : null}
      {onRetry && !retryDismissed ? (
        <div className="zorai-message-retry" role="alert">
          <div>
            <strong>{isRateLimitError(message.content) ? "Provider rate limit" : "Agent request failed"}</strong>
            <span>Retry the last message?</span>
          </div>
          <div className="zorai-message-retry__actions">
            <button type="button" className="zorai-primary-button" onClick={onRetry}>Yes, retry</button>
            <button type="button" className="zorai-ghost-button" onClick={() => setRetryDismissed(true)}>No</button>
          </div>
        </div>
      ) : null}
      <div className="zorai-message__actions">
        {ttsEnabled && message.content.trim() ? (
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
));

function MessageActionIcon({ kind, filled = false, animated = false }: { kind: "speak" | "pin"; filled?: boolean; animated?: boolean }) {
  if (kind === "speak") {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill={filled ? "currentColor" : "none"} />
        <path className={animated ? "zorai-speak-wave zorai-speak-wave--1" : undefined} d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        <path className={animated ? "zorai-speak-wave zorai-speak-wave--2" : undefined} d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      </svg>
    );
  }
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 17v5" />
      <path d="M9 3h6l-1 7 3 3v2H7v-2l3-3-1-7z" />
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
