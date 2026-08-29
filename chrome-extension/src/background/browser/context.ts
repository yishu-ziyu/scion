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
import { tabCanReuseForOpen } from './kernel/find-tab';
import { pickNewerBilibiliWatchTab } from './sites/bilibili-first-video';
import { isGroupableTabUrl, taskTabGroupTitle } from './task-tab-group';
import { analytics } from '../services/analytics';

const logger = createLogger('BrowserContext');

function tabOpenUrl(tab: chrome.tabs.Tab | undefined): string {
  return (tab?.url || tab?.pendingUrl || '').trim();
}

function isHttpUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

/** Committed tab.url only. pendingUrl means the navigation has not landed yet. */
function tabHasCommittedHttpUrl(tab: chrome.tabs.Tab | undefined): boolean {
  const url = (tab?.url || '').trim();
  if (!url || isNewTabPage(url)) return false;
  return isHttpUrl(url);
}

/** Committed or in-flight destination. Used so a second open_tab does not create another tab. */
function tabHasOpenHttpUrl(tab: chrome.tabs.Tab | undefined): boolean {
  const url = tabOpenUrl(tab);
  if (!url || isNewTabPage(url)) return false;
  return isHttpUrl(url);
}

/** Same cap as task/independent-urls. Do not open dozens of tabs at once. */
export const MAX_INDEPENDENT_TABS = 5;

export type IndependentTabOpenResult =
  | { ok: true; page: Page; requestedUrl: string }
  | { ok: false; requestedUrl: string; error: string };

export default class BrowserContext {
  private _config: BrowserContextConfig;
  private _currentTabId: number | null = null;
  private _boundWindowId: number | null = null;
  private _attachedPages: Map<number, Page> = new Map();
  private _revealForeground = false;
  private _taskGroupEnabled = false;
  private _taskGroupId: number | null = null;
  private _taskGroupTitle = '任务';
  /** Tabs created by this BrowserContext during the current task. */
  private _taskOwnedTabIds = new Set<number>();
  /** One-shot permission when the user explicitly asked to close an existing tab. */
  private _authorizedUnownedTabCloseIds = new Set<number>();

  constructor(config: Partial<BrowserContextConfig>) {
    this._config = { ...DEFAULT_BROWSER_CONTEXT_CONFIG, ...config };
  }

  public getConfig(): BrowserContextConfig {
    return this._config;
  }

  /** Tab the task is already attached to, or null before the first bind. */
  public getBoundTabId(): number | null {
    return this._currentTabId;
  }

  /** When true, switchTab/openTab may bring the task tab to the front (user chose 跟随). */
  public setRevealForeground(reveal: boolean): void {
    this._revealForeground = reveal;
  }

  public revealsForeground(): boolean {
    return this._revealForeground;
  }

  public taskTabGroupId(): number | null {
    return this._taskGroupId;
  }

  public isTaskOwnedTab(tabId: number): boolean {
    return this._taskOwnedTabIds.has(tabId);
  }

