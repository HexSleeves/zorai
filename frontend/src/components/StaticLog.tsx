import { memo, useState, lazy, Suspense } from "react";
import { detectFormat } from "../lib/dataParser";

const DataTable = lazy(() => import("./DataTable").then((m) => ({ default: m.DataTable })));

export const StaticLog = memo(function StaticLog({
    content,
    maxHeight = "100%",
    enableDataView = false,
}: {
    content: string;
    maxHeight?: number | string;
    enableDataView?: boolean;
}) {
    const [viewAsTable, setViewAsTable] = useState(false);
    const isStructured = enableDataView && detectFormat(content) !== "plain";

    if (viewAsTable && isStructured) {
        return (
            <div style={{ display: "flex", flexDirection: "column", maxHeight, overflow: "hidden" }}>
                <div style={{ display: "flex", justifyContent: "flex-end", padding: "4px 8px" }}>
                    <button onClick={() => setViewAsTable(false)} style={viewToggleBtn}>
                        Raw Text
                    </button>
                </div>
                <Suspense fallback={<div style={{ padding: 16, color: "var(--text-secondary)" }}>Loading...</div>}>
                    <DataTable data={content} />
                </Suspense>
            </div>
        );
    }

    return (
        <div style={{ position: "relative" }}>
            {isStructured && (
                <button
                    onClick={() => setViewAsTable(true)}
                    style={{ ...viewToggleBtn, position: "absolute", top: 8, right: 8, zIndex: 1 }}
                >
                    View as Table
                </button>
            )}
            <pre
                style={{
                    margin: 0,
                    padding: 16,
                    overflow: "auto",
                    maxHeight,
                    fontSize: "var(--text-sm)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontFamily: "var(--font-mono)",
                    color: "var(--text-primary)",
                    background: "rgba(255,255,255,0.03)",
                }}
            >
                {content}
            </pre>
        </div>
    );
});

const viewToggleBtn: React.CSSProperties = {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.1)",
    color: "var(--text-secondary)",
    borderRadius: 8,
    padding: "4px 10px",
    fontSize: "var(--text-sm)",
    cursor: "pointer",
    fontFamily: "inherit",
};