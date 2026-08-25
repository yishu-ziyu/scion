import type { UserTurnDecision } from './user-turn-decision';

/** Confirm before attaching the debugger when the composer did not already pick 执行. */

export const CONFIRM_EXECUTE_PROMPT = '要我现在操作这个网页吗？';
export const CONFIRM_EXECUTE_CHAT_LABEL = '仅聊天';
export const CONFIRM_EXECUTE_GO_LABEL = '执行';
export const CONFIRM_EXECUTE_CHAT_REPLY = '好的，这次不操作页面。';
export const COMPOSER_CHAT_REPLY = '这次按仅聊天，不操作页面。要动手的话，选执行再发。';

export const CONFIRM_EXECUTE_WAIT_ASK = {
  prompt: CONFIRM_EXECUTE_PROMPT,
  options: [
    { label: CONFIRM_EXECUTE_CHAT_LABEL, sendText: CONFIRM_EXECUTE_CHAT_LABEL },
    { label: CONFIRM_EXECUTE_GO_LABEL, sendText: CONFIRM_EXECUTE_GO_LABEL },
  ],
};

function normalized(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function isConfirmExecuteChat(text: string): boolean {
  return normalized(text) === CONFIRM_EXECUTE_CHAT_LABEL;
}

export function isConfirmExecuteGo(text: string): boolean {
  return normalized(text) === CONFIRM_EXECUTE_GO_LABEL;
}

/** Composer 仅聊天 turns a page-operate decision into a spoken reply. */
export function applyComposerIntent(
  intent: 'chat' | 'execute' | undefined,
  decision: UserTurnDecision,
): UserTurnDecision {
  if (intent === 'chat' && decision.kind === 'execute') {
    return { kind: 'reply', userVisibleText: COMPOSER_CHAT_REPLY };
  }
  return decision;
}
