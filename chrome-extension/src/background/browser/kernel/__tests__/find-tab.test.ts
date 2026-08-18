import { describe, expect, it } from 'vitest';
import { preferBoundTabForActiveFind, tabUrlMatchesQuery } from '../find-tab';

describe('tabUrlMatchesQuery', () => {
  it('matches exact, prefix, and host+path', () => {
    expect(tabUrlMatchesQuery('https://www.bilibili.com/', 'https://www.bilibili.com')).toBe(true);
    expect(tabUrlMatchesQuery('https://www.bilibili.com/video/BV1', 'https://www.bilibili.com')).toBe(true);
    expect(tabUrlMatchesQuery('https://example.com/x', 'https://www.bilibili.com')).toBe(false);
  });
});

describe('preferBoundTabForActiveFind', () => {
  it('keeps the task tab after bind even if the user is now on another page', () => {
    expect(preferBoundTabForActiveFind(7, 99)).toBe(7);
    expect(preferBoundTabForActiveFind(null, 99)).toBe(99);
    expect(preferBoundTabForActiveFind(undefined, undefined)).toBeUndefined();
  });
});
