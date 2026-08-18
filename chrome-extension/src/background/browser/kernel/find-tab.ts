/** After the task is bound, find_tab {active:true} must not follow the user to a new page. */
export function preferBoundTabForActiveFind(
  boundTabId: number | null | undefined,
  focusedTabId: number | undefined,
): number | undefined {
  if (typeof boundTabId === 'number' && Number.isSafeInteger(boundTabId) && boundTabId >= 0) {
    return boundTabId;
  }
  return focusedTabId;
}

/** Match a find_tab query to an open tab URL the way WebBridge does: exact, prefix, or same path. */
export function tabUrlMatchesQuery(tabUrl: string, query: string): boolean {
  const tab = normalizeTabUrl(tabUrl);
  const want = normalizeTabUrl(query);
  if (!tab || !want) return false;
  if (tab === want) return true;
  if (tab.startsWith(want) || want.startsWith(tab)) return true;
  try {
    const a = new URL(tab);
    const b = new URL(want.startsWith('http') ? want : `https://${want}`);
    return a.hostname.replace(/^www\./, '') === b.hostname.replace(/^www\./, '') && a.pathname.startsWith(b.pathname);
  } catch {
    return tab.includes(want);
  }
}

function normalizeTabUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}
