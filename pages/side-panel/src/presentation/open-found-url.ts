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
