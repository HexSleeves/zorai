interface SpinnerProps {
  variant?: "spinner";
  size?: number;
  label?: string;
  className?: string;
}

interface SkeletonProps {
  variant: "skeleton";
  width?: string | number;
  height?: string | number;
  lines?: number;
  className?: string;
}

interface ProgressProps {
  variant: "progress";
  value: number; // 0-100
  label?: string;
  className?: string;
}

type LoadingStateProps = SpinnerProps | SkeletonProps | ProgressProps;

export function LoadingState(props: LoadingStateProps) {
  const variant = props.variant ?? "spinner";
  const className = ["zorai-loading-state", props.className].filter(Boolean).join(" ");

  if (variant === "skeleton") {
    const { width = "100%", height = 14, lines = 3 } = props as SkeletonProps;
    return (
      <div className={`${className} zorai-loading-skeleton`} role="presentation">
        {Array.from({ length: lines }, (_, i) => (
          <div
            key={i}
            className="zorai-loading-skeleton__line"
            style={{ width: i === lines - 1 ? "60%" : width, height }}
          />
        ))}
      </div>
    );
  }

  if (variant === "progress") {
    const { value, label } = props as ProgressProps;
    const clamped = Math.max(0, Math.min(100, value));
    return (
      <div className={`${className} zorai-loading-progress`} role="status" aria-live="polite">
        {label && <div className="zorai-loading-progress__label"><span>{label}</span><span>{Math.round(clamped)}%</span></div>}
        <div className="zorai-loading-progress__track"><div className="zorai-loading-progress__bar" style={{ width: `${clamped}%` }} /></div>
      </div>
    );
  }

  const { size = 20, label } = props as SpinnerProps;
  return (
    <div className={`${className} zorai-loading-spinner`} role="status" aria-live="polite">
      <span className="zorai-loading-spinner__ring" style={{ width: size, height: size }} aria-hidden="true" />
      {label && <span className="zorai-loading-spinner__label">{label}</span>}
    </div>
  );
}

export function LoadingPanel({ label = "Loading…", className = "" }: { label?: string; className?: string }) {
  return <div className={["zorai-loading-panel", className].filter(Boolean).join(" ")}><LoadingState label={label} /></div>;
}

export function ThreadListSkeleton({ rows = 5 }: { rows?: number }) {
  return <div className="zorai-thread-list-skeleton" aria-label="Loading threads" role="status">
    {Array.from({ length: rows }, (_, index) => <LoadingState key={index} variant="skeleton" lines={3} className="zorai-thread-list-skeleton__row" />)}
  </div>;
}
