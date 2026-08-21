import { readFileSync } from 'node:fs';
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
    expect(html).not.toContain('已验证任务回执');
    expect(html).not.toContain('data-testid="task-outcome-rating"');
    expect(html).not.toContain('data-testid="completion-receipt-details"');
    expect(html).not.toContain('data-testid="completion-evidence-list"');
    expect(html).not.toContain('结果暂不可');
    expect(html).not.toContain('本次任务完成得怎么样');
    expect(html).not.toContain('data-testid="skill-save"');
  });

  it('lists opened sources under the delivered sentence', () => {
    const currentRound = completedRound('round-current', 'receipt-current');
    currentRound.attempts = [
      {
        id: 'search-1',
        roundId: currentRound.id,
        actionName: 'search_google',
        effect: 'read',
        argsDigest: 'args',
        displaySummary: '搜索：报名',
        findings: [{ title: '报名页', host: 'qingcheng.ai', url: 'https://qingcheng.ai/apply' }],
        state: 'observed',
        proposedAt: 1,
        observedAt: 2,
      },
    ];
    const snapshot = {
      id: 'task-current',
      goalSummary: 'Verify the current result',
      status: 'completed',
      revision: 3,
      activeTabId: 7,
      currentRoundId: currentRound.id,
      targetRefs: [],
      rounds: [currentRound],
      createdAt: 1,
      updatedAt: 2,
    } satisfies TaskSnapshot;

    const html = renderToStaticMarkup(
      createElement(TaskStatusCard, {
        snapshot,
        send: vi.fn(),
        defaultInstruction: '找到报名页',
        readOnly: true,
      }),
    );

    expect(html).toContain('data-testid="answer-sources"');
    expect(html).toContain('qingcheng.ai');
    expect(html).toContain('报名页');
    expect(html).not.toContain('已验证任务回执');
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
    expect(html).toContain('data-testid="task-work-stream"');
    expect(html).toContain('data-testid="task-page-card"');
    expect(html).toContain('data-testid="live-tool-log"');
    expect(html).toContain('data-testid="live-cursor"');
    expect(html).toContain('data-testid="live-stop-generating"');
    expect(html).toContain('接管');
    expect(html).toContain('etsy.com');
    expect(html).not.toContain('打开 etsy.com');
    expect(html).toContain('https://etsy.com');
    expect(html).not.toContain('>目标<');
    expect(html).not.toContain('>现在<');
    expect(html).not.toContain('>结果<');
    expect(html).not.toContain('做完会出现在这里');
    expect(html).not.toContain('获取页面快照');
    expect(html).not.toContain('data-testid="task-status-label"');
  });

  it('failed card is the original sentence + one verdict + 再说一次', () => {
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
    expect(html).toContain('data-testid="failed-result"');
    expect(html).toMatch(/data-testid="failed-result-sentence"[^>]*>试了几轮，还是没做成。</);
    expect(html).not.toContain('data-testid="completion-receipt"');
    expect(html).not.toContain('data-testid="completion-result"');
    expect(html).not.toContain('>现在<');
    expect(html).not.toContain('>结果<');
    expect(html).not.toContain('做过');
    expect(html).not.toContain('获取页面快照');
    expect(html).not.toContain('data-testid="task-status-label"');
    expect(html).not.toContain('失败了');
    expect(html).not.toContain('本次任务完成得怎么样');
    expect(html).not.toContain('模型反复');
    expect(html).not.toContain('步数耗尽');
    expect(html).not.toContain('没有可交付结果');
    expect(html).not.toContain('data-testid="task-thinking-process"');
    expect(html).not.toContain('data-testid="task-outcome-rating"');
  });

  it('surfaces the asked success sentence as the result, not source-page chrome', () => {
    const currentRound = completedRound('round-form', 'receipt-form');
    currentRound.instructionSummary = 'User instruction';
    currentRound.result = { kind: 'summary', body: 'Saved successfully' };
    currentRound.attempts = [
      {
        id: 'submit-1',
        roundId: currentRound.id,
        actionName: 'click_element',
        effect: 'external_commit',
        argsDigest: 'args',
        displaySummary: '提交表单',
        targetUrl: 'http://127.0.0.1:4173/form',
        state: 'observed',
        proposedAt: 1,
        observedAt: 2,
      },
    ];
    const snapshot = {
      id: 'task-form',
      goalSummary: 'User task',
      status: 'completed',
      revision: 3,
      activeTabId: 7,
      currentRoundId: currentRound.id,
      targetRefs: [
        {
          id: 'tab-7',
          kind: 'page',
          tabId: 7,
          frameId: 0,
          urlOrigin: 'http://127.0.0.1:4173',
          digest: 'page',
          label: '对核这些页',
        },
      ],
      rounds: [currentRound],
      createdAt: 1,
      updatedAt: 2,
    } satisfies TaskSnapshot;

    const html = renderToStaticMarkup(
      createElement(TaskStatusCard, {
        snapshot,
        send: vi.fn(),
        defaultInstruction: 'Fill Name with Ada and submit; success is Saved successfully.',
        readOnly: true,
      }),
    );

    expect(html).toContain('data-testid="completion-result"');
    expect(html).toContain('Saved successfully');
    expect(html).not.toContain('对核这些页');
    expect(html).not.toContain('页面状态已确认');
    expect(html).not.toMatch(/data-testid="completion-result"[^>]*>[\s\S]*127\.0\.0\.1/);
  });

  it('copy button writes the shown result sentence', () => {
    const source = readFileSync(new URL('../TaskStatusCard.tsx', import.meta.url), 'utf8');
    expect(source).toContain('writeText(resultSentence)');
    expect(source).not.toContain('writeText(deliverableAnswer)');
  });

  it('search attempt becomes a board of query plus result rows', () => {
    const snapshot = {
      id: 'task-search',
      goalSummary: 'User task',
      chatSessionId: 'chat-1',
      instructionMessageId: 'message-1',
      status: 'running',
      revision: 2,
      activeTabId: 7,
      currentRoundId: 'round-1',
      targetRefs: [],
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
              actionName: 'search_google',
              effect: 'read',
              argsDigest: 'args',
              displaySummary: '搜索：清程极智 深圳 黑客松',
              targetLabel: '清程极智 深圳 黑客松',
              findings: [
                {
                  title: 'MoonStone2026 AI黑客松正式官宣',
                  host: 'example.com',
                  url: 'https://example.com/hackathon',
                },
              ],
              state: 'observed',
              proposedAt: 1,
              observedAt: 2,
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
        defaultInstruction:
          '帮我找到清程极智，他们有在深圳办一个黑客松。然后找到那个黑客松之后，我需要找到那个报名链接。',
        onStop: vi.fn(),
      }),
    );

    expect(html).toContain('帮我找到清程极智');
    expect(html).not.toContain('>目标<');
    expect(html).toContain('data-testid="task-search-board"');
    expect(html).toContain('清程极智 深圳 黑客松');
    expect(html).toContain('MoonStone2026 AI黑客松正式官宣');
    expect(html).toContain('已完成网页搜索');
    expect(html).toContain('https://example.com/hackathon');
    expect(html).not.toContain('获取页面快照');
    expect(html).not.toContain('做完会出现在这里');
  });

  it('does not repeat the same failure sentence as both hint and product label', () => {
    const label = productFailureLabel('target_missing');
    expect(distinctFailureCategoryLabel(label, 'target_missing')).toBeNull();
    expect(distinctFailureCategoryLabel('这次没跑通。改指令后重试，或点停止后开新任务。', 'target_missing')).toBe(
      label,
    );
  });
});
