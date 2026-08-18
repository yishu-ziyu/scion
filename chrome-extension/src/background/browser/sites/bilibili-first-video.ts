/**
 * Deterministic "open first feed video" helpers for bilibili list surfaces.
 * LLM index-click fails on homepage cards (stale/highlight index, title-list 1.2.3
 * confusion). Prefer resolve URL → go_to_url for a reliable closed loop.
 */

import { isBilibiliListSurface } from './bilibili-titles';

const BV_IN_PATH = /\/video\/(BV[1-9A-HJ-NP-Za-km-z]{10})/i;
const SKIP_HOST = /member\.bilibili\.com|account\.bilibili\.com|message\.bilibili\.com/i;

/** User asked to open/click the first (row) video, not only land on the site. */
export function instructionRequestsFirstVideo(instruction: string): boolean {
  const text = instruction.replace(/\s+/g, ' ').trim();
  if (!text) return false;
  return (
    // 第一个视频 / 第一行第一个视频 / 第一行的视频
    /第一(?:行|列)?(?:的)?(?:第)?[一二]?[个只]?(?:视频|影片)/.test(text) ||
    /打开.{0,32}第一.{0,24}(视频|影片)/.test(text) ||
    /点击.{0,32}第一.{0,24}(视频|影片)/.test(text) ||
    /看.{0,16}第一.{0,16}(视频|影片)/.test(text) ||
    /first\s+(row\s+)?(video|clip)/i.test(text) ||
    /open.{0,32}first.{0,24}video/i.test(text) ||
    /click.{0,32}first.{0,24}video/i.test(text)
  );
}

/** Current-feed nouns: 「第一行的第一个视频」is not a named UP. */
const GENERIC_FIRST_VIDEO_OWNER =
  /^(?:打开|点击|点开|单击|看|进入|读取)*(?:当前)?(?:第?[一二两三四五六七八九十百\d]+(?:行|列|个|条|只)|首页|主页|推荐|热门|列表|页面|当前页|当前页面|B站|b站|哔哩哔哩|bilibili)$/i;

export function isBilibiliWatchUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (!(host === 'bilibili.com' || host === 'www.bilibili.com' || host.endsWith('.bilibili.com'))) return false;
    return BV_IN_PATH.test(parsed.pathname);
  } catch {
    return BV_IN_PATH.test(url);
  }
}

export function isBilibiliSearchOrListUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === 'search.bilibili.com' || host.endsWith('.search.bilibili.com')) return true;
  } catch {
    if (/search\.bilibili\.com/i.test(url)) return true;
  }
  return isBilibiliListSurface(url);
}

/** User asked to open or click a video, including 「第一行的第二个视频」. */
export function instructionRequestsOpenBilibiliVideo(instruction: string): boolean {
  const text = instruction.replace(/\s+/g, ' ').trim();
  if (!text) return false;
  if (instructionRequestsFirstVideo(text)) return true;
  return (
    /点击.{0,32}(视频|影片)/.test(text) ||
    /点开.{0,32}(视频|影片)/.test(text) ||
    /打开.{0,48}(视频|影片)/.test(text) ||
    /click.{0,40}(the\s+)?(first\s+|second\s+)?video/i.test(text)
  );
}

export function cleanBilibiliWatchTitle(title: string): string {
  return title
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*[_|｜\-–—]\s*(?:哔哩哔哩|bilibili).*$/i, '')
    .trim();
}

/** Result the user can check on the watch page. Quote visible wording so verify can ground it. */
export function bilibiliWatchResultSummary(title: string, url?: string): string | null {
  const cleaned = cleanBilibiliWatchTitle(title);
  if (cleaned.length >= 4 && !/^(?:bilibili|哔哩哔哩)$/i.test(cleaned)) {
    return `已打开「${cleaned}」`;
  }
  const bv = url?.match(BV_IN_PATH)?.[1];
  return bv ? `已打开「${bv}」` : null;
}

/** Do not leave a just-opened watch page to probe the search list. */
export function shouldKeepAdoptedBilibiliWatch(currentUrl: string, storedUrl: string): boolean {
  return isBilibiliWatchUrl(currentUrl) && isBilibiliSearchOrListUrl(storedUrl);
}

/**
 * After a list/search click opens a watch tab, stay on that tab.
 * Only adopt a watch tab that is at least as recently used as the list tab.
 */
export function pickNewerBilibiliWatchTab(
  current: { id: number; url: string; lastAccessed?: number },
  tabs: Array<{ id: number; url: string; lastAccessed?: number }>,
): number | null {
  if (!current.url || isBilibiliWatchUrl(current.url)) return null;
  if (!isBilibiliSearchOrListUrl(current.url)) return null;
  const newer = tabs
    .filter(tab => tab.id !== current.id && isBilibiliWatchUrl(tab.url))
    .sort((left, right) => (right.lastAccessed ?? 0) - (left.lastAccessed ?? 0))[0];
  if (!newer) return null;
  if ((newer.lastAccessed ?? 0) < (current.lastAccessed ?? 0)) return null;
  return newer.id;
}

/** On a watch page, the click-video sentence is already done. */
export function judgeBilibiliWatchComplete(
  instruction: string,
  pageUrl: string,
  pageTitle: string,
): string | null {
  if (!instructionRequestsOpenBilibiliVideo(instruction)) return null;
  if (!isBilibiliWatchUrl(pageUrl)) return null;
  return bilibiliWatchResultSummary(pageTitle, pageUrl);
}

