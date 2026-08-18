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

/** Expand @当前页 so the agent sees host, title, and URL. Display text stays short. */
export function expandCurrentPageMention(text: string, page: MentionPage | null): string {
  if (!page || !text.includes(CURRENT_PAGE_TOKEN)) return text;
  const detail = `${CURRENT_PAGE_TOKEN}（${page.host} · ${page.title} ${page.url}）`;
  return text.split(CURRENT_PAGE_TOKEN).join(detail);
}
