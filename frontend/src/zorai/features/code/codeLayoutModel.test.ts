import { describe, expect, it } from "vitest";
import {
  CODE_AGENT_DEFAULT_WIDTH,
  CODE_AGENT_MAX_WIDTH,
  CODE_AGENT_MIN_WIDTH,
  CODE_COLLAPSED_AGENT_WIDTH,
  CODE_COLLAPSED_EXPLORER_WIDTH,
  CODE_EDITOR_MIN_WIDTH,
  CODE_EXPLORER_DEFAULT_WIDTH,
  CODE_EXPLORER_MAX_WIDTH,
  CODE_EXPLORER_MIN_WIDTH,
  adjustCodePanelWidth,
  maxCodePanelWidth,
  resolveCodePanelWidths,
} from "./codeLayoutModel";

describe("resolveCodePanelWidths", () => {
  it("respects preferred widths when the viewport has room", () => {
    const resolved = resolveCodePanelWidths({
      viewportWidth: 1600,
      explorerPreferred: 280,
      agentPreferred: 320,
      explorerOpen: true,
      agentOpen: true,
    });

    expect(resolved).toMatchObject({ explorer: 280, agent: 320 });
    expect(resolved.editor).toBeGreaterThanOrEqual(CODE_EDITOR_MIN_WIDTH);
  });

  it("keeps the editor at least CODE_EDITOR_MIN_WIDTH on narrow viewports", () => {
    const resolved = resolveCodePanelWidths({
      viewportWidth: 900,
      explorerPreferred: 520,
      agentPreferred: 640,
      explorerOpen: true,
      agentOpen: true,
    });

    expect(resolved.editor).toBeGreaterThanOrEqual(CODE_EDITOR_MIN_WIDTH);
    expect(resolved.explorer).toBeLessThanOrEqual(520);
    expect(resolved.agent).toBeLessThanOrEqual(640);
  });

  it("clamps individual preferred widths into their min/max range", () => {
    const resolved = resolveCodePanelWidths({
      viewportWidth: 2400,
      explorerPreferred: 800,
      agentPreferred: 40,
      explorerOpen: true,
      agentOpen: true,
    });

    expect(resolved.explorer).toBe(CODE_EXPLORER_MAX_WIDTH);
    expect(resolved.explorer).toBe(520);
    expect(resolved.agent).toBe(CODE_AGENT_MIN_WIDTH);
    expect(resolved.agent).toBe(260);
  });

  it("uses collapsed widths when a panel is closed", () => {
    const resolved = resolveCodePanelWidths({
      viewportWidth: 1600,
      explorerPreferred: 280,
      agentPreferred: 320,
      explorerOpen: false,
      agentOpen: false,
    });

    expect(resolved.explorer).toBe(CODE_COLLAPSED_EXPLORER_WIDTH);
    expect(resolved.explorer).toBe(48);
    expect(resolved.agent).toBe(CODE_COLLAPSED_AGENT_WIDTH);
    expect(resolved.agent).toBe(40);
    expect(resolved.editor).toBe(1600 - 68 - 48 - 40);
  });

  it("accounts for only visible handles when panels are collapsed", () => {
    const explorerCollapsed = resolveCodePanelWidths({
      viewportWidth: 1000,
      explorerPreferred: 280,
      agentPreferred: 320,
      explorerOpen: false,
      agentOpen: true,
    });
    expect(explorerCollapsed.explorer + explorerCollapsed.agent + explorerCollapsed.editor + 68 + 5).toBe(1000);

    const agentCollapsed = resolveCodePanelWidths({
      viewportWidth: 1000,
      explorerPreferred: 280,
      agentPreferred: 320,
      explorerOpen: true,
      agentOpen: false,
    });
    expect(agentCollapsed.explorer + agentCollapsed.agent + agentCollapsed.editor + 68 + 5).toBe(1000);
  });

  it("gives the editor the remaining space on wide viewports", () => {
    const resolved = resolveCodePanelWidths({
      viewportWidth: 2400,
      explorerPreferred: 280,
      agentPreferred: 320,
      explorerOpen: true,
      agentOpen: true,
    });

    expect(resolved.editor).toBe(2400 - 280 - 320 - 68 - 5 - 5);
    expect(resolved.editor).toBe(1722);
  });

  it("shrinks open panels to fit a single collapsed sibling", () => {
    const resolved = resolveCodePanelWidths({
      viewportWidth: 900,
      explorerPreferred: 520,
      agentPreferred: 640,
      explorerOpen: false,
      agentOpen: true,
    });

    expect(resolved.explorer).toBe(CODE_COLLAPSED_EXPLORER_WIDTH);
    expect(resolved.agent).toBeLessThanOrEqual(CODE_AGENT_MAX_WIDTH);
    expect(resolved.editor).toBeGreaterThanOrEqual(CODE_EDITOR_MIN_WIDTH);
    expect(resolved.explorer + resolved.agent + resolved.editor + 68 + 5).toBe(900);
  });
});

