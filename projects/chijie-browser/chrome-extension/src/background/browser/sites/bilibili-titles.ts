/**
 * Bilibili homepage / favlist title extraction (pure).
 * Harvest proved cards use `.bili-video-card__info--tit` while interactive-tree
 * observe often misses them → selector_miss. This helper enriches observe text.
 */

export const BILI_VIDEO_CARD_TITLE_SELECTOR = '.bili-video-card__info--tit';

/** Homepage feed or user favlist (收藏夹) paths where video cards appear. */
export function isBilibiliListSurface(url: string | undefined | null): boolean {
  if (!url) return false;
  let host = '';
  let path = '';
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    path = u.pathname || '/';
  } catch {
    return false;
  }
  if (!(host === 'bilibili.com' || host === 'www.bilibili.com' || host.endsWith('.bilibili.com'))) {
    return false;
  }
  // Home
  if (path === '/' || path === '') return true;
  // Fav / watchlater / feed list surfaces (not single /video/BV…)
  if (/^\/(favlist|list|account\/favorite|history|watchlater|v\/popular)/i.test(path)) return true;
  // Space fav collection pages
  if (/^\/\d+\/favlist/i.test(path)) return true;
  return false;
}

/** Duration / play-count noise seen in raw harvest (e.g. "7645101:54", "4.0万3903:15"). */
export function isBilibiliTitleNoise(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return true;
  if (t.length < 4) return true;
  if (/^\d{1,3}:\d{2}(:\d{2})?$/.test(t)) return true;
  if (/^\d[\d.]*\s*万/.test(t) && t.length < 24) return true;
  if (/^[\d.:万wW]+$/.test(t)) return true;
  if (/^\d{5,}:\d{2}/.test(t)) return true; // "7645101:54"
  if (/\d+\.?\d*万\d+:\d+/.test(t) && t.length < 32) return true; // "4.0万3903:15"
  return false;
}

export function cleanBilibiliTitles(raw: string[], max = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const title = item.replace(/\s+/g, ' ').trim();
    if (isBilibiliTitleNoise(title)) continue;
    if (seen.has(title)) continue;
    seen.add(title);
    out.push(title);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Extract title strings from HTML that contains bili video-card title nodes.
 * Does not require jsdom — regex on known class + title attr / inner text.
 */
export function extractBilibiliTitlesFromHtml(html: string, max = 12): string[] {
  if (!html || !html.includes('bili-video-card__info--tit')) {
    return [];
  }
  const found: string[] = [];

  // <a class="…bili-video-card__info--tit…" title="…"> or title before class
  const titleAttr =
    /bili-video-card__info--tit[^>]*\btitle\s*=\s*["']([^"']+)["']|title\s*=\s*["']([^"']+)["'][^>]*bili-video-card__info--tit/gi;
  for (const match of html.matchAll(titleAttr)) {
    const value = (match[1] || match[2] || '').trim();
    if (value) found.push(value);
  }

  // Opening tag then short text content (h3/a/text) before next tag close sequence
  const withInner =
    /class\s*=\s*["'][^"']*bili-video-card__info--tit[^"']*["'][^>]*>([\s\S]{0,400}?)<\//gi;
  for (const match of html.matchAll(withInner)) {
    const inner = match[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
    if (inner) found.push(inner);
  }

  return cleanBilibiliTitles(found, max);
}

/** Format observe enrichment block for the control loop state text. */
export function formatBilibiliTitleEnrichment(titles: string[], surface: 'home' | 'favlist' | 'list' = 'list'): string {
  if (titles.length === 0) return '';
  const label =
    surface === 'home' ? 'bilibili home video titles' : surface === 'favlist' ? 'bilibili favlist titles' : 'bilibili video titles';
  const lines = titles.map((t, i) => `  ${i + 1}. ${t}`);
  return [
    `${label} (selector=${BILI_VIDEO_CARD_TITLE_SELECTOR}):`,
    ...lines,
    'Hint: click the card title link to open a video; do not search for unrelated controls.',
  ].join('\n');
}

export function bilibiliListSurfaceKind(url: string): 'home' | 'favlist' | 'list' | null {
  if (!isBilibiliListSurface(url)) return null;
  try {
    const path = new URL(url).pathname || '/';
    if (path === '/' || path === '') return 'home';
    if (/favlist|favorite|fav/i.test(path)) return 'favlist';
    return 'list';
  } catch {
    return null;
  }
}

/**
 * Pure observe enrichment: given page URL + optional HTML, return extra state lines.
 * Empty string when not a bili list surface or no titles found.
 */
export function enrichObserveWithBilibiliTitles(url: string | undefined | null, html: string | undefined | null): string {
  if (!url || !html) return '';
  const kind = bilibiliListSurfaceKind(url);
  if (!kind) return '';
  const titles = extractBilibiliTitlesFromHtml(html);
  return formatBilibiliTitleEnrichment(titles, kind);
}

/**
 * Browser-side snippet (string form) for Page.evaluate — keep in sync with selector constant.
 * Returns raw title candidates; call cleanBilibiliTitles in extension code.
 */
export const BILI_TITLE_DOM_SNIPPET = `(() => {
  const sel = ${JSON.stringify(BILI_VIDEO_CARD_TITLE_SELECTOR)};
  return Array.from(document.querySelectorAll(sel)).map(el => {
    const a = el;
    const title = (a.getAttribute && a.getAttribute('title')) || a.textContent || '';
    return String(title).replace(/\\s+/g, ' ').trim();
  }).filter(Boolean).slice(0, 24);
})()`;
