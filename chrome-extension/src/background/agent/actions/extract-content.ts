/**
 * Generic table / list / repeating-block extraction for extract_content.
 * Does not use site-specific product parsers.
 */
import { instructionAsksForTable } from '@extension/shared';
import { safePageUrl } from '@extension/context-engine';
import { ActionResult } from '@src/background/agent/types';
import { createTableArtifact, type ArtifactSource, type TaskArtifact } from '../../task/artifact';
import { wrapUntrustedContent } from '../messages/utils';
import { nodeLooksLikeNextPage } from './extract-next';

export type ExtractedRecord = Record<string, string>;

export interface ExtractContentPage {
  getContent?: () => Promise<string>;
  getReadabilityContent?: () => Promise<string | { content?: string }>;
  evaluate?: (fn: () => unknown) => Promise<unknown>;
  url?: () => string;
  title?: () => Promise<string> | string;
}

interface SimpleNode {
  tag: string;
  attrs: Record<string, string>;
  children: SimpleNode[];
  text: string;
}

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

const SKIP_DATA_ATTRS = new Set(['testid', 'test-id', 'qa', 'cy']);

export function parseSchemaHint(schema?: string, goal?: string): string[] | undefined {
  const fromSchema = parseFieldList(schema);
  if (fromSchema?.length) return fromSchema;
  return parseFieldList(goal);
}

export function extractStructuredRecords(html: string, schema?: string[]): ExtractedRecord[] {
  if (!html?.trim()) return [];
  const root = parseHtml(html);
  const candidates = [
    extractFromTables(root, schema),
    extractFromLists(root, schema),
    extractFromRepeatingBlocks(root, schema),
  ];
  const best = candidates.reduce(
    (winner, rows) => (scoreRows(rows, schema) > scoreRows(winner, schema) ? rows : winner),
    [],
  );
  return projectFields(best, schema);
}

export async function readPageHtml(page: ExtractContentPage): Promise<string> {
  if (typeof page.getContent === 'function') {
    try {
      const html = await page.getContent();
      if (html?.trim()) return html;
    } catch {
      // try readability
    }
  }
  if (typeof page.getReadabilityContent === 'function') {
    try {
      const raw = await page.getReadabilityContent();
      if (typeof raw === 'string' && raw.trim()) return raw;
      if (raw && typeof raw === 'object' && typeof raw.content === 'string' && raw.content.trim()) {
        return raw.content;
      }
    } catch {
      // try visible text
    }
  }
  if (typeof page.evaluate === 'function') {
    try {
      const text = await page.evaluate(() => document.body?.innerText || '');
      if (typeof text === 'string') return text;
    } catch {
      // empty
    }
  }
  return '';
}

const EXTRACT_PAGE_CAP = 8;

export type ExtractContentOptions = {
  extractWithModel?: (html: string, goal: string, schema?: string[]) => Promise<string>;
  advancePage?: () => Promise<boolean>;
};

export function htmlHasNextPage(html: string): boolean {
  if (!html?.trim()) return false;
  return treeHasNextPage(parseHtml(html));
}

export async function runExtractContent(
  input: { goal: string; schema?: string; intent?: string },
  page: ExtractContentPage,
  options?: ExtractContentOptions,
): Promise<ActionResult> {
  const schema = parseSchemaHint(input.schema, input.goal);
  const collected = await collectPagedExtract(page, input.goal, schema, options);
  if (!collected.rows.length) {
    return new ActionResult({
      extractedContent: 'Extracted 0 records. Task is not complete.',
      includeInMemory: true,
      success: true,
      isDone: false,
      hasMorePages: collected.hasMorePages,
    });
  }
  const columns = columnsFor(collected.rows, schema);
  const artifact = createTableArtifact({
    title: (input.goal || 'extracted records').slice(0, 80),
    columns,
    rows: collected.rows.map(row => {
      const projected: Record<string, string> = {};
      for (const column of columns) projected[column] = row[column] ?? '';
      return projected;
    }),
    sources: collected.sources,
  });
  return extractContentActionResult(artifact, collected.rows, collected.hasMorePages);
}

