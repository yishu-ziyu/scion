import { describe, expect, it, vi } from 'vitest';
import type { TaskSession } from '@extension/storage/lib/task';
import { Action } from '../../agent/actions/builder';
import { controlMediaActionSchema } from '../../agent/actions/schemas';
import { ActionResult } from '../../agent/types';
import { ActionDispatcher } from '../action-dispatcher';
import { resolveMediaArgs } from '../media';
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
