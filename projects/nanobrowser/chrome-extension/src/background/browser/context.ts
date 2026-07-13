import 'webextension-polyfill';
import {
  type BrowserContextConfig,
  type BrowserState,
  DEFAULT_BROWSER_CONTEXT_CONFIG,
  type TabInfo,
  URLNotAllowedError,
} from './views';
import Page, { build_initial_state } from './page';
import { createLogger } from '@src/background/log';
import { isNewTabPage, isUrlAllowed } from './util';
import { analytics } from '../services/analytics';

const logger = createLogger('BrowserContext');
export default class BrowserContext {
  private _config: BrowserContextConfig;
  private _currentTabId: number | null = null;
  private _attachedPages: Map<number, Page> = new Map();

  constructor(config: Partial<BrowserContextConfig>) {
    this._config = { ...DEFAULT_BROWSER_CONTEXT_CONFIG, ...config };
  }

  public getConfig(): BrowserContextConfig {
    return this._config;
  }

  public updateConfig(config: Partial<BrowserContextConfig>): void {
    this._config = { ...this._config, ...config };
  }

  private _getAllowedTabUrl(tab?: chrome.tabs.Tab): string | undefined {
    const committedUrl = tab?.url;
    const url = tab?.pendingUrl || committedUrl;
    if (
      !tab?.id ||
      !url ||
      !isUrlAllowed(url, this._config.allowedUrls, this._config.deniedUrls) ||
      (committedUrl && !isUrlAllowed(committedUrl, this._config.allowedUrls, this._config.deniedUrls))
    ) {
      return undefined;
    }
    return url;
  }

  private async _waitForCommittedAllowedTab(tab: chrome.tabs.Tab): Promise<chrome.tabs.Tab> {
    if (!tab.id || !this._getAllowedTabUrl(tab)) {
      throw new URLNotAllowedError(`Tab URL: ${tab.url || tab.pendingUrl || ''} is not allowed`);
    }
    if (tab.url) {
      return tab;
    }

    await this.waitForTabEvents(tab.id, { waitForActivation: false });
    const committedTab = await chrome.tabs.get(tab.id);
    if (!committedTab.url || !this._getAllowedTabUrl(committedTab)) {
      throw new URLNotAllowedError(`Tab URL: ${committedTab.url || committedTab.pendingUrl || ''} is not allowed`);
    }
    return committedTab;
  }

  private async _getOrCreatePage(tab: chrome.tabs.Tab, forceUpdate = false): Promise<Page> {
    if (!tab.id) {
      throw new Error('Tab ID is not available');
    }

    const existingPage = this._attachedPages.get(tab.id);
    if (existingPage) {
      logger.info('getOrCreatePage', tab.id, 'already attached');
      const bootstrapBecameWebPage = isNewTabPage(existingPage.url()) && !isNewTabPage(tab.url || '');
      if (!forceUpdate && !bootstrapBecameWebPage) {
        return existingPage;
      }
      await this._invalidatePage(tab.id, undefined, true);
    }
    logger.info('getOrCreatePage', tab.id, 'creating new page');
    return new Page(tab.id, tab.url || '', tab.title || '', this._config);
  }

  private async _invalidatePage(tabId: number, candidate?: Page, preserveCurrent = false): Promise<void> {
    const page = candidate || this._attachedPages.get(tabId);
    this._attachedPages.delete(tabId);
    if (!preserveCurrent && this._currentTabId === tabId) {
      this._currentTabId = null;
    }
    await page?.detachPuppeteer();
  }

  private async _attachAllowedPage(
    tabId: number,
    forceUpdate = false,
    expectedCurrentTabId?: number | null,
  ): Promise<Page> {
    let page: Page | undefined;
    try {
      const tab = await this._waitForCommittedAllowedTab(await chrome.tabs.get(tabId));
      page = await this._getOrCreatePage(tab, forceUpdate);

      const attached = this._attachedPages.get(tabId) === page || (await page.attachPuppeteer());
      if (!attached && !isNewTabPage(tab.url || '')) {
        throw new Error(`Failed to attach to tab ${tabId}`);
      }

      const attachedTab = await chrome.tabs.get(tabId);
      if (!attachedTab.url || !this._getAllowedTabUrl(attachedTab)) {
        throw new URLNotAllowedError(
          `Tab URL: ${attachedTab.url || attachedTab.pendingUrl || ''} is not allowed after attachment`,
        );
      }

      this._attachedPages.set(tabId, page);
      if (expectedCurrentTabId !== undefined && this._currentTabId !== expectedCurrentTabId) {
        return this.getCurrentPage();
      }
      this._currentTabId = tabId;
      return page;
    } catch (error) {
      await this._invalidatePage(tabId, page);
      throw error;
    }
  }

