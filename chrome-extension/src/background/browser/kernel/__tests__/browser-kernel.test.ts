import { describe, expect, it, vi } from 'vitest';
import { createBrowserKernel } from '../browser-kernel';
import type { Action } from '../../../agent/actions/builder';
import type { DispatchResult } from '../../../task/contracts';
import { ActionResult } from '../../../agent/types';

describe('BrowserKernel', () => {
  it('act routes through dispatchAction with bound page_revision', async () => {
    const dispatchAction = vi.fn(
      async (...args: [string, Action, unknown]): Promise<DispatchResult> => {
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
      },
    );
    const action = {
      name: () => 'click_element',
      call: vi.fn(),
    } as unknown as Action;

    const kernel = createBrowserKernel({
      browserContext: {
        getState: vi.fn(),
        getCurrentPage: vi.fn(),
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

  it('returns error for unknown action without dispatch', async () => {
    const dispatchAction = vi.fn();
    const kernel = createBrowserKernel({
      browserContext: {} as never,
      hooks: { dispatchAction },
      resolveAction: () => undefined,
    });
    const result = await kernel.act('r', 'nope', {});
    expect(result.error).toMatch(/unknown action/);
    expect(dispatchAction).not.toHaveBeenCalled();
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
});
