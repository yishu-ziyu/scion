import { beforeEach, describe, expect, it, vi } from 'vitest';

const tabsApi = vi.hoisted(() => {
  const updatedListeners = new Set<
    (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void
  >();

  return {
    query: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    reload: vi.fn(),
    onActivated: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    onUpdated: {
      addListener: vi.fn(listener => updatedListeners.add(listener)),
      removeListener: vi.fn(listener => updatedListeners.delete(listener)),
    },
    group: vi.fn(),
    emitUpdated(tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) {
      updatedListeners.forEach(listener => listener(tabId, changeInfo, tab));
    },
    resetListeners() {
      updatedListeners.clear();
    },
  };
});

const tabGroupsApi = vi.hoisted(() => ({
  update: vi.fn(),
}));

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      runtime: { id: 'test-extension' },
      tabs: tabsApi,
      tabGroups: tabGroupsApi,
      windows: { update: vi.fn() },
    },
  });
});

vi.mock('../../services/analytics', () => ({
  analytics: { trackDomainVisit: vi.fn() },
}));

import BrowserContext from '../context';
import Page from '../page';
import { URLNotAllowedError } from '../views';

const extensionTab = {
  id: 1,
  active: true,
  url: 'chrome-extension://test-extension/side-panel/index.html',
  title: 'Nanobrowser',
} as chrome.tabs.Tab;

const contentTab = {
  id: 2,
  active: false,
  url: 'https://example.com/',
  title: 'Example Domain',
} as chrome.tabs.Tab;

const pendingContentTab = {
  ...contentTab,
  id: 3,
  url: '',
  pendingUrl: 'https://example.com/loading',
} as chrome.tabs.Tab;

const pendingExtensionTab = {
  ...contentTab,
  id: 4,
  pendingUrl: extensionTab.url,
} as chrome.tabs.Tab;

const pendingContentFromExtensionTab = {
  ...extensionTab,
  id: 5,
  pendingUrl: pendingContentTab.pendingUrl,
} as chrome.tabs.Tab;

const fallbackContentTab = {
  ...contentTab,
  id: 6,
} as chrome.tabs.Tab;

const blankTab = {
  id: 7,
  active: true,
  url: 'about:blank',
  title: 'New Tab',
} as chrome.tabs.Tab;

const boundWindowTab = {
  ...contentTab,
  id: 8,
  active: true,
  windowId: 10,
} as chrome.tabs.Tab;

const otherWindowTab = {
  ...contentTab,
  id: 9,
  active: true,
  windowId: 11,
} as chrome.tabs.Tab;

const currentTabBecomesMixed = {
  ...pendingContentFromExtensionTab,
  id: contentTab.id,
} as chrome.tabs.Tab;

const normalizedDangerousUrls = [
  { label: 'javascript with LF', url: 'java\nscript:alert(1)' },
  { label: 'javascript with TAB', url: 'java\tscript:alert(1)' },
  { label: 'javascript with CR', url: 'java\rscript:alert(1)' },
  { label: 'javascript after a leading NUL', url: '\u0000javascript:alert(1)' },
  { label: 'data with TAB', url: 'da\tta:text/html,unsafe' },
  { label: 'file with TAB', url: 'file\t:///etc/passwd' },
  { label: 'vbscript with LF', url: 'vb\nscript:msgbox(1)' },
] as const;

const browserUrlGuardCases = (['navigateTo', 'openTab'] as const).flatMap(operation =>
  normalizedDangerousUrls.map(({ label, url }) => ({ operation, label, url })),
);

