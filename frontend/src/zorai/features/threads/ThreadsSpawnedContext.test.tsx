import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SpawnedContext } from "./ThreadsSpawnedContext";

describe("SpawnedContext", () => {
  it("keeps parent navigation visible when an opened child has no spawned agents", () => {
    const html = renderToStaticMarkup(
      <SpawnedContext
        tree={null}
        selectedDaemonThreadId="daemon-child"
        canGoBackThread={true}
        threadNavigationDepth={1}
        backThreadTitle="Parent Thread"
        canOpenSpawnedThread={() => false}
        openSpawnedThread={vi.fn(async () => false)}
        goBackThread={vi.fn()}
      />,
    );

    expect(html).toContain("Back to Parent Thread");
    expect(html).toContain("1 hop history");
    expect(html).toContain("No spawned agents for this thread yet.");
    expect(html).not.toContain('disabled=""');
  });
});
