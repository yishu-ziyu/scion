import { describe, expect, it } from 'vitest';
import { parseControlPolicyDecision } from '../control-policy';
import {
  instructionNeedsWebSearch,
  lookupQueryFromInstruction,
  rewriteInventedLookupNavigation,
} from '../lookup-navigation';

describe('lookup navigation', () => {
  it('treats 搜一下 without a URL as a web search', () => {
    expect(instructionNeedsWebSearch('搜一下北京天气')).toBe(true);
    expect(instructionNeedsWebSearch('search for TypeScript handbook')).toBe(true);
    expect(lookupQueryFromInstruction('搜一下北京天气')).toBe('北京天气');
  });

  it('does not rewrite when the user already gave a URL or named the destination host', () => {
    expect(instructionNeedsWebSearch('打开 https://example.com 搜天气')).toBe(false);
    expect(
      rewriteInventedLookupNavigation('打开 YouTube 搜猫', {
        name: 'go_to_url',
        args: { url: 'https://www.youtube.com/' },
      }),
    ).toEqual({ name: 'go_to_url', args: { url: 'https://www.youtube.com/' } });
  });

  it('rewrites wikipedia.org/wiki/TypeScript when the user only said TypeScript', () => {
    expect(
      rewriteInventedLookupNavigation('搜一下 TypeScript 官方文档', {
        name: 'go_to_url',
        args: { url: 'https://en.wikipedia.org/wiki/TypeScript' },
      }),
    ).toEqual({
      name: 'search_google',
      args: { query: 'TypeScript 官方文档', intent: 'open-ended lookup' },
    });
  });

  it('rewrites an invented wikipedia URL into search_google', () => {
    expect(
      rewriteInventedLookupNavigation('搜一下北京天气', {
        name: 'go_to_url',
        args: { url: 'https://en.wikipedia.org/wiki/Beijing' },
      }),
    ).toEqual({
      name: 'search_google',
      args: { query: '北京天气', intent: 'open-ended lookup' },
    });
  });

  it('keeps a real Google results URL', () => {
    expect(
      rewriteInventedLookupNavigation('搜一下北京天气', {
        name: 'go_to_url',
        args: { url: 'https://www.google.com/search?q=%E5%8C%97%E4%BA%AC%E5%A4%A9%E6%B0%94' },
      })?.name,
    ).toBe('go_to_url');
  });

  it('rewrites a parsed go_to_url decision the same way control-llm does', () => {
    const decision = parseControlPolicyDecision({
      observation: 'searching',
      done: false,
      action_name: 'go_to_url',
      action_args: { url: 'https://en.wikipedia.org/wiki/TypeScript', intent: 'open docs' },
    });
    expect(rewriteInventedLookupNavigation('搜一下 TypeScript 官方文档', decision.action)).toEqual({
      name: 'search_google',
      args: { query: 'TypeScript 官方文档', intent: 'open-ended lookup' },
    });
  });

  it('leaves fill/open-without-search instructions alone', () => {
    expect(instructionNeedsWebSearch('打开 YouTube 并点击第一个视频')).toBe(false);
    expect(instructionNeedsWebSearch('把名字填成 Alex 并提交')).toBe(false);
    expect(
      rewriteInventedLookupNavigation('打开 YouTube 并点击第一个视频', {
        name: 'go_to_url',
        args: { url: 'https://www.youtube.com/' },
      }),
    ).toEqual({ name: 'go_to_url', args: { url: 'https://www.youtube.com/' } });
  });
});
