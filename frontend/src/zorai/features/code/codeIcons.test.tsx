import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CodeIcon } from "./CodeIcon";
import { CodeIconButton } from "./CodeIconButton";

const primaryCommands = [
  "file.save",
  "file.reload",
  "file.quickOpen",
  "search.file",
  "search.project",
  "edit.formatDocument",
  "view.commandPalette",
  "view.settings",
  "view.toggleWrap",
  "view.toggleMinimap",
] as const;

describe("Code SVG command controls", () => {
  it.each(primaryCommands)("renders %s as an accessible SVG button", (commandId) => {
    const html = renderToStaticMarkup(<CodeIconButton commandId={commandId} onClick={() => undefined} />);

    expect(html).toContain("<button");
    expect(html).toContain("aria-label=");
    expect(html).toContain("<svg");
    expect(html).not.toMatch(/>[★●⚙⌘↻💾]+</u);
  });

  it("shows the command title and platform binding in the tooltip", () => {
    const html = renderToStaticMarkup(<CodeIconButton commandId="file.save" onClick={() => undefined} />);

    expect(html).toContain('aria-label="Save"');
    expect(html).toContain('title="Save (Ctrl+S)"');
  });

  it("explains why a command is disabled", () => {
    const html = renderToStaticMarkup(
      <CodeIconButton commandId="file.save" disabled disabledReason="No unsaved changes" onClick={() => undefined} />,
    );

    expect(html).toContain("disabled");
    expect(html).toContain('title="Save — No unsaved changes"');
  });

  it("dispatches only through the supplied command handler", () => {
    const onClick = vi.fn();
    const element = CodeIconButton({ commandId: "file.reload", onClick });

    element.props.onClick();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("provides actual SVG geometry for every toolbar icon", () => {
    const html = renderToStaticMarkup(
      <>{["save", "reload", "file", "search", "settings", "palette", "external", "reveal", "minimap", "wrap", "edit"].map((icon) => <CodeIcon key={icon} icon={icon as Parameters<typeof CodeIcon>[0]["icon"]} />)}</>,
    );

    expect(html.match(/<svg/g)).toHaveLength(11);
    expect(html).toMatch(/<(path|circle|rect) /);
  });
});
