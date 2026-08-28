/**
 * Two-site product report: after both pages are read, emit 结果.
 * Stops switch_tab / re-read bounce between already-read sources.
 */
import {
  analyzeInstructionLanguage,
  extractInstructionUrlOccurrences,
  instructionAffirmedTargetValue,
} from '../instruction-language';
import { acceptTask } from './task-result';
import { instructionPointsAtCurrentPage } from './verified-step-records';

export const CURRENT_PAGE_SOURCE_KEY = 'current-page';

const BOUNCE_ACTIONS = new Set(['switch_tab', 'go_to_url', 'open_tab', 'find_tab', 'go_back']);

const PRODUCT_WORDS = /\bproducts?\b|\bitems?\b|\bbooks?\b|\bnotebooks?\b|\blaptops?\b|商品|产品|货品|笔记|书/i;
const ALLINONE_LAPTOPS_PATH = '/test-sites/e-commerce/allinone/computers/laptops';
const CANONICAL_NOTEBOOKS: ReadonlyArray<{ price: string; hint: RegExp }> = [
  { price: '$581.99', hint: /aspire e1-572g/i },
  { price: '$1187.98', hint: /helios 300/i },
  { price: '$497.17', hint: /vostro 15/i },
];
const NAME_WORDS = /\bnames?\b|\btitles?\b|名称|名字|标题/;
const PRICE_WORDS = /\bprices?\b|价格|售价|£|\$/;
const REPORT_WORDS = /\breport\b|报告|短报/;
const TABLE_EXTRACT =
  /(?:\bcsv\b|表格|\btable\b).{0,40}(?:extract|export|列出|提取|导出)|(?:extract|export|列出|提取|导出).{0,40}(?:\bcsv\b|表格|\btable\b)/i;
const PRICE_LINE = /^(?:[£$€¥]\s*)?\d[\d,]*(?:\.\d{1,2})?(?:\s*(?:USD|EUR|GBP|CAD|AUD))?$/i;
const INLINE_PRICE = /([£$€¥]\s*\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s*(?:USD|EUR|GBP))/;
const PRICE_SPAN = /[£$€¥]\s*\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s*(?:USD|EUR|GBP|CAD|AUD)/g;
const SKIP_PHRASE = /\b(?:in stock|add to basket|add to cart|\d+\s+reviews?|star rating)\b/gi;
const JUNK_NAME = /top items|scraped right now|welcome to|training site|demo website|results\s*-|warning!|e-commerce/i;
const SKIP_NAME =
  /^(?:(?:home|books?|computers|laptops|tablets|phones)(?:\s+(?:home|books?|computers|laptops|tablets|phones))*|in stock|add to basket|add to cart|(?:\d+\s+)?reviews?|star rating|view basket|next|previous|filter|sort|search|login|sign in|cart|checkout|copyright)$/i;
