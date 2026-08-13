import { describe, expect, it } from 'vitest';
import {
  exampleDomainLinkIsTerminalGoal,
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

  it('keeps More information as a hop inside a two-source long-horizon goal', () => {
    const lh04 =
      '这是一个双来源交付任务，请在当前任务绑定标签页中依次完成：1) 点击 More information 访问 IANA Example Domains；2) 记录 IANA 页面标题和完整 URL；3) 再打开 https://en.wikipedia.org/wiki/Web_browser；4) 读取 Wikipedia 标题和首段定义的第一句。最终交付必须只在完成两站后输出，包含两个完整 URL、IANA 标题 Example Domains、Wikipedia 标题 Web browser、Wikipedia 首段第一句英文原文，以及“观察一：”和“观察二：”开头的两条中文观察。任一项缺失都不得完成。';
    expect(isExampleDomainLinkInstruction(lh04)).toBe(true);
    expect(exampleDomainLinkIsTerminalGoal(lh04)).toBe(false);
    expect(exampleDomainLinkIsTerminalGoal('点击页面上的 More information... 链接')).toBe(true);
  });
});
