/**
 * Pure presentation helpers for Tabbit-class agent task loop UI (ticket 01).
 * Seam S1 — no backend imports required for unit tests.
 */

import type { ActionAttempt, CompletionReceipt, TaskSnapshot, TaskStatus } from '@extension/storage';

export type TaskOutcomeRating = 'success' | 'partial' | 'fail';

/** A model saying "done" is insufficient; require a receipt that matches the completed round and its evidence. */
export function shouldShowVerifiedDone(snapshot: TaskSnapshot, receipt: CompletionReceipt | undefined | null): boolean {
  if (snapshot.status !== 'completed' || !receipt?.id) return false;
  const round = snapshot.rounds.find(item => item.id === snapshot.currentRoundId);
  if (!round || round.status !== 'completed' || !round.receipt) return false;
  if (receipt.taskId !== snapshot.id || receipt.roundId !== round.id) return false;
  if (round.receipt.id !== receipt.id || round.receipt.taskId !== snapshot.id || round.receipt.roundId !== round.id) {
    return false;
  }

  const requiredCriteria = round.criteria.filter(criterion => criterion.required);
  if (requiredCriteria.length === 0 || receipt.evidenceDigests.length < requiredCriteria.length) return false;
  const receiptCriterionIds = new Set(receipt.criterionIds);
  return requiredCriteria.every(
    criterion =>
      receiptCriterionIds.has(criterion.id) &&
      round.evidence.some(
        evidence =>
          evidence.passed &&
          !evidence.reason &&
          evidence.criterionId === criterion.id &&
          evidence.roundId === round.id &&
          evidence.targetRefId === criterion.targetRefId,
      ),
  );
}

/** Rating is offered only after verified completion. */
export function shouldShowOutcomeRating(
  snapshot: TaskSnapshot,
  receipt: CompletionReceipt | undefined | null,
): boolean {
  return shouldShowVerifiedDone(snapshot, receipt);
}

/** Steps panel is shown when there is at least one action attempt. */
export function shouldShowExecutionSteps(attempts: ActionAttempt[] | undefined | null): boolean {
  return Array.isArray(attempts) && attempts.length > 0;
}

/**
 * Default expanded when the task is still active; collapsed OK after terminal.
 * Caller may override with user toggle.
 */
export function defaultStepsExpanded(status: string): boolean {
  return status === 'running';
}

export function isMachinePrimaryCopy(text: string): boolean {
  return /\b(step_failed|Planner|Navigator|PLANNER|NAVIGATOR)\b/i.test(text);
}

export function ratingStorageKey(receiptId: string): string {
  return `chijie.taskOutcomeRating.${receiptId}`;
}

/** Only page-observed outcomes count as completed work. Approval is permission, not evidence. */
export function observedAttemptCount(attempts: ActionAttempt[] | undefined | null): number {
  return attempts?.filter(attempt => attempt.state === 'observed').length ?? 0;
}

/** Keep active tasks scannable while retaining the complete audit trail once terminal. */
export function visibleAttemptWindow(attempts: ActionAttempt[], status: TaskStatus): ActionAttempt[] {
  if (['completed', 'failed', 'cancelled'].includes(status)) return attempts;
  return attempts.slice(-3);
}
