import { describe, expect, it, vi } from 'vitest';
import type { TaskSession } from '@extension/storage/lib/task';
import { Action } from '../../agent/actions/builder';
import { closeTabActionSchema, controlMediaActionSchema } from '../../agent/actions/schemas';
import { ActionResult } from '../../agent/types';
import { ActionDispatcher } from '../action-dispatcher';
import { resolveMediaArgs, resolveTabArgs } from '../media';
import { checkCompletion } from '../completion';

describe('continuous media control', () => {
  it('binds pause to the last played media target', async () => {
    let state: 'playing' | 'paused' = 'paused';
    const page = {
      observeMedia: vi.fn(async () => ({ kind: 'bound' as const, targetDigest: 'media-1', state })),
      controlMedia: vi.fn(async (command: 'play' | 'pause', digest?: string) => {
        expect(digest === undefined || digest === 'media-1').toBe(true);
        state = command === 'play' ? 'playing' : 'paused';
        return { kind: 'bound' as const, targetDigest: 'media-1', state };
      }),
    };
    const action = new Action(async args => {
      await page.controlMedia(args.command, args.target_digest);
      return new ActionResult({ success: true });
    }, controlMediaActionSchema);
    const dispatcher = new ActionDispatcher({
      now: () => 100,
      persistAttempt: vi.fn(),
      requestApproval: vi.fn(async () => 'approved' as const),
      observe: vi.fn(async (request, _args, phase) => {
        const observed = await page.observeMedia();
        return {
          target: {
            id: 'media-target',
            kind: 'media' as const,
            tabId: 7,
            frameId: 0 as const,
            urlOrigin: 'https://example.test',
            digest: observed.targetDigest,
          },
          effectTarget: { tag: 'video' },
          evidence:
            phase === 'after'
              ? [
                  {
                    criterionId: `criterion-${request.roundId}`,
                    roundId: request.roundId,
                    targetRefId: 'media-target',
                    observedAt: 100,
                    source: 'page' as const,
                    value: observed.state,
                    passed: true,
                  },
                ]
              : [],
        };
      }),
    });

    const played = await dispatcher.dispatch({
      taskId: 'task-1',
      roundId: 'round-1',
      action,
      rawArgs: { intent: 'play selected media', command: 'play' },
    });
    expect(played.attempt.effect).toBe('reversible');
    const paused = await dispatcher.dispatch({
      taskId: 'task-1',
      roundId: 'round-2',
      action,
      rawArgs: { intent: 'pause the same media', command: 'pause', target_digest: played.targetRef?.digest },
    });

    expect(page.controlMedia).toHaveBeenCalledWith('pause', 'media-1');
    expect(paused).toMatchObject({
      targetRef: { digest: 'media-1' },
      evidence: [{ value: 'paused', roundId: 'round-2' }],
    });
  });

  it('play then pause reuses the same digest via resolveMediaArgs across rounds', () => {
    const task = {
      targetRefs: [] as TaskSession['targetRefs'],
    } as TaskSession;

    const playReady = resolveMediaArgs('control_media', { command: 'play' }, task);
    expect(playReady).toMatchObject({ kind: 'ready', args: { command: 'play' } });

    task.targetRefs.push({
      id: 'media:media-1',
      kind: 'media',
      tabId: 7,
      frameId: 0,
      urlOrigin: 'https://example.test',
      digest: 'media-1',
    });

    const pauseReady = resolveMediaArgs('control_media', { command: 'pause' }, task);
    expect(pauseReady).toMatchObject({
      kind: 'ready',
      args: { command: 'pause', target_digest: 'media-1' },
    });
  });

  it('rebinds an omitted media digest from the latest stored media target', () => {
    const rebound = resolveMediaArgs('control_media', { command: 'pause' }, {
      targetRefs: [
        {
          id: 'media-target',
          kind: 'media',
          tabId: 7,
          frameId: 0,
          urlOrigin: 'https://example.test',
          digest: 'media-1',
        },
      ],
    } as TaskSession);

    expect(rebound).toMatchObject({ kind: 'ready', args: { target_digest: 'media-1' } });
  });

  it('verifies media state only for the current bound digest after the command boundary', () => {
    const criterion = {
      id: 'media-state',
      kind: 'media_state' as const,
      operator: 'equals' as const,
      expected: 'paused' as const,
      required: true,
      roundId: 'round-2',
      targetRefId: 'media:media-1',
      baseline: 'playing',
      frozenAt: 100,
      notBefore: 150,
      timeoutMs: 10_000,
    };
    const observation = {
      criterionId: criterion.id,
      roundId: criterion.roundId,
      targetRefId: criterion.targetRefId,
      observedAt: 160,
      source: 'page' as const,
      value: 'paused',
    };

    expect(
      checkCompletion({
        now: 160,
        currentRoundId: criterion.roundId,
        criteria: [criterion],
        observations: [observation],
      }),
    ).toMatchObject({ passed: true });
    expect(
      checkCompletion({
        now: 160,
        currentRoundId: criterion.roundId,
        criteria: [criterion],
        observations: [{ ...observation, targetRefId: 'media:media-2' }],
      }),
    ).toMatchObject({ passed: false, evidence: [{ reason: 'wrong_target' }] });
  });
});

