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
const SKIP_NAME =
  /^(?:home|books?|in stock|add to basket|add to cart|(?:\d+\s+)?reviews?|star rating|view basket|next|previous|filter|sort|search|login|sign in|cart|checkout|copyright)$/i;

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
  const products: TwoSiteProduct[] = [];
  const seen = new Set<string>();
  const lines = visibleText
    .split(/\n+/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const push = (name: string, price: string) => {
    const n = name.replace(/\s+/g, ' ').trim();
    const p = price.replace(/\s+/g, ' ').trim();
    if (!n || !p || SKIP_NAME.test(n) || n.length > 120) return;
    const key = `${n.toLowerCase()}|${p}`;
    if (seen.has(key)) return;
    seen.add(key);
    products.push({ name: n, price: p });
  };

  for (let i = 0; i < lines.length && products.length < max; i++) {
    const line = lines[i]!;
    if (PRICE_LINE.test(line)) {
      const name = nameBesidePrice(lines, i);
      if (name) push(name, line);
      continue;
    }
    const inline = INLINE_PRICE.exec(line);
    if (!inline || inline.index === undefined) continue;
    const name = line.slice(0, inline.index).replace(/[—–\-|:]+$/g, '').trim();
    if (name) push(name, inline[1]!.trim());
  }
  return products;
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
  if (page?.url && sourceNeedsProducts(instruction, captures, page.url)) {
    return { kind: 'read', url: page.url };
  }
  const unread = unreadNamedUrls(instruction, captures);
  if (unread[0]) return { kind: 'open', url: unread[0] };
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

function sourceNeedsProducts(
  instruction: string,
  captures: ReadonlyMap<string, TwoSiteReportCapture>,
  url: string,
): boolean {
  const key = sourceKeyForObservedUrl(instruction, url, captures);
  if (!key) return false;
  return (captures.get(key)?.products.length ?? 0) === 0;
}

function nameBesidePrice(lines: string[], priceIndex: number): string | undefined {
  const first = lines[priceIndex + 1];
  const second = lines[priceIndex + 2];
  if (first && isProductNameLine(first)) {
    if (second && isProductNameLine(second) && second.length > first.length) return second;
    return first;
  }
  return previousNameLine(lines, priceIndex);
}

function previousNameLine(lines: string[], priceIndex: number): string | undefined {
  for (let i = priceIndex - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!isProductNameLine(line)) continue;
    return line;
  }
  return undefined;
}

function isProductNameLine(line: string): boolean {
  if (!line || line.length < 2 || line.length > 120) return false;
  if (PRICE_LINE.test(line) || SKIP_NAME.test(line)) return false;
  if (INLINE_PRICE.test(line)) return false;
  return true;
}
