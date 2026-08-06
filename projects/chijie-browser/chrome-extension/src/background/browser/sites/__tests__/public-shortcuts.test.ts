import { describe, expect, it } from 'vitest';
import {
  isExampleDomainLinkInstruction,
  isScrollBottomInstruction,
  isWikipediaSearchInstruction,
} from '../public-shortcuts';

describe('public-site shortcut detection', () => {
  it('detects scroll-to-bottom instructions', () => {
    expect(isScrollBottomInstruction('滚到页面底部')).toBe(true);
    expect(isScrollBottomInstruction('scroll to the page bottom')).toBe(true);
  });

  it('detects wikipedia search instructions', () => {
    expect(isWikipediaSearchInstruction('在页内搜索框输入 Agent 并提交搜索')).toBe(true);
  });

  it('detects example.com link-click instructions', () => {
    expect(isExampleDomainLinkInstruction('点击页面上的 More information... 链接')).toBe(true);
  });
});
