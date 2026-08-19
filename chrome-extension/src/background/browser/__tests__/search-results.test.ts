import { describe, expect, it } from 'vitest';
import { isSearchResultsUrl, normalizeSearchFindings, searchQueryFromResultsUrl } from '../search-results';

describe('normalizeSearchFindings', () => {
  it('keeps titles and drops google hosts and blanks', () => {
    expect(
      normalizeSearchFindings([
        { title: 'MoonStone2026 AI黑客松', url: 'https://news.example.com/a', host: 'news.example.com' },
        { title: '  ', url: 'https://a.com' },
        { title: 'Google account', url: 'https://accounts.google.com', host: 'accounts.google.com' },
        { title: 'MoonStone2026 AI黑客松', url: 'https://news.example.com/a', host: 'news.example.com' },
      ]),
    ).toEqual([
      { title: 'MoonStone2026 AI黑客松', url: 'https://news.example.com/a', host: 'news.example.com' },
    ]);
  });

  it('returns empty for junk', () => {
    expect(normalizeSearchFindings(null)).toEqual([]);
    expect(normalizeSearchFindings('nope')).toEqual([]);
  });
});

describe('isSearchResultsUrl', () => {
  it('recognizes google / bing / ddg result pages and ignores homepages', () => {
    expect(isSearchResultsUrl('https://www.google.com/search?q=example.com')).toBe(true);
    expect(isSearchResultsUrl('https://www.bing.com/search?q=example.com')).toBe(true);
    expect(isSearchResultsUrl('https://duckduckgo.com/?q=example.com')).toBe(true);
    expect(isSearchResultsUrl('https://www.google.com/')).toBe(false);
    expect(isSearchResultsUrl('https://example.com/')).toBe(false);
  });
});

describe('searchQueryFromResultsUrl', () => {
  it('reads q= from a search results URL', () => {
    expect(searchQueryFromResultsUrl('https://www.google.com/search?q=example.com+iana')).toBe('example.com iana');
    expect(searchQueryFromResultsUrl('https://example.com/')).toBeUndefined();
  });
});
