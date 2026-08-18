/** Chrome tab-strip title for the pages a task opened or bound. */
export function taskTabGroupTitle(goal: string | undefined | null): string {
  const short = (goal ?? '').replace(/\s+/g, ' ').trim().slice(0, 18);
  return short ? `任务 · ${short}` : '任务';
}

export function isGroupableTabUrl(url: string | undefined | null): boolean {
  const value = (url ?? '').trim();
  if (!value) return false;
  return !value.startsWith('chrome-extension://') && !value.startsWith('chrome://') && !value.startsWith('edge://');
}
