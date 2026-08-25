import { describe, expect, it } from 'vitest';
import type { InteractiveElementDigest } from '../types';
import { formatResolveIntentError, resolveIntent, waitAskFromAmbiguousBind } from '../resolve-intent';

function el(partial: Partial<InteractiveElementDigest> & { index: number }): InteractiveElementDigest {
  return partial;
}

const FORM: InteractiveElementDigest[] = [
  el({ index: 1, tagName: 'input', type: 'text', label: 'Name' }),
  el({ index: 2, tagName: 'a', text: 'Home' }),
  el({ index: 3, tagName: 'button', type: 'submit', text: 'Submit' }),
  el({ index: 4, tagName: 'button', text: 'Cancel' }),
];

describe('resolveIntent', () => {
  it('resolves query 提交 to the submit button on a form fixture', () => {
    const result = resolveIntent(FORM, '提交');
    expect(result).toMatchObject({ kind: 'match', index: 3 });
    if (result.kind === 'match') {
      expect(result.element.type).toBe('submit');
    }
  });

  it('does not pick a control when the query matches nothing', () => {
    const result = resolveIntent(FORM, '结账');
    expect(result.kind).toBe('none');
    if (result.kind === 'none') {
      expect(result.candidates).toEqual([]);
      expect(formatResolveIntentError(result, '结账')).toMatch(/Did not act/);
      expect(formatResolveIntentError(result, '结账')).toMatch(/Candidates: \(none\)/);
    }
  });

  it('does not pick a control when several buttons match', () => {
    const page = [...FORM, el({ index: 5, tagName: 'button', text: 'Submit' })];
    const result = resolveIntent(page, 'Submit');
    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') {
      expect(result.candidates.map(item => item.index)).toEqual([3, 5]);
      expect(formatResolveIntentError(result, 'Submit')).toMatch(/Did not act/);
      expect(formatResolveIntentError(result, 'Submit')).toContain('[3]');
      expect(formatResolveIntentError(result, 'Submit')).toContain('[5]');
    }
  });

  it('picks the 提交 label when another type=submit button says 保存', () => {
    const page = [
      el({ index: 1, tagName: 'button', type: 'submit', text: '保存' }),
      el({ index: 2, tagName: 'button', text: '提交' }),
    ];
    const result = resolveIntent(page, '提交');
    expect(result).toMatchObject({ kind: 'match', index: 2 });
  });

  it('lists observed visible names when several controls match the same query', () => {
    const page = [...FORM, el({ index: 5, tagName: 'button', text: 'Submit' })];
    const result = resolveIntent(page, 'Submit');
    expect(result.kind).toBe('ambiguous');
    if (result.kind !== 'ambiguous') return;
    const ask = waitAskFromAmbiguousBind('Submit', result.candidates);
    expect(ask?.prompt).toContain('Submit');
    expect(ask?.prompt).not.toMatch(/点哪里|点击位置/);
    expect(ask?.options.map(option => option.sendText)).toEqual(['第1个Submit', '第2个Submit']);
  });

  it('does not invent a wait-ask when the query uniquely matches or matches nothing', () => {
    expect(waitAskFromAmbiguousBind('提交', [FORM[2]!])).toBeNull();
    expect(waitAskFromAmbiguousBind('结账', [])).toBeNull();
    expect(
      waitAskFromAmbiguousBind('go', [el({ index: 1, tagName: 'button' }), el({ index: 2, tagName: 'a' })]),
    ).toBeNull();
  });

  it('uses distinct observed labels as sendText without a click-only prompt', () => {
    const ask = waitAskFromAmbiguousBind('教程', [
      el({ index: 2, tagName: 'a', text: '入门教程' }),
      el({ index: 6, tagName: 'a', text: '进阶教程' }),
    ]);
    expect(ask?.prompt).toBe('这几个都对得上「教程」，要哪一个？');
    expect(ask?.options.map(option => option.sendText)).toEqual(['入门教程', '进阶教程']);
  });

  it('does not list weaker matches when two equal-best named controls already tie', () => {
    const page = [
      el({ index: 3, tagName: 'button', type: 'submit', text: 'Submit' }),
      el({ index: 5, tagName: 'button', type: 'submit', text: 'Submit' }),
      el({ index: 7, tagName: 'button', text: 'Submit order' }),
    ];
    const result = resolveIntent(page, 'Submit');
    expect(result.kind).toBe('ambiguous');
    if (result.kind !== 'ambiguous') return;
    expect(result.candidates.map(item => item.index)).toEqual([3, 5]);
    const ask = waitAskFromAmbiguousBind('Submit', result.candidates);
    expect(ask?.options.map(option => option.sendText)).toEqual(['第1个Submit', '第2个Submit']);
    expect(ask?.options.map(option => option.sendText).join(' ')).not.toContain('order');
  });

  it('keeps at most seven named options', () => {
    const candidates = Array.from({ length: 8 }, (_, index) =>
      el({ index: index + 1, tagName: 'a', text: `教程${index + 1}` }),
    );
    const ask = waitAskFromAmbiguousBind('教程', candidates);
    expect(ask?.options).toHaveLength(7);
    expect(ask?.options[0]?.sendText).toBe('教程1');
    expect(ask?.options.at(-1)?.sendText).toBe('教程7');
  });

  it('uses placeholder copy when that is the observed name', () => {
    const ask = waitAskFromAmbiguousBind('搜索', [
      el({ index: 1, tagName: 'input', placeholder: '搜索商品' }),
      el({ index: 4, tagName: 'input', placeholder: '搜索店铺' }),
    ]);
    expect(ask?.prompt).toBe('这几个都对得上「搜索」，要哪一个？');
    expect(ask?.options.map(option => option.sendText)).toEqual(['搜索商品', '搜索店铺']);
  });

  it('resolves 第N个 + observed name among equal-best same-name controls', () => {
    const page = [
      el({ index: 1, tagName: 'a', text: '入门教程' }),
      el({ index: 2, tagName: 'a', text: '教程' }),
      el({ index: 6, tagName: 'a', text: '教程' }),
    ];
    expect(resolveIntent(page, '第1个教程')).toMatchObject({ kind: 'match', index: 2 });
    expect(resolveIntent(page, '第2个教程')).toMatchObject({ kind: 'match', index: 6 });
  });

  it('resolves 第1个Submit to the first equal-best Submit, not a weaker earlier match', () => {
    const page = [
      el({ index: 1, tagName: 'button', text: 'Submit order' }),
      el({ index: 3, tagName: 'button', type: 'submit', text: 'Submit' }),
      el({ index: 5, tagName: 'button', type: 'submit', text: 'Submit' }),
    ];
    expect(resolveIntent(page, '第1个Submit')).toMatchObject({ kind: 'match', index: 3 });
    expect(resolveIntent(page, '第2个Submit')).toMatchObject({ kind: 'match', index: 5 });
  });

  it('resolves 第一个视频 to the first video-like link', () => {
    const page = [
      el({ index: 1, tagName: 'a', text: 'Home' }),
      el({ index: 2, tagName: 'a', text: 'Alpha plays tonight' }),
      el({ index: 3, tagName: 'a', text: 'Beta concert replay' }),
    ];
    const result = resolveIntent(page, '第一个视频');
    expect(result).toMatchObject({ kind: 'match', index: 2 });
  });
});
