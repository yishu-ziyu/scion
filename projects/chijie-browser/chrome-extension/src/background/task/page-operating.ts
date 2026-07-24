/**
 * Push design/005 page-operating bar state to the task's content tab.
 * Failures are silent (tab may lack content script: chrome://, PDF, etc.).
 */

export type PageOperatingSnapshot = {
  status?: string;
  activeTabId?: number;
} | null;

const MSG_TYPE = 'CHIJIE_PAGE_OPERATING' as const;

/** Only show bar while the task is actively driving the page (not waiting for approval). */
export function shouldShowPageOperatingBar(status: string | undefined): boolean {
  return status === 'running';
}

export async function syncPageOperatingBar(
  snapshot: PageOperatingSnapshot,
  send: (tabId: number, message: { type: typeof MSG_TYPE; active: boolean; text?: string }) => Promise<void>,
): Promise<void> {
  const tabId = snapshot?.activeTabId;
  if (tabId === undefined || !Number.isSafeInteger(tabId) || tabId < 0) return;

  const active = shouldShowPageOperatingBar(snapshot?.status);
  try {
    await send(tabId, {
      type: MSG_TYPE,
      active,
      text: active ? '正在替你操作此页' : undefined,
    });
  } catch {
    // Content script missing or tab gone - ignore.
  }
}

export async function chromeTabsSendMessage(
  tabId: number,
  message: { type: typeof MSG_TYPE; active: boolean; text?: string },
): Promise<void> {
  await chrome.tabs.sendMessage(tabId, message);
}
