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

  it('running card is a live tool log, not a collapsed audit or empty result', () => {
    const snapshot = {
      id: 'task-live',
      goalSummary: 'User task',
      chatSessionId: 'chat-1',
      instructionMessageId: 'message-1',
      status: 'running',
      revision: 2,
      activeTabId: 7,
      currentRoundId: 'round-1',
      targetRefs: [
        {
          id: 'page-1',
          kind: 'page',
          tabId: 7,
          frameId: 0,
          urlOrigin: 'https://www.etsy.com',
          digest: 'digest',
        },
      ],
      rounds: [
        {
          id: 'round-1',
          instructionSummary: 'User task',
          status: 'running',
          commandAcks: {},
          criteria: [],
          attempts: [
            {
              id: 'attempt-1',
              roundId: 'round-1',
              actionName: 'go_to_url',
              effect: 'read',
              argsDigest: 'args',
              displaySummary: '打开 etsy.com',
              targetLabel: 'etsy.com',
              state: 'executing',
              proposedAt: 1,
              executingAt: 2,
            },
          ],
          evidence: [],
        },
      ],
      createdAt: 1,
      updatedAt: 3,
    } satisfies TaskSnapshot;

    const html = renderToStaticMarkup(
      createElement(TaskStatusCard, {
        snapshot,
        send: vi.fn(),
        defaultInstruction: '打开 etsy 搜相框，抽出前 5 个商品写进表格',
        onStop: vi.fn(),
      }),
    );

    expect(html).toContain('chijie-user-bubble');
    expect(html).toContain('打开 etsy 搜相框，抽出前 5 个商品写进表格');
    expect(html).toContain('data-live-log="true"');
    expect(html).toContain('data-testid="live-tool-log"');
    expect(html).toContain('data-testid="live-cursor"');
    expect(html).toContain('data-testid="live-stop-generating"');
    expect(html).toContain('接管');
    expect(html).toContain('etsy.com');
    expect(html).toContain('打开');
    expect(html).not.toContain('做完会出现在这里');
    expect(html).not.toContain('is-collapsed');
    expect(html).not.toContain('data-testid="task-status-label"');
  });

  it('failed card is 目标 + 结果 + 再说一次, not stacked 失败了 chrome', () => {
    const snapshot = {
      id: 'task-failed',
      goalSummary: 'User task',
      chatSessionId: 'chat-1',
      instructionMessageId: 'message-1',
      status: 'failed',
      revision: 4,
      activeTabId: 7,
      currentRoundId: 'round-1',
      targetRefs: [],
      rounds: [
        {
          id: 'round-1',
          instructionSummary: 'User task',
          status: 'failed',
          failureCategory: 'max_steps',
          commandAcks: {},
          criteria: [],
          attempts: [
            {
              id: 'attempt-1',
              roundId: 'round-1',
              actionName: 'observe',
              effect: 'read',
              argsDigest: 'args',
              displaySummary: '获取页面快照',
              state: 'observed',
              proposedAt: 1,
              observedAt: 2,
            },
          ],
          evidence: [],
        },
      ],
      createdAt: 1,
      updatedAt: 4,
    } satisfies TaskSnapshot;

    const html = renderToStaticMarkup(
      createElement(TaskStatusCard, {
        snapshot,
        send: vi.fn(),
        defaultInstruction: '打开这个网页的第二行的第一个视频',
        onRetry: vi.fn(),
      }),
    );

    expect(html).toContain('打开这个网页的第二行的第一个视频');
    expect(html).toContain('试了几轮，还是没做成。');
    expect(html).toContain('再说一次');
    expect(html).toContain('data-testid="task-retry"');
    expect(html).toContain('chijie-failed-result');
    expect(html).toContain('做过');
    expect(html).not.toContain('>现在<');
    expect(html.indexOf('>结果<')).toBeLessThan(html.indexOf('做过'));
    expect(html).not.toContain('data-testid="task-status-label"');
    expect(html).not.toContain('失败了');
    expect(html).not.toContain('本次任务完成得怎么样');
    expect(html).not.toContain('模型反复');
    expect(html).not.toContain('步数耗尽');
    expect(html).not.toContain('没有可交付结果');
    expect(html).not.toContain('data-testid="task-thinking-process"');
    expect(html).not.toContain('data-testid="task-outcome-rating"');
    expect(html).toMatch(/data-testid="completion-result"[^>]*>试了几轮，还是没做成。</);
  });

  it('does not repeat the same failure sentence as both hint and product label', () => {
    const label = productFailureLabel('target_missing');
    expect(distinctFailureCategoryLabel(label, 'target_missing')).toBeNull();
    expect(distinctFailureCategoryLabel('这次没跑通。改指令后重试，或点停止后开新任务。', 'target_missing')).toBe(
      label,
    );
  });
});
