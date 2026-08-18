import { Actors, type Message, type TaskSnapshot } from '@extension/storage';
import { resolveDeliverableAnswer } from './goal-coverage';
import { shouldShowVerifiedDone } from './task-loop-ui';

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
  isHistoricalSession?: boolean;
}): CompletionChatDelivery | null {
  const { snapshot, currentSessionId } = input;
  if (input.isHistoricalSession || !snapshot || snapshot.status !== 'completed' || !currentSessionId) return null;
  const ownsSkillSession = snapshot.sourceSkillId !== undefined && snapshot.id === currentSessionId;
  if (snapshot.chatSessionId !== currentSessionId && !ownsSkillSession) return null;

  const round = snapshot.rounds.find(item => item.id === snapshot.currentRoundId);
  if (!round || !shouldShowVerifiedDone(snapshot, round.receipt)) return null;
  const receipt = round.receipt;
  if (!receipt) return null;

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

  const content = resolveDeliverableAnswer({
    instructionSummary: round.instructionSummary,
    goalText,
  });
  if (!content) return null;

  return {
    receiptId: receipt.id,
    sessionId: currentSessionId,
    content,
    timestamp: receipt.verifiedAt,
  };
}

export function hasCompletionChatDelivery(messages: Message[], delivery: CompletionChatDelivery): boolean {
  return messages.some(
    message =>
      message.actor === Actors.SYSTEM &&
      message.timestamp === delivery.timestamp &&
      message.content === delivery.content,
  );
}
