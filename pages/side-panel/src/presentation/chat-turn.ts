/**
 * Growing assistant message while a background `chat_stream` is in flight.
 * Routing of user sentences is the orchestrator's job, not a regex split here.
 */
import type { Message } from '@extension/storage';

/** A chat stream in flight: which session it belongs to, where the growing
 * assistant message sits in the visible list, and the text so far. */
export interface ChatStreamState {
  sessionId: string;
  timestamp: number;
  text: string;
  source?: Message['source'];
}

/**
 * Append one streamed token to the in-flight assistant message inside the
 * visible message list. Returns the list unchanged when the delta belongs to
 * another session.
 */
export function applyChatStreamDelta(messages: Message[], stream: ChatStreamState, delta: string): Message[] {
  const index = messages.findIndex(message => message.timestamp === stream.timestamp && message.actor !== 'user');
  if (index === -1) {
    return [
      ...messages,
      { actor: 'system' as Message['actor'], content: delta, timestamp: stream.timestamp, source: stream.source },
    ];
  }
  const next = [...messages];
  next[index] = { ...next[index], content: next[index].content + delta };
  return next;
}
