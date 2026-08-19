export type ToolArtifactReference = {
  path: string;
  provenance: "argument" | "result" | "artifact";
};

type Provenance = ToolArtifactReference["provenance"];

const MAX_JSON_DEPTH = 8;
const MAX_JSON_VALUES = 512;
const MAX_TEXT_CHARS = 64 * 1024;
const MAX_TEXT_LINES = 300;

const PATH_KEYS = new Set([
  "path",
  "file",
  "file_path",
  "filepath",
  "filename",
  "output",
  "output_path",
  "artifact",
  "artifacts",
  "files",
  "saved_to",
  "preview_path",
]);

const ARTIFACT_COLLECTION_KEYS = new Set(["artifact", "artifacts", "files"]);

const PROVENANCE_PRIORITY: Record<Provenance, number> = {
  result: 1,
  argument: 2,
  artifact: 3,
};

export function extractToolArtifacts(rawArguments: string, rawResult: string): ToolArtifactReference[] {
  const collector = new ArtifactCollector();

  const parsedArguments = parseJson(rawArguments);
  if (parsedArguments !== undefined) {
    scanJson(parsedArguments, "argument", collector);
  }

  const parsedResult = parseJson(rawResult);
  if (parsedResult !== undefined) {
    scanJson(parsedResult, "result", collector);
  } else {
    scanResultText(rawResult, collector);
  }

  return collector.values;
}

class ArtifactCollector {
  readonly values: ToolArtifactReference[] = [];
  private readonly indexByPath = new Map<string, number>();

  add(rawPath: string, provenance: Provenance) {
    const path = cleanCandidatePath(rawPath);
    if (!isAcceptableLocalPath(path)) {
      return;
    }

    const normalized = normalizePathKey(path);
    const existingIndex = this.indexByPath.get(normalized);
    if (existingIndex === undefined) {
      this.indexByPath.set(normalized, this.values.length);
      this.values.push({ path, provenance });
      return;
    }

    const existing = this.values[existingIndex];
    if (PROVENANCE_PRIORITY[provenance] > PROVENANCE_PRIORITY[existing.provenance]) {
      existing.provenance = provenance;
    }
  }
}

function parseJson(raw: string): unknown | undefined {
  if (!raw.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function scanJson(root: unknown, baseProvenance: Provenance, collector: ArtifactCollector) {
  const state = { visited: 0 };
  visitJsonValue(root, 0, baseProvenance, false, collector, state);
}

function visitJsonValue(
  value: unknown,
  depth: number,
  provenance: Provenance,
  collectStringValues: boolean,
  collector: ArtifactCollector,
  state: { visited: number },
) {
  if (depth > MAX_JSON_DEPTH || state.visited >= MAX_JSON_VALUES) {
    return;
  }
  state.visited += 1;

  if (typeof value === "string") {
    if (collectStringValues) {
      collector.add(value, provenance);
    }
    return;
  }

  if (value === null || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (state.visited >= MAX_JSON_VALUES) break;
      visitJsonValue(item, depth + 1, provenance, collectStringValues, collector, state);
    }
    return;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (state.visited >= MAX_JSON_VALUES) break;

    const normalizedKey = key.toLowerCase();
    const isPathKey = PATH_KEYS.has(normalizedKey);
    const childProvenance = ARTIFACT_COLLECTION_KEYS.has(normalizedKey) ? "artifact" : provenance;
    const childCollectsStrings = collectStringValues || isPathKey;

    if (typeof child === "string") {
      if (isPathKey || collectStringValues) {
        collector.add(child, childProvenance);
      }
      state.visited += 1;
      continue;
    }

    visitJsonValue(child, depth + 1, childProvenance, childCollectsStrings, collector, state);
  }
}

function scanResultText(rawResult: string, collector: ArtifactCollector) {
  const bounded = rawResult.slice(0, MAX_TEXT_CHARS);
  const lines = bounded.split(/\r?\n/).slice(0, MAX_TEXT_LINES);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const labeledValue = extractLabeledValue(trimmed);
    if (labeledValue !== null) {
      if (hasShellMeta(labeledValue)) {
        continue;
      }
      collector.add(labeledValue, "result");
      continue;
    }

    if (looksLikeStandalonePathLine(trimmed)) {
      collector.add(trimmed, "result");
    }
  }
}

