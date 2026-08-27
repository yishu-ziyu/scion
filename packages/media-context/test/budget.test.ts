import { describe, expect, it } from 'vitest';
import { contextBlockText } from '@extension/context-engine';
import { fitBundleToBudget, trimBundleToBudget } from '../src/budget';
import { parsePdfText, parseYouTubeTranscript } from '../index';

const pageBundle = () =>
  parsePdfText([{ text: 'One' }, { text: 'Two' }, { text: 'Three' }, { text: 'Four' }], { title: 'Doc' });

describe('fitBundleToBudget', () => {
  it('returns the bundle unchanged when it fits', () => {
    const fitted = fitBundleToBudget(pageBundle(), 400);
    expect(fitted.blocks.length).toBe(8);
    expect(fitted.anchors.length).toBe(4);
    expect(fitted.title).toBe('Doc');
  });

  it('keeps anchors of surviving blocks and re-indexes them', () => {
    const input = pageBundle();
    const fitted = fitBundleToBudget(input, 30);
    expect(fitted.anchors.length).toBe(4);
    for (const anchor of fitted.anchors) {
      const block = fitted.blocks[anchor.blockIndex];
      expect(block).toBeDefined();
      expect(contextBlockText(block).length).toBeGreaterThan(0);
    }
  });

  it('drops anchors whose blocks were omitted, keeps surviving page hints', () => {
    const fitted = fitBundleToBudget(pageBundle(), 11);
    expect(fitted.anchors.length).toBeLessThan(4);
    expect(fitted.anchors.every(a => a.text.startsWith('第'))).toBe(true);
    expect(fitted.blocks.some(b => b.type === 'paragraph' && b.omitted === true)).toBe(true);
  });

  it('handles a zero budget and keeps shape', () => {
    const fitted = fitBundleToBudget(pageBundle(), 0);
    expect(fitted.blocks).toEqual([]);
    expect(fitted.anchors).toEqual([]);
    expect(fitted.sourceType).toBe('document');
  });

  it('keeps the first-page anchor when the first block is truncated', () => {
    // No headings at all: fitToContext falls back to truncating a single paragraph.
    const input = parseYouTubeTranscript([{ start: 0, end: 1, text: 'A'.repeat(50) }]);
    const fitted = fitBundleToBudget(input, 10);
    expect(fitted.blocks).toHaveLength(1);
    expect(fitted.anchors).toHaveLength(1);
    expect(fitted.anchors[0].blockIndex).toBe(0);
    expect(contextBlockText(fitted.blocks[0])).toEqual('A'.repeat(10));
  });

  it('maps the surviving page heading anchor in small budgets', () => {
    const input = parsePdfText([{ text: 'A'.repeat(50) }]);
    const fitted = fitBundleToBudget(input, 10);
    expect(fitted.anchors).toHaveLength(1);
    expect(fitted.anchors[0].blockIndex).toBe(0);
  });

  it('works for YouTube bundles too', () => {
    const input = parseYouTubeTranscript([
      { start: 0, end: 1, text: 'First paragraph' },
      { start: 60, end: 61, text: 'Second paragraph second' },
    ]);
    const fitted = fitBundleToBudget(input, 20);
    expect(fitted.anchors.length).toBe(1);
    expect(fitted.anchors[0].href).toContain('#t=');
  });

  it('exposes the same function as trimBundleToBudget', () => {
    expect(trimBundleToBudget).toBe(fitBundleToBudget);
  });
});
