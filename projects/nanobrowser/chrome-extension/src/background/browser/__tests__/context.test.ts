import { beforeEach, describe, expect, it, vi } from 'vitest';

const tabsApi = vi.hoisted(() => ({
  query: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
}));

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

describe('BrowserContext tab selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('selects an allowed content tab when the active tab is an extension page', async () => {
    tabsApi.query.mockImplementation(async query => (query.active ? [extensionTab] : [extensionTab, contentTab]));
    const context = new BrowserContext({});
    vi.spyOn(context, 'attachPage').mockResolvedValue(true);

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

  it('selects an allowed pending URL before it commits', async () => {
    tabsApi.query.mockResolvedValue([pendingContentTab]);
    tabsApi.create.mockResolvedValue({ ...contentTab, id: 99 });
    const context = new BrowserContext({});
    vi.spyOn(context, 'attachPage').mockResolvedValue(true);

    const page = await context.getCurrentPage();

    expect(page.tabId).toBe(pendingContentTab.id);
    expect(tabsApi.create).not.toHaveBeenCalled();
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
});
