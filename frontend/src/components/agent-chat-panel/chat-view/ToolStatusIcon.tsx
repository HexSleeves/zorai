import type { ToolEventGroup } from "./types";

const ICON_SIZE = 13;

function iconProps(label: string) {
  return {
    className: "acp-tool-status-icon",
    width: ICON_SIZE,
    height: ICON_SIZE,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 2.2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-label": label,
    role: "img" as const,
  };
}

export function ToolStatusIcon({ status }: { status: ToolEventGroup["status"] }) {
  switch (status) {
    case "done":
      return (
        <svg {...iconProps("ok")}>
          <path d="M20 6 9 17l-5-5" />
        </svg>
      );
    case "error":
      return (
        <svg {...iconProps("error")}>
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      );
    case "executing":
    case "requested":
    default:
      return (
        <svg {...iconProps("running")} className="acp-tool-status-icon acp-tool-status-icon--running">
          <path d="M21 12a9 9 0 1 1-9-9" />
        </svg>
      );
  }
}
