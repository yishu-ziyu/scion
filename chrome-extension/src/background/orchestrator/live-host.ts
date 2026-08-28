import type { TaskManager } from '../task/manager';
import { collectPageContextFromTab, preparePageSummaryContext } from '../page-summary-stream';
import { normalizeVisiblePageText } from '../browser/kernel/visible-text';
import type { OrchestratorHost, PageRead } from './types';

function isHttpTab(tab: chrome.tabs.Tab | undefined): tab is chrome.tabs.Tab & { id: number } {
  if (!tab?.id) return false;
  return Boolean(tab.url?.startsWith('http') || tab.pendingUrl?.startsWith('http'));
}

async function getActiveHttpTabId(): Promise<number> {
  const focused = { lastFocusedWindow: true as const };
  const activeHttp = (await chrome.tabs.query({ active: true, ...focused })).find(isHttpTab);
  if (activeHttp) return activeHttp.id;
  // Real side panel keeps the article tab active. A side-panel *tab* (e2e / unpacked
  // debug) does not — still read the newest http tab in that window, never attach.
  const httpTabs = (await chrome.tabs.query(focused)).filter(isHttpTab);
  httpTabs.sort((left, right) => (right.lastAccessed ?? 0) - (left.lastAccessed ?? 0));
  return httpTabs[0]?.id ?? -1;
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
