import { describe, expect, it, vi } from 'vitest';
import { createBrowserKernel } from '../browser-kernel';
import type { Action } from '../../../agent/actions/builder';
import { runObserveActLoop } from '../../../agent/backends/observe-act-loop';
import type { DispatchResult } from '../../../task/contracts';
import { ActionResult } from '../../../agent/types';

function makePageState(label: string) {
  return {
    tabId: 1,
    url: 'https://example.test/app',
    title: label,
    elementTree: { clickableElementsToString: () => `[1]<button>${label}</button>` },
    selectorMap: new Map([
      [
        1,
        {
          tagName: 'button',
          attributes: { type: 'submit' },
          getAllTextTillNextClickableElement: (): string => label,
          hash: async () => ({ branchPathHash: label, attributesHash: label, xpathHash: label }),
        },
      ],
    ]),
  };
}

function stubCurrentPage() {
  return {
    observeMedia: async () => ({ kind: 'none' as const }),
    evaluate: async () => '',
  };
}

function okDispatch(actionName: string): DispatchResult {
  return {
    actionResult: new ActionResult({
      error: undefined,
      isDone: false,
      extractedContent: 'ok',
      includeInMemory: true,
    }),
    attempt: {
      id: 'a1',
      roundId: 'round-1',
      actionName,
      effect: 'reversible',
      argsDigest: 'x',
      state: 'observed',
      proposedAt: 1,
    },
    evidence: [],
    pageRevision: 'rev-dispatch',
  };
}

function kernelForActs(getStateImpl: () => unknown, dispatch?: (name: string) => DispatchResult) {
  const getState = vi.fn(async () => getStateImpl());
  const dispatchAction = vi.fn(async (_round: string, action: Action) =>
    dispatch ? dispatch(action.name()) : okDispatch(action.name()),
  );
  const kernel = createBrowserKernel({
    browserContext: {
      getState,
      getCurrentPage: vi.fn(async () => stubCurrentPage()),
    } as never,
    hooks: { dispatchAction },
    resolveAction: name => ({ name: () => name, call: vi.fn() }) as unknown as Action,
  });
  return { kernel, getState };
}

