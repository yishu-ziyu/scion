import type { ContextAnchor, ContextBlock, ContextBundle, HeadingBlock } from './blocks';
import {
  attribute,
  directOrNested,
  findAll,
  innerText,
  isExcluded,
  parseHtml,
  resolveUrl,
  type HtmlNode,
} from './html';

export interface ExtractWebpageOptions {
  url?: string;
  title?: string;
}

const CANDIDATE_TAGS = new Set(['article', 'main', 'section', 'div', 'body']);
const HEADING_TAG = /^h([1-6])$/;
const LIST_TAGS = new Set(['ul', 'ol']);
const CELL_TAGS = new Set(['th', 'td']);
const BLOCK_TEXT_TAGS = new Set(['p', 'blockquote', 'pre']);

export function extractWebpageContext(html: string, options: ExtractWebpageOptions = {}): ContextBundle {
  if (!html.trim()) return emptyWebpage(options);

  const root = parseHtml(html);
  const url = options.url?.trim() || sourceUrl(root);
  const content = selectContent(root);
  const { blocks, anchors } = content ? extractBlocks(content, url) : { blocks: [], anchors: [] };
  const title = options.title?.trim() || documentTitle(root, content);

  return { sourceType: 'webpage', title, url, blocks, anchors, trustLevel: 'untrusted' };
}

function emptyWebpage(options: ExtractWebpageOptions): ContextBundle {
  return {
    sourceType: 'webpage',
    title: options.title?.trim() ?? '',
    url: options.url?.trim() ?? '',
    blocks: [],
    anchors: [],
    trustLevel: 'untrusted',
  };
}

function selectContent(root: HtmlNode): HtmlNode | undefined {
  const candidates = findAll(root, node => CANDIDATE_TAGS.has(node.tag));
  let winner: HtmlNode | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    const score = candidateScore(candidate);
    if (score > bestScore) {
      winner = candidate;
      bestScore = score;
    }
  }
  return winner;
}

function candidateScore(node: HtmlNode): number {
  const text = innerText(node);
  if (!text) return Number.NEGATIVE_INFINITY;
  const paragraphs = findAll(node, child => child.tag === 'p').length;
  const headings = findAll(node, child => HEADING_TAG.test(child.tag)).length;
  const lists = findAll(node, child => LIST_TAGS.has(child.tag)).length;
  const linkText = findAll(node, child => child.tag === 'a').reduce((sum, link) => sum + innerText(link).length, 0);
  const linkPenalty = text.length ? (linkText / text.length) * 300 : 0;
  const tagBonus = node.tag === 'article' ? 400 : node.tag === 'main' ? 300 : node.tag === 'section' ? 100 : 0;
  return text.length + paragraphs * 90 + headings * 35 + lists * 45 + tagBonus - linkPenalty;
}

function extractBlocks(content: HtmlNode, baseUrl: string): { blocks: ContextBlock[]; anchors: ContextAnchor[] } {
  const blocks: ContextBlock[] = [];
  const anchors: ContextAnchor[] = [];
  const anchorIds = new Set<string>();

  const pushHeading = (node: HtmlNode, level: HeadingBlock['level']) => {
    const text = innerText(node);
    if (!text) return;
    const blockIndex = blocks.length;
    blocks.push({ type: 'heading', level, text });
    anchors.push({ id: uniqueAnchor(attribute(node, 'id') || slug(text), anchorIds), blockIndex, text });
  };

  const pushParagraph = (node: HtmlNode) => {
    const text = innerText(node);
    if (!text) return;
    const blockIndex = blocks.length;
    blocks.push({ type: 'paragraph', text });
    appendLinkAnchors(node, baseUrl, blockIndex, anchors, anchorIds);
  };

  const visit = (node: HtmlNode) => {
    if (isExcluded(node) || node.tag === '#text') return;
    const heading = node.tag.match(HEADING_TAG);
    if (heading) {
      pushHeading(node, Number(heading[1]) as HeadingBlock['level']);
      return;
    }
    if (BLOCK_TEXT_TAGS.has(node.tag)) {
      pushParagraph(node);
      return;
    }
    if (LIST_TAGS.has(node.tag)) {
      const items = listItems(node);
      if (items.length) {
        const blockIndex = blocks.length;
        blocks.push({ type: 'list', ordered: node.tag === 'ol', items });
        appendLinkAnchors(node, baseUrl, blockIndex, anchors, anchorIds);
      }
      return;
    }
    if (node.tag === 'table') {
      const rows = tableRows(node);
      if (rows.length) {
        const blockIndex = blocks.length;
        blocks.push({ type: 'table', rows });
        appendLinkAnchors(node, baseUrl, blockIndex, anchors, anchorIds);
      }
      return;
    }
    if (node.tag === 'a') {
      pushLink(node, baseUrl, blocks, anchors, anchorIds);
      return;
    }
    for (const child of node.children) visit(child);
  };

  visit(content);
  if (blocks.length === 0) {
    const text = innerText(content);
    if (text) blocks.push({ type: 'paragraph', text });
  }
  return { blocks, anchors };
}

