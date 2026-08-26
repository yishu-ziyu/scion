export interface HtmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
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
const HIDDEN_TAGS = new Set(['script', 'style', 'template', 'noscript', 'svg', 'canvas', 'iframe']);
const NOISE_TAGS = new Set(['nav', 'footer', 'aside', 'form', 'dialog']);
const AUTO_CLOSE_SAME = new Set(['li', 'p', 'tr', 'th', 'td']);
const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'div',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'ul',
]);
const NOISE_IDENTITY =
  /(?:^|[\s_-])(ad|ads|advert|banner|cookie|consent|promo|sidebar|navigation|nav|footer|social|share|related|recommend|comments?|modal|popup|newsletter)(?:$|[\s_-])/i;
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
  ndash: '–',
  mdash: '—',
  hellip: '…',
};

export function parseHtml(html: string): HtmlNode {
  const root: HtmlNode = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  for (const token of tokenize(html)) {
    if (!token.startsWith('<')) {
      appendText(stack.at(-1)!, token);
      continue;
    }
    if (/^<\s*\//.test(token)) {
      closeElement(stack, tagName(token));
      continue;
    }
    if (/^<\s*[!?]/.test(token)) continue;
    const tag = tagName(token);
    if (!tag) continue;
    normalizeStackForOpen(stack, tag);
    const node: HtmlNode = { tag, attrs: parseAttributes(token), children: [], text: '' };
    stack.at(-1)!.children.push(node);
    if (!VOID_TAGS.has(tag) && !/\/\s*>$/.test(token)) stack.push(node);
  }
  return root;
}

export function isExcluded(node: HtmlNode): boolean {
  if (HIDDEN_TAGS.has(node.tag) || NOISE_TAGS.has(node.tag)) return true;
  const identity = `${node.attrs.id ?? ''} ${node.attrs.class ?? ''}`;
  const role = node.attrs.role?.toLowerCase();
  return NOISE_IDENTITY.test(identity) || role === 'navigation' || role === 'contentinfo' || role === 'complementary';
}

export function innerText(node: HtmlNode): string {
  if (node.tag === '#text') return node.text;
  if (isExcluded(node)) return '';
  const pieces: string[] = [];
  collectText(node, pieces);
  return normalizeText(pieces.join(' '));
}

export function findAll(node: HtmlNode, predicate: (node: HtmlNode) => boolean): HtmlNode[] {
  const result: HtmlNode[] = [];
  const visit = (current: HtmlNode) => {
    if (isExcluded(current)) return;
    if (predicate(current)) result.push(current);
    for (const child of current.children) visit(child);
  };
  visit(node);
  return result;
}

export function directOrNested(node: HtmlNode, tags: ReadonlySet<string>): HtmlNode[] {
  return findAll(node, child => child !== node && tags.has(child.tag));
}

export function attribute(node: HtmlNode, name: string): string {
  return decodeEntities(node.attrs[name] ?? '').trim();
}

export function normalizeText(text: string): string {
  return decodeEntities(text)
    .replace(/[\t\r\f ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\s+([,.;:!?，。；：！？])/g, '$1')
    .trim();
}

export function resolveUrl(value: string, base: string): string {
  const href = decodeEntities(value).trim();
  if (!href) return '';
  try {
    return base ? new URL(href, base).href : new URL(href).href;
  } catch {
    return href;
  }
}

function collectText(node: HtmlNode, pieces: string[]): void {
  for (const child of node.children) {
    if (child.tag === '#text') pieces.push(child.text);
    else if (!isExcluded(child)) collectText(child, pieces);
  }
}

function appendText(parent: HtmlNode, value: string): void {
  if (!value) return;
  parent.children.push({ tag: '#text', attrs: {}, children: [], text: value });
}

function normalizeStackForOpen(stack: HtmlNode[], tag: string): void {
  const current = stack.at(-1)?.tag;
  if (current === 'p' && BLOCK_TAGS.has(tag)) stack.pop();
  else if (current === tag && AUTO_CLOSE_SAME.has(tag)) stack.pop();
  else if ((current === 'th' || current === 'td') && (tag === 'th' || tag === 'td')) stack.pop();
}

function closeElement(stack: HtmlNode[], tag: string): void {
  for (let index = stack.length - 1; index > 0; index -= 1) {
    if (stack[index].tag !== tag) continue;
    stack.length = index;
    return;
  }
}

function tagName(token: string): string {
  return token.match(/^<\s*\/?\s*([A-Za-z][\w:-]*)/)?.[1]?.toLowerCase() ?? '';
}

function parseAttributes(token: string): Record<string, string> {
  const openingLength = token.match(/^<\s*\/?\s*[A-Za-z][\w:-]*/)?.[0].length ?? 1;
  const body = token.slice(openingLength, token.lastIndexOf('>'));
  const attrs: Record<string, string> = {};
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of body.matchAll(pattern)) {
    const name = match[1].toLowerCase();
    attrs[name] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attrs;
}

function tokenize(html: string): string[] {
  const tokens: string[] = [];
  let index = 0;
  while (index < html.length) {
    const opening = html.indexOf('<', index);
    if (opening < 0) {
      tokens.push(html.slice(index));
      break;
    }
    if (opening > index) tokens.push(html.slice(index, opening));
    if (html.startsWith('<!--', opening)) {
      const end = html.indexOf('-->', opening + 4);
      index = end < 0 ? html.length : end + 3;
      continue;
    }
    const end = findTagEnd(html, opening + 1);
    if (end < 0) {
      tokens.push(html.slice(opening));
      break;
    }
    tokens.push(html.slice(opening, end + 1));
    index = end + 1;
  }
  return tokens;
}

function findTagEnd(html: string, from: number): number {
  let quote = '';
  for (let index = from; index < html.length; index += 1) {
    const char = html[index];
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '>') return index;
  }
  return -1;
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z][\w]+);/gi, (whole, entity: string) => {
    if (entity[0] !== '#') return NAMED_ENTITIES[entity.toLowerCase()] ?? whole;
    const hexadecimal = entity[1]?.toLowerCase() === 'x';
    const codePoint = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return whole;
    return String.fromCodePoint(codePoint);
  });
}