  public async cleanup(): Promise<void> {
    const currentPage = await this.getCurrentPage();
    currentPage?.removeHighlight();
    // detach all pages
    for (const page of this._attachedPages.values()) {
      await page.detachPuppeteer();
    }
    this._attachedPages.clear();
    this._currentTabId = null;
  }

  public async detachPage(tabId: number): Promise<void> {
    await this._invalidatePage(tabId);
  }

  public async handleTabUpdated(tab: chrome.tabs.Tab): Promise<void> {
    if (tab.id && !this._getAllowedTabUrl(tab)) {
      await this._invalidatePage(tab.id);
    }
  }

  public async getCurrentPage(): Promise<Page> {
    // 1. If _currentTabId not set, query the active tab and attach it
    if (!this._currentTabId) {
      let activeTab: chrome.tabs.Tab;
      let tab: chrome.tabs.Tab | undefined = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      if (!this._getAllowedTabUrl(tab)) {
        const tabs = await chrome.tabs.query({ currentWindow: true });
        // ponytail: first allowed tab is the fallback; track last allowed activation if multi-tab precision matters.
        tab = tabs.find(candidate => this._getAllowedTabUrl(candidate));
      }
      if (!tab?.id) {
        // open a new tab with blank page
        const newTab = await chrome.tabs.create({ url: this._config.homePageUrl });
        if (!newTab.id) {
          // this should rarely happen
          throw new Error('No tab ID available');
        }
        activeTab = newTab;
      } else {
        activeTab = tab;
      }
      logger.info('active tab', activeTab.id, activeTab.url, activeTab.title);
      return await this._attachAllowedPage(activeTab.id!, false, null);
    }

    // 2. Revalidate the current tab before reusing or attaching it.
    const currentTabId = this._currentTabId;
    try {
      return await this._attachAllowedPage(currentTabId, false, currentTabId);
    } catch (error) {
      if (error instanceof URLNotAllowedError) {
        return this.getCurrentPage();
      }
      throw error;
    }
  }

  /**
   * Get all tab IDs from the browser and the current window.
   * @returns A set of tab IDs.
   */
  public async getAllTabIds(): Promise<Set<number>> {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    return new Set(tabs.map(tab => tab.id).filter(id => id !== undefined));
  }

