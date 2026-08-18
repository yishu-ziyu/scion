import { describe, expect, it } from 'vitest';
import { Actors, type ChatMessage, type TaskSnapshot } from '@extension/storage';
import { completionChatDelivery, hasCompletionChatDelivery } from '../completion-chat-delivery';

const userMessage: ChatMessage = {
  id: 'message-1',
  actor: Actors.USER,
  content: '用一句话说明当前 AICSS 页面展示的内容。不要点击或修改页面。',
  timestamp: 10,
};

function completedSnapshot(instructionSummary: string): TaskSnapshot {
  return {
    id: 'task-1',
    goalSummary: 'User task',
    chatSessionId: 'chat-1',
    instructionMessageId: userMessage.id,
    status: 'completed',
    revision: 2,
    activeTabId: 7,
    currentRoundId: 'round-1',
    targetRefs: [],
    rounds: [
      {
        id: 'round-1',
        instructionMessageId: userMessage.id,
        instructionSummary,
        status: 'completed',
        commandAcks: {},
        criteria: [
          {
            id: 'criterion-1',
            roundId: 'round-1',
            targetRefId: 'target-1',
            kind: 'page_text',
            operator: 'present',
            expectedDigest: 'expected-1',
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
            criterionId: 'criterion-1',
            roundId: 'round-1',
            targetRefId: 'target-1',
            observedAt: 19,
            source: 'page',
            value: true,
            passed: true,
          },
        ],
        receipt: {
          id: 'receipt-1',
          taskId: 'task-1',
          roundId: 'round-1',
          verifiedAt: 20,
          criterionIds: ['criterion-1'],
          evidenceDigests: ['evidence-1'],
        },
      },
    ],
    createdAt: 1,
    updatedAt: 20,
  };
}

describe('completion chat delivery', () => {
  it('surfaces a completed text deliverable once in the current chat', () => {
    const snapshot = completedSnapshot('当前页面是 AICSS 的 To-do List 组件文档页，并提供 React、Vue 和 Svelte 示例。');
    const delivery = completionChatDelivery({
      snapshot,
      currentSessionId: 'chat-1',
      messages: [userMessage],
    });
    expect(delivery).toEqual({
      receiptId: 'receipt-1',
      sessionId: 'chat-1',
      content: '当前页面是 AICSS 的 To-do List 组件文档页，并提供 React、Vue 和 Svelte 示例。',
      timestamp: 20,
    });
    expect(hasCompletionChatDelivery([userMessage], delivery!)).toBe(false);

    const persisted: ChatMessage = {
      id: 'assistant-1',
      actor: Actors.SYSTEM,
      content: delivery!.content,
      timestamp: delivery!.timestamp,
    };
    expect(hasCompletionChatDelivery([userMessage, persisted], delivery!)).toBe(true);
    expect(
      completionChatDelivery({ snapshot, currentSessionId: 'chat-1', messages: [userMessage, persisted] }),
    ).toEqual(delivery);
  });

  it.each([
    'User instruction',
    '好的，我来读取当前 AICSS 页面并用一句话说明。',
    'Control loop candidate complete',
    '   ',
  ])('does not surface a non-deliverable summary: %s', instructionSummary => {
    expect(
      completionChatDelivery({
        snapshot: completedSnapshot(instructionSummary),
        currentSessionId: 'chat-1',
        messages: [userMessage],
      }),
    ).toBeNull();
  });

  it('surfaces a written page result for the raw owner sentence', () => {
    const ownerMessage: ChatMessage = {
      ...userMessage,
      content: '读当前页，一句主题，引用一处正文',
    };
    expect(
      completionChatDelivery({
        snapshot: completedSnapshot('主题：EverOS 是给智能体的记忆系统。引用：「长期记忆准确率 93.05%」。'),
        currentSessionId: 'chat-1',
        messages: [ownerMessage],
      })?.content,
    ).toContain('EverOS');
  });

  it('does not turn an ordinary action completion into an assistant answer', () => {
    const actionMessage: ChatMessage = {
      ...userMessage,
      content: '打开 YouTube。',
    };
    expect(
      completionChatDelivery({
        snapshot: completedSnapshot('YouTube 已打开。'),
        currentSessionId: 'chat-1',
        messages: [actionMessage],
      }),
    ).toBeNull();
  });

  it('never backfills completion into a selected historical projection', () => {
    expect(
      completionChatDelivery({
        snapshot: completedSnapshot('页面内容摘要。'),
        currentSessionId: 'chat-1',
        messages: [userMessage],
        isHistoricalSession: true,
      }),
    ).toBeNull();
  });

  it('rejects a completed signal whose receipt is incomplete or mismatched', () => {
    const snapshot = completedSnapshot('页面内容摘要。');
    const round = snapshot.rounds[0]!;
    expect(
      completionChatDelivery({
        snapshot: { ...snapshot, rounds: [{ ...round, receipt: { ...round.receipt!, taskId: 'other-task' } }] },
        currentSessionId: 'chat-1',
        messages: [userMessage],
      }),
    ).toBeNull();
    expect(
      completionChatDelivery({
        snapshot: { ...snapshot, rounds: [{ ...round, evidence: [] }] },
        currentSessionId: 'chat-1',
        messages: [userMessage],
      }),
    ).toBeNull();
  });
});
