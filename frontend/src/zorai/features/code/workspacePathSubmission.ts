export async function submitWorkspacePath(
  path: string,
  busy: boolean,
  onSubmit: (path: string) => void | Promise<void>,
): Promise<boolean> {
  const nextPath = path.trim();
  if (!nextPath || busy) return false;
  await onSubmit(nextPath);
  return true;
}
