import { languageForWorkspacePath } from "./codeLanguages";

export type ExternalBridgeSlice = {
  readFsText: (targetPath: string) => Promise<string | null>;
  getFsPathInfo?: (targetPath: string) => Promise<{ path: string; isDirectory: boolean; sizeBytes: number; modifiedAt: number; createdAt: number } | null>;
};

export type ExternalDocumentSeed = {
  path: string;
  content: string;
  sizeBytes: number;
  modifiedAt: number;
  language: string;
};

/**
 * Load an absolute file path from the host filesystem as a detached document.
 * Workspace root is not consulted; the document is keyed by its absolute path
 * so it cannot collide with workspace-relative entries.
 *
 * Throws on unreadable / non-file targets; the caller decides how to surface
 * the error in the workbench.
 */
export async function openExternalFileInWorkspace(
  bridge: ExternalBridgeSlice,
  absolutePath: string,
): Promise<ExternalDocumentSeed> {
  if (!absolutePath) throw new Error("No file selected");
  const info = bridge.getFsPathInfo ? await bridge.getFsPathInfo(absolutePath) : null;
  if (info && info.isDirectory) {
    throw new Error(`${absolutePath} is a directory, not a file.`);
  }
  const content = await bridge.readFsText(absolutePath);
  if (content === null || content === undefined) {
    throw new Error(`Unable to read ${absolutePath}.`);
  }
  const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
  const fallbackSize = content.length;
  const sizeBytes = info?.sizeBytes ?? (encoder ? encoder.encode(content).byteLength : fallbackSize);
  const modifiedAt = info?.modifiedAt ?? 0;
  return {
    path: absolutePath,
    content,
    sizeBytes,
    modifiedAt,
    language: languageForWorkspacePath(absolutePath),
  };
}
