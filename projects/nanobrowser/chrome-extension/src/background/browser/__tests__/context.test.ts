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
    onActivated: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    onUpdated: {
      addListener: vi.fn(listener => updatedListeners.add(listener)),
      removeListener: vi.fn(listener => updatedListeners.delete(listener)),
    },
    emitUpdated(tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) {
      updatedListeners.forEach(listener => listener(tabId, changeInfo, tab));
    },
    resetListeners() {
      updatedListeners.clear();
    },
  };
});

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: { runtime: { id: 'test-extension' }, tabs: tabsApi },
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

const currentTabBecomesMixed = {
  ...pendingContentFromExtensionTab,
  id: contentTab.id,
} as chrome.tabs.Tab;

describe('BrowserContext tab selection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    tabsApi.resetListeners();
  });

  it('selects an allowed content tab when the active tab is an extension page', async () => {
    tabsApi.query.mockImplementation(async query => (query.active ? [extensionTab] : [extensionTab, contentTab]));
    tabsApi.get.mockResolvedValue(contentTab);
    const context = new BrowserContext({});
    vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(true);

    const page = await context.getCurrentPage();

    expect(page.tabId).toBe(contentTab.id);
    expect(tabsApi.create).not.toHaveBeenCalled();
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

  it('does not select a pending web navigation while an extension page remains committed', async () => {
    tabsApi.query.mockImplementation(async query =>
      query.active ? [pendingContentFromExtensionTab] : [pendingContentFromExtensionTab, contentTab],
    );
    tabsApi.get.mockResolvedValue(contentTab);
    const context = new BrowserContext({});
    vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(true);

    const page = await context.getCurrentPage();

    expect(page.tabId).toBe(contentTab.id);
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

  it('revalidates a tab after activation before attaching it', async () => {
    tabsApi.get
      .mockResolvedValueOnce(contentTab)
      .mockResolvedValueOnce({ ...contentTab, active: true })
      .mockResolvedValueOnce(currentTabBecomesMixed);
    tabsApi.update.mockResolvedValue({ ...contentTab, active: true });
    const context = new BrowserContext({});
    const attachPuppeteer = vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(true);

    await expect(context.switchTab(contentTab.id!)).rejects.toBeInstanceOf(URLNotAllowedError);
    expect(attachPuppeteer).not.toHaveBeenCalled();
  });

  it('rejects a switched target that becomes forbidden while attaching', async () => {
    const activeContentTab = { ...contentTab, active: true } as chrome.tabs.Tab;
    tabsApi.get
      .mockResolvedValueOnce(contentTab)
      .mockResolvedValueOnce(activeContentTab)
      .mockResolvedValueOnce(activeContentTab)
      .mockResolvedValue(currentTabBecomesMixed);
    tabsApi.update.mockResolvedValue(activeContentTab);
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
});