export function extractContentActionResult(
  artifact: TaskArtifact,
  rows: ExtractedRecord[],
  hasMorePages = false,
): ActionResult {
  const summary = wrapUntrustedContent(
    [
      `Extracted ${rows.length} records into artifact ${artifact.id}. Task is not complete.`,
      'JSON:',
      JSON.stringify(rows),
    ].join('\n'),
    false,
  );
  return new ActionResult({
    extractedContent: summary,
    includeInMemory: true,
    success: true,
    isDone: false,
    artifact,
    hasMorePages,
  });
}

async function collectPagedExtract(
  page: ExtractContentPage,
  goal: string,
  schema: string[] | undefined,
  options?: ExtractContentOptions,
): Promise<{ rows: ExtractedRecord[]; hasMorePages: boolean; sources: ArtifactSource[] }> {
  const seen = new Set<string>();
  const rows: ExtractedRecord[] = [];
  const sources: ArtifactSource[] = [];
  let hasMorePages = false;
  for (let pageIndex = 0; pageIndex < EXTRACT_PAGE_CAP; pageIndex += 1) {
    const step = await extractOnePage(page, goal, schema, options, seen, pageIndex);
    hasMorePages = step.hasMorePages;
    rows.push(...step.novel);
    if (step.source) sources.push(step.source);
    if (!step.continuePaging) break;
  }
  return { rows, hasMorePages, sources: uniqueSources(sources) };
}

async function extractOnePage(
  page: ExtractContentPage,
  goal: string,
  schema: string[] | undefined,
  options: ExtractContentOptions | undefined,
  seen: Set<string>,
  pageIndex: number,
): Promise<{
  novel: ExtractedRecord[];
  hasMorePages: boolean;
  source: ArtifactSource | null;
  continuePaging: boolean;
}> {
  const html = await readPageHtml(page);
  const pageRows = await rowsFromHtml(html, goal, schema, options?.extractWithModel);
  const hasMorePages = htmlHasNextPage(html);
  const novel = takeNovelRows(pageRows, seen);
  if (pageIndex > 0 && novel.length === 0) {
    return { novel: [], hasMorePages: false, source: null, continuePaging: false };
  }
  const source = await sourceFromPage(page);
  const advance = options?.advancePage;
  if (
    !advance ||
    !shouldAdvancePage({
      hasMorePages,
      options,
      pageIndex,
      goal,
      schema,
      rowCount: novel.length,
    })
  ) {
    return { novel, hasMorePages, source, continuePaging: false };
  }
  return { novel, hasMorePages, source, continuePaging: await advance() };
}

function takeNovelRows(pageRows: ExtractedRecord[], seen: Set<string>): ExtractedRecord[] {
  const novel: ExtractedRecord[] = [];
  for (const row of pageRows) {
    const key = recordKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    novel.push(row);
  }
  return novel;
}

function shouldAdvancePage(params: {
  hasMorePages: boolean;
  options: ExtractContentOptions | undefined;
  pageIndex: number;
  goal: string;
  schema: string[] | undefined;
  rowCount: number;
}): boolean {
  if (!params.hasMorePages || !params.options?.advancePage) return false;
  if (params.pageIndex >= EXTRACT_PAGE_CAP - 1) return false;
  if (stopPagingAfterFirstMatchingTable(params)) return false;
  return true;
}

function stopPagingAfterFirstMatchingTable(params: {
  goal: string;
  schema: string[] | undefined;
  rowCount: number;
}): boolean {
  if (params.rowCount <= 0) return false;
  if (instructionAsksForTable(params.goal)) return true;
  const keys = new Set((params.schema ?? []).map(field => field.trim().toLowerCase()));
  return keys.has('name') && keys.has('price') && keys.has('rating');
}

async function rowsFromHtml(
  html: string,
  goal: string,
  schema: string[] | undefined,
  extractWithModel?: (html: string, goal: string, schema?: string[]) => Promise<string>,
): Promise<ExtractedRecord[]> {
  const rows = extractStructuredRecords(html, schema);
  if (rows.length || !extractWithModel || !html.trim()) return rows;
  try {
    return parseModelExtractedRecords(await extractWithModel(html, goal, schema), schema);
  } catch {
    return [];
  }
}

async function sourceFromPage(page: ExtractContentPage): Promise<ArtifactSource | null> {
  const url = safePageUrl(typeof page.url === 'function' ? page.url() : '');
  let title = '';
  if (typeof page.title === 'function') {
    const raw = await page.title();
    if (typeof raw === 'string') title = raw;
  }
  if (!url && !title) return null;
  return { url: url || undefined, title: title || undefined, retrievedAt: Date.now() };
}

