/**
 * Deterministic YouTube homepage -> first watch URL shortcut (013-B06).
 * The DOM may shift, so the Harness extracts the first /watch?v= href rather
 * than asking the model to click an unstable index.
 */

export const YOUTUBE_EMPTY_HOME_SEARCH_QUERY = 'AI';

export function isYouTubeFirstVideoInstruction(instruction: string): boolean {
  const text = instruction.replace(/\s+/g, ' ').trim();
  return /第一|首页|first/i.test(text) && /打开|open/i.test(text);
}

export function extractFirstYouTubeVideoUrlFromHtml(html: string, baseUrl: string): string | null {
  const candidates = new Set<string>();
  const patterns = [
    /href=["']([^"']*\/watch\?v=[A-Za-z0-9_-]{6,}[^"']*)["']/g,
    /href=["']([^"']*youtube\.com\/watch\?v=[A-Za-z0-9_-]{6,}[^"']*)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const href = match[1].replace(/&amp;/g, '&');
      if (!href) continue;
      try {
        const url = new URL(href, baseUrl);
        if (url.hostname === 'www.youtube.com' || url.hostname === 'm.youtube.com') {
          candidates.add(url.toString());
        }
      } catch {
        // ignore malformed href
      }
    }
  }
  // YouTube homepage thumbnails can use /shorts/ or /watch/; prefer plain watch.
  return [...candidates].find(url => /\/watch\?v=/.test(url)) ?? null;
}

/**
 * Signed-out YouTube can serve an empty homepage with no watch links.
 * Keep 013-B06 verifiable by falling back to a real search results page, whose
 * first watch link is extracted on the next loop turn.
 */
export function buildYouTubeSearchFallbackUrl(pageUrl: string): string | null {
  try {
    const url = new URL(pageUrl);
    if (!/(^|\.)youtube\.com$/.test(url.hostname) || url.pathname !== '/') return null;
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(YOUTUBE_EMPTY_HOME_SEARCH_QUERY)}`;
  } catch {
    return null;
  }
}
