import { describe, expect, it } from 'vitest';
import type { InteractiveElementDigest } from '../types';
import { formatResolveIntentError, resolveIntent } from '../resolve-intent';

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
      expect(formatResolveIntentError(result, '结账')).toMatch(/Did not click/);
      expect(formatResolveIntentError(result, '结账')).toMatch(/Candidates: \(none\)/);
    }
  });

  it('does not pick a control when several buttons match', () => {
    const page = [
      ...FORM,
      el({ index: 5, tagName: 'button', text: 'Submit' }),
    ];
    const result = resolveIntent(page, 'Submit');
    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') {
      expect(result.candidates.map(item => item.index)).toEqual([3, 5]);
      expect(formatResolveIntentError(result, 'Submit')).toMatch(/Did not click/);
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
