import { CHEAP_STOP_TEXT, isWholeStopInstruction } from '../intent/user-turn-decision';
import type { OrchestratorHost } from './types';

const CANCELLABLE = new Set(['running', 'paused', 'waiting_user', 'inputs_required', 'interrupted']);

export async function tryCheapStop(input: {
  text: string;
  sessionId: string;
  host: OrchestratorHost;
}): Promise<string | null> {
  if (!isWholeStopInstruction(input.text)) return null;
  const task = await input.host.getActiveTask?.();
  if (!task || !CANCELLABLE.has(task.status)) return null;
  if (task.chatSessionId !== input.sessionId && task.id !== input.sessionId) return null;
  if (!input.host.dispatchTask) return null;
  const ack = await input.host.dispatchTask({
    type: 'cancel',
    commandId: crypto.randomUUID(),
    taskId: task.id,
    expectedRevision: task.revision,
  });
  return ack.accepted ? CHEAP_STOP_TEXT : null;
}
