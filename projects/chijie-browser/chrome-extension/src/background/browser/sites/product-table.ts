/**
 * Deterministic product list → table deliverable (R1 tracer).
 * Local fixture and simple list pages with name/price/rating fields.
 * Prefer data-* attributes; fall back to class-based spans.
 */

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

  const wantsTable =
    /\b(extract|export|scrape|pull)\b/i.test(text) ||
    /抽取|提取|导出|整理成|做成/.test(text) ||
    /\b(csv|markdown|\.md)\b/i.test(text) ||
    /表格|清单/.test(text);

  if (!wantsTable) return null;

  const productish =
    /\b(product|products|item|items|listing|listings)\b/i.test(text) ||
    /商品|产品|货品|列表/.test(text) ||
    (/\b(price|rating)\b/i.test(text) && /\b(name|title)\b/i.test(text)) ||
    (/价格|评分|星级/.test(text) && /名称|名字|标题/.test(text));

  if (!productish) return null;

  // Prefer CSV when both mentioned or when "table" alone (R1 default).
  let format: 'csv' | 'md' = 'csv';
  if (/\b(markdown|\.md)\b/i.test(text) || /markdown|md\s*表|md格式/.test(text)) {
    if (!/\bcsv\b/i.test(text) && !/\.csv\b/i.test(text)) {
      format = 'md';
    }
  }
  if (/\bcsv\b/i.test(text) || /\.csv\b/i.test(text) || /CSV/.test(text)) {
    format = 'csv';
  }

  return { format, minRows: DEFAULT_MIN_ROWS };
}

/** True when the instruction expects a user-visible table deliverable. */
export function instructionRequestsProductTable(instruction: string): boolean {
  return parseProductTableInstruction(instruction) !== null;
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
  const re = new RegExp(
    `class\\s*=\\s*["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/`,
    'i',
  );
  const m = block.match(re);
  if (!m) return '';
  return decodeHtmlEntities(m[1].replace(/<[^>]+>/g, ' '));
}

/**
 * Extract product rows from list HTML.
 * Supports:
 * 1. `<li|article|div class="product" data-name data-price data-rating>`
 * 2. Nested `.product-name` / `.product-price` / `.product-rating` spans
 * 3. Simple `<tr>` rows with 3+ `<td>` (name, price, rating)
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

  // Card / list items with data-* (fixture + Amazon-like cards)
  const cardRe =
    /<(li|article|div)\b([^>]*\b(?:class\s*=\s*["'][^"']*\bproduct\b[^"']*["']|data-name\s*=)[^>]*)>([\s\S]*?)<\/\1>/gi;
  for (const match of html.matchAll(cardRe)) {
    const attrs = match[2] || '';
    const body = match[3] || '';
    const name =
      attrValue(attrs, 'data-name') ||
      spanByClass(body, 'product-name') ||
      spanByClass(body, 'name') ||
      '';
    const price =
      attrValue(attrs, 'data-price') ||
      spanByClass(body, 'product-price') ||
      spanByClass(body, 'price') ||
      '';
    const rating =
      attrValue(attrs, 'data-rating') ||
      spanByClass(body, 'product-rating') ||
      spanByClass(body, 'rating') ||
      '';
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
export function formatProductTableDeliverable(
  rows: ProductRow[],
  format: 'csv' | 'md' = 'csv',
): string {
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
