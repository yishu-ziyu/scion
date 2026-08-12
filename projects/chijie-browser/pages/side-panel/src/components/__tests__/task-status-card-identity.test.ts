import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CompletionReceipt, TaskRound, TaskSnapshot } from '@extension/storage';
import { TaskStatusCard } from '../TaskStatusCard';

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
});
