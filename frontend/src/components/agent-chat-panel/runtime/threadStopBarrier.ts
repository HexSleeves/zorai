const THREAD_STOP_BARRIER_TIMEOUT_MS = 5_000;

type StopBarrier = {
  promise: Promise<void>;
  resolve: () => void;
  timeout: ReturnType<typeof setTimeout>;
};

const barriers = new Map<string, StopBarrier>();

export function beginThreadStopBarrier(threadId: string, timeoutMs = THREAD_STOP_BARRIER_TIMEOUT_MS): void {
  completeThreadStopBarrier(threadId);
  let resolvePromise: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  const barrier: StopBarrier = {
    promise,
    resolve: resolvePromise,
    timeout: setTimeout(() => completeThreadStopBarrier(threadId), timeoutMs),
  };
  barriers.set(threadId, barrier);
}

export function completeThreadStopBarrier(threadId: string): void {
  const barrier = barriers.get(threadId);
  if (!barrier) return;
  barriers.delete(threadId);
  clearTimeout(barrier.timeout);
  barrier.resolve();
}

export async function waitForThreadStopBarrier(threadId: string): Promise<void> {
  await barriers.get(threadId)?.promise;
}

export function hasThreadStopBarrier(threadId: string): boolean {
  return barriers.has(threadId);
}

export function resetThreadStopBarriersForTest(): void {
  for (const threadId of [...barriers.keys()]) {
    completeThreadStopBarrier(threadId);
  }
}
