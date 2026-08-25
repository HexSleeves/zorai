export function shouldRestoreWorkspaceDocument(
  activeFile: string | null | undefined,
  documents: Record<string, unknown>,
): boolean {
  if (!activeFile) return false;
  return !Object.prototype.hasOwnProperty.call(documents, activeFile);
}
