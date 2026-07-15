import { describe, expect, it } from 'vitest';
import type { ActionAttempt, CompletionReceipt } from '@extension/storage';
import {
  TASK_OUTCOME_RATING_LABELS,
  defaultStepsExpanded,
  isMachinePrimaryCopy,
  ratingStorageKey,
  shouldShowExecutionSteps,
  shouldShowOutcomeRating,
  shouldShowVerifiedDone,
} from '../task-loop-ui';

const receipt = { id: 'rcpt_demo_1', verifiedAt: 1 } as CompletionReceipt;
const attempt = { id: 'a1', actionName: 'go_to_url', state: 'observed' } as ActionAttempt;

describe('Feature: Tabbit-class task loop UI (ticket 01, seam S1)', () => {
  it('shows verified done only when completion receipt exists', () => {
    expect(shouldShowVerifiedDone(undefined)).toBe(false);
    expect(shouldShowVerifiedDone(null)).toBe(false);
    expect(shouldShowVerifiedDone(receipt)).toBe(true);
  });

  it('offers outcome rating only after verified done', () => {
    expect(shouldShowOutcomeRating(undefined)).toBe(false);
    expect(shouldShowOutcomeRating(receipt)).toBe(true);
  });

  it('rating labels match Tabbit-class copy (success / partial / fail)', () => {
    expect(TASK_OUTCOME_RATING_LABELS.success).toBe('成功交付');
    expect(TASK_OUTCOME_RATING_LABELS.partial).toBe('部分完成');
    expect(TASK_OUTCOME_RATING_LABELS.fail).toBe('未完成');
  });

  it('shows execution steps when attempts exist', () => {
    expect(shouldShowExecutionSteps([])).toBe(false);
    expect(shouldShowExecutionSteps([attempt])).toBe(true);
  });

  it('defaults steps expanded while running, collapsible after terminal', () => {
    expect(defaultStepsExpanded('running')).toBe(true);
    expect(defaultStepsExpanded('waiting_approval')).toBe(true);
    expect(defaultStepsExpanded('completed')).toBe(false);
  });

  it('rejects machine tokens as primary user copy', () => {
    expect(isMachinePrimaryCopy('step_failed')).toBe(true);
    expect(isMachinePrimaryCopy('Navigator failed')).toBe(true);
    expect(isMachinePrimaryCopy('打开页面')).toBe(false);
  });

  it('rates per receipt id', () => {
    expect(ratingStorageKey('rcpt_demo_1')).toBe('chijie.taskOutcomeRating.rcpt_demo_1');
  });
});
