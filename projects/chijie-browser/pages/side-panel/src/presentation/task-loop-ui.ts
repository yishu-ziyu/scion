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
 * User can still expand the step list.
 */
export function defaultStepsExpanded(status: string): boolean {
  return status === 'running';
}

/**
 * Statuses that keep the main side panel in a live task workspace.
 * Terminal statuses (completed / failed / cancelled) stay persisted in history
 * but must not own the default main surface — that surface returns to idle.
 */
export const ACTIVE_TASK_STATUSES: readonly TaskStatus[] = [
  'running',
  'paused',
  'waiting_user',
  'inputs_required',
  'interrupted',
] as const;

/** True while the agent still needs the main task card + live log. */
export function isActiveTaskStatus(status: TaskStatus | string | null | undefined): boolean {
  if (!status) return false;
  return (ACTIVE_TASK_STATUSES as readonly string[]).includes(status);
}

/** Terminal snapshots belong to history and must never reclaim an explicit fresh chat. */
export function shouldAutoRestoreTaskSession(input: {
  status: TaskStatus | string | null | undefined;
  taskChatSessionId: string | null | undefined;
  currentSessionId: string | null | undefined;
}): boolean {
  return (
    isActiveTaskStatus(input.status) &&
    Boolean(input.taskChatSessionId) &&
    input.taskChatSessionId !== input.currentSessionId
  );
}

/**
 * Main workspace shows task card + live chat only for an active task,
 * or when the user explicitly opened a historical session.
 * Completed snapshots remain in storage; they are not the default home view.
 */
export function shouldShowMainTaskSurface(input: {
  status: TaskStatus | string | null | undefined;
  isHistoricalSession: boolean;
}): boolean {
  if (input.isHistoricalSession) return true;
  return isActiveTaskStatus(input.status);
}

/**
 * Which surface owns the task card for goal-directed reading order.
 * status → goal → (activity | completion | recovery) → steps → chat.
 */
export function taskPrimaryOrganism(input: {
  status: string;
  showVerifiedDone?: boolean;
}): 'activity' | 'completion' | 'recovery' | 'idle' {
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

/** Only page-observed outcomes count as completed work. */
export function observedAttemptCount(attempts: ActionAttempt[] | undefined | null): number {
  return attempts?.filter(attempt => attempt.state === 'observed').length ?? 0;
}

/** Keep active tasks scannable while retaining the complete audit trail once terminal. */
export function visibleAttemptWindow(attempts: ActionAttempt[], status: TaskStatus): ActionAttempt[] {
  if (['completed', 'failed', 'cancelled'].includes(status)) return attempts;
  return attempts.slice(-3);
}
