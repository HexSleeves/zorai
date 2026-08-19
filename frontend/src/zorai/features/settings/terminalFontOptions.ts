const FALLBACK_TERMINAL_FONTS = [
  "Cascadia Code",
  "Cascadia Mono",
  "Consolas",
  "JetBrains Mono",
  "Fira Code",
  "Source Code Pro",
  "Hack",
  "DejaVu Sans Mono",
  "Ubuntu Mono",
  "Courier New",
  "monospace",
];

export function buildTerminalFontOptions(systemFonts: string[], selectedFont: string): string[] {
  const discoveredFonts = systemFonts.length > 0 ? systemFonts : FALLBACK_TERMINAL_FONTS;
  return Array.from(new Set([
    ...discoveredFonts.map((font) => font.trim()).filter(Boolean),
    selectedFont.trim(),
  ].filter(Boolean))).sort((left, right) => left.localeCompare(right));
}
