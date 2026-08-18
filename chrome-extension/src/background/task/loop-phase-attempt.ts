/**
 * Turn observe/decide/reobserve loop phases into live 执行步骤 rows
 * before the first dispatchAction. Side panel stays empty until then.
 */
import type { ActionAttempt } from '@extension/storage/lib/task';

export type LoopPhaseName = 'observe' | 'decide' | 'act' | 'reobserve';

export const OBSERVE_PHASE_SUMMARY = '获取页面快照';

export function createObservePhaseAttempt(roundId: string, now: number, step = 0): ActionAttempt {
  return {
    id: crypto.randomUUID(),
    roundId,
    actionName: 'observe',
    effect: 'read',
    argsDigest: `loop-phase:observe:${step}`,
    displaySummary: OBSERVE_PHASE_SUMMARY,
    state: 'executing',
    proposedAt: now,
    executingAt: now,
  };
}

export function isLiveObserveAttempt(attempt: ActionAttempt | undefined): boolean {
  if (!attempt || attempt.actionName !== 'observe') return false;
  return attempt.state === 'executing' || attempt.state === 'proposed' || attempt.state === 'authorized';
}

export function completeObservePhaseAttempt(attempt: ActionAttempt, now: number): ActionAttempt {
  return { ...attempt, state: 'observed', observedAt: now };
}

export function attemptsAfterLoopPhase(input: {
  attempts: ActionAttempt[];
  phase: LoopPhaseName;
  step: number;
  roundId: string;
  now: number;
}): { next: ActionAttempt[]; changed: ActionAttempt[] } {
  const next = input.attempts.map(attempt => ({ ...attempt }));
  const changed: ActionAttempt[] = [];
  const liveIndexes = next
    .map((attempt, index) => (isLiveObserveAttempt(attempt) ? index : -1))
    .filter(index => index >= 0);

  const completeLive = () => {
    for (const index of liveIndexes) {
      const completed = completeObservePhaseAttempt(next[index]!, input.now);
      next[index] = completed;
      changed.push(completed);
    }
  };

  if (input.phase === 'observe') {
    if (liveIndexes.length === 0) {
      const created = createObservePhaseAttempt(input.roundId, input.now, input.step);
      next.push(created);
      changed.push(created);
    }
    return { next, changed };
  }

  if (input.phase === 'reobserve') {
    completeLive();
    const created = createObservePhaseAttempt(input.roundId, input.now, input.step);
    next.push(created);
    changed.push(created);
    return { next, changed };
  }

  completeLive();
  return { next, changed };
}
