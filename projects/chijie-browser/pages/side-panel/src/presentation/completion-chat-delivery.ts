import { Actors, type Message, type TaskSnapshot } from '@extension/storage';
import { resolveDeliverableAnswer, wantsContentDeliverable } from './goal-coverage';

export interface CompletionChatDelivery {
  receiptId: string;
  sessionId: string;
  content: string;
  timestamp: number;
}

/** Derive the one persisted assistant message owned by a verified text deliverable. */
export function completionChatDelivery(input: {
  snapshot: TaskSnapshot | null;
  currentSessionId: string | null;
  messages: Message[];
}): CompletionChatDelivery | null {
  const { snapshot, currentSessionId } = input;
  if (!snapshot || snapshot.status !== 'completed' || !currentSessionId) return null;
  if (snapshot.chatSessionId !== currentSessionId) return null;

  const round = snapshot.rounds.find(item => item.id === snapshot.currentRoundId);
  if (!round || round.status !== 'completed' || !round.receipt?.id) return null;

  const instructionMessageId = round.instructionMessageId ?? snapshot.instructionMessageId;
  const instructionMessage = instructionMessageId
    ? input.messages.find(
        message =>
          message.actor === Actors.USER &&
          'id' in message &&
          (message as Message & { id?: string }).id === instructionMessageId,
      )
    : undefined;
  const latestUserMessage = [...input.messages].reverse().find(message => message.actor === Actors.USER);
  const goalText = (instructionMessage ?? latestUserMessage)?.content?.replace(/\s+/g, ' ').trim() ?? '';
  if (!wantsContentDeliverable(goalText)) return null;

  const content = resolveDeliverableAnswer({
    instructionSummary: round.instructionSummary,
    goalText,
  });
  if (!content) return null;

  return {
    receiptId: round.receipt.id,
    sessionId: currentSessionId,
    content,
    timestamp: round.receipt.verifiedAt,
  };
}

export function hasCompletionChatDelivery(
  messages: Message[],
  delivery: CompletionChatDelivery,
): boolean {
  return messages.some(
    message =>
      message.actor === Actors.SYSTEM &&
      message.timestamp === delivery.timestamp &&
      message.content === delivery.content,
  );
}
