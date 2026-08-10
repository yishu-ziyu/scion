/**
 * 022-DIFF-01 unit support: multi-step synthetic pages must show median payload cut ≥30%
 * when rendered as diff vs full (statistical contract for Diff ON).
 */
import { describe, expect, it } from 'vitest';
import { computeObservationDiff, diffMetrics } from '../diff';
import { renderContextForModel } from '../observation';
import type { ObservationFrame } from '../types';

function frame(i: number, text: string, url: string): ObservationFrame {
  return {
    frameId: `f${i}`,
    observedAt: i,
    tab: { id: 1, url, title: `T${i}` },
    pageRevision: `rev-${i}`,
    targetCount: 2,
    interactiveElements: [
      { index: 1, tagName: 'a', text: `link-${i}` },
      { index: 2, tagName: 'button', text: `btn-${i}` },
    ],
    text,
    signals: [],
  };
}

describe('022-DIFF-01 payload reduction (synthetic multi-step)', () => {
  it('median observation payload reduction is >= 30% across multi-step sequence', () => {
    // Large repeated page body + small deltas (typical browser agent observation)
    const baseBody = 'X'.repeat(4000);
    const steps: ObservationFrame[] = [];
    for (let i = 0; i < 10; i += 1) {
      // keep same URL for steps 1..n so control-llm would not force full on nav
      steps.push(frame(i, `${baseBody}\nstep=${i}\nextra=${'y'.repeat(40 + i)}`, 'https://example.com/article'));
    }

    const reductions: number[] = [];
    for (let i = 1; i < steps.length; i += 1) {
      const from = steps[i - 1];
      const to = steps[i];
      const diff = computeObservationDiff(from, to);
      const rendered = renderContextForModel({
        frame: to,
        diffText: diff.text,
        useDiff: true,
        forceFull: false,
      });
      const m = diffMetrics(to.text, rendered.rendered, diff);
      const full = m.observation_full_chars;
      const renderedChars = m.observation_rendered_chars;
      if (full > 0) {
        reductions.push((full - renderedChars) / full);
      }
    }

    reductions.sort((a, b) => a - b);
    const mid = reductions[Math.floor(reductions.length / 2)] ?? 0;
    expect(reductions.length).toBeGreaterThanOrEqual(5);
    // Gate: median reduction >= 30%
    expect(mid).toBeGreaterThanOrEqual(0.3);
  });
});
