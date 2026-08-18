import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { t } from '@extension/i18n';
import type { CompletionReceipt, TaskRound, TaskSnapshot } from '@extension/storage';
import { productFailureLabel } from '../../presentation/failure-taxonomy';
import { distinctFailureCategoryLabel, failureNextStep, TaskStatusCard } from '../TaskStatusCard';

function completedRound(id: string, receiptId: string): TaskRound {
  const criterionId = `criterion-${id}`;
  const receipt: CompletionReceipt = {
    id: receiptId,
    taskId: 'task-current',
    roundId: id,
    verifiedAt: 2,
    criterionIds: [criterionId],
    evidenceDigests: [`digest-${id}`],
  };
  return {
    id,
    instructionSummary: `Result for ${id}`,
    status: 'completed',
    commandAcks: {},
    criteria: [
      {
        id: criterionId,
        roundId: id,
        targetRefId: 'target-1',
        kind: 'page_text',
        operator: 'present',
        expectedDigest: 'expected-digest',
        required: true,
        frozenAt: 1,
        notBefore: 1,
        timeoutMs: 1_000,
        baseline: false,
      },
    ],
    attempts: [],
    evidence: [
      {
        criterionId,
        roundId: id,
        targetRefId: 'target-1',
        observedAt: 2,
        source: 'page',
        value: 'verified result',
        passed: true,
      },
    ],
    receipt,
  };
}

describe('TaskStatusCard identity markers', () => {
  it('binds the rendered card and receipt to the current task and round', () => {
    const oldRound = completedRound('round-old', 'receipt-old');
    const currentRound = completedRound('round-current', 'receipt-current');
    const snapshot = {
      id: 'task-current',
      goalSummary: 'Verify the current result',
      status: 'completed',
      revision: 3,
      activeTabId: 7,
      currentRoundId: currentRound.id,
      targetRefs: [],
      rounds: [oldRound, currentRound],
      createdAt: 1,
      updatedAt: 2,
    } satisfies TaskSnapshot;

    const html = renderToStaticMarkup(
      createElement(TaskStatusCard, {
        snapshot,
        send: vi.fn(),
        defaultInstruction: 'Verify the current result',
        readOnly: true,
      }),
    );

    expect(html).toMatch(
      /<section[^>]*data-testid="task-status"[^>]*data-task-id="task-current"[^>]*data-round-id="round-current"/,
    );
    expect(html).toMatch(/data-testid="completion-receipt"[^>]*data-receipt-id="receipt-current"/);
    expect(html).not.toContain('data-receipt-id="receipt-old"');
  });

  it('does not tell the user to rewrite the goal when page proof failed without a confirm button', () => {
    t.devLocale = 'zh_CN';
    const snapshot = {
      id: 'task-proof',
      goalSummary: '读当前页，一句主题，引用一处正文',
      status: 'waiting_user',
      revision: 2,
      activeTabId: 7,
      currentRoundId: 'round-1',
      targetRefs: [],
      rounds: [
        {
          id: 'round-1',
          instructionSummary: '好的，我读取当前页面并提取主题与正文引用。',
          status: 'waiting_user',
          commandAcks: {},
          criteria: [
            {
              id: 'criterion-1',
              roundId: 'round-1',
              targetRefId: 'target-1',
              kind: 'page_text',
              operator: 'present',
              expectedDigest: 'expected-digest',
              required: true,
              frozenAt: 1,
              notBefore: 1,
              timeoutMs: 1_000,
              baseline: false,
            },
          ],
          attempts: [],
          evidence: [],
          waitReason: 'proof_required',
        },
      ],
      createdAt: 1,
      updatedAt: 2,
    } satisfies TaskSnapshot;

    expect(failureNextStep(snapshot)).toBe(t('chat_task_fail_no_deliverable'));
    expect(failureNextStep(snapshot)).not.toBe(t('chat_task_fail_no_action'));
    expect(failureNextStep(snapshot)).not.toContain('把目标写具体');
  });

  it('does not repeat the same failure sentence as both hint and product label', () => {
    const label = productFailureLabel('target_missing');
    expect(distinctFailureCategoryLabel(label, 'target_missing')).toBeNull();
    expect(distinctFailureCategoryLabel('这次没跑通。改指令后重试，或点停止后开新任务。', 'target_missing')).toBe(
      label,
    );
  });
});
