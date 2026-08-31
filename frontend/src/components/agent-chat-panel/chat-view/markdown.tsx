import { memo, useEffect, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import renderMathInElement from "katex/contrib/auto-render";
import "katex/dist/katex.min.css";

export const KATEX_DELIMITERS = [
  { left: "$$", right: "$$", display: true },
  { left: "\\[", right: "\\]", display: true },
  { left: "\\begin{equation}", right: "\\end{equation}", display: true },
  { left: "\\begin{equation*}", right: "\\end{equation*}", display: true },
  { left: "\\begin{align}", right: "\\end{align}", display: true },
  { left: "\\begin{align*}", right: "\\end{align*}", display: true },
  { left: "\\begin{gather}", right: "\\end{gather}", display: true },
  { left: "\\begin{gather*}", right: "\\end{gather*}", display: true },
  { left: "\\(", right: "\\)", display: false },
  { left: "$", right: "$", display: false },
] as const;

const markdownComponents: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  pre: ({ children }) => <pre>{children}</pre>,
  code: ({ className, children }) => {
    const isBlock = className?.startsWith("language-");
    if (isBlock) {
      return <code>{children}</code>;
    }
    return <code>{children}</code>;
  },
  h1: ({ children }) => <h4>{children}</h4>,
  h2: ({ children }) => <h5>{children}</h5>,
  h3: ({ children }) => <h6>{children}</h6>,
  h4: ({ children }) => <h6>{children}</h6>,
  h5: ({ children }) => <h6>{children}</h6>,
  h6: ({ children }) => <h6>{children}</h6>,
  table: ({ children }) => (
    <div style={{ overflowX: "auto", margin: "6px 0", maxWidth: "100%", minWidth: 0 }}>
      <table>{children}</table>
    </div>
  ),
};

const MATH_TOKEN_OPEN = "\uE100";
const MATH_TOKEN_CLOSE = "\uE101";

export type ProtectedMath = {
  content: string;
  segments: string[];
};

const MATH_PAIRS = [
  { left: "\\begin{equation*}", right: "\\end{equation*}" },
  { left: "\\begin{equation}", right: "\\end{equation}" },
  { left: "\\begin{align*}", right: "\\end{align*}" },
  { left: "\\begin{align}", right: "\\end{align}" },
  { left: "\\begin{gather*}", right: "\\end{gather*}" },
  { left: "\\begin{gather}", right: "\\end{gather}" },
  { left: "\\[", right: "\\]" },
  { left: "\\(", right: "\\)" },
  { left: "$$", right: "$$" },
] as const;

export function protectMathSegments(source: string): ProtectedMath {
  const segments: string[] = [];
  let output = "";
  let cursor = 0;
  let fence: "`" | "~" | null = null;

  while (cursor < source.length) {
    if (cursor === 0 || source[cursor - 1] === "\n") {
      const lineEnd = source.indexOf("\n", cursor);
      const end = lineEnd < 0 ? source.length : lineEnd;
      const line = source.slice(cursor, end);
      const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
      if (fenceMatch) {
        const marker = fenceMatch[1][0] as "`" | "~";
        if (fence === null) fence = marker;
        else if (fence === marker) fence = null;
        output += source.slice(cursor, lineEnd < 0 ? end : end + 1);
        cursor = lineEnd < 0 ? end : end + 1;
        continue;
      }
    }

    if (fence !== null) {
      output += source[cursor];
      cursor += 1;
      continue;
    }

    if (source[cursor] === "`") {
      let ticks = 1;
      while (source[cursor + ticks] === "`") ticks += 1;
      const marker = "`".repeat(ticks);
      const closing = source.indexOf(marker, cursor + ticks);
      const end = closing < 0 ? source.length : closing + ticks;
      output += source.slice(cursor, end);
      cursor = end;
      continue;
    }

    const pair = MATH_PAIRS.find(({ left }) => source.startsWith(left, cursor));
    if (pair) {
      const closing = source.indexOf(pair.right, cursor + pair.left.length);
      if (closing >= 0) {
        const end = closing + pair.right.length;
        const index = segments.push(source.slice(cursor, end)) - 1;
        output += `${MATH_TOKEN_OPEN}${index}${MATH_TOKEN_CLOSE}`;
        cursor = end;
        continue;
      }
    }

    output += source[cursor];
    cursor += 1;
  }

  return { content: output, segments };
}

function restoreMathSegments(root: HTMLElement, segments: string[]): void {
  if (segments.length === 0) return;
  const tokenPattern = new RegExp(`${MATH_TOKEN_OPEN}(\\d+)${MATH_TOKEN_CLOSE}`, "g");
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
  for (const node of textNodes) {
    if (node.parentElement?.closest("pre, code, .no-math, .katex")) continue;
    const restored = node.data.replace(tokenPattern, (_match, rawIndex: string) => {
      const index = Number(rawIndex);
      return Number.isInteger(index) ? segments[index] ?? _match : _match;
    });
    if (restored !== node.data) node.data = restored;
  }
}

export function markdownRenderMode(streaming: boolean | undefined): "plain" | "markdown" {
  return streaming ? "plain" : "markdown";
}

// Full react-markdown + KaTeX rendering of multi-MB messages (tool output,
// long reports) blocks the renderer for seconds per bubble; opening a large
// thread multiplied that across the whole page and looked like "the GUI
// doesn't react to clicks". Above this size fall back to a truncated plain
// view with a copy affordance; the full text stays in the message store.
export const MARKDOWN_FULL_RENDER_MAX_CHARS = 20_000;
const MARKDOWN_PLAIN_PREVIEW_CHARS = 8_000;

export function truncateForPlainRender(content: string): { text: string; truncated: boolean } {
  if (content.length <= MARKDOWN_PLAIN_PREVIEW_CHARS) {
    return { text: content, truncated: false };
  }
  return {
    text: `${content.slice(0, MARKDOWN_PLAIN_PREVIEW_CHARS)}\n\n… [truncated ${content.length - MARKDOWN_PLAIN_PREVIEW_CHARS} chars for rendering — use Copy for the full text]`,
    truncated: true,
  };
}

export const MarkdownContent = memo(function MarkdownContent({
  content,
  streaming = false,
}: {
  content: string;
  streaming?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const oversized = !streaming && content.length > MARKDOWN_FULL_RENDER_MAX_CHARS;
  const renderMode = oversized ? "plain" : markdownRenderMode(streaming);
  const plainPreview = useMemo(
    () => (oversized ? truncateForPlainRender(content) : null),
    [content, oversized],
  );
  const protectedMath = useMemo(
    () => renderMode === "markdown" ? protectMathSegments(content) : { content, segments: [] },
    [content, renderMode],
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root || renderMode === "plain") return;
    restoreMathSegments(root, protectedMath.segments);
    renderMathInElement(root, {
      delimiters: [...KATEX_DELIMITERS],
      ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code", "option"],
      ignoredClasses: ["no-math", "katex", "katex-display"],
      throwOnError: false,
      strict: "ignore",
    });
  }, [protectedMath, renderMode]);

  if (renderMode === "plain") {
    return <div ref={rootRef} className="acp-md acp-md--streaming">{plainPreview?.text ?? content}</div>;
  }
  return (
    <div ref={rootRef} className="acp-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {protectedMath.content}
      </ReactMarkdown>
    </div>
  );
});
