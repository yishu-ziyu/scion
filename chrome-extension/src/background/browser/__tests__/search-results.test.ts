import { describe, expect, it } from 'vitest';
import {
  isSearchResultsUrl,
  normalizeSearchFindings,
  readSearchResultsInPage,
  searchObserveLoopPhase,
  searchQueryFromPageTitle,
  searchQueryFromResultsUrl,
} from '../search-results';

describe('normalizeSearchFindings', () => {
  it('keeps titles and drops google hosts and blanks', () => {
    expect(
      normalizeSearchFindings([
        { title: 'MoonStone2026 AI黑客松', url: 'https://news.example.com/a', host: 'news.example.com' },
        { title: '  ', url: 'https://a.com' },
        { title: 'Google account', url: 'https://accounts.google.com', host: 'accounts.google.com' },
        { title: 'MoonStone2026 AI黑客松', url: 'https://news.example.com/a', host: 'news.example.com' },
      ]),
    ).toEqual([{ title: 'MoonStone2026 AI黑客松', url: 'https://news.example.com/a', host: 'news.example.com' }]);
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
    expect(searchQueryFromResultsUrl('https://www.google.com.hk/search?q=%E5%85%A8%E9%83%A8')).toBe('全部');
    expect(searchQueryFromResultsUrl('https://www.google.com.hk/search')).toBeUndefined();
    expect(searchQueryFromResultsUrl('https://example.com/')).toBeUndefined();
  });
});

describe('searchQueryFromPageTitle', () => {
  it('reads the query from a Google results document title', () => {
    expect(searchQueryFromPageTitle('全部 - Google 搜索')).toBe('全部');
    expect(searchQueryFromPageTitle('全部 - Google Search')).toBe('全部');
    expect(searchQueryFromPageTitle('google.com.hk')).toBeUndefined();
  });
});

describe('searchObserveLoopPhase', () => {
  it('writes 搜索：全部 from the live Google URL even before titles land', () => {
    expect(
      searchObserveLoopPhase({
        url: 'https://www.google.com.hk/search?q=%E5%85%A8%E9%83%A8',
        step: 0,
      }),
    ).toEqual({
      phase: 'observe',
      step: 0,
      detail: '搜索：全部',
      targetUrl: 'https://www.google.com.hk/search?q=%E5%85%A8%E9%83%A8',
    });
  });

  it('uses the document title when q= was already stripped', () => {
    expect(
      searchObserveLoopPhase({
        url: 'https://www.google.com.hk/search',
        step: 0,
        title: '全部 - Google 搜索',
        findings: [{ title: '某某教程', host: 'd.example', url: 'https://d.example/4' }],
      }),
    ).toEqual({
      phase: 'observe',
      step: 0,
      detail: '搜索：全部',
      targetUrl: 'https://www.google.com.hk/search',
      findings: [{ title: '某某教程', host: 'd.example', url: 'https://d.example/4' }],
    });
  });
});

describe('readSearchResultsInPage', () => {
  it('reads a title from h3>a as well as a>h3, including the fourth hit', () => {
    const heading = (title: string, href: string, kind: 'wrap' | 'child') => ({
      textContent: title,
      closest: (sel: string) => (sel === 'a' && kind === 'wrap' ? { href } : null),
      querySelector: (sel: string) => (sel === 'a' && kind === 'child' ? { href } : null),
      parentElement: { closest: () => null },
    });
    const rows = readSearchResultsInPage({
      querySelectorAll: () => [
        heading('第一条视频', 'https://a.example/1', 'wrap'),
        heading('第二条官网', 'https://b.example/2', 'wrap'),
        heading('第三条百科', 'https://c.example/3', 'child'),
        heading('某某教程', 'https://d.example/4', 'child'),
      ],
    });
    expect(rows.map(row => row.title)).toEqual(['第一条视频', '第二条官网', '第三条百科', '某某教程']);
    expect(rows[3]).toMatchObject({ title: '某某教程', url: 'https://d.example/4', host: 'd.example' });
  });
});
