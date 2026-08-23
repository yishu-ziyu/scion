import { describe, expect, it, vi } from 'vitest';
import { classifyRetry } from '../../retry-policy';
import {
  actionInvalidatesElementSnapshot,
  isForbiddenTaskContentUrl,
  runObserveActLoop,
  type LoopDecision,
  type LoopPhaseEvent,
} from '../observe-act-loop';

describe('observe → act → re-observe loop (ticket 02, S3)', () => {
  it('invalidates indexed followups after every navigation action', () => {
    expect(
      ['go_to_url', 'go_back', 'previous_page', 'next_page', 'search_google'].every(actionInvalidatesElementSnapshot),
    ).toBe(true);
  });

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
      onPhase: e => {
        phases.push(e);
      },
    });

    expect(outcome).toEqual({ kind: 'candidate_complete', summary: 'YouTube opened' });
    expect(phases.map(p => p.phase)).toEqual(['observe', 'decide', 'act', 'reobserve', 'decide']);
    expect(observeCount).toBe(1);
    expect(reobserveCount).toBe(1);
    expect(decideCount).toBe(2);
  });

  it('awaits onPhase before observe so a live step can persist first', async () => {
    const order: string[] = [];
    const outcome = await runObserveActLoop({
      maxSteps: 2,
      maxFailures: 1,
      isStopped: () => false,
      waitIfPaused: async () => undefined,
      observe: async () => {
        order.push('observe');
        return 'ok';
      },
      decide: async () => ({ kind: 'done', summary: 'ok' }),
      act: async () => ({ error: null }),
      onPhase: async event => {
        if (event.phase === 'observe') {
          await Promise.resolve();
          order.push('phase');
        }
      },
    });
    expect(outcome).toEqual({ kind: 'candidate_complete', summary: 'ok' });
    expect(order).toEqual(['phase', 'observe']);
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

  it('fails immediately when the caller policy says the error is not retryable', async () => {
    const outcome = await runObserveActLoop({
      maxSteps: 10,
      maxFailures: 2,
      isStopped: () => false,
      waitIfPaused: async () => undefined,
      observe: async () => 'ok',
      decide: async () => ({ kind: 'action', name: 'input_text', args: { index: 1 } }),
      act: async () => ({ error: 'Invalid input: NaN' }),
      shouldRetryFailure: () => false,
    });
    expect(outcome).toEqual({ kind: 'failed', category: 'action_failed' });
  });

  it('retries Element-not-found clicks when classifyRetry says retry, then can finish', async () => {
    let acts = 0;
    const outcome = await runObserveActLoop({
      maxSteps: 5,
      maxFailures: 3,
      isStopped: () => false,
      waitIfPaused: async () => undefined,
      observe: async () => 'ok',
      decide: async () => ({ kind: 'action', name: 'click_element', args: { index: 1 } }),
      act: async () => {
        acts += 1;
        if (acts === 1) return { error: 'Element: foo not found' };
        return { error: null, isDone: true, summary: 'clicked' };
      },
      shouldRetryFailure: error => classifyRetry(error) === 'retry',
    });
    expect(outcome).toEqual({ kind: 'candidate_complete', summary: 'clicked' });
    expect(acts).toBe(2);
  });

  it('still stops immediately on unknown action when classifyRetry says no_retry', async () => {
    let acts = 0;
    const outcome = await runObserveActLoop({
      maxSteps: 5,
      maxFailures: 3,
      isStopped: () => false,
      waitIfPaused: async () => undefined,
      observe: async () => 'ok',
      decide: async () => ({ kind: 'action', name: 'frob', args: {} }),
      act: async () => {
        acts += 1;
        return { error: 'unknown action frob' };
      },
      shouldRetryFailure: error => classifyRetry(error) === 'retry',
    });
    expect(outcome).toEqual({ kind: 'failed', category: 'action_failed' });
    expect(acts).toBe(1);
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

  it('lets onStuck replan once before no_progress fails', async () => {
    let acts = 0;
    let stuck = 0;
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
      onStuck: async () => {
        stuck += 1;
        return 'continue';
      },
    });
    expect(outcome).toEqual({ kind: 'failed', category: 'no_progress' });
    expect(stuck).toBe(1);
    expect(acts).toBe(6);
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

  it('counts new local evidence results as semantic progress on an unchanged page', async () => {
    let acts = 0;
    const summaries = ['added=1; duplicates=0', 'added=0; duplicates=1', 'products=1'];
    const outcome = await runObserveActLoop({
      maxSteps: 5,
      maxFailures: 3,
      maxNoProgress: 3,
      isStopped: () => false,
      waitIfPaused: async () => undefined,
      observe: async () => 'url=https://example.com',
      decide: async (_state, step): Promise<LoopDecision> =>
        step < summaries.length
          ? { kind: 'action', name: 'record_evidence', args: {} }
          : { kind: 'done', summary: 'evidence verified' },
      act: async () => {
        const summary = summaries[acts++];
        return { error: null, summary, progressKey: `record_evidence:${summary}` };
      },
      reobserve: async () => 'url=https://example.com',
    });

    expect(outcome).toEqual({ kind: 'candidate_complete', summary: 'evidence verified' });
    expect(acts).toBe(3);
  });

  it('does not let a repeated local result bypass no_progress', async () => {
    const outcome = await runObserveActLoop({
      maxSteps: 10,
      maxFailures: 3,
      maxNoProgress: 2,
      isStopped: () => false,
      waitIfPaused: async () => undefined,
      observe: async () => 'url=https://example.com',
      decide: async () => ({ kind: 'action', name: 'inspect_evidence_space', args: {} }),
      act: async () => ({ error: null, progressKey: 'inspect_evidence_space:products=1' }),
      reobserve: async () => 'url=https://example.com',
    });

    expect(outcome).toEqual({ kind: 'failed', category: 'no_progress' });
  });

  it('runs same-observation followup fills with one decide', async () => {
    const acted: string[] = [];
    let decideCount = 0;
    let reobserveCount = 0;
    const outcome = await runObserveActLoop({
      maxSteps: 5,
      maxFailures: 3,
      isStopped: () => false,
      waitIfPaused: async () => undefined,
      observe: async () => 'form',
      decide: async (): Promise<LoopDecision> => {
        decideCount += 1;
        if (decideCount === 1) {
          return {
            kind: 'action',
            name: 'input_text',
            args: { index: 1, text: 'Ada' },
            followup: [{ name: 'input_text', args: { index: 2, text: 'ada@example.test' } }],
          };
        }
        return { kind: 'done', summary: 'filled' };
      },
      act: async action => {
        acted.push(`${action.name}:${String(action.args.index)}`);
        return { error: null };
      },
      reobserve: async () => {
        reobserveCount += 1;
        return 'form';
      },
    });
    expect(outcome).toEqual({ kind: 'candidate_complete', summary: 'filled' });
    expect(acted).toEqual(['input_text:1', 'input_text:2']);
    expect(decideCount).toBe(2);
    expect(reobserveCount).toBe(2);
  });

  it('caps actions from any decision source at five', async () => {
    const acted: number[] = [];
    let decideCount = 0;
    const outcome = await runObserveActLoop({
      maxSteps: 3,
      maxFailures: 3,
      isStopped: () => false,
      waitIfPaused: async () => undefined,
      observe: async () => 'form',
      decide: async (): Promise<LoopDecision> => {
        decideCount += 1;
        if (decideCount > 1) return { kind: 'done', summary: 'bounded' };
        return {
          kind: 'action',
          name: 'input_text',
          args: { index: 1, text: 'v1' },
          followup: Array.from({ length: 7 }, (_, index) => ({
            name: 'input_text',
            args: { index: index + 2, text: `v${index + 2}` },
          })),
        };
      },
      act: async action => {
        acted.push(Number(action.args.index));
        return { error: null };
      },
      reobserve: async () => 'filled',
    });
    expect(outcome).toEqual({ kind: 'candidate_complete', summary: 'bounded' });
    expect(acted).toEqual([1, 2, 3, 4, 5]);
  });

  it('does not run a later indexed action after click_element in the same queue', async () => {
    const acted: string[] = [];
    let decideCount = 0;
    const outcome = await runObserveActLoop({
      maxSteps: 5,
      maxFailures: 3,
      isStopped: () => false,
      waitIfPaused: async () => undefined,
      observe: async () => 'list',
      decide: async (): Promise<LoopDecision> => {
        decideCount += 1;
        if (decideCount === 1) {
          return {
            kind: 'action',
            name: 'click_element',
            args: { index: 1 },
            followup: [{ name: 'click_element', args: { index: 9 } }],
          };
        }
        return { kind: 'done', summary: 'clicked once' };
      },
      act: async action => {
        acted.push(`${action.name}:${String(action.args.index)}`);
        return { error: null };
      },
      reobserve: async () => 'next-page',
    });
    expect(outcome).toEqual({ kind: 'candidate_complete', summary: 'clicked once' });
    expect(acted).toEqual(['click_element:1']);
    expect(decideCount).toBe(2);
  });

  it('redecides instead of submitting after an invalid indexed action', async () => {
    const acted: string[] = [];
    let decideCount = 0;
    const outcome = await runObserveActLoop({
      maxSteps: 3,
      maxFailures: 3,
      isStopped: () => false,
      waitIfPaused: async () => undefined,
      observe: async () => 'form',
      decide: async (): Promise<LoopDecision> => {
        decideCount += 1;
        if (decideCount > 1) return { kind: 'done', summary: 'replanned' };
        return {
          kind: 'action',
          name: 'click_element',
          args: { index: 1 },
          followup: [
            { name: 'input_text', args: { index: 2, text: 'Ada' } },
            { name: 'click_element', args: { query: 'Submit' } },
          ],
        };
      },
      act: async action => {
        acted.push(`${action.name}:${String(action.args.index ?? action.args.query ?? '')}`);
        return { error: null };
      },
      reobserve: async () => 'form changed',
    });

    expect(outcome).toEqual({ kind: 'candidate_complete', summary: 'replanned' });
    expect(acted).toEqual(['click_element:1']);
  });

  it('does not let a successful queue prefix reset repeated followup failures', async () => {
    const acted: string[] = [];
    const outcome = await runObserveActLoop({
      maxSteps: 5,
      maxFailures: 2,
      isStopped: () => false,
      waitIfPaused: async () => undefined,
      observe: async () => 'form',
      decide: async (): Promise<LoopDecision> => ({
        kind: 'action',
        name: 'input_text',
        args: { index: 1, text: 'Ada' },
        followup: [{ name: 'click_element', args: { index: 2 } }],
      }),
      act: async action => {
        acted.push(action.name);
        return action.name === 'click_element' ? { error: 'temporary click failure' } : { error: null };
      },
      reobserve: async () => 'name filled',
    });

    expect(outcome).toEqual({ kind: 'failed', category: 'action_failed' });
    expect(acted).toEqual(['input_text', 'click_element', 'input_text', 'click_element']);
  });

  it('runs fill then submit in one decide because submit is last', async () => {
    const acted: string[] = [];
    let decideCount = 0;
    const outcome = await runObserveActLoop({
      maxSteps: 5,
      maxFailures: 3,
      isStopped: () => false,
      waitIfPaused: async () => undefined,
      observe: async () => 'form',
      decide: async (): Promise<LoopDecision> => {
        decideCount += 1;
        if (decideCount === 1) {
          return {
            kind: 'action',
            name: 'input_text',
            args: { index: 1, text: 'Ada' },
            followup: [{ name: 'click_element', args: { index: 2 } }],
          };
        }
        return { kind: 'done', summary: 'submitted' };
      },
      act: async action => {
        acted.push(action.name);
        return { error: null };
      },
      reobserve: async () => 'saved',
    });
    expect(outcome).toEqual({ kind: 'candidate_complete', summary: 'submitted' });
    expect(acted).toEqual(['input_text', 'click_element']);
    expect(decideCount).toBe(2);
  });

  it('does not count each fill in one decide against no_progress', async () => {
    const acted: string[] = [];
    let decideCount = 0;
    const outcome = await runObserveActLoop({
      maxSteps: 5,
      maxFailures: 3,
      maxNoProgress: 3,
      isStopped: () => false,
      waitIfPaused: async () => undefined,
      observe: async () => 'form',
      decide: async (): Promise<LoopDecision> => {
        decideCount += 1;
        if (decideCount === 1) {
          return {
            kind: 'action',
            name: 'input_text',
            args: { index: 1, text: 'a' },
            followup: [
              { name: 'input_text', args: { index: 2, text: 'b' } },
              { name: 'input_text', args: { index: 3, text: 'c' } },
              { name: 'input_text', args: { index: 4, text: 'd' } },
            ],
          };
        }
        return { kind: 'done', summary: 'filled four' };
      },
      act: async action => {
        acted.push(String(action.args.index));
        return { error: null };
      },
      reobserve: async () => 'form',
    });
    expect(outcome).toEqual({ kind: 'candidate_complete', summary: 'filled four' });
    expect(acted).toEqual(['1', '2', '3', '4']);
  });

  it('skips an indexed followup after switch_tab', async () => {
    const acted: string[] = [];
    let decideCount = 0;
    const outcome = await runObserveActLoop({
      maxSteps: 5,
      maxFailures: 3,
      isStopped: () => false,
      waitIfPaused: async () => undefined,
      observe: async () => 'tab-a',
      decide: async (): Promise<LoopDecision> => {
        decideCount += 1;
        if (decideCount === 1) {
          return {
            kind: 'action',
            name: 'switch_tab',
            args: { tab_id: 2 },
            followup: [{ name: 'click_element', args: { index: 4 } }],
          };
        }
        return { kind: 'done', summary: 'switched' };
      },
      act: async action => {
        acted.push(action.name);
        return { error: null };
      },
      reobserve: async () => 'tab-b',
    });
    expect(outcome).toEqual({ kind: 'candidate_complete', summary: 'switched' });
    expect(acted).toEqual(['switch_tab']);
  });

  it('stops the followup queue when isStopped becomes true', async () => {
    const acted: string[] = [];
    let stopped = false;
    const outcome = await runObserveActLoop({
      maxSteps: 5,
      maxFailures: 3,
      isStopped: () => stopped,
      waitIfPaused: async () => undefined,
      observe: async () => 'form',
      decide: async (): Promise<LoopDecision> => ({
        kind: 'action',
        name: 'input_text',
        args: { index: 1, text: 'a' },
        followup: [{ name: 'input_text', args: { index: 2, text: 'b' } }],
      }),
      act: async action => {
        acted.push(String(action.args.index));
        stopped = true;
        return { error: null };
      },
      reobserve: async () => 'form',
    });
    expect(outcome).toEqual({ kind: 'cancelled' });
    expect(acted).toEqual(['1']);
  });

  it('discards the decided queue after a pause and observes again on resume', async () => {
    const acted: string[] = [];
    let paused = false;
    let observeCount = 0;
    let decideCount = 0;
    let reobserveCount = 0;
    const outcome = await runObserveActLoop({
      maxSteps: 5,
      maxFailures: 3,
      isStopped: () => false,
      waitIfPaused: async () => {
        if (!paused) return false;
        paused = false;
        return true;
      },
      observe: async () => `form-${++observeCount}`,
      decide: async (): Promise<LoopDecision> => {
        decideCount += 1;
        if (decideCount > 1) return { kind: 'done', summary: 'replanned after takeover' };
        return {
          kind: 'action',
          name: 'input_text',
          args: { index: 1, text: 'a' },
          followup: [{ name: 'click_element', args: { index: 2 } }],
        };
      },
      act: async action => {
        acted.push(action.name);
        paused = true;
        return { error: null };
      },
      reobserve: async () => {
        reobserveCount += 1;
        return 'must-not-use-after-takeover';
      },
    });
    expect(outcome).toEqual({ kind: 'candidate_complete', summary: 'replanned after takeover' });
    expect(acted).toEqual(['input_text']);
    expect(observeCount).toBe(2);
    expect(reobserveCount).toBe(0);
  });

  it('discards a decision when pause and resume both happen during decide', async () => {
    const acted: string[] = [];
    let pauseVersion = 0;
    let decideCount = 0;
    let observeCount = 0;
    const outcome = await runObserveActLoop({
      maxSteps: 3,
      maxFailures: 3,
      isStopped: () => false,
      waitIfPaused: async () => false,
      pauseVersion: () => pauseVersion,
      observe: async () => `form-${++observeCount}`,
      decide: async (): Promise<LoopDecision> => {
        decideCount += 1;
        if (decideCount > 1) return { kind: 'done', summary: 'fresh decision' };
        pauseVersion += 1;
        return { kind: 'action', name: 'click_element', args: { index: 2 } };
      },
      act: async action => {
        acted.push(action.name);
        return { error: null };
      },
    });

    expect(outcome).toEqual({ kind: 'candidate_complete', summary: 'fresh decision' });
    expect(acted).toEqual([]);
    expect(observeCount).toBe(2);
  });

  it('does not continue followups after a pause and resume during act', async () => {
    const acted: string[] = [];
    let pauseVersion = 0;
    let decideCount = 0;
    let observeCount = 0;
    const outcome = await runObserveActLoop({
      maxSteps: 3,
      maxFailures: 3,
      isStopped: () => false,
      waitIfPaused: async () => false,
      pauseVersion: () => pauseVersion,
      observe: async () => `form-${++observeCount}`,
      decide: async (): Promise<LoopDecision> => {
        decideCount += 1;
        if (decideCount > 1) return { kind: 'done', summary: 'fresh decision' };
        return {
          kind: 'action',
          name: 'input_text',
          args: { index: 1, text: 'Ada' },
          followup: [{ name: 'click_element', args: { index: 2 } }],
        };
      },
      act: async action => {
        acted.push(action.name);
        pauseVersion += 1;
        return { error: null };
      },
      reobserve: async () => 'must not carry after pause',
    });

    expect(outcome).toEqual({ kind: 'candidate_complete', summary: 'fresh decision' });
    expect(acted).toEqual(['input_text']);
    expect(observeCount).toBe(2);
  });

  it('uses a refreshed index for the same queued element', async () => {
    const acted: number[] = [];
    let decideCount = 0;
    const outcome = await runObserveActLoop({
      maxSteps: 3,
      maxFailures: 3,
      isStopped: () => false,
      waitIfPaused: async () => undefined,
      observe: async () => 'form',
      decide: async (): Promise<LoopDecision> => {
        decideCount += 1;
        if (decideCount > 1) return { kind: 'done', summary: 'filled' };
        return {
          kind: 'action',
          name: 'input_text',
          args: { index: 1, text: 'Ada' },
          followup: [{ name: 'input_text', args: { index: 2, text: 'ada@example.test' } }],
        };
      },
      act: async action => {
        acted.push(Number(action.args.index));
        return { error: null };
      },
      reobserve: async () => 'name filled',
      resolveQueuedAction: action => ({ ...action, args: { ...action.args, index: 9 } }),
    });

    expect(outcome).toEqual({ kind: 'candidate_complete', summary: 'filled' });
    expect(acted).toEqual([1, 9]);
  });

  it('redecides instead of using a queued index when the element identity changed', async () => {
    const acted: number[] = [];
    let decideCount = 0;
    let observeCount = 0;
    const outcome = await runObserveActLoop({
      maxSteps: 3,
      maxFailures: 3,
      isStopped: () => false,
      waitIfPaused: async () => undefined,
      observe: async () => `form-${++observeCount}`,
      decide: async (): Promise<LoopDecision> => {
        decideCount += 1;
        if (decideCount > 1) return { kind: 'done', summary: 'replanned' };
        return {
          kind: 'action',
          name: 'input_text',
          args: { index: 1, text: 'Ada' },
          followup: [{ name: 'click_element', args: { index: 2 } }],
        };
      },
      act: async action => {
        acted.push(Number(action.args.index));
        return { error: null };
      },
      reobserve: async () => 'form changed',
      resolveQueuedAction: () => null,
    });

    expect(outcome).toEqual({ kind: 'candidate_complete', summary: 'replanned' });
    expect(acted).toEqual([1]);
    expect(decideCount).toBe(2);
    expect(observeCount).toBe(1);
  });

  it('observes again instead of continuing an indexed queue after reobserve fails', async () => {
    const acted: number[] = [];
    let decideCount = 0;
    let observeCount = 0;
    const outcome = await runObserveActLoop({
      maxSteps: 3,
      maxFailures: 3,
      isStopped: () => false,
      waitIfPaused: async () => undefined,
      observe: async () => `form-${++observeCount}`,
      decide: async (): Promise<LoopDecision> => {
        decideCount += 1;
        if (decideCount > 1) return { kind: 'done', summary: 'observed again' };
        return {
          kind: 'action',
          name: 'input_text',
          args: { index: 1, text: 'Ada' },
          followup: [{ name: 'click_element', args: { index: 2 } }],
        };
      },
      act: async action => {
        acted.push(Number(action.args.index));
        return { error: null };
      },
      reobserve: async () => {
        throw new Error('observation unavailable');
      },
      resolveQueuedAction: action => action,
    });

    expect(outcome).toEqual({ kind: 'candidate_complete', summary: 'observed again' });
    expect(acted).toEqual([1]);
    expect(observeCount).toBe(2);
  });
});
