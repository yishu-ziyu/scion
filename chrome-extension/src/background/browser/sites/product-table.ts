/**
 * Deterministic product list → table deliverable (R1 tracer).
 * Local fixture and simple list pages with name/price/rating fields.
 * Prefer data-* attributes; fall back to class-based spans.
 */

import {
  analyzeInstructionLanguage,
  instructionAffirmedTargetValue,
  instructionAffirmsTarget,
} from '../../instruction-language';
import {
  nameFromAnchorTitle,
  nameFromItemprop,
  priceFromItemprop,
  priceFromPriceColorClass,
  ratingFromDataRating,
  ratingFromStarRatingClass,
} from '../product-card-fields';

export type ProductRow = {
  name: string;
  price: string;
  rating: string;
};

export type ProductTableGoal = {
  /** Output format requested by the user. */
  format: 'csv' | 'md';
  /** Minimum product rows expected (default 1; R1 fixture has ≥5). */
  minRows: number;
};

/** Canonical, ephemeral input for a row-level evidence digest. */
export function productRowEvidenceText(row: ProductRow): string {
  const normalize = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  return `product-row-v1:${JSON.stringify([normalize(row.name), normalize(row.price), normalize(row.rating)])}`;
}

const DEFAULT_MIN_ROWS = 1;

/**
 * Parse extract-products-to-table instructions (e2e + Chinese product phrasing).
 * Examples:
 * - Extract products to a CSV table with name, price, rating
 * - 把商品导出为 CSV 表（名称、价格、评分）
 */
export function parseProductTableInstruction(instruction: string): ProductTableGoal | null {
  const text = instruction.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const language = analyzeInstructionLanguage(instruction);
  if (!instructionAffirmsTarget(language, 'structured_table')) return null;

  const productish =
    /\b(product|products|item|items|listing|listings)\b/i.test(text) ||
    /商品|产品|货品|列表/.test(text) ||
    (/\b(price|rating)\b/i.test(text) && /\b(name|title)\b/i.test(text)) ||
    (/价格|评分|星级/.test(text) && /名称|名字|标题/.test(text));

  if (!productish) return null;

  const format = instructionAffirmedTargetValue(language, 'table_format') === 'md' ? 'md' : 'csv';
  const minRows = instructionAffirmedTargetValue(language, 'product_row_count');
  return { format, minRows: typeof minRows === 'number' ? minRows : DEFAULT_MIN_ROWS };
}

/** True when the instruction expects a user-visible table deliverable. */
export function instructionRequestsProductTable(instruction: string): boolean {
  return parseProductTableInstruction(instruction) !== null;
}

export function instructionRequestsMostExpensive(instruction: string): boolean {
  return instructionAffirmsTarget(analyzeInstructionLanguage(instruction), 'most_expensive');
}