describe('BrowserContext tab selection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    tabsApi.resetListeners();
  });

  it.each(browserUrlGuardCases)(
    '$operation rejects $label before reading or changing browser state',
    async ({ operation, url }) => {
      const context = new BrowserContext({});
      const getCurrentPage = vi.spyOn(context, 'getCurrentPage');
      const navigatePage = vi.spyOn(Page.prototype, 'navigateTo').mockResolvedValue();

      await expect(context[operation](url)).rejects.toBeInstanceOf(URLNotAllowedError);

      expect(getCurrentPage).toHaveBeenCalledTimes(0);
      expect(tabsApi.create).toHaveBeenCalledTimes(0);
      expect(navigatePage).toHaveBeenCalledTimes(0);
    },
  );

  it('does not attach a sibling content tab when the active tab is the side panel', async () => {
    tabsApi.query.mockImplementation(async query => (query.active ? [extensionTab] : [extensionTab, contentTab]));
    tabsApi.create.mockResolvedValue(blankTab);
    tabsApi.get.mockResolvedValue(blankTab);
    const attachPuppeteer = vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(false);
    const context = new BrowserContext({});

    const page = await context.getCurrentPage();

    expect(page.tabId).toBe(blankTab.id);
    expect(page.tabId).not.toBe(contentTab.id);
    expect(context.getBoundTabId()).not.toBe(contentTab.id);
    expect(tabsApi.create).toHaveBeenCalledWith({ url: context.getConfig().homePageUrl, active: false });
    expect(attachPuppeteer).toHaveBeenCalledTimes(1);
    expect(page.attached).toBe(false);
  });

  it('attaches a bound task tab even when the side panel is the active tab', async () => {
    tabsApi.query.mockImplementation(async query => (query.active ? [extensionTab] : [extensionTab, contentTab]));
    tabsApi.get.mockResolvedValue(contentTab);
    const attachPuppeteer = vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(true);
    const context = new BrowserContext({});

    await expect(context.switchTab(contentTab.id!)).resolves.toMatchObject({ tabId: contentTab.id });

    expect(attachPuppeteer).toHaveBeenCalledOnce();
    expect(context.getBoundTabId()).toBe(contentTab.id);
    expect(tabsApi.create).not.toHaveBeenCalled();
  });

  it('binds tab discovery and switching to the task window', async () => {
    tabsApi.get.mockImplementation(async id => (id === boundWindowTab.id ? boundWindowTab : otherWindowTab));
    tabsApi.query.mockResolvedValue([boundWindowTab]);
    vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(true);
    const context = new BrowserContext({});

    await context.bindToTab(boundWindowTab.id!);
    await expect(context.getAllTabIds()).resolves.toEqual(new Set([boundWindowTab.id]));
    expect(tabsApi.query).toHaveBeenCalledWith({ windowId: boundWindowTab.windowId });
    await expect(context.switchTab(otherWindowTab.id!)).rejects.toThrow('outside the task window');
  });

  it('omits extension pages from the tab inventory exposed to agents', async () => {
    tabsApi.query.mockResolvedValue([extensionTab, contentTab]);

    await expect(new BrowserContext({}).getTabInfos()).resolves.toEqual([
      { id: contentTab.id, url: contentTab.url, title: contentTab.title },
    ]);
  });

  it('omits a tab until its pending web navigation replaces a forbidden committed page', async () => {
    tabsApi.query.mockResolvedValue([pendingContentFromExtensionTab]);

    await expect(new BrowserContext({}).getTabInfos()).resolves.toEqual([]);
  });

  it('does not attach a pending web navigation or a sibling tab while an extension page remains committed', async () => {
    tabsApi.query.mockImplementation(async query =>
      query.active ? [pendingContentFromExtensionTab] : [pendingContentFromExtensionTab, contentTab],
    );
    tabsApi.create.mockResolvedValue(blankTab);
    tabsApi.get.mockResolvedValue(blankTab);
    vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(false);
    const context = new BrowserContext({});

    const page = await context.getCurrentPage();

    expect(page.tabId).toBe(blankTab.id);
    expect(page.tabId).not.toBe(pendingContentFromExtensionTab.id);
    expect(page.tabId).not.toBe(contentTab.id);
    expect(tabsApi.create).toHaveBeenCalledOnce();
  });

  it('revalidates the current tab before reusing it', async () => {
    let currentTabChanged = false;
    tabsApi.query.mockImplementation(async query => {
      if (!currentTabChanged) return [contentTab];
      return query.active ? [currentTabBecomesMixed] : [currentTabBecomesMixed, fallbackContentTab];
    });
    tabsApi.get
      .mockResolvedValueOnce(contentTab)
      .mockResolvedValueOnce(contentTab)
      .mockResolvedValueOnce(currentTabBecomesMixed)
      .mockResolvedValue(fallbackContentTab);
    const context = new BrowserContext({});
    vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(true);

    expect((await context.getCurrentPage()).tabId).toBe(contentTab.id);
    currentTabChanged = true;

    expect((await context.getCurrentPage()).tabId).toBe(fallbackContentTab.id);
  });

  it('waits for a pending URL to commit before attaching the page', async () => {
    const committedTab = {
      ...pendingContentTab,
      url: 'https://example.com/final',
      pendingUrl: undefined,
      status: 'complete',
      title: 'Committed page',
    } as chrome.tabs.Tab;
    tabsApi.query.mockResolvedValue([pendingContentTab]);
    tabsApi.get
      .mockResolvedValueOnce(pendingContentTab)
      .mockResolvedValueOnce(pendingContentTab)
      .mockResolvedValue(committedTab);
    const attachPuppeteer = vi.spyOn(Page.prototype, 'attachPuppeteer').mockImplementation(async function (this: Page) {
      expect(this.url()).toBe(committedTab.url);
      return true;
    });
    const context = new BrowserContext({});

    const pagePromise = context.getCurrentPage();
    await vi.waitFor(() => expect(tabsApi.onUpdated.addListener).toHaveBeenCalled());

    expect(attachPuppeteer).not.toHaveBeenCalled();

    tabsApi.emitUpdated(
      pendingContentTab.id!,
      { url: committedTab.url, title: committedTab.title, status: 'complete' },
      committedTab,
    );
    const page = await pagePromise;

    expect(page.tabId).toBe(pendingContentTab.id);
    expect(page.url()).toBe(committedTab.url);
    expect(attachPuppeteer).toHaveBeenCalledOnce();
    expect(tabsApi.create).not.toHaveBeenCalled();
  });

  it('rejects a cold target that becomes forbidden while attaching', async () => {
    tabsApi.query.mockResolvedValue([contentTab]);
    tabsApi.get.mockResolvedValueOnce(contentTab).mockResolvedValue(currentTabBecomesMixed);
    vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(true);
    const detachPuppeteer = vi.spyOn(Page.prototype, 'detachPuppeteer').mockResolvedValue();
    const context = new BrowserContext({});

    await expect(context.getCurrentPage()).rejects.toBeInstanceOf(URLNotAllowedError);

    expect(detachPuppeteer).toHaveBeenCalledOnce();
  });

  it('rejects an extension page before switching tabs', async () => {
    tabsApi.get.mockResolvedValue(extensionTab);

    await expect(new BrowserContext({}).switchTab(extensionTab.id!)).rejects.toBeInstanceOf(URLNotAllowedError);
    expect(tabsApi.update).not.toHaveBeenCalled();
  });

  it('rejects a pending extension URL before switching tabs', async () => {
    tabsApi.get.mockResolvedValue(pendingExtensionTab);

    await expect(new BrowserContext({}).switchTab(pendingExtensionTab.id!)).rejects.toBeInstanceOf(URLNotAllowedError);
    expect(tabsApi.update).not.toHaveBeenCalled();
  });

  it('revalidates a tab before attaching it', async () => {
    tabsApi.get.mockResolvedValueOnce(contentTab).mockResolvedValueOnce(currentTabBecomesMixed);
    const context = new BrowserContext({});
    const attachPuppeteer = vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(true);

    await expect(context.switchTab(contentTab.id!)).rejects.toBeInstanceOf(URLNotAllowedError);
    expect(attachPuppeteer).not.toHaveBeenCalled();
    expect(tabsApi.update).not.toHaveBeenCalled();
  });

  it('rejects a switched target that becomes forbidden while attaching', async () => {
    const activeContentTab = { ...contentTab, active: true } as chrome.tabs.Tab;
    tabsApi.get
      .mockResolvedValueOnce(contentTab)
      .mockResolvedValueOnce(activeContentTab)
      .mockResolvedValue(currentTabBecomesMixed);
    const attachPuppeteer = vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(true);
    const detachPuppeteer = vi.spyOn(Page.prototype, 'detachPuppeteer').mockResolvedValue();
    const context = new BrowserContext({});

    await expect(context.switchTab(contentTab.id!)).rejects.toBeInstanceOf(URLNotAllowedError);

    expect(attachPuppeteer).toHaveBeenCalledOnce();
    expect(detachPuppeteer).toHaveBeenCalledOnce();
  });

  it('retries instead of selecting a page when attachment fails', async () => {
    tabsApi.query.mockResolvedValue([contentTab]);
    tabsApi.get.mockResolvedValue(contentTab);
    const attachPuppeteer = vi
      .spyOn(Page.prototype, 'attachPuppeteer')
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    vi.spyOn(Page.prototype, 'detachPuppeteer').mockResolvedValue();
    const context = new BrowserContext({});

    await expect(context.getCurrentPage()).rejects.toThrow('Failed to attach to tab 2');
    await expect(context.getCurrentPage()).resolves.toMatchObject({ tabId: contentTab.id });

    expect(attachPuppeteer).toHaveBeenCalledTimes(2);
  });

  it('preserves about:blank as the unattached navigation bootstrap', async () => {
    tabsApi.query.mockResolvedValue([extensionTab]);
    tabsApi.create.mockResolvedValue(blankTab);
    tabsApi.get.mockResolvedValue(blankTab);
    const attachPuppeteer = vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(false);
    const context = new BrowserContext({});

    const page = await context.getCurrentPage();

    expect(page.tabId).toBe(blankTab.id);
    expect(page.url()).toBe(blankTab.url);
    expect(page.attached).toBe(false);
    expect(attachPuppeteer).toHaveBeenCalledOnce();
  });

  it('reattaches when an about:blank bootstrap becomes an HTTP page', async () => {
    const navigatedTab = {
      ...contentTab,
      id: blankTab.id,
      active: true,
    } as chrome.tabs.Tab;
    tabsApi.query.mockResolvedValue([extensionTab]);
    tabsApi.create.mockResolvedValue(blankTab);
    tabsApi.get.mockResolvedValueOnce(blankTab).mockResolvedValueOnce(blankTab).mockResolvedValue(navigatedTab);
    const attachPuppeteer = vi
      .spyOn(Page.prototype, 'attachPuppeteer')
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    vi.spyOn(Page.prototype, 'detachPuppeteer').mockResolvedValue();
    const context = new BrowserContext({});

    await context.getCurrentPage();
    await context.handleTabUpdated(navigatedTab);
    const page = await context.getCurrentPage();

    expect(page.url()).toBe(navigatedTab.url);
    expect(page.validWebPage).toBe(true);
    expect(attachPuppeteer).toHaveBeenCalledTimes(2);
    expect(tabsApi.create).toHaveBeenCalledOnce();
  });

  it('reattaches when about:blank commits HTTP during acquisition', async () => {
    const navigatedTab = {
      ...contentTab,
      id: blankTab.id,
      active: true,
    } as chrome.tabs.Tab;
    tabsApi.query.mockResolvedValue([extensionTab]);
    tabsApi.create.mockResolvedValue(blankTab);
    tabsApi.get.mockResolvedValueOnce(blankTab).mockResolvedValue(navigatedTab);
    const attachPuppeteer = vi
      .spyOn(Page.prototype, 'attachPuppeteer')
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    vi.spyOn(Page.prototype, 'detachPuppeteer').mockResolvedValue();
    const context = new BrowserContext({});

    const page = await context.getCurrentPage();

    expect(page.url()).toBe(navigatedTab.url);
    expect(page.validWebPage).toBe(true);
    expect(attachPuppeteer).toHaveBeenCalledTimes(2);
    expect(tabsApi.create).toHaveBeenCalledOnce();
  });

  it('invalidates a managed page when its tab becomes forbidden', async () => {
    tabsApi.query.mockResolvedValueOnce([contentTab]).mockResolvedValue([fallbackContentTab]);
    tabsApi.get
      .mockResolvedValueOnce(contentTab)
      .mockResolvedValueOnce(contentTab)
      .mockResolvedValue(fallbackContentTab);
    const attachPuppeteer = vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(true);
    const detachPuppeteer = vi.spyOn(Page.prototype, 'detachPuppeteer').mockResolvedValue();
    const context = new BrowserContext({});

    await context.getCurrentPage();
    await context.handleTabUpdated(currentTabBecomesMixed);
    const replacement = await context.getCurrentPage();

    expect(replacement.tabId).toBe(fallbackContentTab.id);
    expect(detachPuppeteer).toHaveBeenCalledOnce();
    expect(attachPuppeteer).toHaveBeenCalledTimes(2);
  });

  it('does not let old-tab cleanup clear a newer switched tab', async () => {
    const activeFallbackTab = { ...fallbackContentTab, active: true } as chrome.tabs.Tab;
    let releaseOldDetach!: () => void;
    const oldDetachGate = new Promise<void>(resolve => {
      releaseOldDetach = resolve;
    });
    tabsApi.query.mockResolvedValue([contentTab]);
    tabsApi.get
      .mockResolvedValueOnce(contentTab)
      .mockResolvedValueOnce(contentTab)
      .mockResolvedValueOnce(fallbackContentTab)
      .mockResolvedValue(activeFallbackTab);
    tabsApi.update.mockResolvedValue(activeFallbackTab);
    vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(true);
    const detachPuppeteer = vi.spyOn(Page.prototype, 'detachPuppeteer').mockImplementation(function (this: Page) {
      return this.tabId === contentTab.id ? oldDetachGate : Promise.resolve();
    });
    const context = new BrowserContext({});

    await context.getCurrentPage();
    const oldCleanup = context.handleTabUpdated(currentTabBecomesMixed);
    await vi.waitFor(() => expect(detachPuppeteer).toHaveBeenCalledOnce());
    await context.switchTab(fallbackContentTab.id!);
    releaseOldDetach();
    await oldCleanup;

    await expect(context.getCurrentPage()).resolves.toMatchObject({ tabId: fallbackContentTab.id });
    expect(detachPuppeteer).toHaveBeenCalledOnce();
  });

  it('adopts a newer bilibili watch tab opened from search', async () => {
    const searchTab = {
      id: 20,
      active: true,
      url: 'https://search.bilibili.com/all?keyword=x',
      title: '绝命墨菲',
      lastAccessed: 10,
    } as chrome.tabs.Tab;
    const watchTab = {
      id: 21,
      active: false,
      url: 'https://www.bilibili.com/video/BV1kguq6YEN6/',
      title: '《传教士》第5期',
      lastAccessed: 20,
    } as chrome.tabs.Tab;
    tabsApi.query.mockImplementation(async query => (query.active ? [searchTab] : [searchTab, watchTab]));
    tabsApi.get.mockImplementation(async id => (id === watchTab.id ? watchTab : searchTab));
    vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(true);
    const context = new BrowserContext({});

    await expect(context.getCurrentPage()).resolves.toMatchObject({ tabId: watchTab.id });
  });

  it('does not let a stale current-page read overwrite a newer switch', async () => {
    const activeFallbackTab = { ...fallbackContentTab, active: true } as chrome.tabs.Tab;
    let releaseStaleRead!: (tab: chrome.tabs.Tab) => void;
    const staleFinalSnapshot = new Promise<chrome.tabs.Tab>(resolve => {
      releaseStaleRead = resolve;
    });
    tabsApi.query.mockResolvedValue([contentTab]);
    tabsApi.get
      .mockResolvedValueOnce(contentTab)
      .mockResolvedValueOnce(contentTab)
      .mockResolvedValueOnce(contentTab)
      .mockReturnValueOnce(staleFinalSnapshot)
      .mockResolvedValueOnce(fallbackContentTab)
      .mockResolvedValue(activeFallbackTab);
    tabsApi.update.mockResolvedValue(activeFallbackTab);
    vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(true);
    const context = new BrowserContext({});

    await context.getCurrentPage();
    const staleRead = context.getCurrentPage();
    await vi.waitFor(() => expect(tabsApi.get).toHaveBeenCalledTimes(4));
    await context.switchTab(fallbackContentTab.id!);
    releaseStaleRead(contentTab);

    await expect(staleRead).resolves.toMatchObject({ tabId: fallbackContentTab.id });
    await expect(context.getCurrentPage()).resolves.toMatchObject({ tabId: fallbackContentTab.id });
  });

  it('binds switchTab without bringing the tab to the front', async () => {
    tabsApi.get.mockResolvedValue(contentTab);
    vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(true);
    const context = new BrowserContext({});

    await expect(context.switchTab(contentTab.id!)).resolves.toMatchObject({ tabId: contentTab.id });

    expect(context.getBoundTabId()).toBe(contentTab.id);
    expect(tabsApi.update).not.toHaveBeenCalled();
    expect(tabsApi.reload).not.toHaveBeenCalled();
  });

  it('reloads a discarded tab without activating it', async () => {
    const discarded = { ...contentTab, discarded: true } as chrome.tabs.Tab;
    const restored = { ...contentTab, discarded: false, status: 'complete' } as chrome.tabs.Tab;
    tabsApi.get.mockResolvedValueOnce(discarded).mockResolvedValue(restored);
    tabsApi.reload.mockResolvedValue(undefined);
    vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(true);
    const context = new BrowserContext({});

    await expect(context.switchTab(contentTab.id!)).resolves.toMatchObject({ tabId: contentTab.id });

    expect(tabsApi.reload).toHaveBeenCalledWith(contentTab.id);
    expect(tabsApi.update).not.toHaveBeenCalled();
  });

  it('does not steal a background http tab when the active tab is chrome://newtab', async () => {
    const newTab = {
      id: 8,
      active: true,
      url: 'chrome://newtab/',
      title: 'New Tab',
    } as chrome.tabs.Tab;
    tabsApi.query.mockResolvedValue([newTab, contentTab]);
    tabsApi.create.mockResolvedValue(blankTab);
    tabsApi.get.mockResolvedValue({ ...blankTab, status: 'complete' });
    vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(false);
    const context = new BrowserContext({});

    await context.getCurrentPage();
    expect(tabsApi.create).toHaveBeenCalledWith({ url: context.getConfig().homePageUrl, active: false });
    expect(context.getBoundTabId()).not.toBe(contentTab.id);
  });

  it('opens and bootstraps tabs in the background', async () => {
    tabsApi.query.mockResolvedValue([extensionTab]);
    tabsApi.create.mockResolvedValue(blankTab);
    tabsApi.get.mockResolvedValue({ ...blankTab, status: 'complete' });
    vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(false);
    const context = new BrowserContext({});

    await context.getCurrentPage();
    expect(tabsApi.create).toHaveBeenCalledWith({ url: context.getConfig().homePageUrl, active: false });

    tabsApi.create.mockResolvedValue({ ...contentTab, id: 99, active: false, status: 'complete' });
    tabsApi.get.mockResolvedValue({ ...contentTab, id: 99, status: 'complete' });
    vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(true);

    await context.openTab('https://example.com/next');
    expect(tabsApi.create).toHaveBeenCalledWith({ url: 'https://example.com/next', active: false });
  });

  it('binds an already-open same-host tab instead of creating another', async () => {
    const aicss = {
      id: 21,
      active: true,
      url: 'https://www.aicss.dev/components/approval-card',
      title: 'Approval Card',
      status: 'complete',
    } as chrome.tabs.Tab;
    const youtube = {
      id: 25,
      active: false,
      url: 'https://www.youtube.com/',
      title: 'YouTube',
      status: 'complete',
      windowId: 1,
    } as chrome.tabs.Tab;
    tabsApi.query.mockResolvedValue([aicss, youtube]);
    tabsApi.get.mockImplementation(async id => (id === youtube.id ? youtube : aicss));
    vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(true);
    const context = new BrowserContext({});

    await context.openTab('https://www.youtube.com/');

    expect(tabsApi.create).not.toHaveBeenCalled();
    expect(context.getBoundTabId()).toBe(youtube.id);
    expect(tabsApi.update).not.toHaveBeenCalledWith(youtube.id, expect.objectContaining({ active: true }));
  });

  it('treats a slow-loading destination tab as opened instead of creating another after timeout', async () => {
    const loading = {
      id: 25,
      active: false,
      url: 'https://www.youtube.com/',
      title: '',
      status: 'loading',
    } as chrome.tabs.Tab;
    tabsApi.query.mockResolvedValue([extensionTab]);
    tabsApi.create.mockImplementation(async () => {
      tabsApi.query.mockResolvedValue([extensionTab, loading]);
      return loading;
    });
    tabsApi.get.mockResolvedValue(loading);
    vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(true);
    const context = new BrowserContext({});

    await context.openTab('https://www.youtube.com/');

    expect(tabsApi.create).toHaveBeenCalledTimes(1);
    expect(context.getBoundTabId()).toBe(loading.id);

    tabsApi.create.mockClear();
    await context.openTab('https://www.youtube.com/');
    expect(tabsApi.create).not.toHaveBeenCalled();
    expect(context.getBoundTabId()).toBe(loading.id);
  });

  it('reuses a tab that is still navigating to the same site', async () => {
    const pendingYoutube = {
      id: 25,
      active: false,
      url: '',
      pendingUrl: 'https://www.youtube.com/',
      title: '',
      status: 'loading',
    } as chrome.tabs.Tab;
    const committed = {
      ...pendingYoutube,
      url: 'https://www.youtube.com/',
      pendingUrl: undefined,
      title: 'YouTube',
      status: 'complete',
    } as chrome.tabs.Tab;
    tabsApi.query.mockResolvedValue([pendingYoutube]);
    tabsApi.get.mockResolvedValue(committed);
    vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(true);
    const context = new BrowserContext({});

    await context.openTab('https://www.youtube.com/');

    expect(tabsApi.create).not.toHaveBeenCalled();
    expect(context.getBoundTabId()).toBe(pendingYoutube.id);
  });

  it('navigates an unattached tab without changing which tab is in front', async () => {
    const backgroundTab = { ...blankTab, active: false } as chrome.tabs.Tab;
    tabsApi.query.mockResolvedValue([extensionTab]);
    tabsApi.create.mockResolvedValue(backgroundTab);
    tabsApi.get.mockResolvedValue({ ...backgroundTab, status: 'complete' });
    vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(false);
    const context = new BrowserContext({});
    await context.getCurrentPage();

    const navigated = {
      ...backgroundTab,
      url: 'https://example.com/next',
      status: 'complete',
      title: 'Next',
    } as chrome.tabs.Tab;
    tabsApi.update.mockResolvedValue(navigated);
    tabsApi.get.mockResolvedValue(navigated);
    vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(true);

    await context.navigateTo('https://example.com/next');

    expect(tabsApi.update).toHaveBeenCalledWith(blankTab.id, { url: 'https://example.com/next' });
    expect(tabsApi.update).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ active: true }));
  });

  it('opens a background tab instead of overwriting the current foreground page', async () => {
    const foreground = { ...contentTab, active: true, status: 'complete' } as chrome.tabs.Tab;
    const target = {
      ...contentTab,
      id: 99,
      active: false,
      url: 'https://example.com/next',
      title: 'Next',
      status: 'complete',
    } as chrome.tabs.Tab;
    tabsApi.query.mockResolvedValue([foreground]);
    tabsApi.get.mockImplementation(async id => (id === target.id ? target : foreground));
    tabsApi.create.mockResolvedValue(target);
    vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(true);
    const navigatePage = vi.spyOn(Page.prototype, 'navigateTo').mockResolvedValue();
    const context = new BrowserContext({});

    await context.navigateTo(target.url!);

    expect(tabsApi.create).toHaveBeenCalledWith({ url: target.url, active: false });
    expect(navigatePage).not.toHaveBeenCalled();
    expect(tabsApi.update).not.toHaveBeenCalled();
    expect(context.getBoundTabId()).toBe(target.id);
  });

  it('does not overwrite the source page after the user selects a different foreground tab', async () => {
    const source = { ...contentTab, active: false, status: 'complete' } as chrome.tabs.Tab;
    const target = {
      ...contentTab,
      id: 99,
      active: false,
      url: 'https://example.com/next',
      title: 'Next',
      status: 'complete',
    } as chrome.tabs.Tab;
    tabsApi.query.mockResolvedValue([{ ...source, active: true }]);
    tabsApi.get.mockImplementation(async id => (id === target.id ? target : source));
    tabsApi.create.mockResolvedValue(target);
    vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(true);
    const navigatePage = vi.spyOn(Page.prototype, 'navigateTo').mockResolvedValue();
    const context = new BrowserContext({});

    await context.getCurrentPage();
    await context.navigateTo(target.url!);

    expect(tabsApi.create).toHaveBeenCalledWith({ url: target.url, active: false });
    expect(navigatePage).not.toHaveBeenCalled();
    expect(tabsApi.update).not.toHaveBeenCalled();
  });

  it('brings the tab to the front only after the user chooses follow', async () => {
    const followed = { ...contentTab, windowId: 3, status: 'complete', active: true } as chrome.tabs.Tab;
    tabsApi.get.mockResolvedValue(followed);
    tabsApi.update.mockResolvedValue(followed);
    vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(true);
    const context = new BrowserContext({});

    await context.switchTab(contentTab.id!);
    expect(tabsApi.update).not.toHaveBeenCalled();

    context.setRevealForeground(true);
    await context.switchTab(contentTab.id!);
    expect(tabsApi.update).toHaveBeenCalledWith(contentTab.id, { active: true });

    await context.revealTab(contentTab.id!);
    expect(tabsApi.update).toHaveBeenCalledWith(contentTab.id, { active: true });
    expect(chrome.windows.update).toHaveBeenCalledWith(3, { focused: true });
  });

  it('groups only tabs created by the task without activating or adopting the source tab', async () => {
    tabsApi.get.mockResolvedValue({ ...contentTab, status: 'complete', groupId: -1 });
    tabsApi.group.mockResolvedValue(44);
    tabGroupsApi.update.mockResolvedValue({ id: 44 });
    vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(true);
    const context = new BrowserContext({});

    await context.switchTab(contentTab.id!);
    expect(tabsApi.group).not.toHaveBeenCalled();

    await context.beginTaskTabGroup('打开 example.com 告诉我标题', undefined, true);
    expect(tabsApi.group).not.toHaveBeenCalled();
    expect(tabGroupsApi.update).not.toHaveBeenCalled();
    expect(tabsApi.update).not.toHaveBeenCalledWith(contentTab.id, expect.objectContaining({ active: true }));

    tabsApi.create.mockResolvedValue({ ...contentTab, id: 99, active: false, status: 'complete', groupId: -1 });
    tabsApi.get.mockResolvedValue({ ...contentTab, id: 99, status: 'complete', groupId: -1 });
    await context.openTab('https://example.com/next');
    expect(tabsApi.group).toHaveBeenCalledWith({ tabIds: [99] });
    expect(tabGroupsApi.update).toHaveBeenCalledWith(
      44,
      expect.objectContaining({ title: expect.stringMatching(/^任务/), color: 'orange', collapsed: false }),
    );
    expect(tabsApi.create).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
  });

  it('does not group a pre-existing tab switched to after the task group starts', async () => {
    tabsApi.get.mockResolvedValue({ ...contentTab, status: 'complete', groupId: -1 });
    tabsApi.group.mockResolvedValue(44);
    tabGroupsApi.update.mockResolvedValue({ id: 44 });
    vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(true);
    const context = new BrowserContext({});

    await context.beginTaskTabGroup('查看页面', undefined, true);
    await context.switchTab(contentTab.id!);

    expect(tabsApi.group).not.toHaveBeenCalled();
    expect(tabGroupsApi.update).not.toHaveBeenCalled();
  });

  it('refuses to close a pre-existing tab unless the task explicitly authorizes it', async () => {
    const context = new BrowserContext({});

    await expect(context.closeTab(contentTab.id!)).rejects.toThrow('not created by this task');
    expect(tabsApi.remove).not.toHaveBeenCalled();

    context.authorizeUnownedTabClose(contentTab.id!);
    await context.closeTab(contentTab.id!);
    expect(tabsApi.remove).toHaveBeenCalledWith(contentTab.id);
  });

  it('does not carry tab ownership into a new task group', async () => {
    const firstTaskTab = { ...contentTab, id: 99, active: false, status: 'complete' } as chrome.tabs.Tab;
    const secondTaskTab = {
      ...contentTab,
      id: 100,
      active: false,
      url: 'https://example.com/second',
      status: 'complete',
    } as chrome.tabs.Tab;
    tabsApi.create.mockResolvedValueOnce(firstTaskTab).mockResolvedValueOnce(secondTaskTab);
    tabsApi.get.mockImplementation(async id => (id === firstTaskTab.id ? firstTaskTab : secondTaskTab));
    vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(true);
    const navigatePage = vi.spyOn(Page.prototype, 'navigateTo').mockResolvedValue();
    const context = new BrowserContext({});

    await context.beginTaskTabGroup('first task', undefined, true);
    await context.openTab(firstTaskTab.url!);
    await context.beginTaskTabGroup('second task', undefined, true);
    await context.navigateTo(secondTaskTab.url!);

    expect(tabsApi.create).toHaveBeenLastCalledWith({ url: secondTaskTab.url, active: false });
    expect(navigatePage).not.toHaveBeenCalled();
  });

  it('keeps task ownership when the same task resumes without a saved group id', async () => {
    const taskTab = { ...contentTab, id: 99, active: false, status: 'complete' } as chrome.tabs.Tab;
    tabsApi.create.mockResolvedValue(taskTab);
    tabsApi.get.mockResolvedValue(taskTab);
    vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(true);
    const context = new BrowserContext({});

    await context.beginTaskTabGroup('task', undefined, true);
    await context.openTab(taskTab.url!);
    await context.beginTaskTabGroup('task', undefined, false);
    await context.navigateTo('https://example.com/resumed');

    expect(tabsApi.create).toHaveBeenCalledTimes(1);
    expect(tabsApi.update).toHaveBeenCalledWith(taskTab.id, { url: 'https://example.com/resumed' });
  });

  it('cleanup is idempotent and never discovers or creates a page', async () => {
    const context = new BrowserContext({});
    context.setRevealForeground(true);

    await context.cleanup();
    await context.cleanup();

    expect(tabsApi.query).not.toHaveBeenCalled();
    expect(tabsApi.create).not.toHaveBeenCalled();
    expect(context.revealsForeground()).toBe(false);
  });
});