describe("maxCodePanelWidth", () => {
  it("caps explorer width at its max while preserving the editor minimum", () => {
    expect(
      maxCodePanelWidth({
        panel: "explorer",
        viewportWidth: 1600,
        otherWidth: 320,
      }),
    ).toBe(CODE_EXPLORER_MAX_WIDTH);
  });

  it("caps agent width at the space left after the editor minimum", () => {
    expect(
      maxCodePanelWidth({
        panel: "agent",
        viewportWidth: 1200,
        otherWidth: 280,
      }),
    ).toBe(1200 - 280 - CODE_EDITOR_MIN_WIDTH - 68 - 5 - 5);
  });

  it("accounts for a collapsed sibling when computing the max", () => {
    expect(
      maxCodePanelWidth({
        panel: "agent",
        viewportWidth: 1200,
        otherWidth: CODE_COLLAPSED_EXPLORER_WIDTH,
      }),
    ).toBe(CODE_AGENT_MAX_WIDTH);
  });
});

describe("adjustCodePanelWidth", () => {
  it("moves explorer by the base step on ArrowRight", () => {
    expect(adjustCodePanelWidth("explorer", 280, "ArrowRight", false)).toBe(290);
  });

  it("moves agent by the shifted step on ArrowLeft", () => {
    expect(adjustCodePanelWidth("agent", 320, "ArrowLeft", true)).toBe(280);
  });

  it("clamps at the explorer bounds", () => {
    expect(adjustCodePanelWidth("explorer", 180, "ArrowLeft", false)).toBe(
      CODE_EXPLORER_MIN_WIDTH,
    );
    expect(adjustCodePanelWidth("explorer", 520, "ArrowRight", false)).toBe(
      CODE_EXPLORER_MAX_WIDTH,
    );
  });

  it("clamps at the agent bounds", () => {
    expect(adjustCodePanelWidth("agent", 260, "ArrowLeft", false)).toBe(CODE_AGENT_MIN_WIDTH);
    expect(adjustCodePanelWidth("agent", 640, "ArrowRight", false)).toBe(CODE_AGENT_MAX_WIDTH);
  });

  it("jumps to min on Home and max on End", () => {
    expect(adjustCodePanelWidth("explorer", 300, "Home", false)).toBe(CODE_EXPLORER_MIN_WIDTH);
    expect(adjustCodePanelWidth("explorer", 300, "End", false)).toBe(CODE_EXPLORER_MAX_WIDTH);
    expect(adjustCodePanelWidth("agent", 300, "Home", false)).toBe(CODE_AGENT_MIN_WIDTH);
    expect(adjustCodePanelWidth("agent", 300, "End", false)).toBe(CODE_AGENT_MAX_WIDTH);
  });

  it("uses the shifted step for both directions", () => {
    expect(adjustCodePanelWidth("explorer", 280, "ArrowRight", true)).toBe(320);
    expect(adjustCodePanelWidth("explorer", 280, "ArrowLeft", true)).toBe(240);
    expect(adjustCodePanelWidth("agent", 320, "ArrowRight", true)).toBe(360);
  });

  it("supports ArrowUp and ArrowDown as increase and decrease", () => {
    expect(adjustCodePanelWidth("explorer", 280, "ArrowUp", false)).toBe(290);
    expect(adjustCodePanelWidth("explorer", 280, "ArrowDown", false)).toBe(270);
  });

  it("ignores unknown keys and returns the current value", () => {
    expect(adjustCodePanelWidth("explorer", 280, "Enter", false)).toBe(280);
  });
});