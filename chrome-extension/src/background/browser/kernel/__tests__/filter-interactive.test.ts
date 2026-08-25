import { describe, expect, it } from 'vitest';
import type { InteractiveElementDigest } from '../types';
import { filterInteractiveElements, matchesSubmitKeepRule } from '../filter-interactive';

function el(partial: Partial<InteractiveElementDigest> & { index: number }): InteractiveElementDigest {
  return partial;
}

/** Representative form/nav page used to count unrelated nodes for query 提交. */
const SUBMIT_PAGE: InteractiveElementDigest[] = [
  el({ index: 1, tagName: 'a', text: 'Home' }),
  el({ index: 2, tagName: 'input', type: 'text', label: 'Name' }),
  el({ index: 3, tagName: 'a', text: '提交说明' }),
  el({ index: 4, tagName: 'button', text: 'Cancel' }),
  el({ index: 5, tagName: 'button', text: 'subscription' }),
  el({ index: 6, tagName: 'div', role: 'link', text: '提交' }),
  el({ index: 7, tagName: 'button', type: 'submit', text: '保存' }),
  el({ index: 8, tagName: 'input', type: 'submit', value: 'Save' }),
  el({ index: 9, tagName: 'button', text: '提交' }),
  el({ index: 10, tagName: 'button', text: 'Submit' }),
  el({ index: 11, tagName: 'div', role: 'button', text: '提交申请' }),
  el({ index: 12, tagName: 'button', text: '搜索' }),
];

function unrelatedForSubmit(elements: InteractiveElementDigest[]): InteractiveElementDigest[] {
  return elements.filter(element => !matchesSubmitKeepRule(element));
}

describe('filterInteractiveElements', () => {
  it('keeps the full list and order when the query is empty', () => {
    expect(filterInteractiveElements(SUBMIT_PAGE)).toBe(SUBMIT_PAGE);
    expect(filterInteractiveElements(SUBMIT_PAGE, '')).toBe(SUBMIT_PAGE);
    expect(filterInteractiveElements(SUBMIT_PAGE, '   ')).toBe(SUBMIT_PAGE);
  });

  it('query 提交 keeps only type=submit or button-like submit copy', () => {
    const kept = filterInteractiveElements(SUBMIT_PAGE, '提交');
    expect(kept.map(item => item.index).sort((a, b) => a - b)).toEqual([7, 8, 9, 10, 11]);
    expect(kept.every(matchesSubmitKeepRule)).toBe(true);
    expect(unrelatedForSubmit(kept)).toEqual([]);
  });

  it('general queries match visible copy without using the submit keep rule', () => {
    const kept = filterInteractiveElements(SUBMIT_PAGE, '搜索');
    expect(kept.map(item => item.index)).toEqual([12]);
    expect(kept[0]?.text).toBe('搜索');
  });

  it('does not keep subscription, plain links, or non-submit buttons for 提交', () => {
    const kept = filterInteractiveElements(SUBMIT_PAGE, '提交');
    const texts = kept.map(item => item.text || item.value);
    expect(texts).not.toContain('subscription');
    expect(texts).not.toContain('Home');
    expect(texts).not.toContain('Cancel');
    expect(texts).not.toContain('搜索');
    expect(kept.some(item => item.tagName === 'a')).toBe(false);
  });
});

describe('query 提交 unrelated-node metric', () => {
  it('drops every unrelated node (before = all non-submit controls)', () => {
    const before = unrelatedForSubmit(SUBMIT_PAGE).length;
    const after = unrelatedForSubmit(filterInteractiveElements(SUBMIT_PAGE, '提交')).length;
    expect(before).toBeGreaterThan(0);
    expect(after).toBe(0);
  });
});
