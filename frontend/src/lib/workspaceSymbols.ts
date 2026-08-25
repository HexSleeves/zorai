export type WorkspaceSymbol = {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "struct" | "enum" | "trait" | "method" | "constant";
  line: number;
  column: number;
  detail: string;
};

const SYMBOL_PATTERNS: Array<{ kind: WorkspaceSymbol["kind"]; pattern: RegExp }> = [
  { kind: "function", pattern: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)/ },
  { kind: "struct", pattern: /^\s*(?:pub\s+)?struct\s+([A-Za-z_][\w]*)/ },
  { kind: "enum", pattern: /^\s*(?:pub\s+)?enum\s+([A-Za-z_][\w]*)/ },
  { kind: "trait", pattern: /^\s*(?:pub\s+)?trait\s+([A-Za-z_][\w]*)/ },
  { kind: "interface", pattern: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
  { kind: "type", pattern: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/ },
  { kind: "class", pattern: /^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/ },
  { kind: "function", pattern: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/ },
  { kind: "function", pattern: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/ },
  { kind: "function", pattern: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?[A-Za-z_$][\w$]*\s*=>/ },
  { kind: "function", pattern: /^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(/ },
  { kind: "class", pattern: /^\s*class\s+([A-Za-z_][\w]*)\s*(?:\(|:)/ },
  { kind: "function", pattern: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)\s*\(/ },
  { kind: "type", pattern: /^\s*type\s+([A-Za-z_][\w]*)\s+(?:struct|interface|=)/ },
  { kind: "constant", pattern: /^\s*(?:pub\s+)?(?:const|static)\s+([A-Z_][A-Z0-9_]*)\b/ },
];

export function extractWorkspaceSymbols(content: string, limit = 500): WorkspaceSymbol[] {
  const symbols: WorkspaceSymbol[] = [];
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length && symbols.length < limit; index += 1) {
    const line = lines[index];
    for (const candidate of SYMBOL_PATTERNS) {
      const match = line.match(candidate.pattern);
      if (!match?.[1]) continue;
      symbols.push({
        name: match[1],
        kind: candidate.kind,
        line: index + 1,
        column: Math.max(1, line.indexOf(match[1]) + 1),
        detail: line.trim().slice(0, 200),
      });
      break;
    }
  }
  return symbols;
}
