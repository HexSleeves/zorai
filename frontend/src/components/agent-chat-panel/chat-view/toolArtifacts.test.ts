import { describe, expect, it } from "vitest";

import { extractToolArtifacts, type ToolArtifactReference } from "./toolArtifacts";

function paths(refs: ToolArtifactReference[]) {
  return refs.map((ref) => `${ref.provenance}:${ref.path}`);
}

describe("extractToolArtifacts", () => {
  it("extracts a nested POSIX argument path with argument provenance", () => {
    const refs = extractToolArtifacts(
      JSON.stringify({ request: { options: { output_path: "/home/user/report.txt" } } }),
      "",
    );

    expect(refs).toEqual([{ path: "/home/user/report.txt", provenance: "argument" }]);
  });

  it("extracts Windows drive paths in artifact arrays with artifact provenance", () => {
    const refs = extractToolArtifacts(
      JSON.stringify({ artifacts: [{ path: "C:\\Users\\me\\out.txt" }, "D:\\tmp\\next.log"] }),
      "",
    );

    expect(paths(refs)).toEqual([
      "artifact:C:\\Users\\me\\out.txt",
      "artifact:D:\\tmp\\next.log",
    ]);
  });

  it("extracts UNC paths", () => {
    const refs = extractToolArtifacts(JSON.stringify({ file_path: "\\\\server\\share\\out.txt" }), "");

    expect(refs).toEqual([{ path: "\\\\server\\share\\out.txt", provenance: "argument" }]);
  });

  it("extracts clear local paths from plain text result labels", () => {
    const refs = extractToolArtifacts("{}", "Saved file: /home/user/out.txt\nstatus: ok");

    expect(refs).toEqual([{ path: "/home/user/out.txt", provenance: "result" }]);
  });

  it("rejects unspecified plain text labels even when they contain valid paths", () => {
    const refs = extractToolArtifacts(
      "{}",
      [
        "path: /tmp/path.txt",
        "filepath: /tmp/filepath.txt",
        "output_path: /tmp/output.txt",
        "preview_path: /tmp/preview.txt",
        "artifact: /tmp/artifact.txt",
        "file: /tmp/file.txt",
      ].join("\n"),
    );

    expect(refs).toEqual([]);
  });

  it("rejects specified plain text labels when the value has trailing prose or command fragments", () => {
    const refs = extractToolArtifacts(
      "{}",
      [
        "Saved file: /tmp/out.txt extra words",
        "file_path: /tmp/out.txt (generated)",
        "Saved file: /tmp/a && echo hi",
      ].join("\n"),
    );

    expect(refs).toEqual([]);
  });

  it("accepts specified plain text labels when the entire value is a safely cleaned path", () => {
    const refs = extractToolArtifacts(
      "{}",
      [
        "file_path: '/tmp/quoted.txt',",
        "Saved file: ./report.md:20.",
        "Saved file: /tmp/exact.txt",
        "file_path: /tmp/file-path-exact.txt",
      ].join("\n"),
    );

    expect(paths(refs)).toEqual([
      "result:/tmp/quoted.txt",
      "result:./report.md",
      "result:/tmp/exact.txt",
      "result:/tmp/file-path-exact.txt",
    ]);
  });

  it("keeps accepting standalone local path lines", () => {
    const refs = extractToolArtifacts("{}", "/tmp/standalone.txt");

    expect(refs).toEqual([{ path: "/tmp/standalone.txt", provenance: "result" }]);
  });

  it("rejects URLs, operation IDs, flags, shell command fragments, pipes, and redirections", () => {
    const refs = extractToolArtifacts(
      JSON.stringify({
        path: "https://example.com/out.txt",
        file_path: "file:///home/user/out.txt",
        output: "exec_28445ddd-14ab-4d37-97c5-fcddca9639a5",
        file: "--pretty",
        filename: "cat /tmp/a",
        saved_to: "/tmp/a | less",
        preview_path: "/tmp/a > /tmp/b",
      }),
      "file_path: http://example.com/nope.txt\nSaved file: cat /tmp/a\n--flag\n/tmp/a | wc\n/tmp/a > /tmp/b",
    );

    expect(refs).toEqual([]);
  });

  it("dedupes normalized equivalent paths and upgrades to artifact provenance in place", () => {
    const refs = extractToolArtifacts(
      JSON.stringify({ output_path: "\"/tmp/out.txt\"" }),
      JSON.stringify({ artifacts: [{ path: "/tmp/out.txt" }] }),
    );

    expect(refs).toEqual([{ path: "/tmp/out.txt", provenance: "artifact" }]);
  });

  it("extracts relative, home-relative, current-directory, and parent-directory paths", () => {
    const refs = extractToolArtifacts(
      JSON.stringify({ files: ["~/notes.md", "./local.txt", "../up.log"] }),
      "",
    );

    expect(paths(refs)).toEqual([
      "artifact:~/notes.md",
      "artifact:./local.txt",
      "artifact:../up.log",
    ]);
  });

  it("respects recursion depth and 512-value scan bounds", () => {
    const tooDeep = { a: { b: { c: { d: { e: { f: { g: { h: { path: "/tmp/deep.txt" } } } } } } } } };
    const manyValues = Array.from({ length: 530 }, (_, index) => (
      index === 529 ? { path: "/tmp/too-late.txt" } : { note: `value-${index}` }
    ));

    const refs = extractToolArtifacts(
      JSON.stringify({ ok: { a: { b: { c: { d: { e: { f: { path: "/tmp/depth-8.txt" } } } } } } }, tooDeep }),
      JSON.stringify({ files: manyValues }),
    );

    expect(paths(refs)).toEqual(["argument:/tmp/depth-8.txt"]);
  });

  it("falls back to bounded result text only when JSON is malformed", () => {
    const refs = extractToolArtifacts(
      "Saved file: /tmp/from-args.txt",
      "{not json}\nfile_path: /tmp/from-result.txt",
    );

    expect(refs).toEqual([{ path: "/tmp/from-result.txt", provenance: "result" }]);
  });

  it("cleans safe punctuation and line suffixes without corrupting Windows drive colons", () => {
    const refs = extractToolArtifacts(
      JSON.stringify({ path: "'/home/user/out.txt:12:4',", file: "C:\\tmp\\out.txt:9" }),
      "Saved file: ./report.md:20.",
    );

    expect(paths(refs)).toEqual([
      "argument:/home/user/out.txt",
      "argument:C:\\tmp\\out.txt",
      "result:./report.md",
    ]);
  });
});
