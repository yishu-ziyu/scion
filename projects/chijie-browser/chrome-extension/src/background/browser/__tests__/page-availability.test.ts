import { describe, expect, it } from 'vitest';
import { pageLooksUnavailable } from '../page-availability';

describe('pageLooksUnavailable', () => {
  it('flags YouTube soft-404 shell from user screenshot', () => {
    expect(
      pageLooksUnavailable({
        url: 'https://www.youtube.com/playlist?list=FL',
        title: '404 Not Found',
        bodyText:
          "This page isn't available. Sorry about that. Try searching for something else.",
      }),
    ).toBe(true);
  });

  it('flags classic 404 title', () => {
    expect(pageLooksUnavailable({ title: '404 Not Found', bodyText: 'Not Found' })).toBe(true);
  });

  it('does not flag a normal YouTube playlist or home', () => {
    expect(
      pageLooksUnavailable({
        url: 'https://www.youtube.com/playlist?list=PLxxxxxxxx',
        title: 'My Favorites - YouTube',
        bodyText: 'Mix · 12 videos · Playlist',
      }),
    ).toBe(false);
    expect(
      pageLooksUnavailable({
        url: 'https://www.youtube.com/',
        title: 'YouTube',
        bodyText: 'Home Shorts Subscriptions',
      }),
    ).toBe(false);
  });

  it('flags Chinese unavailable copy', () => {
    expect(
      pageLooksUnavailable({
        title: '页面不存在',
        bodyText: '此页面不可用，请尝试其他内容',
      }),
    ).toBe(true);
  });
});
