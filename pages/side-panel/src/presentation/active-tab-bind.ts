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

type TaskBoundPage = {
  activeTabId?: number;
  targetRefs: Array<{
    kind: string;
    tabId: number;
    urlOrigin: string;
    normalizedUrl?: string;
    label?: string;
  }>;
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
export function pickActiveContentTab(
  tabs: ContentTabCandidate[],
  options: { requireActive?: boolean } = {},
): BoundContentTab | null {
  const withId = tabs.filter(tab => Number.isSafeInteger(tab.id) && (tab.id as number) >= 0);
  const usable = withId.filter(tab => isUsableContentTabUrl(tab.url));
  const activeUsable = usable.find(tab => tab.active) ?? (options.requireActive ? undefined : usable[0]);
  if (!activeUsable?.id || !activeUsable.url) return null;
  const title = (activeUsable.title ?? '').trim() || tabHost(activeUsable.url);
  return {
    tabId: activeUsable.id,
    url: activeUsable.url,
    title,
    host: tabHost(activeUsable.url),
  };
}

/** Side panel opened as a tab is active; chrome://newtab is the user's page and must not borrow another tab. */
export function shouldBorrowBackgroundContentTab(activeUrl?: string | null): boolean {
  if (!activeUrl) return false;
  return activeUrl.startsWith('chrome-extension://');
}

/**
 * Bind the tab the user is looking at.
 * chrome:// new tab / settings stay unbound. Do not steal a background http tab.
 */
export function bindTabForTask(tabs: ContentTabCandidate[]): BoundContentTab | null {
  const active = tabs.find(tab => tab.active);
  if (isUsableContentTabUrl(active?.url)) {
    return pickActiveContentTab(active ? [active] : [], { requireActive: true });
  }
  if (shouldBorrowBackgroundContentTab(active?.url)) {
    return pickActiveContentTab(tabs, { requireActive: false });
  }
  return null;
}

export function instructionPointsAtCurrentPage(instruction: string): boolean {
  return (
    /(?:当前|这个|本)(?:的)?(?:页面|网页|网站|页)|(?:页面|网页)(?:上|中|展示|内容)/.test(instruction) ||
    /\b(?:this|the|current)\s+(?:page|webpage|site)\b/i.test(instruction)
  );
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

/** Keep the live-task chip bound to the task page, even when the user activates another tab. */
export function taskBoundContentTab(task: TaskBoundPage, fallback: BoundContentTab | null): BoundContentTab | null {
  if (!Number.isSafeInteger(task.activeTabId)) return null;
  const tabId = task.activeTabId as number;
  const ref = [...task.targetRefs].reverse().find(item => item.kind === 'page' && item.tabId === tabId);
  if (!ref) return fallback?.tabId === tabId ? fallback : null;
  const url = ref.normalizedUrl || ref.urlOrigin;
  if (!isUsableContentTabUrl(url)) return fallback?.tabId === tabId ? fallback : null;
  const title = ref.label?.trim() || tabHost(url);
  return { tabId, url, title, host: tabHost(url) };
}