function numericProductPrice(price: string): number | null {
  const matches = [...price.replace(/\s+/g, '').matchAll(/-?\d[\d,]*(?:\.\d+)?/g)];
  if (matches.length !== 1) return null;
  const value = Number(matches[0][0].replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

/**
 * Derive the requested comparison from extracted rows, not model prose.
 * Equal prices resolve to the first source row so the conclusion stays singular
 * and deterministic while preserving the chosen row's exact price text.
 */
export function formatMostExpensiveProductConclusion(rows: ProductRow[]): string | null {
  let winner: ProductRow | null = null;
  let highestPrice = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const price = numericProductPrice(row.price);
    if (price === null) return null;
    if (price > highestPrice) {
      winner = row;
      highestPrice = price;
    }
  }
  return winner ? `最贵商品是 ${winner.name}，价格为 ${winner.price}。` : null;
}

function decodeHtmlEntities(raw: string): string {
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function attrValue(attrs: string, name: string): string {
  const re = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i');
  const m = attrs.match(re);
  return m ? decodeHtmlEntities(m[1]) : '';
}

function spanByClass(block: string, className: string): string {
  const re = new RegExp(`class\\s*=\\s*["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/`, 'i');
  const m = block.match(re);
  if (!m) return '';
  return decodeHtmlEntities(m[1].replace(/<[^>]+>/g, ' '));
}

function firstGroup(html: string, re: RegExp): string {
  const match = html.match(re);
  if (!match?.[1]) return '';
  return decodeHtmlEntities(match[1].replace(/<[^>]+>/g, ' '));
}

function wrapperCardName(slice: string): string {
  return (
    nameFromItemprop(
      { itemprop: 'name', title: firstGroup(slice, /<a\b[^>]*\btitle\s*=\s*["']([^"']+)["'][^>]*\bitemprop\s*=\s*["']name["']/i) },
      '',
    ) ||
    nameFromItemprop(
      { itemprop: 'name', title: firstGroup(slice, /<a\b[^>]*\bitemprop\s*=\s*["']name["'][^>]*\btitle\s*=\s*["']([^"']+)/i) },
      '',
    ) ||
    nameFromItemprop(
      {
        itemprop: 'name',
        title: firstGroup(slice, /<a\b[^>]*\bclass\s*=\s*["'][^"']*\btitle\b[^"']*["'][^>]*\btitle\s*=\s*["']([^"']+)/i),
      },
      '',
    ) ||
    nameFromItemprop({ itemprop: 'name' }, firstGroup(slice, /itemprop\s*=\s*["']name["'][^>]*>([\s\S]*?)<\//i))
  );
}

function wrapperCardPrice(slice: string): string {
  return priceFromItemprop({ itemprop: 'price' }, firstGroup(slice, /itemprop\s*=\s*["']price["'][^>]*>([\s\S]*?)<\//i));
}

function wrapperCardRating(slice: string): string {
  return ratingFromDataRating({ 'data-rating': firstGroup(slice, /\bdata-rating\s*=\s*["']([^"']*)["']/i) });
}

function podCardName(slice: string): string {
  return nameFromAnchorTitle(firstGroup(slice, /<a\b[^>]*\btitle\s*=\s*["']([^"']+)["']/i));
}

function podCardPrice(slice: string): string {
  return priceFromPriceColorClass(
    'price_color',
    firstGroup(slice, /class\s*=\s*["'][^"']*\bprice_color\b[^"']*["'][^>]*>([\s\S]*?)<\//i),
  );
}

function podCardRating(slice: string): string {
  return ratingFromStarRatingClass(firstGroup(slice, /class\s*=\s*["']([^"']*\bstar-rating\b[^"']*)["']/i));
}

function collectProductPodCards(
  html: string,
  push: (name: string, price: string, rating: string) => void,
  atLimit: () => boolean,
): void {
  for (const match of html.matchAll(/<article\b[^>]*\bproduct_pod\b[^>]*>/gi)) {
    if (atLimit()) return;
    const start = match.index ?? 0;
    const slice = html.slice(start, start + 4000);
    push(podCardName(slice), podCardPrice(slice), podCardRating(slice));
  }
}

function collectProductWrapperCards(
  html: string,
  push: (name: string, price: string, rating: string) => void,
  atLimit: () => boolean,
): void {
  for (const match of html.matchAll(/<div\b[^>]*\bproduct-wrapper\b[^>]*>/gi)) {
    if (atLimit()) return;
    const start = match.index ?? 0;
    const slice = html.slice(start, start + 4000);
    push(wrapperCardName(slice), wrapperCardPrice(slice), wrapperCardRating(slice));
  }
}

/**
 * Extract product rows from list HTML.
 * Supports:
 * 1. `<li|article|div class="product" data-name data-price data-rating>`
 * 2. Nested `.product-name` / `.product-price` / `.product-rating` spans
 * 3. `.product-wrapper` cards with `a.title` / `itemprop=price` / `data-rating`
 * 4. `article.product_pod` cards with `a[title]` / `.price_color` / `.star-rating`
 * 5. Simple `<tr>` rows with 3+ `<td>` (name, price, rating)
 */
export function extractProductsFromHtml(html: string, max = 50): ProductRow[] {
  if (!html) return [];
  const found: ProductRow[] = [];
  const seen = new Set<string>();

  const push = (name: string, price: string, rating: string) => {
    const n = name.trim();
    const p = price.trim();
    const r = rating.trim();
    if (!n || !p) return;
    const key = `${n}|${p}|${r}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ name: n, price: p, rating: r || '' });
  };

  collectProductWrapperCards(html, push, () => found.length >= max);
  collectProductPodCards(html, push, () => found.length >= max);

  // Card / list items with data-* (fixture + Amazon-like cards)
  const cardRe =
    /<(li|article|div)\b([^>]*\b(?:class\s*=\s*["'][^"']*\bproduct\b[^"']*["']|data-name\s*=)[^>]*)>([\s\S]*?)<\/\1>/gi;
  for (const match of html.matchAll(cardRe)) {
    const attrs = match[2] || '';
    const body = match[3] || '';
    const name = attrValue(attrs, 'data-name') || spanByClass(body, 'product-name') || spanByClass(body, 'name') || '';
    const price =
      attrValue(attrs, 'data-price') || spanByClass(body, 'product-price') || spanByClass(body, 'price') || '';
    const rating =
      attrValue(attrs, 'data-rating') || spanByClass(body, 'product-rating') || spanByClass(body, 'rating') || '';
    push(name, price, rating);
    if (found.length >= max) return found;
  }

  // data-product table rows: <tr data-product><td>Name</td><td>$1</td><td>4.5</td></tr>
  const dataProduct =
    /<tr[^>]*\bdata-product\b[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;
  for (const match of html.matchAll(dataProduct)) {
    push(
      decodeHtmlEntities(match[1].replace(/<[^>]+>/g, ' ')),
      decodeHtmlEntities(match[2].replace(/<[^>]+>/g, ' ')),
      decodeHtmlEntities(match[3].replace(/<[^>]+>/g, ' ')),
    );
    if (found.length >= max) return found;
  }

  // Table rows: skip header if first cell looks like "name"/"product"
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  for (const match of html.matchAll(rowRe)) {
    const cells = [...match[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c =>
      decodeHtmlEntities(c[1].replace(/<[^>]+>/g, ' ')),
    );
    if (cells.length < 3) continue;
    const [c0, c1, c2] = cells;
    if (/^(name|product|title|名称|商品)/i.test(c0) && /price|价格/i.test(c1)) continue;
    // Prefer rows that look like prices for generic tables
    if (!/\$|\d/.test(c1)) continue;
    push(c0, c1, c2);
    if (found.length >= max) break;
  }

  return found;
}

/** Escape a CSV field (RFC-ish: quote when needed). */
export function csvEscape(value: string): string {
  const v = value.replace(/\r?\n/g, ' ').trim();
  if (/[",]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function formatProductsCsv(rows: ProductRow[]): string {
  const header = 'name,price,rating';
  const lines = rows.map(r => [csvEscape(r.name), csvEscape(r.price), csvEscape(r.rating)].join(','));
  return [header, ...lines].join('\n');
}

export function formatProductsMarkdown(rows: ProductRow[]): string {
  const header = '| name | price | rating |';
  const sep = '| --- | --- | --- |';
  const body = rows.map(r => `| ${r.name.replace(/\|/g, '\\|')} | ${r.price} | ${r.rating} |`);
  return [header, sep, ...body].join('\n');
}

/**
 * User-visible deliverable for side-panel completion-deliverable slot.
 * Prefixed with a short result line so hasSubstantiveDeliverableAnswer accepts it.
 */
export function formatProductTableDeliverable(rows: ProductRow[], format: 'csv' | 'md' = 'csv'): string {
  if (rows.length === 0) {
    return '未从当前页抽到商品行。';
  }
  const table = format === 'md' ? formatProductsMarkdown(rows) : formatProductsCsv(rows);
  const label = format === 'md' ? 'Markdown' : 'CSV';
  return `已提取 ${rows.length} 件商品（${label}）：\n${table}`;
}

/**
 * Build done summary for empty-criteria completion (list fields already on page).
 */
export function productTableCompletionPlan(rows: ProductRow[]): {
  summary: string;
  format: 'csv' | 'md';
} | null {
  if (rows.length === 0) return null;
  return {
    summary: formatProductTableDeliverable(rows, 'csv'),
    format: 'csv',
  };
}
