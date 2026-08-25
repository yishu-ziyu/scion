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
    return hostnameKey(a.hostname) === hostnameKey(b.hostname) && a.pathname.startsWith(b.pathname);
  } catch {
    return tab.includes(want);
  }
}

/**
 * Whether an already-open tab can stand in for open_tab(requestedUrl).
 * Same host (www-stripped). A homepage request covers any path on that host.
 * A longer request only covers that path or a child — not the site homepage.
 */
export function tabCanReuseForOpen(tabUrl: string, requestedUrl: string): boolean {
  try {
    const tab = parseHttpUrl(tabUrl);
    const want = parseHttpUrl(requestedUrl);
    if (!tab || !want) return false;
    if (hostnameKey(tab.hostname) !== hostnameKey(want.hostname)) return false;
    const wantPath = normalizePath(want.pathname);
    const tabPath = normalizePath(tab.pathname);
    if (wantPath === '/') return true;
    return tabPath === wantPath || tabPath.startsWith(`${wantPath}/`);
  } catch {
    return false;
  }
}

function hostnameKey(hostname: string): string {
  return hostname.replace(/^www\./i, '').toLowerCase();
}

function normalizePath(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  return pathname.replace(/\/+$/, '') || '/';
}

function parseHttpUrl(value: string): URL | null {
  const raw = value.trim();
  if (!raw) return null;
  const url = new URL(raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url;
}

function normalizeTabUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}
