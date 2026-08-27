function normalizeHttpUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

export function openFoundUrl(url: string, onOpenUrl?: (url: string) => void) {
  const normalizedUrl = normalizeHttpUrl(url);
  if (!normalizedUrl) return;
  if (onOpenUrl) {
    onOpenUrl(normalizedUrl);
    return;
  }
  try {
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      void chrome.tabs.create({ url: normalizedUrl, active: false });
    }
  } catch {
    /* tests / no chrome */
  }
}

export function openFoundSource(source: { url: string; tabId?: number }, onOpenUrl?: (url: string) => void) {
  const normalizedUrl = normalizeHttpUrl(source.url);
  if (!normalizedUrl) return;
  if (onOpenUrl) {
    onOpenUrl(normalizedUrl);
    return;
  }
  if (source.tabId === undefined) {
    openFoundUrl(normalizedUrl);
    return;
  }
  try {
    if (typeof chrome === 'undefined' || !chrome.tabs?.get || !chrome.tabs?.update) {
      openFoundUrl(normalizedUrl);
      return;
    }
    void chrome.tabs
      .get(source.tabId)
      .then(tab => {
        if (tab.id === undefined || !tab.url || !sourceMatchesTab(tab.url, normalizedUrl)) {
          openFoundUrl(normalizedUrl);
          return;
        }
        return chrome.tabs.update(tab.id, { active: true });
      })
      .catch(() => openFoundUrl(normalizedUrl));
  } catch {
    openFoundUrl(normalizedUrl);
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
