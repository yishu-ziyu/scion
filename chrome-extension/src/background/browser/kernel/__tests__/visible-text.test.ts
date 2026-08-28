import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VISIBLE_TEXT_CHARS,
  hasUsablePageBody,
  mergeVisibleTextWithLinkTitles,
  normalizeVisiblePageText,
} from '../visible-text';

describe('normalizeVisiblePageText', () => {
  it('collapses blank lines and bounds length', () => {
    const raw = `Theme sentence.\n\n\n  Quote from the body.\n`;
    expect(normalizeVisiblePageText(raw)).toBe('Theme sentence.\n\nQuote from the body.');
    expect(normalizeVisiblePageText('x'.repeat(20_000)).length).toBe(DEFAULT_VISIBLE_TEXT_CHARS);
  });

  it('treats non-strings as empty', () => {
    expect(normalizeVisiblePageText(undefined)).toBe('');
    expect(normalizeVisiblePageText(12)).toBe('');
  });
});

describe('mergeVisibleTextWithLinkTitles', () => {
  it('appends truncated-card titles that innerText dropped', () => {
    const body = 'A Light in the ...\n£51.77\nTipping the Velvet\n£53.74';
    expect(mergeVisibleTextWithLinkTitles(body, ['A Light in the Attic', 'Tipping the Velvet'])).toContain(
      'A Light in the Attic',
    );
    expect(mergeVisibleTextWithLinkTitles(body, ['A Light in the Attic'])).toContain('A Light in the ...');
    expect(mergeVisibleTextWithLinkTitles(body, 'not-an-array')).toBe(normalizeVisiblePageText(body));
    expect(mergeVisibleTextWithLinkTitles(12, ['A Light in the Attic'])).toContain('A Light in the Attic');
  });
});

describe('hasUsablePageBody', () => {
  it('rejects indexes-only or empty wording', () => {
    expect(hasUsablePageBody('')).toBe(false);
    expect(hasUsablePageBody('  \n  ')).toBe(false);
    expect(hasUsablePageBody('ok')).toBe(false);
  });

  it('accepts a real article body', () => {
    expect(hasUsablePageBody('自组织记忆用于结构化长程推理，而不是聊天记录。')).toBe(true);
  });
});
