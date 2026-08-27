import { useMemo } from "react";
import type { WorkspaceGraphCommit } from "./workspaceRefresh";

export type GraphLane = {
  /** Column index of the commit node. */
  lane: number;
  /** Connections drawn above the node (parent side). */
  inLane: number | null;
  /** Connections drawn below the node (child side). */
  outLanes: number[];
};

export type LaidOutCommit = WorkspaceGraphCommit & { graph: GraphLane };

/**
 * Assign each commit a lane and connection set for a first-parent-friendly
 * column graph. Topo-order input assumed (the loader uses --topo-order).
 *
 * Algorithm: maintain active lanes keyed by branch tip hash. Each commit:
 * 1. Takes over the lane whose tip matches its hash (or claims the lowest
 *    free lane).
 * 2. Emits its parents into free lanes (first parent keeps the commit's own
 *    lane when possible) and records connection columns for rendering.
 */
export function layoutCommitGraph(commits: WorkspaceGraphCommit[], maxLanes = 8): LaidOutCommit[] {
  const laneTips: Array<string | null> = Array.from({ length: maxLanes }, () => null);
  const laneOfHash = new Map<string, number>();
  const rows: LaidOutCommit[] = [];

  for (const commit of commits) {
    let lane = laneOfHash.get(commit.hash) ?? -1;
    if (lane < 0) {
      lane = laneTips.findIndex((tip) => tip === null);
      if (lane < 0) lane = 0; // overflow: pin to first lane, graph degrades gracefully
    }
    laneTips[lane] = null; // vacate: this commit consumes the lane tip

    const outLanes: number[] = [];
    commit.parents.forEach((parent, index) => {
      let parentLane = laneOfHash.get(parent) ?? -1;
      if (parentLane < 0) {
        if (index === 0) {
          parentLane = lane; // first parent continues in the same column
        } else {
          parentLane = laneTips.findIndex((tip) => tip === null);
          if (parentLane < 0) parentLane = laneTips.length - 1;
        }
      }
      laneTips[parentLane] = parent;
      laneOfHash.set(parent, parentLane);
      if (!outLanes.includes(parentLane)) outLanes.push(parentLane);
    });

    rows.push({ ...commit, graph: { lane, inLane: outLanes.includes(lane) ? lane : outLanes[0] ?? null, outLanes } });
  }
  return rows;
}

export function useCommitGraphLayout(commits: WorkspaceGraphCommit[], maxLanes = 8): LaidOutCommit[] {
  return useMemo(() => layoutCommitGraph(commits, maxLanes), [commits, maxLanes]);
}

const GLYPHS: Record<string, string> = {
  "0": "│", "01": "│", "10": "│", "11": "│",
  "02": "│", "20": "│", "22": "│", "12": "│", "21": "│",
};

/** Pure glyph row builder kept out of the component for unit testing. */
export function graphRowGlyphs(row: LaidOutCommit, laneCount: number): string[] {
  const cells: string[] = Array.from({ length: laneCount }, () => " ");
  cells[row.graph.lane] = "●";
  for (const out of row.graph.outLanes) {
    if (out !== row.graph.lane) cells[out] = GLYPHS[`${row.graph.lane}${out}`] ?? "╷";
  }
  return cells;
}
