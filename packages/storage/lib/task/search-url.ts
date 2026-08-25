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
