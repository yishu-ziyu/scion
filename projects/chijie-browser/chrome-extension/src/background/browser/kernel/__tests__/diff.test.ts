import { describe, expect, it } from 'vitest';
import { computeObservationDiff, diffMetrics } from '../diff';
import type { ObservationFrame } from '../types';

function frame(partial: Partial<ObservationFrame> & Pick<ObservationFrame, 'pageRevision' | 'tab'>): ObservationFrame {
  return {
    frameId: partial.frameId ?? 'f1',
    observedAt: partial.observedAt ?? 1,
    tab: partial.tab,
    pageRevision: partial.pageRevision,
    targetCount: partial.targetCount ?? partial.interactiveElements?.length ?? 0,
    interactiveElements: partial.interactiveElements ?? [],
    text: partial.text ?? 'full',
    viewport: partial.viewport,
    media: partial.media,
    signals: partial.signals ?? [],
  };
}

describe('computeObservationDiff', () => {
  it('flags url and element changes as material', () => {
    const from = frame({
      pageRevision: 'rev-a',
      tab: { id: 1, url: 'https://a.test/', title: 'A' },
      interactiveElements: [{ index: 1, tagName: 'a', text: 'one' }],
    });
    const to = frame({
      pageRevision: 'rev-b',
      tab: { id: 1, url: 'https://b.test/', title: 'B' },
      interactiveElements: [
        { index: 1, tagName: 'a', text: 'one' },
        { index: 2, tagName: 'button', text: 'two' },
      ],
      viewport: { scrollY: 100, viewportHeight: 800, documentHeight: 2000 },
    });
    from.viewport = { scrollY: 0, viewportHeight: 800, documentHeight: 2000 };

    const diff = computeObservationDiff(from, to);
    expect(diff.urlChanged).toBe(true);
    expect(diff.titleChanged).toBe(true);
    expect(diff.addedElements).toEqual([{ index: 2, tagName: 'button', text: 'two' }]);
    expect(diff.scrollDelta).toBe(100);
    expect(diff.materialChange).toBe(true);
    expect(diff.text).toContain('ObservationDiff');
    expect(diff.text).toContain('https://b.test/');
  });

  it('reports no material change for identical frames', () => {
    const base = frame({
      pageRevision: 'rev-same',
      tab: { id: 1, url: 'https://x.test/', title: 'X' },
      interactiveElements: [{ index: 1, tagName: 'div', text: 'ok' }],
      viewport: { scrollY: 10, viewportHeight: 700, documentHeight: 1000 },
      media: { kind: 'none' },
    });
    const diff = computeObservationDiff(base, { ...base, frameId: 'f2', observedAt: 2 });
    expect(diff.materialChange).toBe(false);
    expect(diff.addedElements).toHaveLength(0);
    expect(diff.removedElements).toHaveLength(0);
  });

  it('exposes privacy-safe metrics', () => {
    const from = frame({
      pageRevision: 'a',
      tab: { id: 1, url: 'https://x.test/', title: 'X' },
      text: 'aaaa',
    });
    const to = frame({
      pageRevision: 'b',
      tab: { id: 1, url: 'https://x.test/y', title: 'X' },
      text: 'bbbbbb',
      interactiveElements: [{ index: 1, text: 'n' }],
    });
    const diff = computeObservationDiff(from, to);
    const metrics = diffMetrics(to.text, diff.text, diff);
    expect(metrics.observation_full_chars).toBe(6);
    expect(metrics.diff_chars).toBeGreaterThan(0);
    expect(metrics.material_change).toBe(true);
  });
});
