export async function runWorkspaceGitMutation<T>(mutate: () => Promise<T | undefined>, refresh: () => Promise<void>): Promise<T | undefined> {
  try {
    return await mutate();
  } finally {
    await refresh();
  }
}

export async function runWorkspaceGitBulkMutation<T>(items: T[], mutate: (item: T) => Promise<unknown> | undefined, refresh: () => Promise<void>): Promise<void> {
  const failures: unknown[] = [];
  for (const item of items) {
    try {
      await mutate(item);
    } catch (reason) {
      failures.push(reason);
    }
  }
  await refresh();
  if (failures.length > 0) throw failures[0];
}

export function confirmWorkspaceDiscard(message: string, confirm: (message: string) => boolean = window.confirm): boolean {
  return confirm(message);
}
