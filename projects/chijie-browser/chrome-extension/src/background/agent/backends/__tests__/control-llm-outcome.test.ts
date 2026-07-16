import { describe, expect, it } from 'vitest';
import { CONTROL_MAX_NO_PROGRESS, mapLoopOutcomeToExecutor } from '../control-llm';
import type { LoopOutcome } from '../observe-act-loop';

describe('control-llm outcome mapping (contracts 010/011 harden)', () => {
  it('exposes explicit no-progress budget', () => {
    expect(CONTROL_MAX_NO_PROGRESS).toBe(3);
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
