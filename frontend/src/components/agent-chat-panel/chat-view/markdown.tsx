import { memo, useEffect, useRef } from "react";
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

export function normalizeLatexDelimiters(content: string): string {
  let fenceMarker: string | null = null;
  return content
    .split("\n")
    .map((line) => {
      const fence = line.match(/^\s*(`{3,}|~{3,})/);
      if (fence) {
        const marker = fence[1][0];
        if (fenceMarker === null) fenceMarker = marker;
        else if (fenceMarker === marker) fenceMarker = null;
        return line;
      }
      if (fenceMarker !== null) return line;
      return normalizeLatexOutsideInlineCode(line);
    })
    .join("\n");
}

function normalizeLatexOutsideInlineCode(line: string): string {
  let output = "";
  let cursor = 0;
  while (cursor < line.length) {
    if (line[cursor] !== "`") {
      const nextCode = line.indexOf("`", cursor);
      const end = nextCode < 0 ? line.length : nextCode;
      output += normalizeLatexText(line.slice(cursor, end));
      cursor = end;
      continue;
    }

    let ticks = 1;
    while (line[cursor + ticks] === "`") ticks += 1;
    const marker = "`".repeat(ticks);
    const closing = line.indexOf(marker, cursor + ticks);
    if (closing < 0) {
      output += normalizeLatexText(line.slice(cursor));
      break;
    }
    output += line.slice(cursor, closing + ticks);
    cursor = closing + ticks;
  }
  return output;
}

function normalizeLatexText(text: string): string {
  return text
    .replace(/\\\[/g, () => "$$")
    .replace(/\\\]/g, () => "$$")
    .replace(/\\\(/g, () => "$")
    .replace(/\\\)/g, () => "$");
}

export function markdownRenderMode(streaming: boolean | undefined): "plain" | "markdown" {
  return streaming ? "plain" : "markdown";
}

export const MarkdownContent = memo(function MarkdownContent({
  content,
  streaming = false,
}: {
  content: string;
  streaming?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const renderMode = markdownRenderMode(streaming);
  const normalizedContent = renderMode === "markdown" ? normalizeLatexDelimiters(content) : content;

  useEffect(() => {
    const root = rootRef.current;
    if (!root || renderMode === "plain") return;
    renderMathInElement(root, {
      delimiters: [...KATEX_DELIMITERS],
      ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code", "option"],
      ignoredClasses: ["no-math", "katex", "katex-display"],
      throwOnError: false,
      strict: "ignore",
    });
  }, [normalizedContent, renderMode]);

  if (renderMode === "plain") {
    return <div ref={rootRef} className="acp-md acp-md--streaming">{content}</div>;
  }
  return (
    <div ref={rootRef} className="acp-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {normalizedContent}
      </ReactMarkdown>
    </div>
  );
});
