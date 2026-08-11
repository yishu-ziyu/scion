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
        criteria: [],
        attempts: [],
        evidence: [],
        receipt: {
          id: 'receipt-1',
          taskId: 'task-1',
          roundId: 'round-1',
          verifiedAt: 20,
          criterionIds: [],
          evidenceDigests: [],
        },
      },
    ],
    createdAt: 1,
    updatedAt: 20,
  };
}

describe('completion chat delivery', () => {
  it('surfaces a completed text deliverable once in the current chat', () => {
    const snapshot = completedSnapshot(
      '当前页面是 AICSS 的 To-do List 组件文档页，并提供 React、Vue 和 Svelte 示例。',
    );
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
});
