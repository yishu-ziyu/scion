import { describe, expect, it, vi } from 'vitest';
import {
  CONTROL_MAX_NO_PROGRESS,
  decideVisiblePageWithoutAction,
  invokeWithTimeout,
  mapLoopOutcomeToExecutor,
  readCurrentMissionContext,
  shouldKeepActionResultInContext,
} from '../control-llm';
import { resolveControlDelivery } from '../control-delivery';
import type { ExecutorMissionPlan } from '../../../task/contracts';
import type { LoopOutcome } from '../observe-act-loop';

describe('control-llm outcome mapping (contracts 010/011 harden)', () => {
  it('bounds a hung model invocation', async () => {
    await expect(invokeWithTimeout(() => new Promise(() => undefined), 5)).rejects.toThrow('llm_timeout');
  });

  it('exposes explicit no-progress budget', () => {
    expect(CONTROL_MAX_NO_PROGRESS).toBe(3);
  });

  it('reads the current mission phase on every decision instead of repeating the initial phase', async () => {
    let plan: ExecutorMissionPlan = {
      id: 'plan-1',
      goal: 'Research and report',
      phases: [
        { id: 'phase-1', title: 'Research', status: 'active' },
        { id: 'phase-2', title: 'Report', status: 'pending' },
      ],
    };
    const getMissionPlan = vi.fn(async () => plan);

    const firstDecision = await readCurrentMissionContext({ getMissionPlan }, 'round-1');
    plan = {
      ...plan,
      phases: [
        { id: 'phase-1', title: 'Research', status: 'completed' },
        { id: 'phase-2', title: 'Report', status: 'active' },
      ],
    };
    const secondDecision = await readCurrentMissionContext({ getMissionPlan }, 'round-1');

    expect(firstDecision.activePhaseId).toBe('phase-1');
    expect(firstDecision.planMemory).toContain('phase-1: Research [active]');
    expect(secondDecision.activePhaseId).toBe('phase-2');
    expect(secondDecision.planMemory).toContain('phase-1: Research [completed]');
    expect(secondDecision.planMemory).toContain('phase-2: Report [active]');
    expect(secondDecision.planMemory).not.toContain('phase-1: Research [active]');
    expect(getMissionPlan).toHaveBeenCalledTimes(2);
  });

  it('does not reuse a stale initial plan when the live hook is unavailable or rejects', async () => {
    const initialPlan: ExecutorMissionPlan = {
      id: 'plan-stale',
      goal: 'Old goal',
      phases: [{ id: 'phase-old', title: 'Old phase', status: 'active' }],
    };
    await expect(
      readCurrentMissionContext({ getMissionPlan: vi.fn(async () => undefined) }, 'round-stale', initialPlan),
    ).resolves.toEqual({ planMemory: '', activePhaseId: undefined });
    await expect(
      readCurrentMissionContext(
        { getMissionPlan: vi.fn(async () => Promise.reject(new Error('stale'))) },
        'round-stale',
        initialPlan,
      ),
    ).resolves.toEqual({ planMemory: '', activePhaseId: undefined });
  });

  it('keeps substantive read results in the next model turn', () => {
    expect(shouldKeepActionResultInContext('record_evidence')).toBe(true);
    expect(shouldKeepActionResultInContext('read_page_text')).toBe(true);
    expect(shouldKeepActionResultInContext('inspect_github_repository')).toBe(true);
    expect(shouldKeepActionResultInContext('click_element')).toBe(false);
  });

  it.each(['no_progress', 'max_steps'] as const)(
    'preserves stop category %s for TaskManager failureCategory',
    category => {
      const outcome: LoopOutcome = { kind: 'failed', category };
      expect(mapLoopOutcomeToExecutor(outcome)).toEqual({ kind: 'failed', category });
    },
  );

  it('does not rewrite other failed categories', () => {
    expect(mapLoopOutcomeToExecutor({ kind: 'failed', category: 'observe_failed' })).toEqual({
      kind: 'failed',
      category: 'observe_failed',
    });
  });

  it('does not treat a visible page with no action as no_action', () => {
    const delivery = resolveControlDelivery({
      done: false,
      observation: '',
      hasAction: false,
      hasPageBody: true,
    });
    expect(delivery.kind).toBe('retry');
    const next = decideVisiblePageWithoutAction(delivery.kind === 'retry' ? delivery.feedback : '');
    expect(next.decision).toEqual({ kind: 'recoverable', category: 'judge_retry' });
    expect(next.decision).not.toEqual({ kind: 'recoverable', category: 'no_action' });
    expect(mapLoopOutcomeToExecutor({ kind: 'failed', category: 'judge_retry' })).toEqual({
      kind: 'failed',
      category: 'judge_retry',
    });
  });

  it('maps empty category to unknown (not silent drop)', () => {
    expect(mapLoopOutcomeToExecutor({ kind: 'failed', category: '' })).toEqual({
      kind: 'failed',
      category: 'unknown',
    });
    expect(mapLoopOutcomeToExecutor({ kind: 'failed', category: '   ' })).toEqual({
      kind: 'failed',
      category: 'unknown',
    });
  });

  it('maps waiting_user without converting to failed', () => {
    expect(mapLoopOutcomeToExecutor({ kind: 'waiting_user', reason: 'login_required' })).toEqual({
      kind: 'waiting_user',
      reason: 'login_required',
    });
  });

  it('maps candidate_complete and cancelled', () => {
    expect(mapLoopOutcomeToExecutor({ kind: 'candidate_complete', summary: 'done' })).toEqual({
      kind: 'candidate_complete',
      summary: 'done',
    });
    expect(mapLoopOutcomeToExecutor({ kind: 'cancelled' })).toEqual({ kind: 'cancelled' });
  });
});
