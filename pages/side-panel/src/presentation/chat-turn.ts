/**
 * Chat-turn routing for the side panel composer.
 *
 * A message with no page-operation intent is answered by the direct chat
 * stream (background `chat_stream` over agent-core), not by starting a task.
 * Doubt always falls to the task loop: only messages that clearly do not
 * touch the page take the chat path.
 */
import type { Message } from '@extension/storage';
import { instructionPointsAtCurrentPage } from './active-tab-bind';

/** Verbs that mean "operate the browser / this page", not "talk to me". */
const OPERATION_INTENT =
  /(?:打开|访问|进入|跳转|点击|点一下|填写|填入|提交|登录|登陆|注册|下单|购买|翻页|滚动|截屏|截图|下载|刷新|搜索|查找|发送|保存|复制|上传|关闭标签|新建标签)|\b(?:open|visit|go to|click|fill|submit|log ?in|sign ?(?:in|up)|scroll|screenshot|download|refresh|search|find|send|save|copy|upload|close|new tab)\b/i;

const CURRENT_PAGE_REFERENCE =
  /(?:当前|这个|本)(?:的)?(?:页面|网页|网站|页)|\b(?:this|the current)\s+(?:page|webpage|site)\b/i;
const PAGE_SUMMARY_INTENT =
  /(?:总结|概括|摘要|归纳)|\bsummari[sz]e\b|\b(?:give|provide|write|create)\b.{0,40}\bsummary\b/i;

export type ChatTurnRoute = 'page_summary' | 'chat' | 'task';

/** Only a self-contained request to summarize the associated page takes the context recipe. */
export function classifyChatTurn(text: string): ChatTurnRoute {
  const trimmed = text.trim();
  if (!trimmed || OPERATION_INTENT.test(trimmed)) return 'task';
  if (CURRENT_PAGE_REFERENCE.test(trimmed) && PAGE_SUMMARY_INTENT.test(trimmed)) return 'page_summary';
  return isChatOnlyMessage(trimmed) ? 'chat' : 'task';
}

/** True when the message is pure conversation — no operation intent. */
export function isChatOnlyMessage(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (instructionPointsAtCurrentPage(trimmed)) return false;
  if (OPERATION_INTENT.test(trimmed)) return false;
  return true;
}

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