describe('BrowserContext.openIndependentTabs', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    tabsApi.resetListeners();
  });

  function pendingTab(id: number, url: string): chrome.tabs.Tab {
    return {
      id,
      active: false,
      url: '',
      pendingUrl: url,
      title: '',
      status: 'loading',
    } as chrome.tabs.Tab;
  }

  function completeTab(id: number, url: string, title: string): chrome.tabs.Tab {
    return { id, active: false, url, title, status: 'complete' } as chrome.tabs.Tab;
  }

  it('calls both chrome.tabs.create before either load completes', async () => {
    const iana = 'https://www.iana.org';
    const wiki = 'https://en.wikipedia.org/wiki/Web_browser';
    const tabs = new Map<number, chrome.tabs.Tab>([
      [21, pendingTab(21, iana)],
      [22, pendingTab(22, wiki)],
    ]);
    let nextId = 21;
    const createOrder: string[] = [];
    tabsApi.create.mockImplementation(async ({ url }: { url: string }) => {
      const id = nextId++;
      createOrder.push(url);
      return tabs.get(id);
    });
    tabsApi.get.mockImplementation(async (id: number) => tabs.get(id));
    vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(true);
    const context = new BrowserContext({});

    const resultPromise = context.openIndependentTabs([iana, wiki]);
    await vi.waitFor(() => expect(tabsApi.create).toHaveBeenCalledTimes(2));
    expect(createOrder).toEqual([iana, wiki]);
    expect(Page.prototype.attachPuppeteer).not.toHaveBeenCalled();

    const ianaDone = completeTab(21, iana, 'Internet Assigned Numbers Authority');
    const wikiDone = completeTab(22, wiki, 'Web browser');
    tabs.set(21, ianaDone);
    tabs.set(22, wikiDone);
    tabsApi.emitUpdated(21, { url: iana, title: ianaDone.title, status: 'complete' }, ianaDone);
    tabsApi.emitUpdated(22, { url: wiki, title: wikiDone.title, status: 'complete' }, wikiDone);

    const results = await resultPromise;
    expect(results.filter(item => item.ok)).toHaveLength(2);
    expect(tabsApi.create.mock.calls[0][0]).toMatchObject({ url: iana, active: false });
    expect(tabsApi.create.mock.calls[1][0]).toMatchObject({ url: wiki, active: false });
  });

  it('creates background tabs when follow is off', async () => {
    const first = completeTab(31, 'https://example.com/a', 'A');
    const second = completeTab(32, 'https://example.com/b', 'B');
    tabsApi.create.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    tabsApi.get.mockImplementation(async (id: number) => (id === 31 ? first : second));
    vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(true);
    const context = new BrowserContext({});

    await context.openIndependentTabs(['https://example.com/a', 'https://example.com/b']);
    expect(tabsApi.create).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
    expect(tabsApi.create).not.toHaveBeenCalledWith(expect.objectContaining({ active: true }));
  });

  it('keeps the other tab when one attach fails', async () => {
    const good = completeTab(41, 'https://one.test/ok', 'OK');
    const bad = completeTab(42, 'https://two.test/fail', 'Fail');
    tabsApi.create.mockResolvedValueOnce(good).mockResolvedValueOnce(bad);
    tabsApi.get.mockImplementation(async (id: number) => (id === 41 ? good : bad));
    vi.spyOn(Page.prototype, 'attachPuppeteer').mockImplementation(async function (this: Page) {
      if (this.tabId === 42) return false;
      return true;
    });
    const context = new BrowserContext({});

    const results = await context.openIndependentTabs(['https://one.test/ok', 'https://two.test/fail']);
    expect(results).toEqual([
      expect.objectContaining({ ok: true, requestedUrl: 'https://one.test/ok' }),
      expect.objectContaining({ ok: false, requestedUrl: 'https://two.test/fail' }),
    ]);
  });
});
