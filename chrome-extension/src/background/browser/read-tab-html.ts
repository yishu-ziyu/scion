/**
 * Tab HTML without puppeteer / chrome.debugger.
 * `Page.content()` attaches the debugger and can sit until the page snapshot
 * path returns; extract only needs the document string.
 */
export async function readTabOuterHtml(tabId: number): Promise<string> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => document.documentElement?.outerHTML || '',
    });
    const html = results?.[0]?.result;
    return typeof html === 'string' ? html : '';
  } catch {
    return '';
  }
}
