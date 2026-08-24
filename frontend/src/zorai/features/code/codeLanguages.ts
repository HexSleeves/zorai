const named: Record<string, string> = {
  dockerfile: "dockerfile", containerfile: "dockerfile", makefile: "makefile", gnumakefile: "makefile",
  rakefile: "ruby", gemfile: "ruby", guardfile: "ruby", procfile: "shell",
  ".bashrc": "shell", ".bash_profile": "shell", ".zshrc": "shell", ".profile": "shell",
  ".editorconfig": "ini", ".npmrc": "ini", ".prettierrc": "jsonc", ".eslintrc": "jsonc",
  "tsconfig.json": "jsonc", "jsconfig.json": "jsonc", "deno.json": "jsonc", "deno.jsonc": "jsonc",
};
const extensions: Record<string, string> = {
  c: "c", h: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", cs: "csharp", css: "css", scss: "scss", sass: "scss", less: "less",
  dart: "dart", ex: "elixir", exs: "elixir", fs: "fsharp", fsx: "fsharp", go: "go", graphql: "graphql", gql: "graphql", groovy: "groovy",
  html: "html", htm: "html", java: "java", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascriptreact",
  json: "json", jsonc: "jsonc", kt: "kotlin", kts: "kotlin", lua: "lua", md: "markdown", mdx: "mdx", mm: "objective-c",
  php: "php", pl: "perl", pm: "perl", proto: "protobuf", py: "python", r: "r", rb: "ruby", rs: "rust", sh: "shell", bash: "shell", zsh: "shell",
  sql: "sql", swift: "swift", svelte: "svelte", tf: "terraform", tfvars: "terraform", toml: "toml", ts: "typescript", mts: "typescript", cts: "typescript",
  tsx: "typescriptreact", vue: "vue", xml: "xml", yaml: "yaml", yml: "yaml", zig: "zig",
};

export function languageForWorkspacePath(path: string): string {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  if (named[name]) return named[name];
  if (/^(?:vite|vitest|eslint|prettier|postcss|tailwind)\.config\.(?:js|cjs|mjs)$/.test(name)) return "javascript";
  if (/^(?:vite|vitest|eslint|prettier|postcss|tailwind)\.config\.(?:ts|cts|mts)$/.test(name)) return "typescript";
  const extension = name.includes(".") ? name.split(".").pop() ?? "" : "";
  return extensions[extension] ?? "plaintext";
}
