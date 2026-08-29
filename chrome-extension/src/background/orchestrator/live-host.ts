import type { TaskManager } from '../task/manager';
import { collectPageContextFromTab, preparePageSummaryContext } from '../page-summary-stream';
import { normalizeVisiblePageText } from '../browser/kernel/visible-text';
import type { OrchestratorHost, PageRead } from './types';

function isHttpTab(tab: chrome.tabs.Tab | undefined): tab is chrome.tabs.Tab & { id: number } {
  if (!tab?.id) return false;
  return Boolean(tab.url?.startsWith('http') || tab.pendingUrl?.startsWith('http'));
}

function newestHttpTab(tabs: chrome.tabs.Tab[]): (chrome.tabs.Tab & { id: number }) | undefined {
  const httpTabs = tabs.filter(isHttpTab);
  httpTabs.sort((left, right) => (right.lastAccessed ?? 0) - (left.lastAccessed ?? 0));
  return httpTabs[0];
}

/** Prefer a window's current page over a background tab that was lastAccessed more recently. */
export function pickPreferredHttpTabId(tabs: chrome.tabs.Tab[]): number {
  const httpTabs = tabs.filter(isHttpTab);
  const activeHttp = httpTabs.filter(tab => tab.active);
  const pool = activeHttp.length > 0 ? activeHttp : httpTabs;
  pool.sort((left, right) => (right.lastAccessed ?? 0) - (left.lastAccessed ?? 0));
  return pool[0]?.id ?? -1;
}

/** Prefer the focused window's page; if that window has no http tab (side panel, DevTools), use any window. */
export function pickActiveHttpTabId(input: {
  activeInFocus: chrome.tabs.Tab[];
  inFocus: chrome.tabs.Tab[];
  all: chrome.tabs.Tab[];
}): number {
  const activeHttp = input.activeInFocus.find(isHttpTab);
  if (activeHttp) return activeHttp.id;
  const inFocusHttp = newestHttpTab(input.inFocus);
  if (inFocusHttp) return inFocusHttp.id;
  return pickPreferredHttpTabId(input.all);
}

async function getActiveHttpTabId(): Promise<number> {
  const focused = { lastFocusedWindow: true as const };
  const [activeInFocus, inFocus, all] = await Promise.all([
    chrome.tabs.query({ active: true, ...focused }),
    chrome.tabs.query(focused),
    chrome.tabs.query({}),
  ]);
  return pickActiveHttpTabId({ activeInFocus, inFocus, all });
}

async function readVisibleCurrentPage(): Promise<PageRead> {
  const tabId = await getActiveHttpTabId();
  if (tabId < 0) return { ok: false, error: 'No web page is active.' };
  const collected = await collectPageContextFromTab(tabId);
  if (!collected) return { ok: false, error: 'Could not read the current page.' };
  const prepared = preparePageSummaryContext(collected);
  return {
    ok: true,
    title: prepared.page.title,
    url: prepared.page.url,
    text: normalizeVisiblePageText(prepared.page.text),
  };
}

/** Wire TaskManager + current-page helpers for the service worker. */
export function createLiveOrchestratorHost(taskManager: TaskManager): OrchestratorHost {
  return {
    getActiveTask: () => taskManager.activeSnapshot(),
    getTask: taskId => taskManager.snapshot(taskId),
    dispatchTask: command => taskManager.dispatch(command),
    subscribeTask: listener => taskManager.subscribe(listener),
    readCurrentPage: readVisibleCurrentPage,
    getActiveTabId: getActiveHttpTabId,
  };
}