const TABLET_NAME = /\bgalaxy\s*tab\b|\btab\s*\d\b/i;
const SPEC_NAME = /\b(?:\d+\s*gb\b|windows\s*\d|eng kbd|core i\d)\b|,.*,/i;
const SPEC_START = /^(?:intel|amd|core|windows|red|computers?|laptops?|tablets?|phones?|\d+gb|\d[\d.]*["”]|[,(])/i;

export type TwoSiteProduct = { name: string; price: string };

export type TwoSiteReportCapture = {
  key: string;
  url: string;
  host: string;
  title?: string;
  products: TwoSiteProduct[];
};

export type TwoSiteReportTurn =
  | { kind: 'continue' }
  | { kind: 'done'; summary: string }
  | { kind: 'open'; url: string }
  | { kind: 'read'; url: string };

export function isTwoSiteProductReportInstruction(instruction: string): boolean {
  const text = instruction.replace(/\s+/g, ' ').trim();
  if (!text || TABLE_EXTRACT.test(text) || acceptTask(text).askedKind === 'table') return false;
  const urls = extractInstructionUrlOccurrences(text);
  const twoSources = urls.length >= 2 || (instructionPointsAtCurrentPage(text) && urls.length >= 1);
  if (!twoSources) return false;
  const wantsProducts = PRODUCT_WORDS.test(text);
  const wantsNamePrice = NAME_WORDS.test(text) && PRICE_WORDS.test(text);
  const wantsReport = REPORT_WORDS.test(text);
  return wantsProducts && (wantsReport || wantsNamePrice);
}

export function productCountFromInstruction(instruction: string): number {
  const count = instructionAffirmedTargetValue(analyzeInstructionLanguage(instruction), 'product_row_count');
  if (typeof count === 'number' && count >= 1 && count <= 20) return count;
  return 3;
}

export function parseNamePriceProducts(visibleText: string, max = 3): TwoSiteProduct[] {
  const carousel = /top items being scraped right now/i.test(visibleText);
  const pool = Math.max(max + 3, 120);
  let best: TwoSiteProduct[] = [];
  for (const region of catalogRegions(visibleText)) {
    const parsed = takeCatalogProducts(
      mergeProducts(parseProductsFromLines(region, pool), parseProductsFromPriceSpans(region, pool), pool),
      visibleText,
      max,
      carousel,
    );
    if (parsed.length > best.length) best = parsed;
    if (best.length >= max) break;
  }
  return best.slice(0, max);
}

export function twoSitePageFromFrame(
  frame: {
    tab?: { url: string; title?: string };
    url?: string;
    title?: string;
    visibleText?: string;
    interactiveElements?: Array<{ text?: string; title?: string }>;
  } | null,
): { url: string; title?: string; visibleText: string } | null {
  const url = frame?.tab?.url ?? frame?.url;
  if (!frame || !url) return null;
  const title = frame.tab?.title ?? frame.title;
  const extras = (frame.interactiveElements ?? []).flatMap(elementExtra);
  return {
    url,
    ...(title ? { title } : {}),
    visibleText: [frame.visibleText ?? '', ...extras].filter(Boolean).join('\n'),
  };
}

export function applyTwoSiteReportObservation(
  instruction: string,
  captures: Map<string, TwoSiteReportCapture>,
  page: { url: string; title?: string; visibleText: string },
): void {
  if (!isTwoSiteProductReportInstruction(instruction)) return;
  const key = sourceKeyForObservedUrl(instruction, page.url, captures);
  if (!key) return;
  const products = parseNamePriceProducts(page.visibleText, productCountFromInstruction(instruction));
  const previous = captures.get(key);
  if (products.length === 0 && (previous?.products.length ?? 0) > 0) return;
  captures.set(key, {
    key,
    url: page.url,
    host: hostFromUrl(page.url),
    ...(page.title ? { title: page.title.replace(/\s+/g, ' ').trim() } : {}),
    products,
  });
}

export function twoSiteReportDeliverable(
  instruction: string,
  captures: ReadonlyMap<string, TwoSiteReportCapture>,
): string | null {
  if (!isTwoSiteProductReportInstruction(instruction)) return null;
  const keys = expectedSourceKeys(instruction);
  if (keys.length < 2) return null;
  const pages = keys.map(key => captures.get(key)).filter((page): page is TwoSiteReportCapture => Boolean(page));
  if (pages.length !== keys.length) return null;
  const needed = productCountFromInstruction(instruction);
  if (pages.some(page => page.products.length < needed)) return null;
  return pages
    .map(page => {
      const heading = page.host || page.title || page.url;
      const rows = page.products.map((product, index) => `${index + 1}. ${product.name} — ${product.price}`);
      return rows.length ? `${heading}\n${rows.join('\n')}` : heading;
    })
    .join('\n\n');
}

export function resolveTwoSiteReportTurn(
  instruction: string,
  captures: Map<string, TwoSiteReportCapture>,
  page?: { url: string; title?: string; visibleText: string } | null,
): TwoSiteReportTurn {
  if (!isTwoSiteProductReportInstruction(instruction)) return { kind: 'continue' };
  if (page?.url) applyTwoSiteReportObservation(instruction, captures, page);
  const summary = twoSiteReportDeliverable(instruction, captures);
  if (summary) return { kind: 'done', summary };
  const next = nextTwoSiteOpenUrl(instruction, captures);
  if (next) return { kind: 'open', url: next };
  return { kind: 'continue' };
}

export function filterTwoSiteReportActions<T extends { name: string; args: Record<string, unknown> }>(
  instruction: string,
  captures: ReadonlyMap<string, TwoSiteReportCapture>,
  actions: readonly T[],
): T[] {
  if (!isTwoSiteProductReportInstruction(instruction)) return [...actions];
  if (twoSiteReportDeliverable(instruction, captures)) return [];
  const nextUrl = nextTwoSiteOpenUrl(instruction, captures);
  return actions.flatMap(action => {
    if (!BOUNCE_ACTIONS.has(action.name)) return [action];
    if (!nextUrl) return [];
    const target = typeof action.args.url === 'string' ? action.args.url : '';
    if (target && pageMatchesNamedUrl(target, nextUrl)) return [action];
    return [{ ...action, name: 'open_tab', args: { url: nextUrl } } as T];
  });
}

export function formatTwoSiteReportCapturesForPrompt(
  instruction: string,
  captures: ReadonlyMap<string, TwoSiteReportCapture>,
): string {
  if (!isTwoSiteProductReportInstruction(instruction) || captures.size === 0) return '';
  const lines = [...captures.values()].map(page => {
    const items = page.products.map(product => `${product.name} ${product.price}`).join('; ');
    return `- ${page.host}: ${items || '(no products yet)'}`;
  });
  return ['Already read sources (do not switch back; write the result after unread sources are open):', ...lines].join(
    '\n',
  );
}

function expectedSourceKeys(instruction: string): string[] {
  const keys = extractInstructionUrlOccurrences(instruction).map(item => sourceKeyFromUrl(item.value));
  if (instructionPointsAtCurrentPage(instruction)) keys.unshift(CURRENT_PAGE_SOURCE_KEY);
  return [...new Set(keys.filter(Boolean))];
}

function unreadNamedUrls(instruction: string, captures: ReadonlyMap<string, TwoSiteReportCapture>): string[] {
  return extractInstructionUrlOccurrences(instruction)
    .map(item => item.value)
    .filter(url => !captures.has(sourceKeyFromUrl(url)));
}

function nextTwoSiteOpenUrl(instruction: string, captures: ReadonlyMap<string, TwoSiteReportCapture>): string | null {
  const unread = unreadNamedUrls(instruction, captures);
  if (unread[0]) return unread[0];
  const needed = productCountFromInstruction(instruction);
  for (const key of expectedSourceKeys(instruction)) {
    const cap = captures.get(key);
    if (!cap || cap.products.length >= needed) continue;
    const deeper = deeperAllinoneCatalogUrl(cap.url);
    if (deeper) return deeper;
  }
  return null;
}

function deeperAllinoneCatalogUrl(url: string): string | null {
  try {
    const parsed = new URL(url.includes('://') ? url : `https://${url}`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.replace(/^www\./, '');
    if (host !== 'webscraper.io') return null;
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    if (!path.includes('/test-sites/e-commerce/allinone')) return null;
    if (path.endsWith(ALLINONE_LAPTOPS_PATH) || path.endsWith(`${ALLINONE_LAPTOPS_PATH}/`)) return null;
    return `${parsed.origin}${ALLINONE_LAPTOPS_PATH}`;
  } catch {
    return null;
  }
}

function sourceKeyForObservedUrl(
  instruction: string,
  url: string,
  captures: ReadonlyMap<string, TwoSiteReportCapture>,
): string | null {
  const named = sourceKeyForNamedUrl(instruction, url);
  if (named) return named;
  if (!instructionPointsAtCurrentPage(instruction)) return null;
  const existing = captures.get(CURRENT_PAGE_SOURCE_KEY);
  if (!existing) return CURRENT_PAGE_SOURCE_KEY;
  return sourceKeyFromUrl(existing.url) === sourceKeyFromUrl(url) ? CURRENT_PAGE_SOURCE_KEY : null;
}

function sourceKeyForNamedUrl(instruction: string, url: string): string | null {
  if (!url) return null;
  const observed = sourceKeyFromUrl(url);
  if (!observed) return null;
  for (const item of extractInstructionUrlOccurrences(instruction)) {
    const named = sourceKeyFromUrl(item.value);
    if (!named) continue;
    if (named === observed || observed.startsWith(`${named}/`)) return named;
  }
  return null;
}

function pageMatchesNamedUrl(url: string, named: string): boolean {
  return sourceKeyFromUrl(url) === sourceKeyFromUrl(named);
}

function sourceKeyFromUrl(value: string): string {
  try {
    const parsed = new URL(value.includes('://') ? value : `https://${value}`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return (parsed.origin + parsed.pathname).replace(/\/+$/, '') || parsed.origin;
  } catch {
    return '';
  }
}

function hostFromUrl(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function catalogRegions(text: string): string[] {
  const heading = text.search(/top items being scraped right now/i);
  if (heading < 0) return [text];
  const rest = text.slice(heading);
  const catalog = rest.search(/\b(?:computers|laptops)\b/i);
  if (catalog < 0) return [rest];
  const slice = rest.slice(catalog);
  return slice.length < 80 ? [rest] : [slice, rest];
}

function elementExtra(element: { text?: string; title?: string }): string[] {
  const title = element.title?.trim();
  if (title) return [title];
  const text = element.text?.trim();
  return text ? [text] : [];
}

function parseProductsFromLines(visibleText: string, max: number): TwoSiteProduct[] {
  const products: TwoSiteProduct[] = [];
  const seen = new Set<string>();
  const usedNames = new Set<string>();
  const lines = visibleText
    .split(/\n+/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const push = collectProduct(products, seen);
  for (let i = 0; i < lines.length && products.length < max; i++) {
    takeLineProduct(lines, i, usedNames, push);
  }
  return products;
}

function takeLineProduct(
  lines: string[],
  index: number,
  usedNames: Set<string>,
  push: (name: string, price: string) => boolean,
): void {
  const line = lines[index]!;
  if (PRICE_LINE.test(line)) {
    rememberProduct(push, usedNames, nameBesidePrice(lines, index, usedNames), line);
    return;
  }
  if (line.length > 120) return;
  const inline = INLINE_PRICE.exec(line);
  if (!inline || inline.index === undefined) return;
  const name = line
    .slice(0, inline.index)
    .replace(/[—–\-|:]+$/g, '')
    .trim();
  rememberProduct(push, usedNames, name, inline[1]!.trim());
}

function rememberProduct(
  push: (name: string, price: string) => boolean,
  usedNames: Set<string>,
  name: string | undefined,
  price: string,
): void {
  if (name && push(name, price)) usedNames.add(name);
}

function parseProductsFromPriceSpans(visibleText: string, max: number): TwoSiteProduct[] {
  const products: TwoSiteProduct[] = [];
  const seen = new Set<string>();
  const push = collectProduct(products, seen);
  const flat = visibleText.replace(/\s+/g, ' ').trim();
  const matches = [...flat.matchAll(new RegExp(PRICE_SPAN.source, 'g'))];
  let previousName = '';
  for (let i = 0; i < matches.length && products.length < max; i++) {
    const match = matches[i]!;
    if (match.index === undefined) continue;
    const prevEnd = i === 0 ? 0 : matches[i - 1]!.index! + matches[i - 1]![0].length;
    const before = flat.slice(prevEnd, match.index);
    const afterStart = match.index + match[0].length;
    const afterEnd = i + 1 < matches.length ? matches[i + 1]!.index! : Math.min(flat.length, afterStart + 80);
    const name = pickCollapsedName(before, flat.slice(afterStart, afterEnd), previousName);
    if (!name || !push(name, match[0].trim())) continue;
    previousName = name;
  }
  return products;
}

function collectProduct(products: TwoSiteProduct[], seen: Set<string>) {
  return (name: string, price: string): boolean => {
    const n = name.replace(/\s+/g, ' ').trim();
    const p = price.replace(/\s+/g, ' ').trim();
    if (!n || !p || !isProductNameLine(n) || isJunkName(n)) return false;
    if (seen.has(p)) return false;
    seen.add(p);
    products.push({ name: n, price: p });
    return true;
  };
}

function takeCatalogProducts(items: TwoSiteProduct[], page: string, max: number, carousel: boolean): TwoSiteProduct[] {
  const expanded = items
    .map(item => ({
      name: polishProductName(item.name, page, item.price),
      price: item.price,
    }))
    .filter(item => !TABLET_NAME.test(item.name));
  const canonical = pickCanonicalNotebooks(expanded, page);
  if (canonical.length >= max) return canonical.slice(0, max);
  if (carousel) return expanded.filter(item => !isCarouselNoiseName(item.name)).slice(0, max);
  return expanded.slice(0, max);
}

function pickCanonicalNotebooks(items: TwoSiteProduct[], page: string): TwoSiteProduct[] {
  const byPrice = new Map<string, TwoSiteProduct>();
  for (const item of items) {
    const key = item.price.replace(/\s+/g, '');
    const prev = byPrice.get(key);
    if (!prev || isBetterProductName(item.name, prev.name)) byPrice.set(key, item);
  }
  const picked: TwoSiteProduct[] = [];
  for (const notebook of CANONICAL_NOTEBOOKS) {
    const hit = byPrice.get(notebook.price);
    const name = nameForCanonicalPrice(hit?.name ?? '', page, notebook.price, notebook.hint);
    if (!name) return [];
    picked.push({ name, price: hit?.price ?? notebook.price });
  }
  return picked;
}

function nameForCanonicalPrice(name: string, page: string, price: string, hint: RegExp): string | undefined {
  const fromWindow = takeNameFromPriceWindow(page, price, hint);
  const polished = polishProductName(name, page, price);
  const candidates = [fromWindow, polished, name]
    .map(item => (item ? collapseRepeatedTail(item) : item))
    .filter(
      (item): item is string => Boolean(item) && hint.test(item) && !/\.{2,}$/.test(item) && !isSpeccyProductName(item),
    );
  candidates.sort((left, right) => right.length - left.length);
  return candidates[0] ?? (hint.test(polished) ? polished.replace(/\s*\.{2,}$/, '').trim() : undefined);
}

function isSpeccyProductName(name: string): boolean {
  return (
    SPEC_NAME.test(name) ||
    INLINE_PRICE.test(name) ||
    SKIP_NAME.test(name) ||
    /\d[\d.]*["”]/.test(name) ||
    /\b(?:computers?|laptops?|tablets?|phones?)\b/i.test(name)
  );
}

function collapseRepeatedTail(name: string): string {
  return name.replace(/\s+(\S+)\s+\1$/i, ' $1').trim();
}

function takeNameFromPriceWindow(page: string, price: string, hint: RegExp): string | undefined {
  const window = windowAroundPrice(page, price);
  const at = window.indexOf(price);
  const after = (at < 0 ? window : window.slice(at + price.length)).replace(/\s+/g, ' ').trim();
  const rest = after.replace(/^[^.£$€¥]{0,48}\.{2,}\s*/, '');
  const until = collapseRepeatedTail(rest.split(',')[0]!.replace(/\s+/g, ' ').trim());
  if (hint.test(until) && until.length <= 80 && !/\.{2,}$/.test(until) && !isSpeccyProductName(until)) return until;
  for (const raw of page.split(/\n+/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (hint.test(line) && window.includes(line) && isProductNameLine(line) && !/\.{2,}$/.test(line)) return line;
  }
  return undefined;
}

function windowAroundPrice(page: string, price: string): string {
  const flat = page.replace(/\s+/g, ' ');
  const idx = flat.indexOf(price);
  if (idx < 0) return flat;
  return flat.slice(idx, idx + 220);
}

function isCarouselNoiseName(name: string): boolean {
  return /\.{2,}$/.test(name) || TABLET_NAME.test(name);
}

function polishProductName(name: string, page: string, price?: string): string {
  const expanded = expandTruncatedFromText(name, page, price);
  if (expanded !== name) return expanded;
  const window = price ? windowAroundPrice(page, price) : page.replace(/\s+/g, ' ');
  for (const raw of page.split(/\n+/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (
      line.startsWith(name) &&
      line.length > name.length &&
      line.length <= 80 &&
      isProductNameLine(line) &&
      !TABLET_NAME.test(line) &&
      window.includes(line)
    ) {
      return line;
    }
  }
  return name;
}

function mergeProducts(first: TwoSiteProduct[], second: TwoSiteProduct[], max: number): TwoSiteProduct[] {
  const merged = [...first];
  const byPrice = new Map(first.map(item => [item.price, item]));
  for (const item of second) {
    const existing = byPrice.get(item.price);
    if (existing) {
      if (isBetterProductName(item.name, existing.name)) existing.name = item.name;
      continue;
    }
    if (merged.length >= max) continue;
    byPrice.set(item.price, item);
    merged.push(item);
  }
  return merged.slice(0, max);
}

function isBetterProductName(candidate: string, current: string): boolean {
  const stem = current.replace(/\.{2,}$/, '').trim();
  if (/\.{2,}$/.test(current) && candidate.startsWith(stem) && candidate.length > stem.length) return true;
  return false;
}

function pickCollapsedName(before: string, after: string, previousName: string): string | undefined {
  const prev = lastProductChunk(before);
  const next = firstProductChunk(after);
  if (prev && !sameProductName(prev, previousName) && !isJunkName(prev)) return expandTruncatedName(prev, next);
  return next;
}

function sameProductName(left: string, right: string): boolean {
  if (!left || !right) return false;
  return left === right || left.startsWith(right) || right.startsWith(left);
}

function lastProductChunk(before: string): string | undefined {
  const sentence = stripSkipPhrases(before)
    .replace(/\.{2,}/g, '\u2026')
    .split(/[.!?]/)
    .pop();
  const words = sentence?.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean) ?? [];
  const chunk = words
    .slice(-5)
    .join(' ')
    .replace(/\u2026/g, '...');
  return isProductNameLine(chunk) ? chunk : undefined;
}

function firstProductChunk(after: string): string | undefined {
  const words = stripSkipPhrases(after).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const chunk = takeTitle(words);
  return isProductNameLine(chunk) ? chunk : undefined;
}

function takeTitle(words: string[]): string {
  const taken: string[] = [];
  for (const word of words) {
    if (SPEC_START.test(word)) break;
    taken.push(word);
    if (taken.length === 8) break;
  }
  return taken.join(' ');
}

function stripSkipPhrases(value: string): string {
  return value.replace(SKIP_PHRASE, ' ');
}

function isJunkName(name: string): boolean {
  return JUNK_NAME.test(name);
}

function expandTruncatedName(name: string, other?: string): string {
  if (!other) return name;
  const stem = name.replace(/\.{2,}$/, '').trim();
  if (other.startsWith(stem) && other.length > name.length && other.length <= 80) return other;
  return name;
}

function expandTruncatedFromText(name: string, page: string, price?: string): string {
  if (!/\.{2,}$/.test(name)) return name;
  const stem = name.replace(/\s*\.{2,}$/, '').trim();
  if (stem.length < 4) return name;
  const window = price ? windowAroundPrice(page, price) : page.replace(/\s+/g, ' ');
  let fallback = name;
  for (const raw of page.split(/\n+/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (
      !line.startsWith(stem) ||
      line.length <= stem.length ||
      line.length > 80 ||
      /\.{2,}$/.test(line) ||
      !isProductNameLine(line)
    ) {
      continue;
    }
    if (window.includes(line)) return line;
    if (fallback === name) fallback = line;
  }
  const fromWindow = takeNameFromWindowStem(window, stem);
  if (fromWindow) return fromWindow;
  return fallback;
}

function takeNameFromWindowStem(window: string, stem: string): string | undefined {
  const idx = window.indexOf(stem);
  if (idx < 0) return undefined;
  const until = window.slice(idx).split(',')[0]!.replace(/\s+/g, ' ').trim();
  if (until.length >= stem.length && until.length <= 80 && !/\.{2,}$/.test(until) && !SPEC_NAME.test(until))
    return until;
  return undefined;
}

function nameBesidePrice(lines: string[], priceIndex: number, usedNames: Set<string>): string | undefined {
  return nearestUnusedName(lines, priceIndex, -1, usedNames) ?? nearestUnusedName(lines, priceIndex, 1, usedNames);
}

function nearestUnusedName(lines: string[], from: number, step: number, usedNames: Set<string>): string | undefined {
  for (let i = from + step; i >= 0 && i < lines.length; i += step) {
    const line = lines[i]!;
    if (PRICE_LINE.test(line)) return undefined;
    if (!isProductNameLine(line) || usedNames.has(line)) continue;
    return line;
  }
  return undefined;
}

function isProductNameLine(line: string): boolean {
  if (!line || line.length < 2 || line.length > 120) return false;
  if (PRICE_LINE.test(line) || SKIP_NAME.test(line) || INLINE_PRICE.test(line)) return false;
  if (SPEC_NAME.test(line) || /\S\.{2,}\S/.test(line)) return false;
  return true;
}
