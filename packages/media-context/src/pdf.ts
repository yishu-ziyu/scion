import type { ContextAnchor, ContextBlock, ContextBundle, TrustLevel } from '@extension/context-engine';
import { stripCjkSpacing, uniqueAnchor } from './text';

export interface PdfPageItem {
  /** 1-based page number; falls back to input order. */
  page?: number;
  /** Full page text; lines separated by newlines. */
  text?: string;
  /** Alternative to `text`: one entry per line. */
  lines?: string[];
  /** Display label override, e.g. "iii" or "A-12". */
  label?: string;
}

export type PdfPageInput = string | PdfPageItem;

export interface PdfMetadata {
  title?: string;
  url?: string;
  numPages?: number;
  trustLevel?: TrustLevel;
}

/** Fallback lines-per-paragraph cap before sentence splitting. */
const MAX_PARAGRAPH_CHARS = 600;

/**
 * Turn per-page extracted text into a ContextBundle.
 * Accepts a single string (a `\f` splits pages), or an array of page items.
 * Each page becomes a level-2 heading "第 N 页" plus paragraphs, and one
 * anchor pointing at `#page=N` (or `url#page=N` when metadata.url is set).
 */
export function parsePdfText(pages: PdfPageInput | readonly PdfPageInput[], metadata: PdfMetadata = {}): ContextBundle {
  const items = toPageItems(pages);
  const blocks: ContextBlock[] = [];
  const anchors: ContextAnchor[] = [];
  const usedIds = new Set<string>();

  items.forEach((item, index) => {
    const paragraphs = pageParagraphs(item);
    if (paragraphs.length === 0) return;
    const page = pageNumber(item, index);
    const heading = `第 ${item.label ?? page} 页`;
    const blockIndex = blocks.length;
    blocks.push({ type: 'heading', level: 2, text: heading });
    for (const text of paragraphs) blocks.push({ type: 'paragraph', text });
    anchors.push({
      id: uniqueAnchor(`page-${item.label ?? page}`, usedIds),
      blockIndex,
      text: heading,
      href: pageHref(metadata.url, page),
    });
  });

  return {
    sourceType: 'document',
    title: metadata.title?.trim() ?? '',
    url: metadata.url?.trim() ?? '',
    blocks,
    anchors,
    trustLevel: metadata.trustLevel ?? 'untrusted',
  };
}

function toPageItems(pages: PdfPageInput | readonly PdfPageInput[]): PdfPageItem[] {
  if (typeof pages === 'string') return pages.split(/\f/).map(text => ({ text }));
  if (isPageItem(pages)) return [{ ...pages }];
  return pages.map(item => (typeof item === 'string' ? { text: item } : { ...item }));
}

function isPageItem(value: unknown): value is PdfPageItem {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pageNumber(item: PdfPageItem, index: number): number {
  return item.page != null && Number.isFinite(item.page) && item.page > 0 ? Math.floor(item.page) : index + 1;
}

function pageHref(url: string | undefined, page: number): string {
  const base = url?.trim() ? url.trim().split('#')[0] : '';
  return `${base}#page=${page}`;
}

function pageParagraphs(item: PdfPageItem): string[] {
  const raw = item.text ?? (item.lines ? item.lines.join('\n') : '');
  if (!raw.trim()) return [];
  return raw
    .split(/\n\s*\n/)
    .map(cleanPageText)
    .flatMap(text => splitLongParagraph(text, MAX_PARAGRAPH_CHARS))
    .filter(Boolean);
}

function cleanPageText(raw: string): string {
  // PDF extraction yields one line per visual line; join into flowing text.
  const joined = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .join(' ');
  return stripCjkSpacing(joined.replace(/\s+/g, ' ').trim());
}

/** Split a long paragraph at sentence boundaries; hard-cut as a fallback. */
function splitLongParagraph(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max + 1);
    const boundary = sentenceBoundary(window, max);
    const cut = boundary > 0 ? boundary : max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts.filter(Boolean);
}

function sentenceBoundary(window: string, max: number): number {
  const enders = ['。', '！', '？', '；', '. ', '! ', '? ', '; '];
  let best = 0;
  for (const ender of enders) {
    const index = window.lastIndexOf(ender);
    if (index > best && index > max / 2) best = index + ender.length;
  }
  return best;
}