describe('tab close control + evidence', () => {
  it('defaults close_tab to the task active tab when tab_id is omitted', () => {
    const resolved = resolveTabArgs(
      'close_tab',
      { intent: 'close this page' },
      { activeTabId: 42, targetRefs: [] } as unknown as TaskSession,
    );
    expect(resolved).toMatchObject({ tab_id: 42 });
  });

  it('maps focus_tab args onto the task tab when tab_id is omitted', () => {
    const resolved = resolveTabArgs(
      'focus_tab',
      {},
      { activeTabId: 9, targetRefs: [] } as unknown as TaskSession,
    );
    expect(resolved).toMatchObject({ tab_id: 9 });
  });

  it('dispatches close_tab and records closed tab evidence after act', async () => {
    const closed = new Set<number>();
    const action = new Action(async (input: { tab_id?: number }) => {
      const tabId = input.tab_id ?? 7;
      closed.add(tabId);
      return new ActionResult({ success: true });
    }, closeTabActionSchema);
    const dispatcher = new ActionDispatcher({
      now: () => 200,
      persistAttempt: vi.fn(),
      requestApproval: vi.fn(async () => 'approved' as const),
      observe: vi.fn(async (request, parsedArgs, phase) => {
        const tabId =
          parsedArgs && typeof parsedArgs === 'object' && 'tab_id' in parsedArgs
            ? Number((parsedArgs as { tab_id: number }).tab_id)
            : 7;
        const isClosed = closed.has(tabId);
        return {
          target: {
            id: `tab-${tabId}`,
            kind: 'page' as const,
            tabId,
            frameId: 0 as const,
            urlOrigin: 'https://example.test',
            digest: `tab-${tabId}`,
          },
          effectTarget: { tag: 'tab' },
          evidence:
            phase === 'after'
              ? [
                  {
                    criterionId: `tab-state:${request.roundId}`,
                    roundId: request.roundId,
                    targetRefId: `tab-${tabId}`,
                    observedAt: 200,
                    source: 'page' as const,
                    value: isClosed ? 'closed' : 'active',
                    passed: isClosed,
                  },
                ]
              : [],
        };
      }),
    });

    const result = await dispatcher.dispatch({
      taskId: 'task-close',
      roundId: 'round-close',
      action,
      rawArgs: { intent: 'close this page', tab_id: 7 },
    });

    expect(closed.has(7)).toBe(true);
    expect(result.evidence).toEqual([
      expect.objectContaining({ value: 'closed', passed: true, targetRefId: 'tab-7' }),
    ]);
  });

  it('verifies tab_state closed only with matching target evidence', () => {
    const criterion = {
      id: 'tab-closed',
      kind: 'tab_state' as const,
      operator: 'equals' as const,
      expected: 'closed' as const,
      required: true,
      roundId: 'round-1',
      targetRefId: 'tab-7',
      baseline: 'active',
      frozenAt: 100,
      notBefore: 100,
      timeoutMs: 10_000,
    };
    expect(
      checkCompletion({
        now: 200,
        currentRoundId: 'round-1',
        criteria: [criterion],
        observations: [
          {
            criterionId: criterion.id,
            roundId: 'round-1',
            targetRefId: 'tab-7',
            observedAt: 200,
            source: 'page',
            value: 'closed',
          },
        ],
      }),
    ).toMatchObject({ passed: true });
    expect(
      checkCompletion({
        now: 200,
        currentRoundId: 'round-1',
        criteria: [criterion],
        observations: [
          {
            criterionId: criterion.id,
            roundId: 'round-1',
            targetRefId: 'tab-7',
            observedAt: 200,
            source: 'page',
            value: 'active',
          },
        ],
      }),
    ).toMatchObject({ passed: false, evidence: [{ reason: 'mismatch' }] });
  });
});

describe('download evidence completion surface', () => {
  it('never passes download_state finished without finished observation', () => {
    const criterion = {
      id: 'dl-1',
      kind: 'download_state' as const,
      operator: 'equals' as const,
      expected: 'finished' as const,
      required: true,
      roundId: 'round-1',
      targetRefId: 'download:session',
      baseline: 'none',
      frozenAt: 100,
      notBefore: 100,
      timeoutMs: 10_000,
    };
    expect(
      checkCompletion({
        now: 200,
        currentRoundId: 'round-1',
        criteria: [criterion],
        observations: [],
      }).passed,
    ).toBe(false);
    expect(
      checkCompletion({
        now: 200,
        currentRoundId: 'round-1',
        criteria: [criterion],
        observations: [
          {
            criterionId: criterion.id,
            roundId: 'round-1',
            targetRefId: 'download:session',
            observedAt: 200,
            source: 'page',
            value: 'none',
          },
        ],
      }),
    ).toMatchObject({ passed: false, evidence: [{ reason: 'mismatch' }] });
    expect(
      checkCompletion({
        now: 200,
        currentRoundId: 'round-1',
        criteria: [criterion],
        observations: [
          {
            criterionId: criterion.id,
            roundId: 'round-1',
            targetRefId: 'download:session',
            observedAt: 200,
            source: 'page',
            value: 'finished',
          },
        ],
      }).passed,
    ).toBe(true);
  });
});