/**
 * True when first-video means a named UP's list (「老番茄的第一个视频」),
 * not the homepage recommend card.
 */
export function instructionNamesSpecificBilibiliCreator(instruction: string): boolean {
  const text = instruction.replace(/\s+/g, ' ').trim();
  if (!text) return false;

  for (const match of text.matchAll(
    /([^，,。！!？?\s的]{1,24})的第一(?:行|列)?(?:的)?(?:第)?[一二]?[个只]?(?:视频|影片)/g,
  )) {
    const owner = (match[1] ?? '').trim();
    if (owner && !GENERIC_FIRST_VIDEO_OWNER.test(owner)) return true;
  }

  const english = text.match(/([A-Za-z\u4e00-\u9fff]{2,24})(?:'s|’s)\s+first\s+(?:video|clip)/i);
  if (english?.[1] && !/^(the|this|that|home|first)$/i.test(english[1])) return true;

  return false;
}

/** Normalize any bilibili video href to a stable https watch URL (no query). */
export function normalizeBilibiliVideoUrl(href: string): string | null {
  if (!href || SKIP_HOST.test(href)) return null;
  let raw = href.trim();
  if (raw.startsWith('//')) raw = `https:${raw}`;
  if (raw.startsWith('/')) raw = `https://www.bilibili.com${raw}`;
  try {
    const u = new URL(raw);
    if (SKIP_HOST.test(u.hostname)) return null;
    const match = u.pathname.match(BV_IN_PATH);
    if (!match?.[1]) return null;
    return `https://www.bilibili.com/video/${match[1]}`;
  } catch {
    const match = raw.match(BV_IN_PATH);
    if (!match?.[1]) return null;
    return `https://www.bilibili.com/video/${match[1]}`;
  }
}

/**
 * Extract the first feed video URL from HTML (document order).
 * Prefers card image links, then title links, then any /video/BV href.
 */
export function extractFirstBilibiliVideoUrlFromHtml(html: string): string | null {
  if (!html || !html.includes('/video/')) return null;

  const patterns: RegExp[] = [
    // Cover link (most reliable feed card)
    /class\s*=\s*["'][^"']*bili-video-card__image--link[^"']*["'][^>]*href\s*=\s*["']([^"']+)["']/gi,
    /href\s*=\s*["']([^"']+)["'][^>]*class\s*=\s*["'][^"']*bili-video-card__image--link[^"']*["']/gi,
    // Title link
    /class\s*=\s*["'][^"']*bili-video-card__info--tit[^"']*["'][^>]*href\s*=\s*["']([^"']+)["']/gi,
    /href\s*=\s*["']([^"']*\/video\/BV[^"']*)["'][^>]*class\s*=\s*["'][^"']*bili-video-card__info--tit/gi,
    // Any video href in a card block (bounded)
    /bili-video-card[\s\S]{0,1200}?href\s*=\s*["']([^"']*\/video\/BV[^"']*)["']/gi,
    // Fallback: first BV path in document
    /href\s*=\s*["']([^"']*\/video\/BV[1-9A-HJ-NP-Za-km-z]{10}[^"']*)["']/gi,
  ];

  const seen = new Set<string>();
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const normalized = normalizeBilibiliVideoUrl(match[1] ?? '');
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      return normalized;
    }
  }
  return null;
}

/** True when we should short-circuit LLM click and open the first feed video. */
export function shouldDeterministicOpenFirstBilibiliVideo(
  instruction: string,
  pageUrl: string | undefined | null,
): boolean {
  if (!instructionRequestsFirstVideo(instruction)) return false;
  // Named UP: search / open their space first. Homepage first card is the wrong video.
  if (instructionNamesSpecificBilibiliCreator(instruction)) return false;
  if (!pageUrl) return false;
  // Already on a watch page — loop should mark done, not re-open first card.
  try {
    const path = new URL(pageUrl).pathname;
    if (BV_IN_PATH.test(path)) return false;
  } catch {
    // continue with list-surface check
  }
  return isBilibiliListSurface(pageUrl);
}

/**
 * Browser-side snippet for Page.evaluate — first card video href in DOM order.
 * Keep in sync with extractFirstBilibiliVideoUrlFromHtml preference order.
 */
export const BILI_FIRST_VIDEO_DOM_SNIPPET = `(() => {
  const sels = [
    'a.bili-video-card__image--link[href*="/video/"]',
    '.bili-video-card a.bili-video-card__info--tit[href*="/video/"]',
    '.bili-video-card a[href*="/video/BV"]',
    'a[href*="/video/BV"]',
  ];
  const seen = new Set();
  for (const sel of sels) {
    for (const a of document.querySelectorAll(sel)) {
      const href = a.href || a.getAttribute('href') || '';
      if (!href || /member\\.bilibili|upload\\/video/i.test(href)) continue;
      const m = href.match(/\\/video\\/(BV[1-9A-HJ-NP-Za-km-z]{10})/i);
      if (!m) continue;
      const key = m[1];
      if (seen.has(key)) continue;
      seen.add(key);
      return 'https://www.bilibili.com/video/' + key;
    }
  }
  return null;
})()`;
