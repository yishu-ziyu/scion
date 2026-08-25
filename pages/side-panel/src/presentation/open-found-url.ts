export function openFoundUrl(url: string, onOpenUrl?: (url: string) => void) {
  if (onOpenUrl) {
    onOpenUrl(url);
    return;
  }
  try {
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      void chrome.tabs.create({ url, active: false });
    }
  } catch {
    /* tests / no chrome */
  }
}

export function openFoundSource(source: { url: string; tabId?: number }, onOpenUrl?: (url: string) => void) {
  if (onOpenUrl) {
    onOpenUrl(source.url);
    return;
  }
  if (source.tabId === undefined) {
    openFoundUrl(source.url);
    return;
  }
  try {
    if (typeof chrome === 'undefined' || !chrome.tabs?.get || !chrome.tabs?.update) {
      openFoundUrl(source.url);
      return;
    }
    void chrome.tabs
      .get(source.tabId)
      .then(tab => {
        if (tab.id === undefined || !tab.url || !sourceMatchesTab(tab.url, source.url)) {
          openFoundUrl(source.url);
          return;
        }
        return chrome.tabs.update(tab.id, { active: true });
      })
      .catch(() => openFoundUrl(source.url));
  } catch {
    openFoundUrl(source.url);
  }
}

export function sourceMatchesTab(tabUrl: string, expectedNormalizedUrl: string): boolean {
  try {
    const tab = new URL(tabUrl);
    if (tab.protocol !== 'http:' && tab.protocol !== 'https:') return false;
    if (tab.search) return false;
    const actual = (tab.origin + tab.pathname).replace(/\/+$/, '') || tab.origin;
    const expected = expectedNormalizedUrl.replace(/\/+$/, '');
    return actual === expected;
  } catch {
    return false;
  }
}
