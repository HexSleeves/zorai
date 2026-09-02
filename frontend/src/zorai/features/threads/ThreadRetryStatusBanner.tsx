import {
  formatThreadRetrySummary,
  retryStatusShowsPromptActions,
  retryWaitRemainingMs,
  type ThreadRetryStatus,
} from "./threadRetryStatus";

export function ThreadRetryStatusBanner({
  status,
  onRetryNow,
  onStop,
}: {
  status: ThreadRetryStatus;
  onRetryNow: () => void;
  onStop: () => void;
}) {
  const seconds = Math.max(1, Math.ceil(retryWaitRemainingMs(status) / 1000));
  const showPromptActions = retryStatusShowsPromptActions(status);

  return (
    <div className="zorai-retry-status" role="alert">
      <div className="zorai-retry-status__summary">{formatThreadRetrySummary(status)}</div>
      {status.message ? <p className="zorai-retry-status__message">{status.message}</p> : null}
      {showPromptActions ? (
        <div className="zorai-retry-status__actions">
          <button type="button" className="zorai-primary-button" onClick={onRetryNow}>
            {`Yes, retry now${seconds > 0 ? ` (${seconds}s)` : ""}`}
          </button>
          <button type="button" className="zorai-ghost-button" onClick={onStop}>No, stop</button>
        </div>
      ) : (
        <button type="button" className="zorai-retry-status__stop" onClick={onStop}>
          Stop
        </button>
      )}
    </div>
  );
}
