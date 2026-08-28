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

const PRODUCT_WORDS = /\bproducts?\b|\bitems?\b|商品|产品|货品/i;
const NAME_WORDS = /\bnames?\b|\btitles?\b|名称|名字|标题/;
const PRICE_WORDS = /\bprices?\b|价格|售价|£|\$/;
const REPORT_WORDS = /\breport\b|报告|短报/;
const TABLE_EXTRACT = /(?:\bcsv\b|表格|\btable\b).{0,40}(?:extract|export|列出|提取|导出)|(?:extract|export|列出|提取|导出).{0,40}(?:\bcsv\b|表格|\btable\b)/i;
const PRICE_LINE = /^(?:[£$€¥]\s*)?\d[\d,]*(?:\.\d{1,2})?(?:\s*(?:USD|EUR|GBP|CAD|AUD))?$/i;
const INLINE_PRICE = /([£$€¥]\s*\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s*(?:USD|EUR|GBP))/;
const PRICE_SPAN = /[£$€¥]\s*\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s*(?:USD|EUR|GBP|CAD|AUD)/g;
const SKIP_PHRASE = /\b(?:in stock|add to basket|add to cart|\d+\s+reviews?|star rating)\b/gi;
const JUNK_NAME =
  /top items|scraped right now|welcome to|training site|demo website|results\s*-|warning!|e-commerce/i;
const SKIP_NAME =
  /^(?:(?:home|books?|computers|laptops|tablets|phones)(?:\s+(?:home|books?|computers|laptops|tablets|phones))*|in stock|add to basket|add to cart|(?:\d+\s+)?reviews?|star rating|view basket|next|previous|filter|sort|search|login|sign in|cart|checkout|copyright)$/i;
const SPEC_NAME =
  /\b(?:\d+\s*gb\s*(?:ssd|hdd|ddr\d|ram)|windows\s*\d|eng kbd|core i\d)\b|,.*,/i;

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
  const text = catalogRegion(visibleText);
  return mergeProducts(parseProductsFromLines(text, max), parseProductsFromPriceSpans(text, max), max);
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
  const extras = (frame.interactiveElements ?? []).flatMap(element =>
    [element.title, element.text].filter((value): value is string => Boolean(value?.trim())),
  );
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
  if (products.length === 0) return;
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
  if (pages.some(page => page.products.length === 0)) return null;
  return pages
    .map(page => {
      const heading = page.host || page.title || page.url;
      const rows = page.products.map((product, index) => `${index + 1}. ${product.name} — ${product.price}`);
      return `${heading}\n${rows.join('\n')}`;
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
  const unread = unreadNamedUrls(instruction, captures);
  if (unread[0]) {
    if (page?.url && pageMatchesNamedUrl(page.url, unread[0]) && sourceNeedsProducts(instruction, captures, page.url)) {
      return { kind: 'read', url: unread[0] };
    }
    return { kind: 'open', url: unread[0] };
  }
  if (page?.url && sourceNeedsProducts(instruction, captures, page.url)) {
    return { kind: 'read', url: page.url };
  }
  return { kind: 'continue' };
}

export function filterTwoSiteReportActions<T extends { name: string; args: Record<string, unknown> }>(
  instruction: string,
  captures: ReadonlyMap<string, TwoSiteReportCapture>,
  actions: readonly T[],
): T[] {
  if (!isTwoSiteProductReportInstruction(instruction)) return [...actions];
  if (twoSiteReportDeliverable(instruction, captures)) return [];
  const unread = unreadNamedUrls(instruction, captures);
  const nextUrl = unread[0];
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
    if (sourceKeyFromUrl(item.value) === observed) return observed;
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

function catalogRegion(text: string): string {
  const heading = text.search(/top items being scraped right now/i);
  if (heading < 0) return text;
  const rest = text.slice(heading);
  const catalog = rest.search(/\b(?:computers|laptops|tablets)\b/i);
  return catalog >= 0 ? rest.slice(catalog) : rest;
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
  const name = line.slice(0, inline.index).replace(/[—–\-|:]+$/g, '').trim();
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
    const afterEnd = i + 1 < matches.length ? matches[i + 1]!.index! : Math.min(flat.length, afterStart + 60);
    const name = pickCollapsedName(before, flat.slice(afterStart, afterEnd), previousName);
    if (!name) continue;
    previousName = name;
    push(name, match[0].trim());
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
  if (prev && prev !== previousName && !isJunkName(prev)) return expandTruncatedName(prev, next);
  return next;
}

function lastProductChunk(before: string): string | undefined {
  const words = stripSkipPhrases(before).split(/[.!?]/).pop()?.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean) ?? [];
  const chunk = words.slice(-5).join(' ');
  return isProductNameLine(chunk) ? chunk : undefined;
}

function firstProductChunk(after: string): string | undefined {
  const words = stripSkipPhrases(after).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const chunk = words.slice(0, 5).join(' ');
  return isProductNameLine(chunk) ? chunk : undefined;
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

function sourceNeedsProducts(
  instruction: string,
  captures: ReadonlyMap<string, TwoSiteReportCapture>,
  url: string,
): boolean {
  const key = sourceKeyForObservedUrl(instruction, url, captures);
  if (!key) return false;
  return (captures.get(key)?.products.length ?? 0) === 0;
}

function nameBesidePrice(lines: string[], priceIndex: number, usedNames: Set<string>): string | undefined {
  return nearestUnusedName(lines, priceIndex, -1, usedNames) ?? nearestUnusedName(lines, priceIndex, 1, usedNames);
}

function nearestUnusedName(
  lines: string[],
  from: number,
  step: number,
  usedNames: Set<string>,
): string | undefined {
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
