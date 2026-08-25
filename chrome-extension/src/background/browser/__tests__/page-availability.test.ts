import { describe, expect, it } from 'vitest';
import { pageLooksUnavailable } from '../page-availability';

describe('pageLooksUnavailable', () => {
  it('flags YouTube soft-404 shell from user screenshot', () => {
    expect(
      pageLooksUnavailable({
        url: 'https://www.youtube.com/playlist?list=FL',
        title: '404 Not Found',
        bodyText: "This page isn't available. Sorry about that. Try searching for something else.",
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

  it('flags GitHub missing-file pages', () => {
    expect(
      pageLooksUnavailable({
        url: 'https://github.com/yishu-ziyu/living-reader/blob/main/product-brief.md',
        title: 'File not found',
        bodyText: 'The main branch of living-reader does not contain the path product-brief.md.',
      }),
    ).toBe(true);
  });

  it('flags Cloudflare verification shells as unavailable content', () => {
    expect(
      pageLooksUnavailable({
        url: 'https://www.producthunt.com/products/chatpdf',
        title: '请稍候…',
        bodyText: '正在进行安全验证。本网站使用安全服务防护恶意自动程序。由 Cloudflare 提供服务。',
      }),
    ).toBe(true);
  });

  it('flags parked and for-sale domains as unavailable product sources', () => {
    expect(
      pageLooksUnavailable({
        url: 'https://forsale.godaddy.com/forsale/liquidtext.com',
        title: 'liquidtext.com',
        bodyText: 'This domain is for sale. Buy this domain.',
      }),
    ).toBe(true);
  });
});