function recordKey(row: ExtractedRecord): string {
  return JSON.stringify(
    Object.keys(row)
      .sort()
      .map(key => [key, row[key]]),
  );
}

function uniqueSources(sources: ArtifactSource[]): ArtifactSource[] {
  const seen = new Set<string>();
  const out: ArtifactSource[] = [];
  for (const source of sources) {
    const key = (source.url || source.title || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(source);
  }
  return out;
}

function treeHasNextPage(node: SimpleNode): boolean {
  if (nodeLooksLikeNextPage(node.tag, node.attrs, innerText(node))) return true;
  return node.children.some(treeHasNextPage);
}

export function parseModelExtractedRecords(raw: string, schema?: string[]): ExtractedRecord[] {
  const json = extractJsonArray(raw);
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    const rows = parsed
      .filter(item => item && typeof item === 'object' && !Array.isArray(item))
      .map(item => {
        const row: ExtractedRecord = {};
        for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
          if (value == null) continue;
          const text = String(value).trim();
          if (text) row[normalizeKey(key) || key] = text;
        }
        return row;
      })
      .filter(row => Object.keys(row).length >= 1);
    return projectFields(rows, schema);
  } catch {
    return [];
  }
}

export function parseExtractedRecords(summary: string | null | undefined): ExtractedRecord[] {
  if (!summary) return [];
  const marker = summary.indexOf('JSON:');
  const slice = marker >= 0 ? summary.slice(marker + 5) : summary;
  const json = extractJsonArray(slice);
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as ExtractedRecord[]) : [];
  } catch {
    return [];
  }
}

function extractJsonArray(text: string): string | null {
  const start = text.indexOf('[');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseFieldList(text?: string): string[] | undefined {
  if (!text?.trim()) return undefined;
  const trimmed = text.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const fields = parsed.map(item => normalizeKey(String(item))).filter(Boolean);
        return fields.length ? fields : undefined;
      }
    } catch {
      // fall through
    }
  }
  const parts = trimmed
    .split(/[,，、;；|]/)
    .map(part => part.trim())
    .filter(Boolean);
  const fields = parts.filter(looksLikeFieldName).map(normalizeKey).filter(Boolean);
  return fields.length >= 2 ? fields : undefined;
}

function looksLikeFieldName(value: string): boolean {
  return /^[\w\u3400-\u9fff-]{1,32}$/.test(value.trim());
}

function projectFields(rows: ExtractedRecord[], schema?: string[]): ExtractedRecord[] {
  if (!schema?.length) return rows;
  return rows
    .map(row => {
      const out: ExtractedRecord = {};
      for (const field of schema) {
        const key = matchFieldKey(row, field);
        if (key) out[field] = row[key];
      }
      return out;
    })
    .filter(row => Object.values(row).some(value => value.trim()));
}

const FIELD_SYNONYMS: Record<string, string[]> = {
  name: ['name', 'title', '名称', '品名', '商品名', '名字'],
  price: ['price', '价格', '价钱', '售价', '单价'],
  rating: ['rating', 'score', '评分', '分数', '星级'],
  qty: ['qty', 'quantity', '数量', '件数'],
  city: ['city', '城市'],
  pop: ['pop', 'population', '人口'],
};

function synonymGroup(field: string): string[] {
  const want = field.toLowerCase();
  for (const group of Object.values(FIELD_SYNONYMS)) {
    if (group.some(item => item.toLowerCase() === want)) return group;
  }
  return [field];
}

function matchFieldKey(row: ExtractedRecord, field: string): string | undefined {
  const want = field.toLowerCase();
  const keys = Object.keys(row);
  const synonyms = synonymGroup(field);
  const synonymHit = keys.find(key => synonyms.some(item => item.toLowerCase() === key.toLowerCase()));
  if (synonymHit) return synonymHit;
  return (
    keys.find(key => key.toLowerCase() === want) ??
    keys.find(key => key.toLowerCase().includes(want) || want.includes(key.toLowerCase()))
  );
}

function columnsFor(rows: ExtractedRecord[], schema?: string[]): string[] {
  if (schema?.length) return schema;
  const seen = new Set<string>();
  const columns: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      columns.push(key);
    }
  }
  return columns.length ? columns : ['value'];
}

