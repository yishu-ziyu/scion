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
    let reobserveCount = 0;

    const outcome = await runObserveActLoop({
      maxSteps: 5,
      maxFailures: 3,
      isStopped: () => false,
      waitIfPaused: async () => undefined,
      observe: async () => {
        observeCount += 1;
        return 'url=about:blank';
      },
      decide: async (state, step): Promise<LoopDecision> => {
        decideCount += 1;
        if (step === 0) {
          expect(state).toContain('about:blank');
          return { kind: 'action', name: 'go_to_url', args: { url: 'https://www.youtube.com/' } };
        }
        // Second decide must consume reobserve output, not a fresh observe.
        expect(state).toContain('youtube.com');
        return { kind: 'done', summary: 'YouTube opened' };
      },
      act: async action => {
        expect(action.name).toBe('go_to_url');
        return { error: null };
      },
      reobserve: async () => {
        reobserveCount += 1;
        return 'url=https://www.youtube.com/';
      },
      onPhase: e => phases.push(e),
    });

    expect(outcome).toEqual({ kind: 'candidate_complete', summary: 'YouTube opened' });
    expect(phases.map(p => p.phase)).toEqual(['observe', 'decide', 'act', 'reobserve', 'decide']);
    expect(observeCount).toBe(1);
    expect(reobserveCount).toBe(1);
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

  it('returned act errors count as action_failed, not dispatch_failed', async () => {
    const outcome = await runObserveActLoop({
      maxSteps: 10,
      maxFailures: 2,
      isStopped: () => false,
      waitIfPaused: async () => undefined,
      observe: async () => 'ok',
      decide: async () => ({ kind: 'action', name: 'click_element', args: { index: 1 } }),
      act: async () => ({ error: 'stale_task_round' }),
    });
    expect(outcome).toEqual({ kind: 'failed', category: 'action_failed' });
  });

  it('thrown act errors still map to dispatch_failed (soft backends must return {error})', async () => {
    const outcome = await runObserveActLoop({
      maxSteps: 10,
      maxFailures: 2,
      isStopped: () => false,
      waitIfPaused: async () => undefined,
      observe: async () => 'ok',
      decide: async () => ({ kind: 'action', name: 'click_element', args: { index: 1 } }),
      act: async () => {
        throw new Error('hard throw');
      },
    });
    expect(outcome).toEqual({ kind: 'failed', category: 'dispatch_failed' });
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

  it('reobserves and replans a changed target within the existing failure budget', async () => {
    let observes = 0;
    let acts = 0;
    const outcome = await runObserveActLoop({
      maxSteps: 4,
      maxFailures: 2,
      isStopped: () => false,
      waitIfPaused: async () => undefined,
      observe: async () => `target=${++observes}`,
      decide: async (_state, step): Promise<LoopDecision> =>
        step < 2
          ? { kind: 'action', name: 'click_element', args: { index: step + 1 } }
          : { kind: 'done', summary: 'replanned target completed' },
      act: async () => {
        acts += 1;
        return acts === 1 ? { error: 'Action target changed; replan required' } : { error: null };
      },
      reobserve: async () => 'target=stable-after-act',
    });

    expect(outcome).toEqual({ kind: 'candidate_complete', summary: 'replanned target completed' });
    expect(observes).toBe(2);
    expect(acts).toBe(2);
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

  it('E1: fails with no_progress after maxNoProgress identical successful acts', async () => {
    let acts = 0;
    const outcome = await runObserveActLoop({
      maxSteps: 20,
      maxFailures: 5,
      maxNoProgress: 3,
      isStopped: () => false,
      waitIfPaused: async () => undefined,
      observe: async () => 'url=stuck-page title=same',
      decide: async () => ({ kind: 'action', name: 'click_element', args: { index: 1 } }),
      act: async () => {
        acts += 1;
        return { error: null };
      },
      reobserve: async () => 'url=stuck-page title=same',
    });
    expect(outcome).toEqual({ kind: 'failed', category: 'no_progress' });
    expect(acts).toBe(3);
  });

  it('E2: resets no_progress streak when reobserve text changes', async () => {
    let acts = 0;
    const outcome = await runObserveActLoop({
      maxSteps: 10,
      maxFailures: 5,
      maxNoProgress: 3,
      isStopped: () => false,
      waitIfPaused: async () => undefined,
      observe: async () => 'v0',
      decide: async (_s, step): Promise<LoopDecision> => {
        if (step >= 4) return { kind: 'done', summary: 'moved on' };
        return { kind: 'action', name: 'click_element', args: { index: step } };
      },
      act: async () => {
        acts += 1;
        return { error: null };
      },
      reobserve: async () => {
        // first two acts stuck, then page changes before third identical would fire
        if (acts <= 2) return 'v0';
        return `v${acts}`;
      },
    });
    expect(outcome).toEqual({ kind: 'candidate_complete', summary: 'moved on' });
    expect(acts).toBeGreaterThanOrEqual(3);
  });

  it('E3: maxNoProgress=0 disables no_progress and can hit max_steps', async () => {
    const outcome = await runObserveActLoop({
      maxSteps: 4,
      maxFailures: 5,
      maxNoProgress: 0,
      isStopped: () => false,
      waitIfPaused: async () => undefined,
      observe: async () => 'frozen',
      decide: async () => ({ kind: 'action', name: 'wait', args: { seconds: 0 } }),
      act: async () => ({ error: null }),
      reobserve: async () => 'frozen',
    });
    expect(outcome).toEqual({ kind: 'failed', category: 'max_steps' });
  });
});
