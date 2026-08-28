import { useEffect, useState } from "react";
import { useCommitGraphLayout } from "./commitGraphLayout";
import { loadWorkspaceGraphHistory, type WorkspaceGraphCommit } from "./workspaceRefresh";

const PAGE_SIZE = 200;

export function CommitGraph({ root, bridge }: {
  root: string;
  bridge: Pick<ZoraiBridge, "workspaceGitHistory">;
}) {
  const [commits, setCommits] = useState<WorkspaceGraphCommit[]>([]);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadWorkspaceGraphHistory(bridge, root, limit)
      .then((next) => { if (!cancelled) { setCommits(next); setError(null); } })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [root, bridge, limit]);

  const rows = useCommitGraphLayout(commits);
  const laneCount = Math.max(1, ...rows.map((row) => row.graph.lane + 1));

  return (
    <div className="zorai-commit-graph" role="list" aria-label="Commit graph">
      {error ? <div className="zorai-commit-graph-error" role="alert">{error}</div> : null}
      {!loading && rows.length === 0 && !error ? <div className="zorai-commit-graph-empty">No commits.</div> : null}
      {rows.map((row) => (
        <div className="zorai-commit-graph-row" role="listitem" key={row.hash} title={`${row.shortHash} ${row.subject}`}>
          <span className="zorai-commit-graph-cells" aria-hidden="true">
            {Array.from({ length: laneCount }, (_, column) => {
              const isNode = column === row.graph.lane;
              const isOut = row.graph.outLanes.includes(column) && !isNode;
              const isIn = row.graph.inLane === column && !isNode && !isOut;
              return <i key={column} className={isNode ? "is-node" : isOut ? "is-out" : isIn ? "is-in" : undefined} />;
            })}
          </span>
          <span className="zorai-commit-graph-hash">{row.shortHash}</span>
          <span className="zorai-commit-graph-subject">
            {row.subject}
            {row.refs.length > 0 ? (
              <span className="zorai-commit-graph-refs">
                {row.refs.map((ref) => <em key={ref}>{ref}</em>)}
              </span>
            ) : null}
          </span>
          <span className="zorai-commit-graph-author">{row.author}</span>
        </div>
      ))}
      {rows.length >= limit ? (
        <button type="button" className="zorai-commit-graph-more" onClick={() => setLimit((current) => current + PAGE_SIZE)}>
          Show more
        </button>
      ) : null}
    </div>
  );
}
