import { describe, expect, it, vi } from 'vitest';
import { Action } from '../../agent/actions/builder';
import {
  clickElementActionSchema,
  doneActionSchema,
  goToUrlActionSchema,
  waitActionSchema,
} from '../../agent/actions/schemas';
import { ActionResult } from '../../agent/types';
import { ActionDispatcher, decideEffect } from '../action-dispatcher';

describe('EffectPolicy', () => {
  it.each([
    ['done', {}, 'allow'],
    ['search_google', {}, 'allow'],
    ['go_to_url', { url: 'https://example.com' }, 'allow'],
    ['go_back', {}, 'allow'],
    ['click_element', { tag: 'button', type: 'submit', inForm: true }, 'approval'],
    // Ordinary UI / navigation clicks are reversible (YouTube thumbs, menus, tabs).
    ['click_element', { tag: 'div', role: 'button', inForm: false }, 'allow'],
    ['click_element', { tag: 'input', type: 'submit', inForm: false }, 'approval'],
    ['click_element', { tag: 'a', type: '', inForm: false, semanticNavigation: true }, 'allow'],
    ['click_element', { tag: 'a', type: '', inForm: false, hasSemanticName: true }, 'allow'],
    ['click_element', { tag: 'a', type: '', inForm: false }, 'allow'],
    ['click_element', { tag: 'button', type: 'button', inForm: false }, 'allow'],
    // In-form <button> without type defaults to submit in HTML.
    ['click_element', { tag: 'button', type: '', inForm: true }, 'approval'],
    ['click_element', { tag: 'button', type: 'button', inForm: true }, 'allow'],
    ['click_element', { tag: 'a', type: '', inForm: false, semanticCommit: true }, 'approval'],
    ['click_element', { tag: 'a', type: '', inForm: false, intent: 'Delete item' }, 'approval'],
    ['click_element', { tag: 'a', type: '', inForm: false, intent: 'Revoke access' }, 'approval'],
    // "Open dispute" is navigation to a form, not submit/commit.
    ['click_element', { tag: 'a', type: '', inForm: false, intent: 'Open dispute' }, 'allow'],
    ['click_element', { tag: 'a', type: '', inForm: false, intent: 'Submit dispute' }, 'approval'],
    ['send_keys', { activeTag: 'input', inForm: true, keys: 'Enter' }, 'approval'],
    ['send_keys', { activeTag: 'textarea', inForm: true, keys: 'Control+Enter' }, 'approval'],
    ['send_keys', { activeTag: 'body', inForm: false, keys: 'PageDown' }, 'allow'],
    ['input_text', { tag: 'input', type: 'password' }, 'block'],
    ['input_text', { tag: 'input', type: 'text' }, 'allow'],
    ['switch_tab', {}, 'allow'],
    ['open_tab', {}, 'allow'],
    ['close_tab', {}, 'allow'],
    ['cache_content', {}, 'allow'],
    ['scroll_to_percent', {}, 'allow'],
    ['scroll_to_top', {}, 'allow'],
    ['scroll_to_bottom', {}, 'allow'],
    ['previous_page', {}, 'allow'],
    ['next_page', {}, 'allow'],
    ['scroll_to_text', {}, 'allow'],
    ['get_dropdown_options', {}, 'allow'],
    ['select_dropdown_option', {}, 'allow'],
    ['wait', {}, 'allow'],
    ['control_media', {}, 'allow'],
  ] as const)('%s resolves to %s', (actionName, target, expected) => {
    expect(decideEffect({ actionName, target, skillPolicy: 'default' }).kind).toBe(expected);
  });
});

