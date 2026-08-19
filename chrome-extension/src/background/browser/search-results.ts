import type { AttemptFinding } from '@extension/storage';

const MAX_FINDINGS = 6;
const TITLE_MAX = 80;

export function isSearchResultsUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    const path = url.pathname.toLowerCase();
    if (host.includes('google.') && path.startsWith('/search')) return true;
    if ((host === 'bing.com' || host.endsWith('.bing.com')) && path.startsWith('/search')) return true;
    if (host === 'duckduckgo.com' || host.endsWith('.duckduckgo.com')) {
      return Boolean(url.searchParams.get('q') || path.startsWith('/html'));
    }
    if ((host === 'baidu.com' || host.endsWith('.baidu.com')) && (path === '/s' || path.startsWith('/s/') || path.startsWith('/baidu'))) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function searchQueryFromResultsUrl(value: string | undefined): string | undefined {
  if (!value || !isSearchResultsUrl(value)) return undefined;
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    const query = (url.searchParams.get('q') || url.searchParams.get('wd') || url.searchParams.get('p') || '')
      .replace(/\s+/g, ' ')
      .trim();
    return query.length >= 1 ? query.slice(0, 80) : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeSearchFindings(raw: unknown): AttemptFinding[] {
  if (!Array.isArray(raw)) return [];
  const out: AttemptFinding[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { title?: unknown; url?: unknown; host?: unknown };
    const title = String(record.title ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (title.length < 2) continue;
    const url = typeof record.url === 'string' ? record.url.trim().slice(0, 500) : undefined;
    let host = typeof record.host === 'string' ? record.host.replace(/^www\./, '').trim() : undefined;
    if (!host && url) {
      try {
        host = new URL(url).hostname.replace(/^www\./, '');
      } catch {
        host = undefined;
      }
    }
    if (host && /google\./i.test(host) && !/googleusercontent/i.test(host)) continue;
    const key = `${title}|${host ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: title.slice(0, TITLE_MAX), url, host });
    if (out.length >= MAX_FINDINGS) break;
  }
  return out;
}

/** Runs inside the search page. Must stay self-contained for page.evaluate. */
export function readSearchResultsInPage(): Array<{ title: string; url: string; host: string }> {
  const out: Array<{ title: string; url: string; host: string }> = [];
  const seen = new Set<string>();
  const heads = Array.from(
    document.querySelectorAll(
      '#search h3, #rso h3, div.g h3, [data-snf] h3, li.b_algo h2, #b_results h2, article[data-testid="result"] h2, a.result__a',
    ),
  );
  for (const head of heads) {
    const link = head.closest('a') ?? head.parentElement?.closest('a');
    const title = (head.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!link || title.length < 2) continue;
    let href = (link as HTMLAnchorElement).href || '';
    try {
      const parsed = new URL(href, location.origin);
      if (parsed.hostname.includes('google.') && parsed.pathname === '/url') {
        href = parsed.searchParams.get('q') || parsed.searchParams.get('url') || href;
      }
    } catch {
      /* keep href */
    }
    let host = '';
    try {
      host = new URL(href, location.origin).hostname.replace(/^www\./, '');
    } catch {
      host = '';
    }
    if (host.includes('google.') || host.includes('gstatic.')) continue;
    const key = `${title}|${host}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, url: href, host });
    if (out.length >= 6) break;
  }
  return out;
}

export async function collectSearchFindings(page: {
  evaluate: (fn: () => unknown) => Promise<unknown>;
}): Promise<AttemptFinding[]> {
  try {
    const raw = await page.evaluate(readSearchResultsInPage);
    return normalizeSearchFindings(raw);
  } catch {
    return [];
  }
}
