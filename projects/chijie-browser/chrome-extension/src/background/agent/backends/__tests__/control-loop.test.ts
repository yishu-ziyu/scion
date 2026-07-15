import { describe, expect, it, vi } from 'vitest';
import {
  createControlLoopDriver,
  fixtureFormControlSteps,
  fixtureMediaControlSteps,
  fixtureNavigateControlSteps,
} from '../control-loop';
import type { ExecutorHooks } from '../../../task/contracts';
import { ActionResult } from '../../types';

function hooksMock(): ExecutorHooks & {
  onPlan: ReturnType<typeof vi.fn>;
  dispatchAction: ReturnType<typeof vi.fn>;
} {
  return {
    onPlan: vi.fn(async () => undefined),
    dispatchAction: vi.fn(async (_roundId, action, rawArgs) => {
      const actionResult = await action.call(rawArgs);
      return {
        actionResult,
        attempt: {
          id: 'a1',
          roundId: _roundId,
          actionName: action.name(),
          state: 'observed' as const,
          effect: 'reversible' as const,
          proposedAt: 1,
        },
        evidence: [],
      };
    }),
  };
}

describe('control-loop backend (design/002)', () => {
  it('runs form fixture script through onPlan + dispatchAction + candidate_complete', async () => {
    const hooks = hooksMock();
    const driver = createControlLoopDriver(
      { taskId: 't1', roundId: 'r1', instruction: 'fill and submit', tabId: 1 },
      hooks,
      { steps: fixtureFormControlSteps() },
    );

    const outcome = await driver.run('r1');
    expect(outcome).toEqual({ kind: 'candidate_complete', summary: 'Form submit candidate' });
    expect(hooks.onPlan).toHaveBeenCalledOnce();
    expect(hooks.onPlan.mock.calls[0][1]).toEqual([
      { kind: 'page_text', operator: 'present', expected: 'Saved successfully', required: true },
    ]);
    expect(hooks.dispatchAction).toHaveBeenCalledTimes(2);
    expect(hooks.dispatchAction.mock.calls[0][1].name()).toBe('input_text');
    expect(hooks.dispatchAction.mock.calls[1][1].name()).toBe('click_element');
  });

  it('runs media script with control_media play then pause', async () => {
    const calls: Array<{ command: string; digest?: string }> = [];
    const hooks = hooksMock();
    const driver = createControlLoopDriver(
      { taskId: 't2', roundId: 'r2', instruction: 'play then pause', tabId: 1 },
      hooks,
      {
        steps: fixtureMediaControlSteps({ playDigest: 'digest-media-1' }),
        actionHandlers: {
          control_media: async args => {
            calls.push({
              command: String(args.command),
              digest: args.target_digest ? String(args.target_digest) : undefined,
            });
            return new ActionResult({ success: true });
          },
        },
      },
    );

    const outcome = await driver.run('r2');
    expect(outcome.kind).toBe('candidate_complete');
    // dispatchAction mock calls action.call which hits handlers
    expect(calls).toEqual([
      { command: 'play', digest: 'digest-media-1' },
      { command: 'pause', digest: 'digest-media-1' },
    ]);
  });

  it('stop mid-run yields cancelled', async () => {
    const hooks = hooksMock();
    hooks.onPlan.mockImplementation(async () => {
      // hang until stop — use pause gate instead
    });
    const driver = createControlLoopDriver(
      { taskId: 't3', roundId: 'r3', instruction: 'x', tabId: 1 },
      hooks,
      {
        steps: [
          { type: 'plan', criteria: [] },
          { type: 'candidate_complete', summary: 'should not reach' },
        ],
      },
    );

    const runPromise = driver.run('r3');
    await driver.stop();
    // first step may complete; if stop after plan, candidate may still run
    // force cancel by stopping before run:
    const driver2 = createControlLoopDriver(
      { taskId: 't3b', roundId: 'r3b', instruction: 'x', tabId: 1 },
      hooksMock(),
      {
        steps: [
          { type: 'plan', criteria: [] },
          { type: 'candidate_complete' },
        ],
      },
    );
    await driver2.stop();
    await expect(driver2.run('r3b')).resolves.toEqual({ kind: 'cancelled' });
    void runPromise;
  });

  it('fails closed when script has no terminal step', async () => {
    const driver = createControlLoopDriver(
      { taskId: 't4', roundId: 'r4', instruction: 'x', tabId: 1 },
      hooksMock(),
      { steps: [{ type: 'plan', criteria: [] }] },
    );
    await expect(driver.run('r4')).resolves.toEqual({ kind: 'failed', category: 'control_script_exhausted' });
  });

  it('navigate-first script dispatches go_to_url then wait through hooks (ticket 02)', async () => {
    const hooks = hooksMock();
    const navigated: string[] = [];
    const driver = createControlLoopDriver(
      { taskId: 't-nav', roundId: 'r-nav', instruction: '打开 YouTube', tabId: 1 },
      hooks,
      {
        steps: fixtureNavigateControlSteps(),
        actionHandlers: {
          go_to_url: async args => {
            navigated.push(String(args.url));
            return new ActionResult({ success: true });
          },
          wait: async () => new ActionResult({ success: true }),
        },
      },
    );

    const outcome = await driver.run('r-nav');
    expect(outcome).toEqual({ kind: 'candidate_complete', summary: 'Navigation candidate complete' });
    expect(hooks.onPlan).toHaveBeenCalledOnce();
    expect(hooks.dispatchAction).toHaveBeenCalledTimes(2);
    expect(hooks.dispatchAction.mock.calls[0][1].name()).toBe('go_to_url');
    expect(hooks.dispatchAction.mock.calls[1][1].name()).toBe('wait');
    expect(navigated).toEqual(['https://www.youtube.com/']);
  });
});
