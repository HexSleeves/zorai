export type FuzzyItem = {
  id: string;
  label: string;
  searchText: string;
  recent?: boolean;
  open?: boolean;
};

export function parseQuickOpenQuery(value: string): { query: string; line: number | null; column: number | null } {
  const match = value.trim().match(/^(.*?)(?::(\d+))?(?::(\d+))?$/);
  return {
    query: match?.[1] ?? value.trim(),
    line: match?.[2] ? Number(match[2]) : null,
    column: match?.[3] ? Number(match[3]) : null,
  };
}

function fuzzyScore(query: string, text: string): number {
  const needle = query.toLowerCase();
  const haystack = text.toLowerCase();
  if (!needle) return 1;
  const baseName = haystack.split(/[\\/\s]/).filter(Boolean).pop() ?? haystack;
  if (haystack === needle || baseName === needle) return 1000;
  if (baseName.startsWith(needle)) return 900;
  if (haystack.startsWith(needle)) return 800;
  if (haystack.includes(needle)) return 600 - haystack.indexOf(needle);
  let cursor = 0;
  let gaps = 0;
  for (const character of needle) {
    const found = haystack.indexOf(character, cursor);
    if (found < 0) return Number.NEGATIVE_INFINITY;
    gaps += found - cursor;
    cursor = found + 1;
  }
  return 300 - gaps;
}

export function rankFuzzyItems<T extends FuzzyItem>(query: string, items: T[]): T[] {
  return items
    .map((item) => ({ item, score: fuzzyScore(query.trim(), `${item.label} ${item.searchText}`)
      + (item.open ? 80 : 0)
      + (item.recent ? 40 : 0) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => right.score - left.score || left.item.label.localeCompare(right.item.label))
    .map((entry) => entry.item);
}
