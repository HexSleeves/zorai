import { Component, Suspense, lazy, useEffect, useRef, type ErrorInfo, type ReactNode } from "react";
import { getBridge } from "@/lib/bridge";
import "@/lib/monacoEnvironment";
import type { OnMount } from "@monaco-editor/react";
import type { languages as MonacoLanguagesApi } from "monaco-editor";

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
  diagnostics = [],
  testResults = [],
  lsp,
  onNavigateLocation,
  onMount,
  textareaRef,
}: FallbackEditorProps & {
  language: string;
  diagnostics?: ZoraiLspDiagnostic[];
  testResults?: Array<{ line: number; status: "passed" | "failed" | "skipped"; message?: string | null }>;
  lsp?: { root: string; path: string; language: string; available: boolean };
  onNavigateLocation?: (path: string, line: number, column: number) => void;
  onMount?: OnMount;
}) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  const providerDisposablesRef = useRef<Array<{ dispose: () => void }>>([]);
  const fallback = <FallbackEditor value={value} path={path} onChange={onChange} onSelect={onSelect} onSave={onSave} textareaRef={textareaRef} />;
  useEffect(() => {
    const monacoEditor = editorRef.current;
    const monaco = monacoRef.current;
    const model = monacoEditor?.getModel();
    if (!monacoEditor || !monaco || !model) return;
    monaco.editor.setModelMarkers(model, "zorai-lsp", diagnostics.map((diagnostic) => ({
      message: diagnostic.message,
      severity: diagnostic.severity === 1
        ? monaco.MarkerSeverity.Error
        : diagnostic.severity === 2
          ? monaco.MarkerSeverity.Warning
          : diagnostic.severity === 3
            ? monaco.MarkerSeverity.Info
            : monaco.MarkerSeverity.Hint,
      source: diagnostic.source ?? undefined,
      code: diagnostic.code ?? undefined,
      startLineNumber: diagnostic.startLine,
      startColumn: diagnostic.startColumn,
      endLineNumber: diagnostic.endLine,
      endColumn: diagnostic.endColumn,
    })));
    const testDecorations = testResults.map((result) => ({
      range: new monaco.Range(result.line, 1, result.line, 1),
      options: {
        isWholeLine: false,
        glyphMarginClassName: `zorai-test-glyph zorai-test-glyph--${result.status}`,
        glyphMarginHoverMessage: { value: result.message ?? `Test ${result.status}` },
      },
    }));
    const decorationCollection = monacoEditor.createDecorationsCollection(testDecorations);
    return () => {
      monaco.editor.setModelMarkers(model, "zorai-lsp", []);
      decorationCollection.clear();
    };
  }, [diagnostics, path, testResults]);
  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    providerDisposablesRef.current.forEach((disposable) => disposable.dispose());
    providerDisposablesRef.current = [];
    const bridge = getBridge();
    if (lsp?.available && bridge?.workspaceLspRequest) {
      const request = (method: "hover" | "definition" | "references", position: { lineNumber: number; column: number }) => bridge.workspaceLspRequest!(
        lsp.root,
        lsp.path,
        lsp.language,
        method,
        { line: position.lineNumber - 1, character: position.column - 1 },
      );
      providerDisposablesRef.current.push(monaco.languages.registerHoverProvider(language, {
        provideHover: async (_model, position) => {
          const response = await request("hover", position).catch(() => null);
          const hover = response?.result as any;
          if (!hover?.contents) return null;
          return {
            contents: (Array.isArray(hover.contents) ? hover.contents : [hover.contents]).map((content: any) => ({
              value: typeof content === "string" ? content : content.value ?? String(content),
            })),
          };
        },
      }));
      const locations = (result: any): any[] => result ? (Array.isArray(result) ? result : [result]) : [];
      const convertLocation = (location: any): MonacoLanguagesApi.Location | null => {
        const uri = location.targetUri ?? location.uri;
        const range = location.targetSelectionRange ?? location.targetRange ?? location.range;
        if (!uri || !range) return null;
        let relativePath = uri;
        try {
          relativePath = decodeURIComponent(new URL(uri).pathname).replace(/^\/[A-Za-z]:\//, (value) => value.slice(1));
        } catch {
          relativePath = String(uri);
        }
        const rootNormalized = lsp.root.replace(/\\/g, "/").replace(/\/$/, "");
        relativePath = relativePath.replace(/\\/g, "/");
        if (relativePath.startsWith(rootNormalized)) relativePath = relativePath.slice(rootNormalized.length).replace(/^\//, "");
        const rangeValue = new monaco.Range(range.start.line + 1, range.start.character + 1, range.end.line + 1, range.end.character + 1);
        if (relativePath === lsp.path) return { uri: editor.getModel()!.uri, range: rangeValue };
        onNavigateLocation?.(relativePath, range.start.line + 1, range.start.character + 1);
        return null;
      };
      providerDisposablesRef.current.push(monaco.languages.registerDefinitionProvider(language, {
        provideDefinition: async (_model, position) => locations((await request("definition", position).catch(() => null))?.result).map(convertLocation).filter((location): location is MonacoLanguagesApi.Location => location !== null),
      }));
      providerDisposablesRef.current.push(monaco.languages.registerReferenceProvider(language, {
        provideReferences: async (_model, position) => locations((await request("references", position).catch(() => null))?.result).map(convertLocation).filter((location): location is MonacoLanguagesApi.Location => location !== null),
      }));
    }
    editor.onDidDispose(() => {
      providerDisposablesRef.current.forEach((disposable) => disposable.dispose());
      providerDisposablesRef.current = [];
    });
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
            glyphMargin: true,
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
