export function applyCodeSaveTransforms(content: string, options: { trimTrailingWhitespace: boolean; finalNewline: boolean }): string {
  let next = options.trimTrailingWhitespace ? content.split("\n").map((line) => line.replace(/[\t ]+$/g, "")).join("\n") : content;
  if (options.finalNewline && !next.endsWith("\n")) next += "\n";
  return next;
}

export type CodeAutoSaveController = {
  schedule: (documentId: string, delayMs: number) => void;
  cancel: (documentId: string) => void;
  cancelAll: () => void;
};

export function createCodeAutoSaveController(save: (documentId: string) => Promise<boolean>): CodeAutoSaveController {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const cancel = (documentId: string) => {
    const timer = timers.get(documentId);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(documentId);
  };
  return {
    schedule(documentId, delayMs) {
      cancel(documentId);
      timers.set(documentId, setTimeout(() => {
        timers.delete(documentId);
        void save(documentId);
      }, Math.max(0, delayMs)));
    },
    cancel,
    cancelAll() { for (const documentId of timers.keys()) cancel(documentId); },
  };
}
