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
 * Default expanded while the agent is actively moving; collapse after terminal
 * so the chat/composer keep a real reading area (design/004 layout contract).
 * waiting_approval also collapses — approval card must dominate (design/005 P6).
 * User can still expand the step list.
 */
export function defaultStepsExpanded(status: string): boolean {
  return status === 'running';
}

/**
 * Which surface owns the task card for goal-directed reading order.
 * status → goal → (approval | activity | completion | recovery) → steps → chat.
 */
export function taskPrimaryOrganism(input: {
  status: string;
  hasPendingApproval?: boolean;
  showVerifiedDone?: boolean;
}): 'approval' | 'activity' | 'completion' | 'recovery' | 'idle' {
  if (input.status === 'waiting_approval' && input.hasPendingApproval !== false) {
    return 'approval';
  }
  if (input.showVerifiedDone) return 'completion';
  if (input.status === 'running') return 'activity';
  if (
    input.status === 'waiting_user' ||
    input.status === 'inputs_required' ||
    input.status === 'failed' ||
    input.status === 'interrupted' ||
    input.status === 'cancelled'
  ) {
    return 'recovery';
  }
  return 'idle';
}

/**
 * True if copy is engineer-primary (presentation leakage).
 * Keep in sync with product/014 Part C and failure-taxonomy isEngineerFailureNoise.
 */
export function isMachinePrimaryCopy(text: string): boolean {
  return /\b(step_failed|Planner|Navigator|PLANNER|NAVIGATOR|observe_failed|json_parse_failed|no_progress|ExecutorDriver|pageRevision|failure_class|false_complete|wrong_tab|attach_mode|llm_failed|control_script_exhausted)\b/i.test(
    text,
  );
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
