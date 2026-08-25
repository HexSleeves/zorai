export const CODE_FILE_OPEN_MARKS = [
  "start",
  "tab-active",
  "ipc-start",
  "ipc-complete",
  "model-ready",
  "paint",
  "interactive",
] as const;

export type CodeFileOpenMark = (typeof CODE_FILE_OPEN_MARKS)[number];

export type CodeFileOpenRecord = {
  root: string;
  path: string;
  cacheHit: boolean;
  byteSize?: number;
  lineCount?: number;
  language?: string;
  totalMs: number;
  feedbackMs?: number;
  ipcMs?: number;
  modelMs?: number;
  paintMs?: number;
  marks: Partial<Record<CodeFileOpenMark, number>>;
};

const MAX_RECORDS = 200;
const records: CodeFileOpenRecord[] = [];

export function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(quantile * sorted.length) - 1));
  return sorted[index] ?? null;
}

function duration(marks: Partial<Record<CodeFileOpenMark, number>>, start: CodeFileOpenMark, end: CodeFileOpenMark) {
  const from = marks[start];
  const to = marks[end];
  return from === undefined || to === undefined ? undefined : Math.max(0, to - from);
}

export function createCodeFileOpenTrace(meta: Pick<CodeFileOpenRecord, "root" | "path" | "cacheHit">) {
  const marks: Partial<Record<CodeFileOpenMark, number>> = {};
  let finished: CodeFileOpenRecord | null = null;
  return {
    mark(name: CodeFileOpenMark, timestamp = performance.now()) {
      marks[name] = timestamp;
      if (typeof performance?.mark === "function") performance.mark(`code-file-open:${name}`);
    },
    finish(extra: Partial<Pick<CodeFileOpenRecord, "byteSize" | "lineCount" | "language">> = {}) {
      if (finished) return finished;
      const start = marks.start ?? 0;
      const interactive = marks.interactive ?? start;
      finished = {
        ...meta,
        ...extra,
        marks: { ...marks },
        totalMs: Math.max(0, interactive - start),
        feedbackMs: duration(marks, "start", "tab-active"),
        ipcMs: duration(marks, "ipc-start", "ipc-complete"),
        modelMs: duration(marks, "ipc-complete", "model-ready"),
        paintMs: duration(marks, "model-ready", "paint"),
      };
      records.push(finished);
      if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS);
      return finished;
    },
  };
}

export function summarizeCodeFileOpenDurations() {
  const durations = records.map((record) => record.totalMs);
  return { count: durations.length, p50: percentile(durations, .5), p95: percentile(durations, .95) };
}

export function recentCodeFileOpenRecords(): readonly CodeFileOpenRecord[] {
  return records;
}
