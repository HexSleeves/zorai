export const THREAD_HISTORY_SCROLL_THRESHOLD_PX = 24;
export const THREAD_HISTORY_OLDER_LOAD_DEBOUNCE_MS = 200;
export const THREAD_HISTORY_OLDER_LOAD_COOLDOWN_MS = 400;

export type ThreadHistoryScrollAction = "load-older" | "trim-latest" | "none";

let followBottom = true;
let ignoreScroll = false;
let olderLoadInFlight = false;
let olderHistoryExhausted = false;
let olderLoadCooldownUntil = 0;
let scheduledOlderLoad: ReturnType<typeof setTimeout> | null = null;
let paginationGeneration = 0;

export function setFollowThreadHistoryBottom(follow: boolean): void {
  followBottom = follow;
}

export function shouldFollowThreadHistoryBottom(): boolean {
  return followBottom;
}

export function beginProgrammaticThreadHistoryScroll(): void {
  ignoreScroll = true;
}

export function endProgrammaticThreadHistoryScroll(): void {
  afterPaint(() => {
    ignoreScroll = false;
  });
}

export function shouldIgnoreThreadHistoryScroll(): boolean {
  return ignoreScroll;
}

export function resetThreadHistoryPagination(): void {
  paginationGeneration += 1;
  ignoreScroll = false;
  olderLoadInFlight = false;
  olderHistoryExhausted = false;
  olderLoadCooldownUntil = 0;
  cancelScheduledOlderThreadHistoryLoad();
}

export function resetThreadHistoryScrollStateForTest(): void {
  followBottom = true;
  ignoreScroll = false;
  resetThreadHistoryPagination();
}

export function resolveThreadHistoryScrollAction(params: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  thresholdPx?: number;
}): ThreadHistoryScrollAction {
  const threshold = params.thresholdPx ?? THREAD_HISTORY_SCROLL_THRESHOLD_PX;
  const atTop = params.scrollTop <= threshold;
  const distanceFromBottom = params.scrollHeight - params.scrollTop - params.clientHeight;
  const atBottom = distanceFromBottom <= threshold;

  if (atTop && atBottom) {
    followBottom = true;
    return "none";
  }
  if (atTop) {
    followBottom = false;
    return olderHistoryExhausted ? "none" : "load-older";
  }
  olderHistoryExhausted = false;
  if (atBottom) {
    followBottom = true;
    return "trim-latest";
  }
  followBottom = false;
  return "none";
}

export function consumeThreadHistoryScroll(options: {
  scroller: HTMLElement;
  loadOlder?: () => Promise<boolean>;
  trimLatest?: () => boolean;
  onFollowBottomChange?: (follow: boolean) => void;
  onTrimmed?: () => void;
  now?: number;
}): void {
  if (shouldIgnoreThreadHistoryScroll() || olderLoadInFlight) return;
  const action = resolveThreadHistoryScrollAction({
    scrollTop: options.scroller.scrollTop,
    scrollHeight: options.scroller.scrollHeight,
    clientHeight: options.scroller.clientHeight,
  });
  options.onFollowBottomChange?.(shouldFollowThreadHistoryBottom());
  if (action !== "load-older") {
    cancelScheduledOlderThreadHistoryLoad();
  }
  if (action === "load-older") {
    scheduleOlderThreadHistoryLoad(options.scroller, options.loadOlder, options.now);
    return;
  }
  if (action === "trim-latest" && options.trimLatest?.()) {
    options.onTrimmed?.();
  }
}

function scheduleOlderThreadHistoryLoad(
  scroller: HTMLElement,
  loadOlder: (() => Promise<boolean>) | undefined,
  now = Date.now(),
): void {
  if (!loadOlder || olderLoadInFlight || olderHistoryExhausted) return;
  if (now < olderLoadCooldownUntil) return;
  if (scheduledOlderLoad != null) return;
  scheduledOlderLoad = setTimeout(() => {
    scheduledOlderLoad = null;
    void runOlderThreadHistoryLoad(scroller, loadOlder);
  }, THREAD_HISTORY_OLDER_LOAD_DEBOUNCE_MS);
}

async function runOlderThreadHistoryLoad(
  scroller: HTMLElement,
  loadOlder: () => Promise<boolean>,
): Promise<void> {
  if (olderLoadInFlight || olderHistoryExhausted) return;
  if (scroller.scrollTop > THREAD_HISTORY_SCROLL_THRESHOLD_PX) return;

  olderLoadInFlight = true;
  const loadGeneration = paginationGeneration;
  beginProgrammaticThreadHistoryScroll();
  const previousHeight = scroller.scrollHeight;
  const previousTop = scroller.scrollTop;
  let loaded = false;
  try {
    loaded = await loadOlder();
  } finally {
    if (loadGeneration === paginationGeneration) {
      olderLoadInFlight = false;
    }
  }
  if (loadGeneration !== paginationGeneration) return;
  if (!loaded) {
    olderHistoryExhausted = true;
    endProgrammaticThreadHistoryScroll();
    return;
  }
  olderLoadCooldownUntil = Date.now() + THREAD_HISTORY_OLDER_LOAD_COOLDOWN_MS;
  afterLayout(() => {
    scroller.scrollTop = scroller.scrollHeight - previousHeight + previousTop;
    endProgrammaticThreadHistoryScroll();
    if (scroller.scrollTop <= THREAD_HISTORY_SCROLL_THRESHOLD_PX) {
      scheduleOlderThreadHistoryLoad(scroller, loadOlder, olderLoadCooldownUntil);
    }
  });
}

function cancelScheduledOlderThreadHistoryLoad(): void {
  if (scheduledOlderLoad == null) return;
  clearTimeout(scheduledOlderLoad);
  scheduledOlderLoad = null;
}

function afterPaint(fn: () => void): void {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(fn);
    return;
  }
  setTimeout(fn, 0);
}

function afterLayout(fn: () => void): void {
  afterPaint(() => afterPaint(fn));
}
