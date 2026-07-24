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
