import { describe, expect, it } from 'vitest';
import { preferBoundTabForActiveFind, tabCanReuseForOpen, tabUrlMatchesQuery } from '../find-tab';

describe('tabUrlMatchesQuery', () => {
  it('matches exact, prefix, and host+path', () => {
    expect(tabUrlMatchesQuery('https://www.bilibili.com/', 'https://www.bilibili.com')).toBe(true);
    expect(tabUrlMatchesQuery('https://www.bilibili.com/video/BV1', 'https://www.bilibili.com')).toBe(true);
    expect(tabUrlMatchesQuery('https://example.com/x', 'https://www.bilibili.com')).toBe(false);
  });
});

describe('tabCanReuseForOpen', () => {
  it('lets a homepage request reuse any path on the same host', () => {
    expect(tabCanReuseForOpen('https://www.youtube.com/', 'https://www.youtube.com/')).toBe(true);
    expect(tabCanReuseForOpen('https://youtube.com/', 'https://www.youtube.com/')).toBe(true);
    expect(tabCanReuseForOpen('https://www.youtube.com/watch?v=abc', 'https://www.youtube.com/')).toBe(true);
  });

  it('does not treat the site homepage as a deeper requested path', () => {
    expect(tabCanReuseForOpen('https://example.com/', 'https://example.com/next')).toBe(false);
    expect(tabCanReuseForOpen('https://example.com/other', 'https://example.com/next')).toBe(false);
    expect(tabCanReuseForOpen('https://example.com/next', 'https://example.com/next')).toBe(true);
    expect(tabCanReuseForOpen('https://example.com/next/item', 'https://example.com/next')).toBe(true);
  });

  it('does not reuse a different host', () => {
    expect(tabCanReuseForOpen('https://www.aicss.dev/components/approval-card', 'https://www.youtube.com/')).toBe(
      false,
    );
    expect(tabCanReuseForOpen('https://music.youtube.com/', 'https://www.youtube.com/')).toBe(false);
  });
});

describe('preferBoundTabForActiveFind', () => {
  it('keeps the task tab after bind even if the user is now on another page', () => {
    expect(preferBoundTabForActiveFind(7, 99)).toBe(7);
    expect(preferBoundTabForActiveFind(null, 99)).toBe(99);
    expect(preferBoundTabForActiveFind(undefined, undefined)).toBeUndefined();
  });
});
