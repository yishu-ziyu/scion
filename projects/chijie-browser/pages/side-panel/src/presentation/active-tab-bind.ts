/**
 * Phase 1 / S1 — pure helpers for binding tasks to the user's content tab.
 * No chrome.* here so unit tests stay node-friendly.
 */

export type ContentTabCandidate = {
  id?: number;
  url?: string;
  title?: string;
  active?: boolean;
  windowId?: number;
};

export type BoundContentTab = {
  tabId: number;
  url: string;
  title: string;
  host: string;
};

const BLOCKED_URL_PREFIXES = [
  'chrome://',
  'chrome-extension://',
  'edge://',
  'about:',
  'devtools://',
  'view-source:',
  'chrome-search://',
  'chrome-error://',
];

/** True when the tab is a normal web (or file) page agents can usefully read. */
export function isUsableContentTabUrl(url: string | undefined | null): boolean {
  if (!url || !url.trim()) return false;
  const u = url.trim();
  if (BLOCKED_URL_PREFIXES.some(prefix => u.startsWith(prefix))) return false;
  if (u === 'chrome://newtab/' || u.startsWith('chrome://new-tab-page')) return false;
  return true;
}

export function tabHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || url;
  } catch {
    return url;
  }
}

/**
 * Pick the best content tab from a query result.
 * Prefer active usable tabs; otherwise first usable; never invent ids.
 */
export function pickActiveContentTab(tabs: ContentTabCandidate[]): BoundContentTab | null {
  const withId = tabs.filter(tab => Number.isSafeInteger(tab.id) && (tab.id as number) >= 0);
  const usable = withId.filter(tab => isUsableContentTabUrl(tab.url));
  const activeUsable = usable.find(tab => tab.active) ?? usable[0];
  if (!activeUsable?.id || !activeUsable.url) return null;
  const title = (activeUsable.title ?? '').trim() || tabHost(activeUsable.url);
  return {
    tabId: activeUsable.id,
    url: activeUsable.url,
    title,
    host: tabHost(activeUsable.url),
  };
}

/** One-line chip copy: host · short title */
export function formatBindChip(bind: BoundContentTab | null, emptyLabel: string): string {
  if (!bind) return emptyLabel;
  const title = bind.title.replace(/\s+/g, ' ').trim();
  const short = title.length > 42 ? `${title.slice(0, 40)}…` : title;
  if (short && short !== bind.host) return `${bind.host} · ${short}`;
  return bind.host || short || emptyLabel;
}

export function formatBindDetail(bind: BoundContentTab | null): string {
  if (!bind) return '';
  return `${bind.title}\n${bind.url}`;
}
