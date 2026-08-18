import { describe, expect, it } from 'vitest';
import {
  CURRENT_PAGE_TOKEN,
  expandCurrentPageMention,
  insertCurrentPageMention,
  mentionMatchesCurrentPage,
  mentionTriggerAt,
} from '../composer-mention';

describe('composer mention', () => {
  it('opens after a lone @ and stays closed inside emails', () => {
    expect(mentionTriggerAt('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionTriggerAt('看 @当', 4)).toEqual({ start: 2, query: '当' });
    expect(mentionTriggerAt('a@b.com', 7)).toBeNull();
    expect(mentionTriggerAt('@当前 页', 4)).toBeNull();
  });

  it('matches the current-page mention by prefix', () => {
    expect(mentionMatchesCurrentPage('')).toBe(true);
    expect(mentionMatchesCurrentPage('当')).toBe(true);
    expect(mentionMatchesCurrentPage('page')).toBe(true);
    expect(mentionMatchesCurrentPage('xyz')).toBe(false);
  });

  it('inserts and expands the current-page token', () => {
    expect(insertCurrentPageMention('@', 0, 1)).toBe(`${CURRENT_PAGE_TOKEN}`);
    expect(insertCurrentPageMention('看 @', 2, 3)).toBe(`看 ${CURRENT_PAGE_TOKEN}`);
    expect(
      expandCurrentPageMention(`${CURRENT_PAGE_TOKEN} 视频在讲什么`, {
        host: 'bilibili.com',
        title: '首页',
        url: 'https://www.bilibili.com/',
      }),
    ).toBe(`${CURRENT_PAGE_TOKEN}（bilibili.com · 首页 https://www.bilibili.com/） 视频在讲什么`);
    expect(expandCurrentPageMention('无提及', { host: 'x', title: 't', url: 'u' })).toBe('无提及');
  });
});