  public async registerTaskOwnedTab(tabId: number): Promise<void> {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab.id) return;
      this._taskOwnedTabIds.add(tabId);
      await this.adoptTabIntoTaskGroup(tabId);
    } catch {
      this._taskOwnedTabIds.delete(tabId);
    }
  }

  public authorizeUnownedTabClose(tabId: number): void {
    this._authorizedUnownedTabCloseIds.add(tabId);
  }

  /**
   * Bind later attach/open/switch tabs into one Chrome tab group.
   * Does not activate tabs. No-op when tabGroups is missing (Firefox).
   */
  public async beginTaskTabGroup(
    title: string,
    existingGroupId?: number,
    resetTaskOwnership = false,
  ): Promise<number | null> {
    if (resetTaskOwnership) {
      this._taskOwnedTabIds.clear();
      this._authorizedUnownedTabCloseIds.clear();
    }
    this._taskGroupEnabled = true;
    this._taskGroupTitle = taskTabGroupTitle(title);
    this._taskGroupId =
      typeof existingGroupId === 'number' && Number.isSafeInteger(existingGroupId) && existingGroupId >= 0
        ? existingGroupId
        : null;
    return this._taskGroupId;
  }

  private async adoptTabIntoTaskGroup(tabId: number): Promise<void> {
    if (!this._taskGroupEnabled || !this._taskOwnedTabIds.has(tabId) || !chrome.tabGroups || !chrome.tabs.group) {
      return;
    }
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab.id || !isGroupableTabUrl(tab.url || tab.pendingUrl)) return;
      if (this._taskGroupId != null && tab.groupId === this._taskGroupId) return;
      const groupId = await chrome.tabs.group({
        tabIds: [tab.id],
        ...(this._taskGroupId != null ? { groupId: this._taskGroupId } : {}),
      });
      this._taskGroupId = groupId;
      await chrome.tabGroups.update(groupId, {
        title: this._taskGroupTitle,
        color: 'orange',
        collapsed: false,
      });
    } catch (error) {
      logger.info('task tab group skipped', error);
    }
  }

  /** User asked to see this tab now (跟随 on, or 接管). Always activates. */
  public async revealTab(tabId: number): Promise<void> {
    const tab = await chrome.tabs.get(tabId);
    if (!this._getAllowedTabUrl(tab)) {
      throw new URLNotAllowedError(`Reveal tab failed. URL: ${tab.url || ''} is not allowed`);
    }
    await chrome.tabs.update(tabId, { active: true });
    if (Number.isInteger(tab.windowId) && chrome.windows?.update) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
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
      !isUrlAllowed(url, this._config.allowedUrls, this._config.deniedUrls, { existingTab: true }) ||
      (committedUrl &&
        !isUrlAllowed(committedUrl, this._config.allowedUrls, this._config.deniedUrls, { existingTab: true }))
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
      if (isNewTabPage(page.url()) && !isNewTabPage(attachedTab.url)) {
        await this._invalidatePage(tabId, page, true);
        return this._attachAllowedPage(tabId, forceUpdate, expectedCurrentTabId);
      }

      this._attachedPages.set(tabId, page);
      if (expectedCurrentTabId !== undefined && this._currentTabId !== expectedCurrentTabId) {
        return this.getCurrentPage();
      }
      this._currentTabId = tabId;
      await this.adoptTabIntoTaskGroup(tabId);
      return page;
    } catch (error) {
      await this._invalidatePage(tabId, page);
      throw error;
    }
  }

  public async cleanup(): Promise<void> {
    const currentPage = this._currentTabId === null ? undefined : this._attachedPages.get(this._currentTabId);
    currentPage?.removeHighlight();
    // detach all pages
    for (const page of this._attachedPages.values()) {
      await page.detachPuppeteer();
    }
    this._attachedPages.clear();
    this._currentTabId = null;
    this._boundWindowId = null;
    this._taskGroupEnabled = false;
    this._taskGroupId = null;
    this._taskGroupTitle = '任务';
    this._taskOwnedTabIds.clear();
    this._authorizedUnownedTabCloseIds.clear();
    this._revealForeground = false;
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
      const windowQuery =
        this._boundWindowId === null ? { currentWindow: true as const } : { windowId: this._boundWindowId };
      let tab: chrome.tabs.Tab | undefined = (await chrome.tabs.query({ active: true, ...windowQuery }))[0];
      if (!this._getAllowedTabUrl(tab)) {
        // Side panel (chrome-extension://) or chrome:// new tab / settings:
        // do not steal another tab. Chat-only must not take the debugger lock.
        tab = undefined;
      }
      if (!tab?.id) {
        // open a new tab with blank page; keep it in the background
        const newTab = await chrome.tabs.create({
          url: this._config.homePageUrl,
          active: this._revealForeground,
        });
        if (!newTab.id) {
          // this should rarely happen
          throw new Error('No tab ID available');
        }
        this._taskOwnedTabIds.add(newTab.id);
        activeTab = newTab;
      } else {
        activeTab = tab;
      }
      logger.info('active tab', activeTab.id, activeTab.url, activeTab.title);
      return this._maybeAdoptBilibiliWatch(await this._attachAllowedPage(activeTab.id!, false, null));
    }

    // 2. Revalidate the current tab before reusing or attaching it.
    const currentTabId = this._currentTabId;
    try {
      return this._maybeAdoptBilibiliWatch(await this._attachAllowedPage(currentTabId, false, currentTabId));
    } catch (error) {
      if (error instanceof URLNotAllowedError) {
        return this.getCurrentPage();
      }
      throw error;
    }
  }

  /** If a list/search click opened a watch tab, observe that tab instead of the list. */
  private async _maybeAdoptBilibiliWatch(page: Page): Promise<Page> {
    try {
      const currentTab = await chrome.tabs.get(page.tabId);
      if (!currentTab.id) return page;
      const windowQuery =
        this._boundWindowId === null ? { currentWindow: true as const } : { windowId: this._boundWindowId };
      const tabs = await chrome.tabs.query(windowQuery);
      const nextId = pickNewerBilibiliWatchTab(
        { id: currentTab.id, url: currentTab.url || '', lastAccessed: currentTab.lastAccessed },
        tabs.flatMap(tab =>
          tab.id ? [{ id: tab.id, url: tab.url || tab.pendingUrl || '', lastAccessed: tab.lastAccessed }] : [],
        ),
      );
      if (!nextId || nextId === page.tabId) return page;
      logger.info('adopt newer bilibili watch tab', nextId);
      return await this._attachAllowedPage(nextId);
    } catch {
      return page;
    }
  }

  /**
   * Get all tab IDs from the browser and the current window.
   * @returns A set of tab IDs.
   */
  public async getAllTabIds(): Promise<Set<number>> {
    const tabs = await chrome.tabs.query(
      this._boundWindowId === null ? { currentWindow: true } : { windowId: this._boundWindowId },
    );
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
    const { waitForUpdate = true, waitForActivation = false, timeoutMs = 5000 } = options;

    const tabReady = async (): Promise<boolean> => {
      try {
        const tab = await chrome.tabs.get(tabId);
        const urlOk = !waitForUpdate || tabHasCommittedHttpUrl(tab);
        const activeOk = !waitForActivation || tab.active === true;
        return urlOk && activeOk;
      } catch {
        return false;
      }
    };

    if (await tabReady()) return;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        chrome.tabs.onUpdated.removeListener(onUpdated);
        chrome.tabs.onActivated.removeListener(onActivated);
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      const onUpdated = (updatedTabId: number) => {
        if (updatedTabId !== tabId) return;
        void tabReady().then(ok => {
          if (ok) finish();
        });
      };
      const onActivated = (activeInfo: chrome.tabs.TabActiveInfo) => {
        if (activeInfo.tabId !== tabId) return;
        void tabReady().then(ok => {
          if (ok) finish();
        });
      };
      if (waitForUpdate) chrome.tabs.onUpdated.addListener(onUpdated);
      if (waitForActivation) chrome.tabs.onActivated.addListener(onActivated);
      const timer = setTimeout(
        () => {
          void tabReady().then(ok => {
            if (ok) finish();
            else finish(new Error(`Tab operation timed out after ${timeoutMs} ms`));
          });
        },
        Math.max(0, timeoutMs),
      );
    });
  }

  private async findReusableOpenTab(url: string): Promise<number | undefined> {
    const listed = await chrome.tabs.query(this._boundWindowId === null ? {} : { windowId: this._boundWindowId });
    const tabs = Array.isArray(listed) ? listed : [];
    const matches = tabs.filter(tab => {
      if (!tab.id) return false;
      const openUrl = tabOpenUrl(tab);
      if (!openUrl || !isUrlAllowed(openUrl, this._config.allowedUrls, this._config.deniedUrls)) return false;
      return tabCanReuseForOpen(openUrl, url);
    });
    const owned = matches.find(tab => this._taskOwnedTabIds.has(tab.id!));
    if (owned?.id) return owned.id;
    const bound = matches.find(tab => tab.id === this._currentTabId);
    if (bound?.id) return bound.id;
    return matches[0]?.id;
  }

  public async switchTab(tabId: number): Promise<Page> {
    logger.info('switchTab', tabId);

    const tab = await chrome.tabs.get(tabId);
    if (!this._getAllowedTabUrl(tab)) {
      throw new URLNotAllowedError(`Switch tab failed. URL: ${tab.url || ''} is not allowed`);
    }
    if (this._boundWindowId !== null && Number.isInteger(tab.windowId) && tab.windowId !== this._boundWindowId) {
      throw new Error(`Switch tab failed. Tab ${tabId} is outside the task window`);
    }

    // Default: attach in place. Only bring the tab forward when the user chose 跟随.
    if (this._revealForeground) {
      await chrome.tabs.update(tabId, { active: true });
      await this.waitForTabEvents(tabId, { waitForUpdate: false, waitForActivation: true });
    } else if (tab.discarded) {
      await chrome.tabs.reload(tabId);
      await this.waitForTabEvents(tabId, { waitForActivation: false });
    }

    return await this._attachAllowedPage(tabId);
  }

  public async bindToTab(tabId: number): Promise<Page> {
    const tab = await chrome.tabs.get(tabId);
    if (!this._getAllowedTabUrl(tab)) {
      throw new URLNotAllowedError(`Bind tab failed. URL: ${tab.url || ''} is not allowed`);
    }
    if (Number.isInteger(tab.windowId)) this._boundWindowId = tab.windowId;
    return this.switchTab(tabId);
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
    // A task may start from a page the user already had open. With follow off,
    // never navigate that page, even if the user has since selected another tab.
    if (!this._revealForeground && !this._taskOwnedTabIds.has(page.tabId)) {
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
    if (this._revealForeground) {
      await chrome.tabs.update(tabId, { url, active: true });
      await this.waitForTabEvents(tabId, { waitForActivation: true });
    } else {
      // Omit `active` (true steals, false kicks them off a page they are watching).
      await chrome.tabs.update(tabId, { url });
      await this.waitForTabEvents(tabId, { waitForActivation: false });
    }

    // Reattach the page after navigation completes
    await this._attachAllowedPage(tabId, true);
  }

  public async openTab(url: string): Promise<Page> {
    if (!isUrlAllowed(url, this._config.allowedUrls, this._config.deniedUrls)) {
      throw new URLNotAllowedError(`Open tab failed. URL: ${url} is not allowed`);
    }

    const reusableId = await this.findReusableOpenTab(url);
    if (reusableId !== undefined) {
      return await this._attachAllowedPage(reusableId);
    }

    const tab = await chrome.tabs.create({
      url,
      active: this._revealForeground,
      ...(this._boundWindowId === null ? {} : { windowId: this._boundWindowId }),
    });
    if (!tab.id) {
      throw new Error('No tab ID available');
    }
    this._taskOwnedTabIds.add(tab.id);
    try {
      await this.waitForTabEvents(tab.id, { waitForActivation: this._revealForeground });
    } catch (error) {
      const created = await chrome.tabs.get(tab.id).catch(() => undefined);
      if (!tabHasOpenHttpUrl(created)) throw error;
    }

    return await this._attachAllowedPage(tab.id);
  }

  /**
   * Create several tabs first, then wait and attach together.
   * One URL failing (denied, attach, timeout) does not abort the rest.
   */
  public async openIndependentTabs(urls: string[]): Promise<IndependentTabOpenResult[]> {
    const requested = [...new Set(urls.map(value => value.trim()).filter(Boolean))].slice(0, MAX_INDEPENDENT_TABS);
    const created = await Promise.all(requested.map(url => this._createIndependentTab(url)));
    return Promise.all(created.map(item => this._waitAndAttachIndependentTab(item)));
  }

  private async _createIndependentTab(url: string): Promise<{ requestedUrl: string; tabId?: number; error?: string }> {
    if (!isUrlAllowed(url, this._config.allowedUrls, this._config.deniedUrls)) {
      return { requestedUrl: url, error: 'url_not_allowed' };
    }
    try {
      const tab = await chrome.tabs.create({
        url,
        active: this._revealForeground,
        ...(this._boundWindowId === null ? {} : { windowId: this._boundWindowId }),
      });
      if (!tab.id) return { requestedUrl: url, error: 'no_tab_id' };
      this._taskOwnedTabIds.add(tab.id);
      return { requestedUrl: url, tabId: tab.id };
    } catch (error) {
      return { requestedUrl: url, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async _waitAndAttachIndependentTab(item: {
    requestedUrl: string;
    tabId?: number;
    error?: string;
  }): Promise<IndependentTabOpenResult> {
    if (item.tabId == null) {
      return { ok: false, requestedUrl: item.requestedUrl, error: item.error || 'create_failed' };
    }
    try {
      await this.waitForTabEvents(item.tabId, { waitForActivation: this._revealForeground });
      const page = await this._attachAllowedPage(item.tabId);
      return { ok: true, page, requestedUrl: item.requestedUrl };
    } catch (error) {
      return {
        ok: false,
        requestedUrl: item.requestedUrl,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public async closeTab(tabId: number): Promise<void> {
    const taskOwned = this._taskOwnedTabIds.has(tabId);
    const explicitlyAuthorized = this._authorizedUnownedTabCloseIds.delete(tabId);
    if (!taskOwned && !explicitlyAuthorized) {
      throw new Error(`Refusing to close tab ${tabId}: it was not created by this task`);
    }
    await this.detachPage(tabId);
    await chrome.tabs.remove(tabId);
    this._taskOwnedTabIds.delete(tabId);
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
    this._taskOwnedTabIds.delete(tabId);
    // update current tab id if needed
    if (this._currentTabId === tabId) {
      this._currentTabId = null;
    }
  }

  public async getTabInfos(): Promise<TabInfo[]> {
    const tabs = await chrome.tabs.query(this._boundWindowId === null ? {} : { windowId: this._boundWindowId });
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

  public async getState(
    useVision = false,
    cacheClickableElementsHashes = false,
    options?: { waitForLoad?: boolean },
  ): Promise<BrowserState> {
    const currentPage = await this.getCurrentPage();

    const pageState = !currentPage
      ? build_initial_state()
      : await currentPage.getState(useVision, cacheClickableElementsHashes, options);
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
