export const THREAD_HISTORY_SCROLL_THRESHOLD_PX = 24;

export type ThreadHistoryScrollAction = "load-older" | "trim-latest" | "none";

let followBottom = true;
let ignoreScroll = false;

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
  requestAnimationFrame(() => {
    ignoreScroll = false;
  });
}

export function shouldIgnoreThreadHistoryScroll(): boolean {
  return ignoreScroll;
}

export function resetThreadHistoryScrollStateForTest(): void {
  followBottom = true;
  ignoreScroll = false;
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
    return "load-older";
  }
  if (atBottom) {
    followBottom = true;
    return "trim-latest";
  }
  followBottom = false;
  return "none";
}