function scoreRows(rows: ExtractedRecord[], schema?: string[]): number {
  if (!rows.length) return 0;
  if (!schema?.length) {
    const fields = rows.reduce((sum, row) => sum + Object.keys(row).length, 0) / rows.length;
    return rows.length * 10 + fields;
  }
  const usable = projectFields(rows, schema);
  if (!usable.length) return 0;
  const filled = usable.reduce((sum, row) => sum + Object.keys(row).length, 0);
  return filled * 10 + usable.length;
}

function extractFromTables(root: SimpleNode, schema?: string[]): ExtractedRecord[] {
  let best: ExtractedRecord[] = [];
  for (const table of findAll(root, node => node.tag === 'table')) {
    const trs = findAll(table, node => node.tag === 'tr');
    if (!trs.length) continue;
    const headerCells = cellsIn(trs[0], 'th');
    const useHeader = headerCells.length >= 2;
    const columns = useHeader ? headerCells.map((cell, i) => normalizeKey(innerText(cell)) || `col${i + 1}`) : [];
    const dataRows = useHeader ? trs.slice(1) : trs;
    const rows: ExtractedRecord[] = [];
    for (const tr of dataRows) {
      const tds = cellsIn(tr, 'td');
      const source = tds.length ? tds : cellsIn(tr, 'th');
      if (source.length < 2) continue;
      const keys = columns.length ? columns : source.map((_, i) => `col${i + 1}`);
      const row: ExtractedRecord = {};
      source.forEach((cell, i) => {
        const key = keys[i] || `col${i + 1}`;
        const value = innerText(cell);
        if (value) row[key] = value;
      });
      if (Object.keys(row).length >= 2) rows.push(row);
    }
    if (scoreRows(rows, schema) > scoreRows(best, schema)) best = rows;
  }
  return best;
}

function extractFromLists(root: SimpleNode, schema?: string[]): ExtractedRecord[] {
  let best: ExtractedRecord[] = [];
  for (const list of findAll(root, node => node.tag === 'ul' || node.tag === 'ol')) {
    const items = list.children.filter(child => child.tag === 'li');
    const rows = items.map(recordFromBlock).filter(row => Object.keys(row).length >= 2);
    if (scoreRows(rows, schema) > scoreRows(best, schema)) best = rows;
  }
  return best;
}

