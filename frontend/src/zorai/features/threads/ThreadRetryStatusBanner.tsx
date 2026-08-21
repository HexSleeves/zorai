import { formatThreadRetrySummary, type ThreadRetryStatus } from "./threadRetryStatus";

export function ThreadRetryStatusBanner({
  status,
  onStop,
}: {
  status: ThreadRetryStatus;
  onStop: () => void;
}) {
  return (
    <div className="zorai-retry-status" role="alert">
      <div className="zorai-retry-status__summary">{formatThreadRetrySummary(status)}</div>
      {status.message ? <p className="zorai-retry-status__message">{status.message}</p> : null}
      <button type="button" className="zorai-retry-status__stop" onClick={onStop}>
        Stop
      </button>
    </div>
  );
}
