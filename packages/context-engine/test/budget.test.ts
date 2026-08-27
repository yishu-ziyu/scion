import { describe, expect, it } from 'vitest';
import { contextBlockCharacters, type ContextBlock } from '../src/blocks';
import { fitToContext } from '../src/budget';

const blocks: ContextBlock[] = [
  { type: 'heading', level: 1, text: 'Overview' },
  { type: 'paragraph', text: 'A'.repeat(30) },
  { type: 'heading', level: 2, text: 'Details' },
  { type: 'paragraph', text: 'B'.repeat(50) },
  { type: 'heading', level: 2, text: 'Conclusion' },
  { type: 'paragraph', text: 'C'.repeat(30) },
];

const length = (items: ContextBlock[]) => items.reduce((sum, block) => sum + contextBlockCharacters(block), 0);

describe('fitToContext', () => {
  it('returns the original blocks when they fit', () => {
    expect(fitToContext(blocks, 200)).toEqual(blocks);
  });

  it('keeps both ends, heading levels, and marks the omitted middle', () => {
    const fitted = fitToContext(blocks, 90);
    expect(length(fitted)).toBeLessThanOrEqual(90);
    expect(fitted[0]).toEqual(blocks[0]);
    expect(fitted.at(-1)).toEqual(blocks.at(-1));
    expect(fitted).toContainEqual({ type: 'heading', level: 2, text: 'Details' });
    expect(fitted).toContainEqual({ type: 'heading', level: 2, text: 'Conclusion' });
    expect(fitted).toContainEqual({ type: 'paragraph', text: '[…]', omitted: true });
  });

  it('uses the remaining budget for part of an oversized body block', () => {
    const oversized: ContextBlock[] = [
      { type: 'heading', level: 1, text: 'Title' },
      { type: 'paragraph', text: `BODY-${'x'.repeat(200)}` },
    ];
    const fitted = fitToContext(oversized, 40);
    expect(length(fitted)).toBeLessThanOrEqual(40);
    expect(fitted.some(block => block.type === 'paragraph' && block.text.startsWith('BODY-'))).toBe(true);
  });

  it('obeys zero and very small budgets', () => {
    expect(fitToContext(blocks, 0)).toEqual([]);
    expect(length(fitToContext(blocks, 5))).toBeLessThanOrEqual(5);
  });
});
