/**
 * Visible page wording for the default observation (021 看页).
 * innerText, not clickable indexes. Not a screenshot.
 */

export const DEFAULT_VISIBLE_TEXT_CHARS = 16_000;
export const MIN_USABLE_PAGE_BODY_CHARS = 20;

export function normalizeVisiblePageText(raw: unknown, maxChars = DEFAULT_VISIBLE_TEXT_CHARS): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[ \t]+/gm, '')
    .trim()
    .slice(0, maxChars);
}

/** Truncated cards (h3 ellipsis) keep the full name on the link title. */
export function mergeVisibleTextWithLinkTitles(
  body: unknown,
  titles: unknown,
  maxChars = DEFAULT_VISIBLE_TEXT_CHARS,
): string {
  const text = typeof body === 'string' ? body : '';
  const extra = Array.isArray(titles)
    ? titles
        .map(item => (typeof item === 'string' ? item.replace(/\s+/g, ' ').trim() : ''))
        .filter(item => item && item.length <= 80 && !text.includes(item))
    : [];
  if (extra.length === 0) return normalizeVisiblePageText(text, maxChars);
  return normalizeVisiblePageText([text, ...extra].join('\n'), maxChars);
}

export function hasUsablePageBody(text: string | undefined | null): boolean {
  return (text ?? '').replace(/\s+/g, '').length >= MIN_USABLE_PAGE_BODY_CHARS;
}