function extractLabeledValue(line: string): string | null {
  const match = line.match(/^(?:saved\s+file|file_path)\s*:\s*(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function looksLikeStandalonePathLine(line: string): boolean {
  if (/\s/.test(line)) {
    return false;
  }
  return extractLeadingPathToken(line) === line;
}

function hasShellMeta(value: string): boolean {
  return /[|<>]|(?:^|\s)(?:&&|\$\(|`)/.test(value);
}

function extractLeadingPathToken(value: string): string | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^(?:\\\\[^\s"'`,;)\]}]+(?:\\[^\s"'`,;)\]}]+)+|[A-Za-z]:[\\/][^\s"'`,;)\]}]+|(?:~|\.{1,2})[\\/][^\s"'`,;)\]}]+|\/[^^\s"'`,;)\]}]+)/);
  return match?.[0] ?? null;
}

function cleanCandidatePath(rawPath: string): string {
  let path = rawPath.trim();

  for (let index = 0; index < 4; index += 1) {
    const before = path;
    path = stripBasicTrailingPunctuation(path.trim());
    path = stripBalancedQuotes(path.trim());
    path = stripLineColumnSuffix(path.trim());
    path = stripBasicTrailingPunctuation(path.trim());
    if (path === before) break;
  }

  return path;
}

function stripBalancedQuotes(value: string): string {
  if (value.length < 2) {
    return value;
  }

  const first = value[0];
  const last = value[value.length - 1];
  if ((first === "\"" && last === "\"") || (first === "'" && last === "'") || (first === "`" && last === "`")) {
    return value.slice(1, -1);
  }

  return value;
}

function stripBasicTrailingPunctuation(value: string): string {
  let path = value;
  while (/[.,;\])}]/.test(path[path.length - 1] ?? "")) {
    path = path.slice(0, -1);
  }
  return path;
}

function stripLineColumnSuffix(value: string): string {
  const match = value.match(/^(.*?):\d+(?::\d+)?$/);
  if (!match?.[1]) {
    return value;
  }

  const prefix = match[1];
  if (prefix.length < 2 || /^[A-Za-z]$/.test(prefix)) {
    return value;
  }

  return prefix;
}

function isAcceptableLocalPath(path: string): boolean {
  if (!path || path.length > 1024 || /[\r\n]/.test(path)) {
    return false;
  }

  if (/\s/.test(path)) {
    return false;
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path) || /^file:/i.test(path)) {
    return false;
  }

  if (path.startsWith("-") && !path.startsWith("../")) {
    return false;
  }

  if (hasShellMeta(path)) {
    return false;
  }

  if (/^(?:cat|echo|less|more|head|tail|sed|awk|grep|rg|vim|nano|code|rm|cp|mv|touch|mkdir|python\d?|node|npm|npx|sh|bash|zsh|fish|curl|wget)\s+/i.test(path)) {
    return false;
  }

  if (/^(?:exec|task|operation|op|background_task|goal|thread)_[A-Za-z0-9-]+$/i.test(path)) {
    return false;
  }

  return isAnchoredLocalPath(path);
}

function isAnchoredLocalPath(path: string): boolean {
  return (
    /^\/(?!\/)/.test(path) ||
    /^~[\\/]/.test(path) ||
    /^\.{1,2}[\\/]/.test(path) ||
    /^[A-Za-z]:[\\/].+/.test(path) ||
    /^\\\\[^\\/\s]+[\\/][^\\/\s]+(?:[\\/].*)?$/.test(path)
  );
}

function normalizePathKey(path: string): string {
  if (/^[A-Za-z]:/.test(path)) {
    return path.replace(/\\/g, "/").toLowerCase();
  }

  if (path.startsWith("\\\\")) {
    return path.replace(/\\/g, "/").toLowerCase();
  }

  return path;
}
