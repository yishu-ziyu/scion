/**
 * Pure presentation helpers for Tabbit-class agent task loop UI (ticket 01).
 * Seam S1 — no backend imports required for unit tests.
 */

import type { ActionAttempt, CompletionReceipt } from '@extension/storage';

export type TaskOutcomeRating = 'success' | 'partial' | 'fail';

export const TASK_OUTCOME_RATING_LABELS: Record<TaskOutcomeRating, string> = {
  success: '成功交付',
  partial: '部分完成',
  fail: '未完成',
};

/** Show verified-done block only when a completion receipt exists. */
export function shouldShowVerifiedDone(receipt: CompletionReceipt | undefined | null): boolean {
  return Boolean(receipt?.id);
}

/** Rating is offered only after verified completion. */
export function shouldShowOutcomeRating(receipt: CompletionReceipt | undefined | null): boolean {
  return shouldShowVerifiedDone(receipt);
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
  return !['completed', 'failed', 'cancelled'].includes(status);
}

export function isMachinePrimaryCopy(text: string): boolean {
  return /\b(step_failed|Planner|Navigator|PLANNER|NAVIGATOR)\b/i.test(text);
}

export function ratingStorageKey(receiptId: string): string {
  return `chijie.taskOutcomeRating.${receiptId}`;
}
