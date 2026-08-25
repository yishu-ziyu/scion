/** Tabbit-style @ mention: attach the current page into the composer. */

export const CURRENT_PAGE_TOKEN = '@当前页';

export type MentionPage = {
  title: string;
  url: string;
  host: string;
};

export type MentionTrigger = {
  start: number;
  query: string;
};

/** True when the cursor is in an @query with no space yet. */
export function mentionTriggerAt(text: string, cursor: number): MentionTrigger | null {
  const pos = Number.isFinite(cursor) ? Math.max(0, Math.min(text.length, cursor)) : text.length;
  const before = text.slice(0, pos);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  const prev = at === 0 ? ' ' : before[at - 1];
  if (prev && !/\s/.test(prev)) return null;
  const query = before.slice(at + 1);
  if (/[\s\n]/.test(query)) return null;
  return { start: at, query };
}

export function mentionMatchesCurrentPage(query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return '当前页'.includes(q) || 'page'.startsWith(q) || CURRENT_PAGE_TOKEN.slice(1).startsWith(q);
}

export function insertCurrentPageMention(text: string, start: number, cursor: number): string {
  const pos = Number.isFinite(cursor) ? Math.max(start, Math.min(text.length, cursor)) : text.length;
  const before = text.slice(0, start);
  const after = text.slice(pos);
  const spacer = after.startsWith(' ') || after.length === 0 ? '' : ' ';
  return `${before}${CURRENT_PAGE_TOKEN}${spacer}${after}`;
}

function normalizedPageUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    return `${url.origin}${pathname}${url.search}`;
  } catch {
    return null;
  }
}

function instructionAlreadyNamesPage(text: string, pageUrl: string): boolean {
  const pageKey = normalizedPageUrl(pageUrl);
  if (!pageKey) return false;
  return [...text.matchAll(/https?:\/\/[^\s<>]+/gi)].some(match => {
    const literal = match[0].replace(/[.,!?;:]+$/, '');
    return normalizedPageUrl(literal) === pageKey;
  });
}

/** Expand @当前页 so the agent sees host, title, and URL. Display text stays short. */
export function expandCurrentPageMention(text: string, page: MentionPage | null): string {
  if (!page || !text.includes(CURRENT_PAGE_TOKEN)) return text;
  const detail = instructionAlreadyNamesPage(text, page.url)
    ? `${CURRENT_PAGE_TOKEN}（${page.host} · ${page.title}）`
    : `${CURRENT_PAGE_TOKEN}（${page.host} · ${page.title} ${page.url}）`;
  return text.split(CURRENT_PAGE_TOKEN).join(detail);
}

/** Stored task text carries page context for the agent; UI titles keep the user's compact token. */
export function displayCurrentPageMention(text: string): string {
  return text.replace(/@当前页（[^）]*）/g, CURRENT_PAGE_TOKEN);
}
