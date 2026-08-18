import { describe, expect, it } from 'vitest';
import { isGroupableTabUrl, taskTabGroupTitle } from '../task-tab-group';

describe('task tab group title', () => {
  it('prefixes the short goal', () => {
    expect(taskTabGroupTitle('读标题')).toBe('任务 · 读标题');
    expect(taskTabGroupTitle('打开 https://example.com ，只告诉我页面标题是什么')).toMatch(/^任务 · /);
    expect(taskTabGroupTitle('')).toBe('任务');
    expect(taskTabGroupTitle('   ')).toBe('任务');
  });

  it('skips extension and chrome pages', () => {
    expect(isGroupableTabUrl('https://example.com/')).toBe(true);
    expect(isGroupableTabUrl('chrome-extension://abc/side-panel/index.html')).toBe(false);
    expect(isGroupableTabUrl('chrome://newtab')).toBe(false);
  });
});
