import { describe, expect, it } from 'vitest';
import type { ActionAttempt, CompletionReceipt, TaskSnapshot } from '@extension/storage';
import {
  defaultStepsExpanded,
  isMachinePrimaryCopy,
  observedAttemptCount,
  ratingStorageKey,
  shouldShowExecutionSteps,
  shouldShowOutcomeRating,
  shouldShowVerifiedDone,
  taskPrimaryOrganism,
  visibleAttemptWindow,
} from '../task-loop-ui';

const receipt: CompletionReceipt = {
  id: 'rcpt_demo_1',
  taskId: 'task-1',
  roundId: 'round-1',
  verifiedAt: 2,
  criterionIds: ['criterion-1'],
  evidenceDigests: ['digest-1'],
};
const completedSnapshot = {
  id: 'task-1',
  status: 'completed',
  currentRoundId: 'round-1',
  rounds: [
    {
      id: 'round-1',
      status: 'completed',
      criteria: [
        {
          id: 'criterion-1',
          roundId: 'round-1',
          targetRefId: 'target-1',
          required: true,
        },
      ],
      evidence: [
        {
          criterionId: 'criterion-1',
          roundId: 'round-1',
          targetRefId: 'target-1',
          passed: true,
        },
      ],
      receipt,
    },
  ],
} as TaskSnapshot;
const attempt = { id: 'a1', actionName: 'go_to_url', state: 'observed' } as ActionAttempt;

describe('Feature: Tabbit-class task loop UI (ticket 01, seam S1)', () => {
  it('shows verified done only when completion receipt exists', () => {
    expect(shouldShowVerifiedDone({ ...completedSnapshot, status: 'running' }, receipt)).toBe(false);
    expect(shouldShowVerifiedDone(completedSnapshot, undefined)).toBe(false);
    expect(shouldShowVerifiedDone(completedSnapshot, null)).toBe(false);
    expect(shouldShowVerifiedDone(completedSnapshot, receipt)).toBe(true);
  });

  it('offers outcome rating only after verified done', () => {
    expect(shouldShowOutcomeRating({ ...completedSnapshot, status: 'running' }, receipt)).toBe(false);
    expect(shouldShowOutcomeRating(completedSnapshot, undefined)).toBe(false);
    expect(shouldShowOutcomeRating(completedSnapshot, receipt)).toBe(true);
  });

  it('rejects mismatched or unsupported receipts even when task status says completed', () => {
    expect(shouldShowVerifiedDone(completedSnapshot, { ...receipt, taskId: 'other-task' })).toBe(false);
    expect(shouldShowVerifiedDone(completedSnapshot, { ...receipt, roundId: 'other-round' })).toBe(false);
    expect(
      shouldShowVerifiedDone(
        {
          ...completedSnapshot,
          rounds: [{ ...completedSnapshot.rounds[0], evidence: [] }],
        },
        receipt,
      ),
    ).toBe(false);
  });

  it('shows execution steps when attempts exist', () => {
    expect(shouldShowExecutionSteps([])).toBe(false);
    expect(shouldShowExecutionSteps([attempt])).toBe(true);
  });

  it('defaults steps expanded only while running so terminal cards stay short', () => {
    expect(defaultStepsExpanded('running')).toBe(true);
    expect(defaultStepsExpanded('waiting_approval')).toBe(false);
    // design/004: terminal collapses steps by default; chat must keep height.
    expect(defaultStepsExpanded('completed')).toBe(false);
    expect(defaultStepsExpanded('failed')).toBe(false);
  });

  it('picks feature-first primary organism for goal-directed reading order', () => {
    expect(taskPrimaryOrganism({ status: 'waiting_approval', hasPendingApproval: true })).toBe('approval');
    expect(taskPrimaryOrganism({ status: 'running' })).toBe('activity');
    expect(taskPrimaryOrganism({ status: 'completed', showVerifiedDone: true })).toBe('completion');
    expect(taskPrimaryOrganism({ status: 'waiting_user' })).toBe('recovery');
    expect(taskPrimaryOrganism({ status: 'paused' })).toBe('idle');
  });

  it('rejects machine tokens as primary user copy', () => {
    expect(isMachinePrimaryCopy('step_failed')).toBe(true);
    expect(isMachinePrimaryCopy('Navigator failed')).toBe(true);
    expect(isMachinePrimaryCopy('no_progress after act')).toBe(true);
    expect(isMachinePrimaryCopy('pageRevision stale')).toBe(true);
    expect(isMachinePrimaryCopy('打开页面')).toBe(false);
  });

  it('rates per receipt id', () => {
    expect(ratingStorageKey('rcpt_demo_1')).toBe('chijie.taskOutcomeRating.rcpt_demo_1');
  });

  it('counts only observed attempts as completed work', () => {
    expect(
      observedAttemptCount([
        attempt,
        { ...attempt, id: 'a2', state: 'approved' },
        { ...attempt, id: 'a3', state: 'executing' },
      ]),
    ).toBe(1);
  });

  it('keeps active task history compact but preserves terminal evidence', () => {
    const attempts = Array.from({ length: 5 }, (_, index) => ({ ...attempt, id: `a${index + 1}` }));
    expect(visibleAttemptWindow(attempts, 'running').map(item => item.id)).toEqual(['a3', 'a4', 'a5']);
    expect(visibleAttemptWindow(attempts, 'completed')).toHaveLength(5);
  });
});
