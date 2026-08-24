import { fileTypeForPath } from "./codeFileTypes";

export function CodeFileIcon({ path }: { path: string }) {
  const type = fileTypeForPath(path);
  return <span className={`zorai-code-file-icon type-${type.id}`} title={type.label} aria-label={`${type.label} file`}>{type.glyph}</span>;
}

export function CodeFolderChevron({ expanded }: { expanded: boolean }) {
  return <svg className="zorai-code-folder-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d={expanded ? "m3 5 5 5 5-5" : "m5 3 5 5-5 5"} /></svg>;
}
