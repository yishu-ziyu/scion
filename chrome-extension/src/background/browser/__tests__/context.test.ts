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

  it('navigates an unattached tab without changing which tab is in front', async () => {
    tabsApi.query.mockResolvedValue([extensionTab]);
    tabsApi.create.mockResolvedValue(blankTab);
    tabsApi.get.mockResolvedValue({ ...blankTab, status: 'complete' });
    vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(false);
    const context = new BrowserContext({});
    await context.getCurrentPage();

    const navigated = {
      ...blankTab,
      url: 'https://example.com/next',
      status: 'complete',
      title: 'Next',
    } as chrome.tabs.Tab;
    tabsApi.update.mockResolvedValue(navigated);
    tabsApi.get.mockResolvedValue(navigated);
    vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(true);

    await context.navigateTo('https://example.com/next');

    expect(tabsApi.update).toHaveBeenCalledWith(blankTab.id, { url: 'https://example.com/next' });
    expect(tabsApi.update).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ active: true }),
    );
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

  it('puts bound and opened pages in one Chrome tab group without activating them', async () => {
    tabsApi.get.mockResolvedValue({ ...contentTab, status: 'complete', groupId: -1 });
    tabsApi.group.mockResolvedValue(44);
    tabGroupsApi.update.mockResolvedValue({ id: 44 });
    vi.spyOn(Page.prototype, 'attachPuppeteer').mockResolvedValue(true);
    const context = new BrowserContext({});

    await context.switchTab(contentTab.id!);
    expect(tabsApi.group).not.toHaveBeenCalled();

    await context.beginTaskTabGroup('打开 example.com 告诉我标题');
    expect(tabsApi.group).toHaveBeenCalledWith({ tabIds: [contentTab.id] });
    expect(tabGroupsApi.update).toHaveBeenCalledWith(
      44,
      expect.objectContaining({ title: expect.stringMatching(/^任务/), color: 'orange', collapsed: false }),
    );
    expect(tabsApi.update).not.toHaveBeenCalledWith(contentTab.id, expect.objectContaining({ active: true }));

    tabsApi.create.mockResolvedValue({ ...contentTab, id: 99, active: false, status: 'complete', groupId: -1 });
    tabsApi.get.mockResolvedValue({ ...contentTab, id: 99, status: 'complete', groupId: -1 });
    await context.openTab('https://example.com/next');
    expect(tabsApi.group).toHaveBeenCalledWith({ tabIds: [99], groupId: 44 });
    expect(tabsApi.create).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
  });
});
