/** Next-page control hints from untrusted HTML attributes and visible labels. */

const EXACT_NEXT = new Set([
  'next',
  'next page',
  'next ›',
  'next »',
  'load more',
  'more results',
  '>',
  '›',
  '»',
  '>>',
  '→',
  '下一页',
  '下一頁',
  '下页',
  '下頁',
  '后页',
  '後頁',
  '加载更多',
  '載入更多',
]);

const CHINESE_NEXT = ['下一页', '下一頁', '下页', '下頁', '后页', '後頁', '加载更多', '載入更多'];
const NEXT_ARIA = /\bnext(\s+page)?\b/;
const PREV_ARIA = /\bprev(ious)?\b/;
const CLICKABLE_TAGS = new Set(['a', 'button', 'link', 'summary']);

function normalizeLabel(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function textLooksLikeNextPage(text: string): boolean {
  const normalized = normalizeLabel(text);
  if (!normalized || normalized.length > 24) return false;
  if (EXACT_NEXT.has(normalized)) return true;
  return CHINESE_NEXT.some(token => normalized.includes(token.toLowerCase()));
}

export function relIsNext(attrs: Record<string, string>): boolean {
  return (attrs.rel || '').toLowerCase().split(/\s+/).includes('next');
}

export function labelledAsNextPage(attrs: Record<string, string>): boolean {
  const raw = `${attrs['aria-label'] || ''} ${attrs.title || ''}`.replace(/\s+/g, ' ').trim();
  if (!raw) return false;
  if (textLooksLikeNextPage(raw)) return true;
  const normalized = raw.toLowerCase();
  return NEXT_ARIA.test(normalized) && !PREV_ARIA.test(normalized);
}

export function classLooksLikeNext(attrs: Record<string, string>): boolean {
  const tokens = `${attrs.class || ''} ${attrs.id || ''}`
    .toLowerCase()
    .split(/[\s_]+/)
    .filter(Boolean);
  return tokens.some(tokenLooksLikeNextClass);
}

function tokenLooksLikeNextClass(token: string): boolean {
  return token === 'next' || token.endsWith('-next') || token.startsWith('next-') || token.includes('pagination-next');
}

export function isClickableName(tag: string, attrs: Record<string, string>): boolean {
  const role = (attrs.role || '').toLowerCase();
  const type = (attrs.type || '').toLowerCase();
  if (CLICKABLE_TAGS.has(tag) || role === 'button' || role === 'link') return true;
  return tag === 'input' && (type === 'button' || type === 'submit');
}

export function attrsLookLikeNextPage(attrs: Record<string, string>): boolean {
  return relIsNext(attrs) || labelledAsNextPage(attrs) || classLooksLikeNext(attrs);
}

export function nodeLooksLikeNextPage(tag: string, attrs: Record<string, string>, text: string): boolean {
  if (attrsLookLikeNextPage(attrs)) return true;
  return isClickableName(tag, attrs) && textLooksLikeNextPage(text);
}
