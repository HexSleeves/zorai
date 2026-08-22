import { Component, Suspense, lazy, type ErrorInfo, type ReactNode } from "react";
import "@/lib/monacoEnvironment";
import type { OnMount } from "@monaco-editor/react";

const MonacoEditor = lazy(() => import("@monaco-editor/react").then((module) => ({ default: module.default })));
const MonacoDiffEditor = lazy(() => import("@monaco-editor/react").then((module) => ({ default: module.DiffEditor })));

type FallbackEditorProps = {
  value: string;
  path: string;
  onChange: (value: string) => void;
  onSelect: (startLine: number, startColumn: number, endLine: number, endColumn: number) => void;
  onSave: () => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
};

class MonacoBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Monaco editor failed; using textarea fallback", error, info); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function WorkspaceCodeEditor({
  value,
  path,
  language,
  onChange,
  onSelect,
  onSave,
  onMount,
  textareaRef,
}: FallbackEditorProps & { language: string; onMount?: OnMount }) {
  const fallback = <FallbackEditor value={value} path={path} onChange={onChange} onSelect={onSelect} onSave={onSave} textareaRef={textareaRef} />;
  const handleMount: OnMount = (editor, monaco) => {
    editor.onDidChangeCursorSelection((event) => onSelect(
      event.selection.startLineNumber,
      event.selection.startColumn,
      event.selection.endLineNumber,
      event.selection.endColumn,
    ));
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, onSave);
    onMount?.(editor, monaco);
  };
  return (
    <MonacoBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <MonacoEditor
          path={`zorai-workspace:///${path}`}
          value={value}
          language={language || "plaintext"}
          theme="vs-dark"
          onMount={handleMount}
          onChange={(next) => onChange(next ?? "")}
          options={{
            automaticLayout: true,
            minimap: { enabled: true },
            fontSize: 13,
            lineHeight: 20,
            wordWrap: "off",
            renderWhitespace: "selection",
            bracketPairColorization: { enabled: true },
            guides: { bracketPairs: true, indentation: true },
            multiCursorModifier: "alt",
            smoothScrolling: true,
            scrollBeyondLastLine: false,
            stickyScroll: { enabled: true },
            formatOnPaste: false,
          }}
        />
      </Suspense>
    </MonacoBoundary>
  );
}

export function WorkspaceDiffEditor({ original, modified, language }: { original: string; modified: string; language: string }) {
  const fallback = <div className="zorai-workspace-diff-grid"><pre>{original}</pre><pre>{modified}</pre></div>;
  return (
    <MonacoBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <MonacoDiffEditor
          original={original}
          modified={modified}
          language={language || "plaintext"}
          theme="vs-dark"
          options={{ automaticLayout: true, readOnly: true, renderSideBySide: true, minimap: { enabled: false }, scrollBeyondLastLine: false }}
        />
      </Suspense>
    </MonacoBoundary>
  );
}

function FallbackEditor({ value, path, onChange, onSelect, onSave, textareaRef }: FallbackEditorProps) {
  const updateSelection = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const beforeStart = textarea.value.slice(0, textarea.selectionStart);
    const beforeEnd = textarea.value.slice(0, textarea.selectionEnd);
    onSelect(
      beforeStart.split("\n").length,
      beforeStart.length - beforeStart.lastIndexOf("\n"),
      beforeEnd.split("\n").length,
      beforeEnd.length - beforeEnd.lastIndexOf("\n"),
    );
  };
  return (
    <textarea
      ref={textareaRef}
      className="zorai-workspace-code-editor"
      value={value}
      spellCheck={false}
      aria-label={`Edit ${path}`}
      onSelect={updateSelection}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          onSave();
        }
        if (event.key === "Tab") {
          event.preventDefault();
          const target = event.currentTarget;
          const start = target.selectionStart;
          const end = target.selectionEnd;
          onChange(`${target.value.slice(0, start)}  ${target.value.slice(end)}`);
          requestAnimationFrame(() => { target.selectionStart = target.selectionEnd = start + 2; });
        }
      }}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
