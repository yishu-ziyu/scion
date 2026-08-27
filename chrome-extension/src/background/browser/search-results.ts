import type { AttemptFinding } from '@extension/storage';

// Local copy of packages/storage/lib/task/search-url.ts: re-exporting from @extension/storage pulled chrome.storage into action-target tests.
// Keep isSearchResultsUrl / searchQueryFromResultsUrl / searchQueryFromPageTitle aligned with that file.
const MAX_FINDINGS = 6;
const TITLE_MAX = 80;

function normalizeNavigableUrl(value: string): string | undefined {
  const candidate = value.trim().slice(0, 500);
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function hasNavigableFindingUrl(value: unknown): boolean {
  if (!value || typeof value !== 'object') return true;
  const url = (value as { url?: unknown }).url;
  return typeof url !== 'string' || normalizeNavigableUrl(url) !== undefined;
}

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
    if (
      (host === 'baidu.com' || host.endsWith('.baidu.com')) &&
      (path === '/s' || path.startsWith('/s/') || path.startsWith('/baidu'))
    ) {
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

export function searchQueryFromPageTitle(value: string | undefined): string | undefined {
  const text = value?.replace(/\s+/g, ' ').trim() ?? '';
  if (!text) return undefined;
  const matched = /^(.*)\s+[-–—]\s+Google(?:\s*(?:搜索|Search))?$/i.exec(text);
  const query = matched?.[1]?.replace(/\s+/g, ' ').trim();
  if (!query || /^https?:\/\//i.test(query)) return undefined;
  return query.slice(0, 80);
}

export function searchObserveLoopPhase(input: {
  url: string;
  step: number;
  title?: string;
  findings?: AttemptFinding[];
}): {
  phase: 'observe';
  step: number;
  detail: string;
  targetUrl: string;
  findings?: AttemptFinding[];
} | null {
  if (!isSearchResultsUrl(input.url)) return null;
  const query = searchQueryFromResultsUrl(input.url) ?? searchQueryFromPageTitle(input.title);
  const findings = input.findings && input.findings.length > 0 ? input.findings : undefined;
  return {
    phase: 'observe',
    step: input.step,
    detail: query ? `搜索：${query}` : '搜索网页',
    targetUrl: input.url,
    ...(findings ? { findings } : {}),
  };
}

export function normalizeSearchFindings(raw: unknown): AttemptFinding[] {
  if (!Array.isArray(raw)) return [];
  const out: AttemptFinding[] = [];
  const seen = new Set<string>();
  for (const item of raw.filter(hasNavigableFindingUrl)) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { title?: unknown; url?: unknown; host?: unknown };
    const title = String(record.title ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (title.length < 2) continue;
    const url = typeof record.url === 'string' ? normalizeNavigableUrl(record.url) : undefined;
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

type SearchHeading = {
  textContent: string | null;
  closest: (selector: string) => { href: string } | null;
  querySelector: (selector: string) => { href: string } | null;
  parentElement: { closest: (selector: string) => { href: string } | null } | null;
};

/** Runs inside the search page. Must stay self-contained for page.evaluate. */
export function readSearchResultsInPage(root?: {
  querySelectorAll: (selector: string) => ArrayLike<SearchHeading>;
}): Array<{ title: string; url: string; host: string }> {
  const scope = root ?? (typeof document === 'undefined' ? undefined : document);
  if (!scope) return [];
  const out: Array<{ title: string; url: string; host: string }> = [];
  const seen = new Set<string>();
  const heads = Array.from(
    scope.querySelectorAll(
      '#search h3, #rso h3, div.g h3, div.MjjYud h3, h3.LC20lb, [data-snf] h3, [data-snhf] h3, li.b_algo h2, #b_results h2, article[data-testid="result"] h2, a.result__a',
    ),
  );
  const base = typeof location === 'undefined' ? 'https://www.google.com.hk' : location.origin;
  for (const head of heads) {
    const link = head.closest('a') ?? head.querySelector('a') ?? head.parentElement?.closest('a') ?? null;
    const title = (head.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!link || title.length < 2) continue;
    let href = link.href || '';
    try {
      const parsed = new URL(href, base);
      if (parsed.hostname.includes('google.') && parsed.pathname === '/url') {
        href = parsed.searchParams.get('q') || parsed.searchParams.get('url') || href;
      }
    } catch {
      /* keep href */
    }
    let host = '';
    try {
      host = new URL(href, base).hostname.replace(/^www\./, '');
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