function extractFromRepeatingBlocks(root: SimpleNode, schema?: string[]): ExtractedRecord[] {
  let best: ExtractedRecord[] = [];
  const visit = (node: SimpleNode) => {
    const groups = new Map<string, SimpleNode[]>();
    for (const child of node.children) {
      if (!child.tag || child.tag === '#text') continue;
      const key = `${child.tag}|${primaryClass(child)}`;
      const group = groups.get(key) ?? [];
      group.push(child);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      if (group.length < 3) continue;
      const rows = group.map(recordFromBlock).filter(row => Object.keys(row).length >= 2);
      if (scoreRows(rows, schema) > scoreRows(best, schema)) best = rows;
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  return best;
}

function recordFromBlock(node: SimpleNode): ExtractedRecord {
  const row: ExtractedRecord = {};
  assignDataAttrs(node, row);
  collectSemanticFields(node, row);
  for (const child of node.children) {
    const key = fieldFromChild(child, row);
    const value = innerText(child);
    if (key && value && !row[key]) row[key] = value;
  }
  return row;
}

function collectSemanticFields(node: SimpleNode, row: ExtractedRecord): void {
  assignDataAttrs(node, row);
  assignItempropField(node, row);
  assignAnchorTitleName(node, row);
  assignPriceColor(node, row);
  assignStarRatingClass(node, row);
  for (const child of node.children) collectSemanticFields(child, row);
}

function assignDataAttrs(node: SimpleNode, row: ExtractedRecord): void {
  for (const [name, value] of Object.entries(node.attrs)) {
    const field = fieldFromAttr(name, value);
    if (field && !row[field]) row[field] = value;
  }
}

function assignItempropField(node: SimpleNode, row: ExtractedRecord): void {
  const prop = (node.attrs.itemprop || '').trim();
  if (!prop) return;
  const key = normalizeKey(prop);
  if (!key || row[key]) return;
  const value = (node.attrs.content || node.attrs.title || innerText(node)).trim();
  if (value) row[key] = value;
}

const STAR_RATING_WORDS: Record<string, string> = {
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
};

function assignAnchorTitleName(node: SimpleNode, row: ExtractedRecord): void {
  if (row.name || node.tag !== 'a') return;
  const title = (node.attrs.title || '').trim();
  if (title) row.name = title;
}

function assignPriceColor(node: SimpleNode, row: ExtractedRecord): void {
  if (row.price) return;
  if (!/\bprice_color\b/i.test(node.attrs.class || '')) return;
  const value = innerText(node);
  if (value) row.price = value;
}

function assignStarRatingClass(node: SimpleNode, row: ExtractedRecord): void {
  if (row.rating) return;
  const tokens = (node.attrs.class || '').trim().split(/\s+/);
  if (!tokens.some(token => /^star-rating$/i.test(token))) return;
  const word = tokens.find(token => STAR_RATING_WORDS[token.toLowerCase()]);
  if (word) row.rating = STAR_RATING_WORDS[word.toLowerCase()];
}

function fieldFromAttr(name: string, value: string): string | undefined {
  if (!value.trim()) return undefined;
  const lower = name.toLowerCase();
  if (!lower.startsWith('data-')) return undefined;
  const key = lower.slice(5);
  if (SKIP_DATA_ATTRS.has(key)) return undefined;
  return normalizeKey(key);
}

function fieldFromChild(node: SimpleNode, existing: ExtractedRecord): string | undefined {
  const fromClass = keyFromClass(node.attrs.class || '');
  if (fromClass) return fromClass;
  if (/^h[1-6]$/.test(node.tag)) return existing.name ? 'heading' : 'name';
  return undefined;
}

function keyFromClass(className: string): string | undefined {
  const tokens = className.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return undefined;
  const hyphenated = tokens.filter(token => token.includes('-') && !/^(is|has|js)-/i.test(token));
  const pick = hyphenated[hyphenated.length - 1] ?? tokens[tokens.length - 1];
  if (/^(product|item|card|row|col|flex|grid|container|wrapper|inner|outer|list)$/i.test(pick)) return undefined;
  return normalizeKey(pick);
}

function normalizeKey(raw: string): string {
  const stripped = raw
    .trim()
    .replace(/^data-/i, '')
    .replace(/^[A-Za-z]+-/, '')
    .replace(/[^a-zA-Z0-9_\u3400-\u9fff]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return stripped.toLowerCase();
}

function cellsIn(row: SimpleNode, tag: 'td' | 'th'): SimpleNode[] {
  return row.children.filter(child => child.tag === tag);
}

function findAll(root: SimpleNode, pred: (node: SimpleNode) => boolean): SimpleNode[] {
  const out: SimpleNode[] = [];
  const walk = (node: SimpleNode) => {
    if (pred(node)) out.push(node);
    for (const child of node.children) walk(child);
  };
  walk(root);
  return out;
}

function innerText(node: SimpleNode): string {
  const parts = [node.text, ...node.children.map(innerText)].join(' ');
  return decodeEntities(parts).replace(/\s+/g, ' ').trim();
}

function primaryClass(node: SimpleNode): string {
  return (node.attrs.class || '').trim().split(/\s+/).filter(Boolean)[0] ?? '';
}

function parseHtml(html: string): SimpleNode {
  const root: SimpleNode = { tag: '#root', attrs: {}, children: [], text: '' };
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<![^>]*>/g, '');
  const stack = [root];
  const tokenRe = /<\/?([a-zA-Z][\w:-]*)([^>]*)\/?>|([^<]+)/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(cleaned))) {
    if (match[3] !== undefined) {
      const text = match[3];
      if (!text.trim()) continue;
      const parent = stack[stack.length - 1];
      parent.text += text;
      continue;
    }
    const tag = match[1].toLowerCase();
    const raw = match[0];
    const isClose = raw.startsWith('</');
    if (isClose) {
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const node: SimpleNode = { tag, attrs: parseAttrs(match[2] || ''), children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    const selfClosing = /\/\s*>$/.test(raw) || VOID_TAGS.has(tag);
    if (!selfClosing) stack.push(node);
  }
  return root;
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

function decodeEntities(raw: string): string {
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
