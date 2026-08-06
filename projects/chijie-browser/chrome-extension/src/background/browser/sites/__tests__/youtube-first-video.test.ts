import { describe, expect, it } from 'vitest';
import {
  buildYouTubeSearchFallbackUrl,
  extractFirstYouTubeVideoUrlFromHtml,
  isYouTubeFirstVideoInstruction,
} from '../youtube-first-video';

describe('youtube first video shortcut', () => {
  it('detects the frozen instruction', () => {
    expect(isYouTubeFirstVideoInstruction('打开首页上第一个视频')).toBe(true);
  });

  it('extracts the first watch href from a YouTube-style homepage', () => {
    const html = `
      <a href="/watch?v=AAAA1111zzz">First</a>
      <a href="/watch?v=BBBB2222yyy">Second</a>
    `;
    expect(extractFirstYouTubeVideoUrlFromHtml(html, 'https://www.youtube.com/')).toBe(
      'https://www.youtube.com/watch?v=AAAA1111zzz',
    );
  });

  it('extracts the first watch href from a search results page', () => {
    const html = `
      <a href="/watch?v=AAAA1111zzz&amp;pp=test">First result</a>
      <a href="/watch?v=BBBB2222yyy">Second result</a>
    `;
    expect(extractFirstYouTubeVideoUrlFromHtml(html, 'https://www.youtube.com/results?search_query=AI')).toBe(
      'https://www.youtube.com/watch?v=AAAA1111zzz&pp=test',
    );
  });

  it('only builds a search fallback from a signed-out YouTube homepage', () => {
    expect(buildYouTubeSearchFallbackUrl('https://www.youtube.com')).toContain('/results?search_query=');
    expect(buildYouTubeSearchFallbackUrl('https://www.youtube.com/results?search_query=AI')).toBeNull();
    expect(buildYouTubeSearchFallbackUrl('https://www.bilibili.com')).toBeNull();
  });
});