  /**
   * Wait for tab events to occur after a tab is created or updated.
   * @param tabId - The ID of the tab to wait for events on.
   * @param options - An object containing options for the wait.
   * @returns A promise that resolves when the tab events occur.
   */
  private async waitForTabEvents(
    tabId: number,
    options: {
      waitForUpdate?: boolean;
      waitForActivation?: boolean;
      timeoutMs?: number;
    } = {},
  ): Promise<void> {
    const { waitForUpdate = true, waitForActivation = true, timeoutMs = 5000 } = options;

    const promises: Promise<void>[] = [];

    if (waitForUpdate) {
      const updatePromise = new Promise<void>(resolve => {
        let hasUrl = false;
        let hasTitle = false;
        let isComplete = false;

        const onUpdatedHandler = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
          if (updatedTabId !== tabId) return;

          if (changeInfo.url) hasUrl = true;
          if (changeInfo.title) hasTitle = true;
          if (changeInfo.status === 'complete') isComplete = true;

          // Resolve when we have all the information we need
          if (hasUrl && hasTitle && isComplete) {
            chrome.tabs.onUpdated.removeListener(onUpdatedHandler);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(onUpdatedHandler);

        // Check current state
        chrome.tabs.get(tabId).then(tab => {
          if (tab.url) hasUrl = true;
          if (tab.title) hasTitle = true;
          if (tab.status === 'complete') isComplete = true;

          if (hasUrl && hasTitle && isComplete) {
            chrome.tabs.onUpdated.removeListener(onUpdatedHandler);
            resolve();
          }
        });
      });
      promises.push(updatePromise);
    }

    if (waitForActivation) {
      const activatedPromise = new Promise<void>(resolve => {
        const onActivatedHandler = (activeInfo: chrome.tabs.TabActiveInfo) => {
          if (activeInfo.tabId === tabId) {
            chrome.tabs.onActivated.removeListener(onActivatedHandler);
            resolve();
          }
        };
        chrome.tabs.onActivated.addListener(onActivatedHandler);

        // Check current state
        chrome.tabs.get(tabId).then(tab => {
          if (tab.active) {
            chrome.tabs.onActivated.removeListener(onActivatedHandler);
            resolve();
          }
        });
      });
      promises.push(activatedPromise);
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Tab operation timed out after ${timeoutMs} ms`)), timeoutMs),
    );

    await Promise.race([Promise.all(promises), timeoutPromise]);
  }

  public async switchTab(tabId: number): Promise<Page> {
    logger.info('switchTab', tabId);

    const tab = await chrome.tabs.get(tabId);
    if (!this._getAllowedTabUrl(tab)) {
      throw new URLNotAllowedError(`Switch tab failed. URL: ${tab.url || ''} is not allowed`);
    }

    await chrome.tabs.update(tabId, { active: true });
    await this.waitForTabEvents(tabId, { waitForUpdate: false });

    return await this._attachAllowedPage(tabId);
  }

  public async navigateTo(url: string): Promise<void> {
    if (!isUrlAllowed(url, this._config.allowedUrls, this._config.deniedUrls)) {
      throw new URLNotAllowedError(`URL: ${url} is not allowed`);
    }

    // Track domain visit for analytics
    void analytics.trackDomainVisit(url);

    const page = await this.getCurrentPage();
    if (!page) {
      await this.openTab(url);
      return;
    }
    // if page is attached, use puppeteer to navigate to the url
    if (page.attached) {
      await page.navigateTo(url);
      return;
    }
    //  Use chrome.tabs.update only if the page is not attached
    const tabId = page.tabId;
    // Update tab and wait for events
    await chrome.tabs.update(tabId, { url, active: true });
    await this.waitForTabEvents(tabId);

    // Reattach the page after navigation completes
    await this._attachAllowedPage(tabId, true);
  }

  public async openTab(url: string): Promise<Page> {
    if (!isUrlAllowed(url, this._config.allowedUrls, this._config.deniedUrls)) {
      throw new URLNotAllowedError(`Open tab failed. URL: ${url} is not allowed`);
    }

    // Create the new tab
    const tab = await chrome.tabs.create({ url, active: true });
    if (!tab.id) {
      throw new Error('No tab ID available');
    }
    // Wait for tab events
    await this.waitForTabEvents(tab.id);

    return await this._attachAllowedPage(tab.id);
  }

  public async closeTab(tabId: number): Promise<void> {
    await this.detachPage(tabId);
    await chrome.tabs.remove(tabId);
    // update current tab id if needed
    if (this._currentTabId === tabId) {
      this._currentTabId = null;
    }
  }

  /**
   * Remove a tab from the attached pages map. This will not run detachPuppeteer.
   * @param tabId - The ID of the tab to remove.
   */
  public removeAttachedPage(tabId: number): void {
    this._attachedPages.delete(tabId);
    // update current tab id if needed
    if (this._currentTabId === tabId) {
      this._currentTabId = null;
    }
  }

  public async getTabInfos(): Promise<TabInfo[]> {
    const tabs = await chrome.tabs.query({});
    const tabInfos: TabInfo[] = [];

    for (const tab of tabs) {
      const url = this._getAllowedTabUrl(tab);
      if (tab.id && url && tab.title) {
        tabInfos.push({
          id: tab.id,
          url,
          title: tab.title,
        });
      }
    }
    return tabInfos;
  }

  public async getCachedState(useVision = false, cacheClickableElementsHashes = false): Promise<BrowserState> {
    const currentPage = await this.getCurrentPage();

    let pageState = !currentPage ? build_initial_state() : currentPage.getCachedState();
    if (!pageState) {
      pageState = await currentPage.getState(useVision, cacheClickableElementsHashes);
    }

    const tabInfos = await this.getTabInfos();
    const browserState: BrowserState = {
      ...pageState,
      tabs: tabInfos,
    };
    return browserState;
  }

  public async getState(useVision = false, cacheClickableElementsHashes = false): Promise<BrowserState> {
    const currentPage = await this.getCurrentPage();

    const pageState = !currentPage
      ? build_initial_state()
      : await currentPage.getState(useVision, cacheClickableElementsHashes);
    const tabInfos = await this.getTabInfos();
    const browserState: BrowserState = {
      ...pageState,
      tabs: tabInfos,
      // browser_errors: [],
    };
    return browserState;
  }

  public async removeHighlight(): Promise<void> {
    const page = await this.getCurrentPage();
    if (page) {
      await page.removeHighlight();
    }
  }
}
