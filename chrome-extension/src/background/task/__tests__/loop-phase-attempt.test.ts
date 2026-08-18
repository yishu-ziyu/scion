import { describe, expect, it } from 'vitest';
import {
  OBSERVE_PHASE_SUMMARY,
  attemptsAfterLoopPhase,
  completeObservePhaseAttempt,
  createObservePhaseAttempt,
  isLiveObserveAttempt,
} from '../loop-phase-attempt';

describe('loop-phase-attempt', () => {
  it('creates a live 获取页面快照 step', () => {
    const attempt = createObservePhaseAttempt('round-1', 100, 0);
    expect(attempt).toMatchObject({
      roundId: 'round-1',
      actionName: 'observe',
      effect: 'read',
      displaySummary: OBSERVE_PHASE_SUMMARY,
      state: 'executing',
      proposedAt: 100,
      executingAt: 100,
    });
    expect(isLiveObserveAttempt(attempt)).toBe(true);
    expect(isLiveObserveAttempt(completeObservePhaseAttempt(attempt, 200))).toBe(false);
  });

  it('does not add a second observe while one is already live', () => {
    const first = createObservePhaseAttempt('round-1', 100, 0);
    const { next, changed } = attemptsAfterLoopPhase({
      attempts: [first],
      phase: 'observe',
      step: 0,
      roundId: 'round-1',
      now: 150,
    });
    expect(changed).toEqual([]);
    expect(next).toHaveLength(1);
    expect(next[0]?.id).toBe(first.id);
  });

  it('marks the snapshot done when the model starts deciding', () => {
    const live = createObservePhaseAttempt('round-1', 100, 0);
    const { next, changed } = attemptsAfterLoopPhase({
      attempts: [live],
      phase: 'decide',
      step: 0,
      roundId: 'round-1',
      now: 180,
    });
    expect(changed).toEqual([expect.objectContaining({ id: live.id, state: 'observed', observedAt: 180 })]);
    expect(next[0]?.state).toBe('observed');
  });

  it('starts a new snapshot after an act', () => {
    const live = createObservePhaseAttempt('round-1', 100, 0);
    const { next } = attemptsAfterLoopPhase({
      attempts: [live],
      phase: 'reobserve',
      step: 1,
      roundId: 'round-1',
      now: 220,
    });
    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({ id: live.id, state: 'observed', observedAt: 220 });
    expect(next[1]).toMatchObject({ actionName: 'observe', state: 'executing', displaySummary: OBSERVE_PHASE_SUMMARY });
  });
});
