import { Component, Suspense, lazy, useEffect, useRef, type ErrorInfo, type ReactNode } from "react";
import { getBridge } from "@/lib/bridge";
import "@/lib/monacoEnvironment";
import type { OnMount } from "@monaco-editor/react";
import type { CodeEditorSettings } from "@/zorai/features/code/codeEditorSettingsStore";
import type { languages as MonacoLanguagesApi } from "monaco-editor";
import { registerCodeEditorActions } from "@/zorai/features/code/codeEditorActions";

const MonacoEditor = lazy(() => import("@monaco-editor/react").then((module) => ({ default: module.default })));
const MonacoDiffEditor = lazy(() => import("@monaco-editor/react").then((module) => ({ default: module.DiffEditor })));

type FallbackEditorProps = {
  value: string;
  path: string;
  onChange: (value: string) => void;
  onSelect: (startLine: number, startColumn: number, endLine: number, endColumn: number) => void;
  onSave: () => void;
  onBlur?: () => void;
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
  onBlur,
  diagnostics = [],
  testResults = [],
  lsp,
  onNavigateLocation,
  onMount,
  textareaRef,
  settings,
}: FallbackEditorProps & {
  language: string;
  diagnostics?: ZoraiLspDiagnostic[];
  testResults?: Array<{ line: number; status: "passed" | "failed" | "skipped"; message?: string | null }>;
  lsp?: { root: string; path: string; language: string; available: boolean };
  onNavigateLocation?: (path: string, line: number, column: number) => void;
  onMount?: OnMount;
  onBlur?: () => void;
  settings: CodeEditorSettings;
}) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  const providerDisposablesRef = useRef<Array<{ dispose: () => void }>>([]);
  const actionDisposablesRef = useRef<Array<{ dispose: () => void }>>([]);
  const fallback = <FallbackEditor value={value} path={path} onChange={onChange} onSelect={onSelect} onSave={onSave} onBlur={onBlur} textareaRef={textareaRef} />;
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
    monaco.editor.defineTheme("zorai-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: {
        "minimap.background": "#00000000",
        "minimapSlider.background": "#ffffff1f",
        "minimapSlider.hoverBackground": "#ffffff33",
        "minimapSlider.activeBackground": "#ffffff47",
      },
    });
    monaco.editor.setTheme("zorai-dark");
    actionDisposablesRef.current.forEach((disposable) => disposable.dispose());
    actionDisposablesRef.current = registerCodeEditorActions(editor, { onSave });
    providerDisposablesRef.current.forEach((disposable) => disposable.dispose());
    providerDisposablesRef.current = [];
    const bridge = getBridge();
    if (lsp?.available && bridge?.workspaceLspRequest) {
      const request = (method: "hover" | "definition" | "references" | "completion", position: { lineNumber: number; column: number }) => bridge.workspaceLspRequest!(
        lsp.root,
        lsp.path,
        lsp.language,
        method,
        { line: position.lineNumber - 1, character: position.column - 1 },
      );
      providerDisposablesRef.current.push(monaco.languages.registerHoverProvider(language, {
        provideHover: async (model, position) => {
          if (model.uri.toString() !== editor.getModel()?.uri.toString()) return null;
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
        provideDefinition: async (model, position) => model.uri.toString() === editor.getModel()?.uri.toString()
          ? locations((await request("definition", position).catch(() => null))?.result).map(convertLocation).filter((location): location is MonacoLanguagesApi.Location => location !== null)
          : null,
      }));
      providerDisposablesRef.current.push(monaco.languages.registerReferenceProvider(language, {
        provideReferences: async (model, position) => model.uri.toString() === editor.getModel()?.uri.toString()
          ? locations((await request("references", position).catch(() => null))?.result).map(convertLocation).filter((location): location is MonacoLanguagesApi.Location => location !== null)
          : null,
      }));
      providerDisposablesRef.current.push(monaco.languages.registerCompletionItemProvider(language, {
        triggerCharacters: ['.', ':'],
        provideCompletionItems: async (model, position) => {
          if (model.uri.toString() !== editor.getModel()?.uri.toString()) return { suggestions: [] };
          const response = await request("completion", position).catch(() => null);
          const raw: any = response?.result;
          const items: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
          const word = model.getWordUntilPosition(position);
          const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
          return {
            suggestions: items.slice(0, 500).map((item) => ({
              label: typeof item.label === "string" ? item.label : item.label?.label ?? "completion",
              kind: Math.max(0, Math.min(27, Number(item.kind) || 1)),
              detail: item.detail,
              documentation: typeof item.documentation === "string" ? item.documentation : item.documentation?.value,
              insertText: typeof item.insertText === "string" ? item.insertText : typeof item.textEdit?.newText === "string" ? item.textEdit.newText : typeof item.label === "string" ? item.label : item.label?.label ?? "",
              range,
            })),
          };
        },
      }));
    }
    editor.onDidDispose(() => {
      providerDisposablesRef.current.forEach((disposable) => disposable.dispose());
      providerDisposablesRef.current = [];
      actionDisposablesRef.current.forEach((disposable) => disposable.dispose());
      actionDisposablesRef.current = [];
    });
    editor.onDidBlurEditorWidget(() => onBlur?.());
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
            minimap: { enabled: settings.minimap, renderCharacters: true, maxColumn: 72, showSlider: "mouseover", side: "right", size: "proportional" },
            fontFamily: settings.fontFamily,
            fontSize: settings.fontSize,
            lineHeight: settings.lineHeight,
            tabSize: settings.tabSize,
            insertSpaces: settings.insertSpaces,
            wordWrap: settings.wordWrap === "off" ? "off" : settings.wordWrap === "viewport" ? "on" : "bounded",
            wordWrapColumn: settings.wordWrapColumn,
            renderWhitespace: settings.renderWhitespace,
            lineNumbers: settings.lineNumbers,
            bracketPairColorization: { enabled: settings.bracketGuides },
            guides: { bracketPairs: settings.bracketGuides, indentation: settings.bracketGuides },
            multiCursorModifier: "alt",
            smoothScrolling: settings.smoothScrolling,
            scrollBeyondLastLine: false,
            stickyScroll: { enabled: settings.stickyScroll },
            glyphMargin: settings.glyphMargin,
            formatOnPaste: settings.formatOnPaste,
            formatOnType: settings.formatOnType,
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

function FallbackEditor({ value, path, onChange, onSelect, onSave, onBlur, textareaRef }: FallbackEditorProps) {
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
      onBlur={onBlur}
    />
  );
}