describe('BrowserKernel', () => {
  it('act routes through dispatchAction with bound page_revision', async () => {
    const dispatchAction = vi.fn(async (...args: [string, Action, unknown]): Promise<DispatchResult> => {
      void args;
      return {
        actionResult: new ActionResult({
          error: undefined,
          isDone: false,
          extractedContent: 'ok',
          includeInMemory: true,
        }),
        attempt: {
          id: 'a1',
          roundId: 'round-1',
          actionName: 'click_element',
          effect: 'reversible',
          argsDigest: 'x',
          state: 'observed',
          proposedAt: 1,
        },
        evidence: [],
        pageRevision: 'rev-1',
      };
    });
    const action = {
      name: () => 'click_element',
      call: vi.fn(),
    } as unknown as Action;

    const kernel = createBrowserKernel({
      browserContext: {
        getState: vi.fn(async () => makePageState('after')),
        getCurrentPage: vi.fn(async () => stubCurrentPage()),
      } as never,
      hooks: { dispatchAction },
      resolveAction: name => (name === 'click_element' ? action : undefined),
    });

    const result = await kernel.act('round-1', 'click_element', { index: 3, intent: 'go' }, 'rev-seed');
    expect(result.error).toBeFalsy();
    expect(dispatchAction).toHaveBeenCalledTimes(1);
    const call = dispatchAction.mock.calls[0];
    expect(call[0]).toBe('round-1');
    expect(call[1]).toBe(action);
    expect(call[2]).toMatchObject({ index: 3, page_revision: 'rev-seed' });
  });

  it.each([
    ['evaluate', { code: 'document.body.remove()' }, 'dynamic_code_not_allowed'],
    ['run_javascript', {}, 'unknown_action'],
    ['click_element', { index: 1, nested: { code: 'document.body.remove()' } }, 'dynamic_code_not_allowed'],
  ])('rejects rogue %s injection before dispatch', async (name, args, error) => {
    const dispatchAction = vi.fn();
    const rogueAction = { name: () => name } as unknown as Action;
    const kernel = createBrowserKernel({
      browserContext: {} as never,
      hooks: { dispatchAction },
      resolveAction: () => rogueAction,
    });

    await expect(kernel.act('r', name, args)).resolves.toEqual({ error });
    expect(dispatchAction).not.toHaveBeenCalled();
  });

  it('returns error for unknown action without dispatch', async () => {
    const dispatchAction = vi.fn();
    const kernel = createBrowserKernel({
      browserContext: {} as never,
      hooks: { dispatchAction },
      resolveAction: () => undefined,
    });
    const result = await kernel.act('r', 'nope', {});
    expect(result.error).toBe('unknown_action');
    expect(dispatchAction).not.toHaveBeenCalled();
  });

  it('returns a retryable error when an indexed target disappears before dispatch', async () => {
    const dispatchAction = vi.fn(async () => {
      throw new Error('Action target is no longer available');
    });
    const action = {
      name: () => 'click_element',
      call: vi.fn(),
    } as unknown as Action;
    const kernel = createBrowserKernel({
      browserContext: {} as never,
      hooks: { dispatchAction },
      resolveAction: () => action,
    });

    await expect(kernel.act('round-1', 'click_element', { index: 3 })).resolves.toEqual({
      error: 'action_target_stale',
    });
    expect(dispatchAction).toHaveBeenCalledOnce();
  });

  it('observe applies query to interactive elements', async () => {
    const selectorMap = new Map([
      [
        1,
        {
          tagName: 'a',
          attributes: {},
          getAllTextTillNextClickableElement: (): string => 'Home',
          hash: async () => ({ branchPathHash: 'b', attributesHash: 'a', xpathHash: 'x' }),
        },
      ],
      [
        2,
        {
          tagName: 'button',
          attributes: { type: 'submit' },
          getAllTextTillNextClickableElement: (): string => '提交',
          hash: async () => ({ branchPathHash: 'b', attributesHash: 'a', xpathHash: 'x' }),
        },
      ],
    ]);
    const kernel = createBrowserKernel({
      browserContext: {
        getState: vi.fn(async () => ({
          tabId: 1,
          url: 'https://example.test/form',
          title: 'Form',
          elementTree: { clickableElementsToString: () => '[1]<a>Home</a>\n[2]<button type=submit>提交</button>' },
          selectorMap,
        })),
        getCurrentPage: vi.fn(async () => ({
          observeMedia: async () => ({ kind: 'none' as const }),
          evaluate: async () => '',
        })),
      } as never,
      hooks: { dispatchAction: vi.fn() },
      resolveAction: () => undefined,
    });

    const filtered = await kernel.observe({ query: '提交' });
    expect(filtered.interactiveElements.map(item => item.index)).toEqual([2]);
    const full = await kernel.observe();
    expect(full.interactiveElements.map(item => item.index)).toEqual([1, 2]);
  });

  it('extract uses parser on page html', async () => {
    const kernel = createBrowserKernel({
      browserContext: {
        getCurrentPage: vi.fn(async () => ({
          getContent: async () => '<div>hello</div>',
        })),
      } as never,
      hooks: { dispatchAction: vi.fn() },
      resolveAction: () => undefined,
    });
    const result = await kernel.extract({
      parser: html => html.includes('hello'),
    });
    expect(result).toEqual({ ok: true, data: true });
  });

  it('act click_element waits until pageRevision changes before returning', async () => {
    let label = 'before';
    const { kernel, getState } = kernelForActs(() => makePageState(label));
    const before = await kernel.observe();
    const waitFor = vi.spyOn(kernel, 'waitFor');
    getState.mockImplementation(async () => {
      const state = makePageState(label);
      label = 'after';
      return state;
    });

    const result = await kernel.act('round-1', 'click_element', { index: 1 }, before.pageRevision);

    expect(result.error).toBeFalsy();
    expect(waitFor).toHaveBeenCalledWith(
      { kind: 'revision_changed', fromRevision: before.pageRevision },
      expect.any(Number),
    );
    const timeoutMs = waitFor.mock.calls[0]?.[1];
    expect(timeoutMs).toBeGreaterThanOrEqual(3_000);
    expect(timeoutMs).toBeLessThanOrEqual(5_000);
    const after = kernel.lastFrame();
    expect(after?.pageRevision).toBeTruthy();
    expect(after?.pageRevision).not.toBe(before.pageRevision);
    expect(after?.tab.title).toBe('after');
  });

  it('act click_element still returns after timeout if pageRevision never changes', async () => {
    const { kernel } = kernelForActs(() => makePageState('frozen'));
    const before = await kernel.observe();
    const originalWaitFor = kernel.waitFor.bind(kernel);
    const waitFor = vi.spyOn(kernel, 'waitFor').mockImplementation((condition, timeoutMs) => {
      expect(timeoutMs).toBeGreaterThanOrEqual(3_000);
      expect(timeoutMs).toBeLessThanOrEqual(5_000);
      return originalWaitFor(condition, 30);
    });

    const result = await kernel.act('round-1', 'click_element', { index: 1 }, before.pageRevision);

    expect(waitFor).toHaveBeenCalledWith(
      { kind: 'revision_changed', fromRevision: before.pageRevision },
      expect.any(Number),
    );
    expect(result.error).toBeFalsy();
    expect(kernel.lastFrame()?.pageRevision).toBe(before.pageRevision);
  });

  it.each(['observe', 'wait', 'extract_content'])('act %s does not wait for a revision change', async name => {
    const { kernel, getState } = kernelForActs(() => makePageState('same'));
    const before = await kernel.observe();
    const waitFor = vi.spyOn(kernel, 'waitFor');
    const observesBeforeAct = getState.mock.calls.length;

    const result = await kernel.act('round-1', name, name === 'wait' ? { seconds: 1 } : {}, before.pageRevision);

    expect(result.error).toBeFalsy();
    expect(waitFor).not.toHaveBeenCalled();
    expect(getState.mock.calls.length).toBe(observesBeforeAct);
    expect(kernel.lastFrame()?.pageRevision).toBe(before.pageRevision);
  });

  it('after click_element the next decide sees the post-wait observation', async () => {
    let observes = 0;
    const { kernel } = kernelForActs(() => {
      observes += 1;
      return makePageState(observes >= 3 ? 'after' : 'before');
    });

    const outcome = await runObserveActLoop({
      maxSteps: 5,
      maxFailures: 3,
      isStopped: () => false,
      waitIfPaused: async () => undefined,
      observe: async () => (await kernel.observe()).text,
      decide: async (state, step) => {
        if (step === 0) {
          expect(state).toContain('before');
          return { kind: 'action' as const, name: 'click_element', args: { index: 1 } };
        }
        expect(state).toContain('after');
        return { kind: 'done' as const, summary: 'clicked' };
      },
      act: async action => kernel.act('round-1', action.name, action.args, kernel.lastFrame()?.pageRevision),
      reobserve: async () => kernel.lastFrame()?.text ?? '',
    });

    expect(outcome).toEqual({ kind: 'candidate_complete', summary: 'clicked' });
  });

  it('does not wait for a revision change when click_element fails', async () => {
    const { kernel, getState } = kernelForActs(
      () => makePageState('same'),
      () => ({
        ...okDispatch('click_element'),
        actionResult: new ActionResult({ error: 'Element: foo not found', includeInMemory: true }),
      }),
    );
    const before = await kernel.observe();
    const waitFor = vi.spyOn(kernel, 'waitFor');
    const observesBeforeAct = getState.mock.calls.length;

    const result = await kernel.act('round-1', 'click_element', { index: 1 }, before.pageRevision);

    expect(result.error).toBe('Element: foo not found');
    expect(waitFor).not.toHaveBeenCalled();
    expect(getState.mock.calls.length).toBe(observesBeforeAct);
  });
});
