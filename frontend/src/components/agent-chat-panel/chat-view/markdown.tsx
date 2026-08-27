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

const LATEX_MARKERS = {
  inlineOpen: "\uE000",
  inlineClose: "\uE001",
  displayOpen: "\uE002",
  displayClose: "\uE003",
} as const;

export function protectLatexDelimiters(content: string): string {
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
      return protectLatexOutsideInlineCode(line);
    })
    .join("\n");
}

function protectLatexOutsideInlineCode(line: string): string {
  let output = "";
  let cursor = 0;
  while (cursor < line.length) {
    if (line[cursor] !== "`") {
      const nextCode = line.indexOf("`", cursor);
      const end = nextCode < 0 ? line.length : nextCode;
      output += protectLatexText(line.slice(cursor, end));
      cursor = end;
      continue;
    }

    let ticks = 1;
    while (line[cursor + ticks] === "`") ticks += 1;
    const marker = "`".repeat(ticks);
    const closing = line.indexOf(marker, cursor + ticks);
    if (closing < 0) {
      output += protectLatexText(line.slice(cursor));
      break;
    }
    output += line.slice(cursor, closing + ticks);
    cursor = closing + ticks;
  }
  return output;
}

function protectLatexText(text: string): string {
  return text
    .replace(/\\\[/g, LATEX_MARKERS.displayOpen)
    .replace(/\\\]/g, LATEX_MARKERS.displayClose)
    .replace(/\\\(/g, LATEX_MARKERS.inlineOpen)
    .replace(/\\\)/g, LATEX_MARKERS.inlineClose);
}

function restoreLatexDelimiters(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
  for (const node of textNodes) {
    const parent = node.parentElement;
    if (parent?.closest("pre, code, .no-math, .katex")) continue;
    const restored = node.data
      .split(LATEX_MARKERS.inlineOpen).join("\\(")
      .split(LATEX_MARKERS.inlineClose).join("\\)")
      .split(LATEX_MARKERS.displayOpen).join("\\[")
      .split(LATEX_MARKERS.displayClose).join("\\]");
    if (restored !== node.data) node.data = restored;
  }
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
  const protectedContent = renderMode === "markdown" ? protectLatexDelimiters(content) : content;

  useEffect(() => {
    const root = rootRef.current;
    if (!root || renderMode === "plain") return;
    restoreLatexDelimiters(root);
    renderMathInElement(root, {
      delimiters: [...KATEX_DELIMITERS],
      ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code", "option"],
      ignoredClasses: ["no-math", "katex", "katex-display"],
      throwOnError: false,
      strict: "ignore",
    });
  }, [protectedContent, renderMode]);

  if (renderMode === "plain") {
    return <div ref={rootRef} className="acp-md acp-md--streaming">{content}</div>;
  }
  return (
    <div ref={rootRef} className="acp-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {protectedContent}
      </ReactMarkdown>
    </div>
  );
});
