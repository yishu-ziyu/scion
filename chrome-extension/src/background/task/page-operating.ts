/**
 * Push design/005 page-operating bar state to the task's content tab.
 * Failures are silent (tab may lack content script: chrome://, PDF, etc.).
 */

export type PageOperatingSnapshot = {
  status?: string;
  activeTabId?: number;
  followForeground?: boolean;
} | null;

const MSG_TYPE = 'CHIJIE_PAGE_OPERATING' as const;
export const PAGE_OPERATING_STOP = 'CHIJIE_PAGE_OPERATING_STOP' as const;
export const PAGE_OPERATING_FOLLOW = 'CHIJIE_PAGE_OPERATING_FOLLOW' as const;
export const PAGE_OPERATING_TAKEOVER = 'CHIJIE_PAGE_OPERATING_TAKEOVER' as const;
export const PAGE_OPERATING_TEXT = '持节正在操作这个页面';
export const PAGE_OPERATING_FOLLOW_LABEL = '跟随';
export const PAGE_OPERATING_TAKEOVER_LABEL = '接管';

/** Only show bar while the task is actively driving the page. */
export function shouldShowPageOperatingBar(status: string | undefined): boolean {
  return status === 'running';
}

export type PageOperatingCancelTarget = {
  id: string;
  revision: number;
  status?: string;
  activeTabId?: number;
} | null;

/** Stop only if the click came from the tab this task is driving. */
export function pageOperatingCancelCommand(
  snapshot: PageOperatingCancelTarget,
  senderTabId: number | undefined,
  commandId: string,
): { type: 'cancel'; commandId: string; taskId: string; expectedRevision: number } | null {
  if (!snapshot?.id || snapshot.status !== 'running') return null;
  if (senderTabId === undefined || snapshot.activeTabId !== senderTabId) return null;
  return {
    type: 'cancel',
    commandId,
    taskId: snapshot.id,
    expectedRevision: snapshot.revision,
  };
}

export type PageOperatingBarMessage = {
  type: typeof MSG_TYPE;
  active: boolean;
  text?: string;
  follow?: boolean;
  followLabel?: string;
  takeoverLabel?: string;
};

export async function syncPageOperatingBar(
  snapshot: PageOperatingSnapshot,
  send: (tabId: number, message: PageOperatingBarMessage) => Promise<void>,
): Promise<void> {
  const tabId = snapshot?.activeTabId;
  if (tabId === undefined || !Number.isSafeInteger(tabId) || tabId < 0) return;

  const active = shouldShowPageOperatingBar(snapshot?.status);
  try {
    await send(tabId, {
      type: MSG_TYPE,
      active,
      text: active ? PAGE_OPERATING_TEXT : undefined,
      follow: Boolean(snapshot?.followForeground),
      followLabel: PAGE_OPERATING_FOLLOW_LABEL,
      takeoverLabel: PAGE_OPERATING_TAKEOVER_LABEL,
    });
  } catch {
    // Content script missing or tab gone - ignore.
  }
}

export async function chromeTabsSendMessage(tabId: number, message: PageOperatingBarMessage): Promise<void> {
  await chrome.tabs.sendMessage(tabId, message);
}

export function createPageOperatingBarSyncQueue(
  loadSnapshot: () => Promise<PageOperatingSnapshot>,
  send: (tabId: number, message: PageOperatingBarMessage) => Promise<void>,
  onError: (error: unknown) => void,
): () => Promise<void> {
  let tail = Promise.resolve();
  let visibleTabId: number | undefined;
  return () => {
    const run = tail.then(async () => {
      const snapshot = await loadSnapshot();
      const candidateTabId = snapshot?.activeTabId;
      const currentTabId =
        typeof candidateTabId === 'number' && Number.isSafeInteger(candidateTabId) && candidateTabId >= 0
          ? candidateTabId
          : undefined;
      if (visibleTabId !== undefined && visibleTabId !== currentTabId) {
        await syncPageOperatingBar({ activeTabId: visibleTabId }, send);
      }
      await syncPageOperatingBar(snapshot, send);
      visibleTabId = shouldShowPageOperatingBar(snapshot?.status) ? currentTabId : undefined;
    });
    tail = run.catch(onError);
    return run;
  };
}

export function pageOperatingFollowCommand(
  snapshot: PageOperatingCancelTarget,
  senderTabId: number | undefined,
  commandId: string,
  follow: boolean,
): { type: 'set_follow'; commandId: string; taskId: string; expectedRevision: number; follow: boolean } | null {
  if (!snapshot?.id || snapshot.status !== 'running') return null;
  if (senderTabId === undefined || snapshot.activeTabId !== senderTabId) return null;
  return {
    type: 'set_follow',
    commandId,
    taskId: snapshot.id,
    expectedRevision: snapshot.revision,
    follow,
  };
}

export function pageOperatingTakeoverCommand(
  snapshot: PageOperatingCancelTarget,
  senderTabId: number | undefined,
  commandId: string,
): { type: 'takeover'; commandId: string; taskId: string; expectedRevision: number } | null {
  if (!snapshot?.id || snapshot.status !== 'running') return null;
  if (senderTabId === undefined || snapshot.activeTabId !== senderTabId) return null;
  return {
    type: 'takeover',
    commandId,
    taskId: snapshot.id,
    expectedRevision: snapshot.revision,
  };
}