describe('ActionDispatcher', () => {
  it('does not invoke an external commit before approval and invokes it once after approval', async () => {
    let decide!: (value: 'approved' | 'rejected') => void;
    const approval = new Promise<'approved' | 'rejected'>(resolve => {
      decide = resolve;
    });
    const executeExternalCommit = vi.fn(async () => new ActionResult({ success: true }));
    const action = new Action(executeExternalCommit, clickElementActionSchema, true);
    const persistedStates: string[] = [];
    const dispatcher = new ActionDispatcher({
      now: () => 100,
      persistAttempt: vi.fn(async attempt => {
        persistedStates.push(attempt.state);
      }),
      requestApproval: vi.fn(async () => approval),
      observe: vi.fn(async (_request, _args, phase) => ({
        target: {
          id: 'target-1',
          kind: 'element' as const,
          tabId: 7,
          frameId: 0 as const,
          urlOrigin: 'https://example.test',
          digest: 'button-1',
        },
        effectTarget: { tag: 'button', type: 'submit', inForm: true },
        evidence: phase === 'after' ? [] : [],
      })),
    });
    const pending = dispatcher.dispatch({
      taskId: 'task-1',
      roundId: 'round-1',
      action,
      rawArgs: { intent: 'submit form', index: 4 },
    });

    await vi.waitFor(() => expect(executeExternalCommit).not.toHaveBeenCalled());
    decide('approved');
    const result = await pending;
    expect(result.actionResult.success).toBe(true);
    expect(executeExternalCommit).toHaveBeenCalledTimes(1);
    expect(persistedStates).toEqual(['proposed', 'approved', 'executing', 'observed']);
  });

  it('does not invoke a rejected external commit', async () => {
    const executeExternalCommit = vi.fn(async () => new ActionResult({ success: true }));
    const action = new Action(executeExternalCommit, clickElementActionSchema, true);
    const persistedStates: string[] = [];
    const dispatcher = new ActionDispatcher({
      now: () => 100,
      persistAttempt: vi.fn(async attempt => {
        persistedStates.push(attempt.state);
      }),
      requestApproval: vi.fn(async () => 'rejected' as const),
      observe: vi.fn(async () => ({
        target: {
          id: 'target-1',
          kind: 'element' as const,
          tabId: 7,
          frameId: 0 as const,
          urlOrigin: 'https://example.test',
          digest: 'button-1',
        },
        effectTarget: { tag: 'button', type: 'submit', inForm: true },
        evidence: [],
      })),
    });

    const result = await dispatcher.dispatch({
      taskId: 'task-1',
      roundId: 'round-1',
      action,
      rawArgs: { intent: 'submit form', index: 4 },
    });

    expect(result.attempt.state).toBe('blocked');
    expect(executeExternalCommit).not.toHaveBeenCalled();
    expect(persistedStates).toEqual(['proposed', 'blocked']);
  });

  it('invalidates approval when the target fingerprint changes', async () => {
    const executeExternalCommit = vi.fn(async () => new ActionResult({ success: true }));
    const action = new Action(executeExternalCommit, clickElementActionSchema, true);
    const persistedStates: string[] = [];
    let observation = 0;
    const dispatcher = new ActionDispatcher({
      now: () => 100,
      persistAttempt: vi.fn(async attempt => {
        persistedStates.push(attempt.state);
      }),
      requestApproval: vi.fn(async () => 'approved' as const),
      observe: vi.fn(async () => {
        observation += 1;
        return {
          target: {
            id: 'target-1',
            kind: 'element' as const,
            tabId: 7,
            frameId: 0 as const,
            urlOrigin: 'https://example.test',
            digest: observation === 1 ? 'button-before' : 'button-changed',
          },
          effectTarget: { tag: 'button', type: 'submit', inForm: true },
          evidence: [],
        };
      }),
    });

    const result = await dispatcher.dispatch({
      taskId: 'task-1',
      roundId: 'round-1',
      action,
      rawArgs: { intent: 'submit form', index: 4 },
    });

    expect(result.attempt.state).toBe('blocked');
    expect(executeExternalCommit).not.toHaveBeenCalled();
    expect(persistedStates).toEqual(['proposed', 'approved', 'blocked']);
  });

  it('does not execute an unclaimed index after the observed target changes', async () => {
    const execute = vi.fn(async () => new ActionResult({ success: true }));
    const action = new Action(execute, clickElementActionSchema, true);
    const persistedStates: string[] = [];
    let observation = 0;
    const observe = vi.fn(async () => {
      observation += 1;
      return {
        target: {
          id: 'target-1',
          kind: 'element' as const,
          tabId: 7,
          frameId: 0 as const,
          urlOrigin: 'https://example.test',
          digest: observation === 1 ? 'button-before' : 'button-changed',
        },
        effectTarget: { tag: 'button', type: 'button', inForm: false },
        evidence: [],
      };
    });
    const dispatcher = new ActionDispatcher({
      now: () => 100,
      persistAttempt: vi.fn(async attempt => {
        persistedStates.push(attempt.state);
      }),
      requestApproval: vi.fn(async () => 'approved' as const),
      observe,
    });

    const result = await dispatcher.dispatch({
      taskId: 'task-1',
      roundId: 'round-1',
      action,
      rawArgs: { intent: 'open item', index: 4 },
    });

    expect(result.attempt.state).toBe('blocked');
    expect(result.actOutcome).toBe('didnt');
    expect(result.actionResult.error).toMatch(/target changed.*replan/i);
    expect(result.targetRef?.digest).toBe('button-changed');
    expect(execute).not.toHaveBeenCalled();
    expect(observe).toHaveBeenCalledTimes(2);
    expect(persistedStates).toEqual(['proposed', 'blocked']);
  });

  it('executes an unclaimed index once when the target remains bound', async () => {
    const execute = vi.fn(async () => new ActionResult({ success: true }));
    const action = new Action(execute, clickElementActionSchema, true);
    const phases: Array<'before' | 'after'> = [];
    const dispatcher = new ActionDispatcher({
      now: () => 100,
      persistAttempt: vi.fn(async () => undefined),
      requestApproval: vi.fn(async () => 'approved' as const),
      observe: vi.fn(async (_request, _args, phase) => {
        phases.push(phase);
        return {
          target: {
            id: 'target-1',
            kind: phase === 'after' ? ('page' as const) : ('element' as const),
            tabId: 7,
            frameId: 0 as const,
            urlOrigin: 'https://example.test',
            digest: phase === 'after' ? 'page-after' : 'button-stable',
          },
          effectTarget: { tag: 'button', type: 'button', inForm: false },
          evidence: [],
        };
      }),
    });

    const result = await dispatcher.dispatch({
      taskId: 'task-1',
      roundId: 'round-1',
      action,
      rawArgs: { intent: 'open item', index: 4 },
    });

    expect(result.attempt.state).toBe('observed');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(phases).toEqual(['before', 'before', 'after']);
  });

  it.each([
    ['go_to_url', goToUrlActionSchema, { intent: 'open example', url: 'https://example.test' }],
    ['wait', waitActionSchema, { intent: 'wait briefly', seconds: 1 }],
    ['done', doneActionSchema, { text: 'finished', success: true }],
  ])('keeps no-target %s dispatch compatible', async (_name, schema, rawArgs) => {
    const execute = vi.fn(async () => new ActionResult({ success: true }));
    const action = new Action(execute, schema, true);
    const phases: Array<'before' | 'after'> = [];
    const dispatcher = new ActionDispatcher({
      now: () => 100,
      persistAttempt: vi.fn(async () => undefined),
      requestApproval: vi.fn(async () => 'approved' as const),
      observe: vi.fn(async (_request, _args, phase) => {
        phases.push(phase);
        return {
          target: {
            id: 'page-1',
            kind: 'page' as const,
            tabId: 7,
            frameId: 0 as const,
            urlOrigin: 'https://example.test',
            digest: phase === 'before' ? 'page-before' : 'page-after',
          },
          effectTarget: {},
          evidence: [],
        };
      }),
    });

    const result = await dispatcher.dispatch({
      taskId: 'task-1',
      roundId: 'round-1',
      action,
      rawArgs,
    });

    expect(result.attempt.state).toBe('observed');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(phases).toEqual(['before', 'after']);
  });

  it('persists uncertain after an executing action throws (soft return, no rethrow)', async () => {
    const action = new Action(
      vi.fn(async () => {
        throw new Error('commit transport failed');
      }),
      clickElementActionSchema,
      true,
    );
    const persistedStates: string[] = [];
    const dispatcher = new ActionDispatcher({
      now: () => 100,
      persistAttempt: vi.fn(async attempt => {
        persistedStates.push(attempt.state);
      }),
      requestApproval: vi.fn(async () => 'approved' as const),
      observe: vi.fn(async () => ({
        target: {
          id: 'target-1',
          kind: 'element' as const,
          tabId: 7,
          frameId: 0 as const,
          urlOrigin: 'https://example.test',
          digest: 'button-1',
        },
        effectTarget: { tag: 'button', type: 'submit', inForm: true },
        evidence: [],
      })),
    });

    // Overnight: rethrow after uncertain → control loop dispatch_failed.
    // Soft path keeps uncertain as terminal signal without killing the loop via throw.
    await expect(
      dispatcher.dispatch({
        taskId: 'task-1',
        roundId: 'round-1',
        action,
        rawArgs: { intent: 'submit form', index: 4 },
      }),
    ).resolves.toMatchObject({
      attempt: { state: 'uncertain' },
      actionResult: { error: 'commit transport failed' },
    });
    expect(persistedStates).toEqual(['proposed', 'approved', 'executing', 'uncertain']);
  });

  it('rejects mutate when claimed pageRevision is stale (product/007)', async () => {
    const execute = vi.fn(async () => new ActionResult({ success: true }));
    const action = new Action(execute, clickElementActionSchema, true);
    const dispatcher = new ActionDispatcher({
      now: () => 100,
      persistAttempt: vi.fn(async () => undefined),
      requestApproval: vi.fn(async () => 'approved' as const),
      observe: vi.fn(async () => ({
        target: {
          id: 'target-1',
          kind: 'element' as const,
          tabId: 7,
          frameId: 0 as const,
          urlOrigin: 'https://example.test',
          digest: 'button-1',
        },
        effectTarget: { tag: 'button', type: 'submit', inForm: true },
        evidence: [],
        pageRevision: '7|https://example.test|button-1',
      })),
    });

    const result = await dispatcher.dispatch({
      taskId: 'task-1',
      roundId: 'round-1',
      action,
      rawArgs: {
        intent: 'submit form',
        index: 4,
        pageRevision: '7|https://example.test|stale-dom',
      },
    });

    expect(result.attempt.state).toBe('blocked');
    expect(result.actOutcome).toBe('didnt');
    expect(result.actionResult.error).toMatch(/pageRevision/i);
    expect(execute).not.toHaveBeenCalled();
  });

  it('marks successful external_commit without expect as unknown (product/007)', async () => {
    const execute = vi.fn(async () => new ActionResult({ success: true }));
    const action = new Action(execute, clickElementActionSchema, true);
    const dispatcher = new ActionDispatcher({
      now: () => 100,
      persistAttempt: vi.fn(async () => undefined),
      requestApproval: vi.fn(async () => 'approved' as const),
      observe: vi.fn(async () => ({
        target: {
          id: 'target-1',
          kind: 'element' as const,
          tabId: 7,
          frameId: 0 as const,
          urlOrigin: 'https://example.test',
          digest: 'button-1',
        },
        effectTarget: { tag: 'button', type: 'submit', inForm: true },
        evidence: [],
      })),
    });

    const result = await dispatcher.dispatch({
      taskId: 'task-1',
      roundId: 'round-1',
      action,
      rawArgs: { intent: 'submit form', index: 4 },
    });

    expect(result.attempt.state).toBe('observed');
    expect(result.actOutcome).toBe('unknown');
    expect(result.pageRevision).toContain('button-1');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does not mark an external commit error result as observed', async () => {
    const action = new Action(
      vi.fn(async () => new ActionResult({ error: 'outcome unknown' })),
      clickElementActionSchema,
      true,
    );
    const persistedStates: string[] = [];
    const dispatcher = new ActionDispatcher({
      now: () => 100,
      persistAttempt: vi.fn(async attempt => {
        persistedStates.push(attempt.state);
      }),
      requestApproval: vi.fn(async () => 'approved' as const),
      observe: vi.fn(async () => ({
        target: {
          id: 'target-1',
          kind: 'element' as const,
          tabId: 7,
          frameId: 0 as const,
          urlOrigin: 'https://example.test',
          digest: 'button-1',
        },
        effectTarget: { tag: 'button', type: 'submit', inForm: true },
        evidence: [],
      })),
    });

    const result = await dispatcher.dispatch({
      taskId: 'task-1',
      roundId: 'round-1',
      action,
      rawArgs: { intent: 'submit form', index: 4 },
    });

    expect(result.attempt.state).toBe('uncertain');
    expect(persistedStates).toEqual(['proposed', 'approved', 'executing', 'uncertain']);
  });

});