function listItems(list: HtmlNode): string[] {
  const direct = list.children.filter(child => child.tag === 'li');
  const nodes = direct.length ? direct : findAll(list, child => child.tag === 'li');
  return nodes.map(innerText).filter(Boolean);
}

function tableRows(table: HtmlNode): string[][] {
  return directOrNested(table, new Set(['tr']))
    .map(row => directOrNested(row, CELL_TAGS).map(innerText).filter(Boolean))
    .filter(row => row.length > 0);
}

function pushLink(
  node: HtmlNode,
  baseUrl: string,
  blocks: ContextBlock[],
  anchors: ContextAnchor[],
  usedIds: Set<string>,
): void {
  const text = innerText(node);
  const href = safeHref(attribute(node, 'href'), baseUrl);
  if (!text || !href) return;
  const blockIndex = blocks.length;
  blocks.push({ type: 'link', text, href });
  anchors.push({ id: uniqueAnchor(slug(text), usedIds), blockIndex, text, href });
}

function appendLinkAnchors(
  node: HtmlNode,
  baseUrl: string,
  blockIndex: number,
  anchors: ContextAnchor[],
  usedIds: Set<string>,
): void {
  for (const link of findAll(node, child => child.tag === 'a')) {
    const text = innerText(link);
    const href = safeHref(attribute(link, 'href'), baseUrl);
    if (!text || !href) continue;
    anchors.push({ id: uniqueAnchor(slug(text), usedIds), blockIndex, text, href });
  }
}

function safeHref(value: string, baseUrl: string): string {
  if (!value || /^\s*(javascript|data):/i.test(value)) return '';
  return resolveUrl(value, baseUrl);
}

function sourceUrl(root: HtmlNode): string {
  const canonical = findAll(
    root,
    node => node.tag === 'link' && attribute(node, 'rel').toLowerCase() === 'canonical',
  )[0];
  if (canonical) return resolveUrl(attribute(canonical, 'href'), '');
  const ogUrl = findAll(root, node => node.tag === 'meta' && attribute(node, 'property').toLowerCase() === 'og:url')[0];
  return ogUrl ? attribute(ogUrl, 'content') : '';
}

function documentTitle(root: HtmlNode, content?: HtmlNode): string {
  const ogTitle = findAll(
    root,
    node => node.tag === 'meta' && attribute(node, 'property').toLowerCase() === 'og:title',
  )[0];
  if (ogTitle) return attribute(ogTitle, 'content');
  const title = findAll(root, node => node.tag === 'title')[0];
  if (title && innerText(title)) return innerText(title);
  const heading = content && findAll(content, node => node.tag === 'h1')[0];
  return heading ? innerText(heading) : '';
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\u00c0-\u024f\u3400-\u9fff]+/g, '-')
      .replace(/^-|-$/g, '') || 'section'
  );
}

function uniqueAnchor(preferred: string, used: Set<string>): string {
  const base = preferred || 'section';
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}
