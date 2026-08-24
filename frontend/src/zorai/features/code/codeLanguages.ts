const named: Record<string, string> = {
  dockerfile: "dockerfile", makefile: "makefile", rakefile: "ruby", gemfile: "ruby", procfile: "shell",
};
const extensions: Record<string, string> = {
  c: "c", h: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", cs: "csharp", css: "css", scss: "scss", sass: "scss", less: "less",
  dart: "dart", ex: "elixir", exs: "elixir", fs: "fsharp", fsx: "fsharp", go: "go", graphql: "graphql", gql: "graphql", groovy: "groovy",
  html: "html", htm: "html", java: "java", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascriptreact",
  json: "json", jsonc: "json", kt: "kotlin", kts: "kotlin", lua: "lua", md: "markdown", mdx: "mdx", mm: "objective-c",
  php: "php", pl: "perl", pm: "perl", proto: "protobuf", py: "python", r: "r", rb: "ruby", rs: "rust", sh: "shell", bash: "shell", zsh: "shell",
  sql: "sql", swift: "swift", svelte: "svelte", tf: "terraform", tfvars: "terraform", toml: "toml", ts: "typescript", mts: "typescript", cts: "typescript",
  tsx: "typescriptreact", vue: "vue", xml: "xml", yaml: "yaml", yml: "yaml", zig: "zig",
};

export function languageForWorkspacePath(path: string): string {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  if (named[name]) return named[name];
  const extension = name.includes(".") ? name.split(".").pop() ?? "" : "";
  return extensions[extension] ?? "plaintext";
}
