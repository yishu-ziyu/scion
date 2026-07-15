import { describe, expect, it, vi } from 'vitest';
import {
  isForbiddenTaskContentUrl,
  runObserveActLoop,
  type LoopDecision,
  type LoopPhaseEvent,
} from '../observe-act-loop';

describe('observe → act → re-observe loop (ticket 02, S3)', () => {
  it('runs navigate-first: observe → decide go_to_url → act → reobserve → decide done', async () => {
    const phases: LoopPhaseEvent[] = [];
    let observeCount = 0;
    let decideCount = 0;

    const outcome = await runObserveActLoop({
      maxSteps: 5,
      maxFailures: 3,
      isStopped: () => false,
      waitIfPaused: async () => undefined,
      observe: async () => {
        observeCount += 1;
        return observeCount === 1 ? 'url=about:blank' : 'url=https://www.youtube.com/';
      },
      decide: async (state, step): Promise<LoopDecision> => {
        decideCount += 1;
        if (step === 0) {
          expect(state).toContain('about:blank');
          return { kind: 'action', name: 'go_to_url', args: { url: 'https://www.youtube.com/' } };
        }
        expect(state).toContain('youtube.com');
        return { kind: 'done', summary: 'YouTube opened' };
      },
      act: async action => {
        expect(action.name).toBe('go_to_url');
        return { error: null };
      },
      reobserve: async () => 'url=https://www.youtube.com/',
      onPhase: e => phases.push(e),
    });

    expect(outcome).toEqual({ kind: 'candidate_complete', summary: 'YouTube opened' });
    expect(phases.map(p => p.phase)).toEqual([
      'observe',
      'decide',
      'act',
      'reobserve',
      'observe',
      'decide',
    ]);
    expect(decideCount).toBe(2);
  });

  it('retries recoverable parse failures then succeeds without killing the task', async () => {
    let decides = 0;
    const outcome = await runObserveActLoop({
      maxSteps: 5,
      maxFailures: 3,
      isStopped: () => false,
      waitIfPaused: async () => undefined,
      observe: async () => 'ok',
      decide: async (): Promise<LoopDecision> => {
        decides += 1;
        if (decides === 1) return { kind: 'recoverable', category: 'json_parse_failed' };
        return { kind: 'done', summary: 'recovered' };
      },
      act: async () => ({ error: null }),
    });

    expect(outcome).toEqual({ kind: 'candidate_complete', summary: 'recovered' });
    expect(decides).toBe(2);
  });

  it('fails after maxFailures recoverable errors', async () => {
    const outcome = await runObserveActLoop({
      maxSteps: 10,
      maxFailures: 2,
      isStopped: () => false,
      waitIfPaused: async () => undefined,
      observe: async () => 'ok',
      decide: async () => ({ kind: 'recoverable', category: 'no_action' }),
      act: async () => ({ error: null }),
    });
    expect(outcome).toEqual({ kind: 'failed', category: 'no_action' });
  });

  it('resets failure budget after a successful act', async () => {
    let decideN = 0;
    let actN = 0;
    const outcome = await runObserveActLoop({
      maxSteps: 6,
      maxFailures: 2,
      isStopped: () => false,
      waitIfPaused: async () => undefined,
      observe: async () => 's',
      decide: async (): Promise<LoopDecision> => {
        decideN += 1;
        // fail once, succeed act, fail once more, then done — budget must reset after act
        if (decideN === 1) return { kind: 'recoverable', category: 'json_parse_failed' };
        if (decideN === 2) return { kind: 'action', name: 'wait', args: { seconds: 0 } };
        if (decideN === 3) return { kind: 'recoverable', category: 'json_parse_failed' };
        return { kind: 'done', summary: 'ok' };
      },
      act: async () => {
        actN += 1;
        return { error: null };
      },
    });
    expect(outcome.kind).toBe('candidate_complete');
    expect(actN).toBe(1);
  });

  it('marks chrome-extension URLs as forbidden task content targets', () => {
    expect(isForbiddenTaskContentUrl('chrome-extension://abc/side-panel/index.html')).toBe(true);
    expect(isForbiddenTaskContentUrl('https://www.youtube.com/')).toBe(false);
    expect(isForbiddenTaskContentUrl('chrome://extensions')).toBe(true);
  });

  it('supports wait and done path without act when done on first decide', async () => {
    const act = vi.fn();
    const outcome = await runObserveActLoop({
      maxSteps: 3,
      maxFailures: 2,
      isStopped: () => false,
      waitIfPaused: async () => undefined,
      observe: async () => 'already there',
      decide: async () => ({ kind: 'done', summary: 'noop' }),
      act,
    });
    expect(outcome).toEqual({ kind: 'candidate_complete', summary: 'noop' });
    expect(act).not.toHaveBeenCalled();
  });
});
