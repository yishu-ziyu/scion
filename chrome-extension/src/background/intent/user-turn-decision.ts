/** LLM-first user-turn decision: reply / clarify / execute / stop. */

import { HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { AgentNameEnum, agentModelStore, llmProviderStore } from '@extension/storage';
import { createLogger } from '../log';
import { createChatModel } from '../agent/helper';
import { extractJsonFromModelOutput, removeThinkTags } from '../agent/messages/utils';
import { ensurePersonalDefaults } from '../../personal/bootstrap';

const logger = createLogger('UserTurnDecision');

export type UserTurnKind = 'reply' | 'clarify' | 'execute' | 'stop';

export interface UserTurnDecision {
  kind: UserTurnKind;
  /** Human-visible Chinese (or user language) text for the chat stream */
  userVisibleText: string;
}

export const EMPTY_TURN_CLARIFY_TEXT = '你想让我具体做什么？可以说要打开、搜索、点击或填写什么。';
export const CHEAP_GREETING_REPLY_TEXT = '你好，需要我帮你在页面上做什么？';
export const CHEAP_STOP_TEXT = '好的，已停止。';

const WHOLE_GREETING =
  /^(?:你好|您好|嗨+|哈喽|在吗|在不在|谢谢(?:你|您)?|感谢|早上好|晚上好|下午好|hi|hello|hey|thanks|thank\s+you|ok(?:ay)?|好的)[.!?。！？~]*$/i;
const WHOLE_STOP = /^(?:停止|停下|停一下|取消|取消任务|停止任务|别做了|不要做了|停|stop|cancel)(?:吧|啊|呀)?[.!?。！？]*$/i;
const BROWSER_VERB =
  /打开|开启|搜索|查找|点击|点开|填写|填入|播放|暂停|关闭|关掉|提取|摘录|滚动|跳转|前往|访问|\bopen\b|\bsearch\b|\bclick\b|\bfill\b|\bplay\b|\bpause\b|\bclose\b|\bextract\b|\bscroll\b|\bnavigate\b|go\s+to/i;

export type ParseUserTurnResult =
  | { ok: true; decision: UserTurnDecision }
  | { ok: false; error: string };

const KINDS = new Set<UserTurnKind>(['reply', 'clarify', 'execute', 'stop']);

const SYSTEM_PROMPT = `你是持节侧栏的对话判断器。根据用户最新一句话和最近对话，判断用户要什么，并只输出一个 JSON 对象（不要 markdown，不要其它文字）。

字段：
- "kind": 必须是以下之一
  - "reply"：闲聊、招呼、致谢、问答且不需要操作当前浏览器页面
  - "clarify"：意图不清，需要先问清楚才能动手
  - "execute"：用户要你在浏览器里操作页面（打开、点击、搜索、填写、提取页面内容等）
  - "stop"：用户要停止/取消当前正在做的事
- "user_visible_text": 给用户看的中文（或与用户相同语言）
  - reply / clarify：必填，完整一句人话（招呼就回招呼并问能帮什么；说不清就追问具体要做什么）
  - execute：可写简短确认，也可空字符串
  - stop：可写「好的，已停止」类短句，也可空

规则：
- 不要输出点击、选择器、JSON 动作计划。
- 不要假设用户要操作页面，除非话语明确是网页操作任务。
- 单独的「你好」「在吗」等 → reply，不要 execute。
- 过短、含糊、缺少可执行目标 → clarify。
- 明确「打开/搜索/点击/填写…」或完整可执行目标 → execute。

只输出 JSON，例如：
{"kind":"reply","user_visible_text":"你好，需要我帮你在页面上做什么？"}
`;

/** Parse raw model text into a UserTurnDecision. Pure — no network. */
export function parseUserTurnDecision(raw: string): ParseUserTurnResult {
  if (!raw || !String(raw).trim()) {
    return { ok: false, error: 'empty_model_output' };
  }
  let cleaned = removeThinkTags(String(raw));
  cleaned = cleaned.trim();
  let obj: unknown;
  try {
    obj = extractJsonFromModelOutput(cleaned);
  } catch {
    try {
      obj = JSON.parse(cleaned);
    } catch {
      return { ok: false, error: 'invalid_json' };
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, error: 'not_object' };
  }
  const record = obj as Record<string, unknown>;
  const kindRaw = record.kind ?? record.decision ?? record.type;
  if (typeof kindRaw !== 'string' || !KINDS.has(kindRaw as UserTurnKind)) {
    return { ok: false, error: 'invalid_kind' };
  }
  const kind = kindRaw as UserTurnKind;
  const textRaw = record.user_visible_text ?? record.userVisibleText ?? record.message ?? record.reply ?? '';
  const userVisibleText = typeof textRaw === 'string' ? textRaw.trim() : '';
  if ((kind === 'reply' || kind === 'clarify') && !userVisibleText) {
    return { ok: false, error: 'missing_user_visible_text' };
  }
  return { ok: true, decision: { kind, userVisibleText } };
}

export interface HistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

export function historyTurnsFromMessages(
  messages: Array<{ actor?: string; content?: string }>,
): HistoryTurn[] {
  return messages
    .filter(
      (message): message is { actor?: string; content: string } =>
        typeof message.content === 'string' && Boolean(message.content.trim()),
    )
    .slice(-12)
    .map(message => ({
      role: message.actor === 'user' ? 'user' : 'assistant',
      content: message.content.trim(),
    }));
}

/**
 * Reading the bound page requires browser observation even when the classifier
 * mistakenly writes a conversational acknowledgement.
 */
export function enforcePageObservationInvariant(
  latestUserText: string,
  decision: UserTurnDecision,
): UserTurnDecision {
  if (decision.kind === 'execute' || decision.kind === 'stop') return decision;

  const text = latestUserText.replace(/\s+/g, ' ').trim();
  const referencesPage =
    /(?:当前|这个|本)(?:[^。！？!?]{0,20})?(?:页面|网页|网站|标签页)|(?:页面|网页)(?:上|中|展示|内容)/.test(
      text,
    ) || /\b(?:this|the|current)\s+(?:page|webpage|site|tab)\b/i.test(text);
  const requestsReading =
    /说明|描述|总结|摘要|概括|读取|读一下|提取|摘录|列出|展示的内容|是什么|有哪些/.test(text) ||
    /\b(?:summari[sz]e|describe|read|extract|quote|list|tell me|what(?:'s| is)|what are)\b/i.test(text);

  return referencesPage && requestsReading ? { kind: 'execute', userVisibleText: '' } : decision;
}

function hasCheapExecutableGoal(text: string): boolean {
  if (/https?:\/\//i.test(text)) return true;
  if (!BROWSER_VERB.test(text)) return false;
  const remainder = text.replace(BROWSER_VERB, '').replace(/\s+/g, '');
  return remainder.length >= 2;
}

/**
 * High-precision classify without a model. Returns null when the sentence is
 * ambiguous and decideUserTurn still needs llm.invoke.
 */
export function resolveUserTurnCheap(text: string): UserTurnDecision | null {
  const latest = text.replace(/\s+/g, ' ').trim();
  if (!latest) {
    return { kind: 'clarify', userVisibleText: EMPTY_TURN_CLARIFY_TEXT };
  }
  if (WHOLE_GREETING.test(latest)) {
    return { kind: 'reply', userVisibleText: CHEAP_GREETING_REPLY_TEXT };
  }
  if (WHOLE_STOP.test(latest)) {
    return { kind: 'stop', userVisibleText: CHEAP_STOP_TEXT };
  }
  const pageForced = enforcePageObservationInvariant(latest, { kind: 'reply', userVisibleText: '' });
  if (pageForced.kind === 'execute') {
    return { kind: 'execute', userVisibleText: '' };
  }
  if (hasCheapExecutableGoal(latest)) {
    return { kind: 'execute', userVisibleText: '' };
  }
  return null;
}

function contentFromLlmResponse(response: unknown): string {
  if (!response || typeof response !== 'object') return '';
  const r = response as { content?: unknown };
  const content = r.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text: unknown }).text ?? '');
        }
        return '';
      })
      .join('');
  }
  return '';
}

/** Call the configured Navigator/Planner model to decide the user turn. */
export async function decideUserTurn(input: {
  latestUserText: string;
  history?: HistoryTurn[];
}): Promise<UserTurnDecision> {
  const latest = input.latestUserText.trim();
  const cheap = resolveUserTurnCheap(latest);
  if (cheap) return cheap;

  await ensurePersonalDefaults();
  const providers = await llmProviderStore.getAllProviders();
  if (Object.keys(providers).length === 0) {
    throw new Error('模型未配置，请先连接模型。');
  }
  await agentModelStore.cleanupLegacyValidatorSettings();
  const agentModels = await agentModelStore.getAllAgentModels();
  const navigatorModel = agentModels[AgentNameEnum.Navigator] ?? agentModels[AgentNameEnum.Planner];
  if (!navigatorModel) {
    throw new Error('未设置可用模型。');
  }
  if (!providers[navigatorModel.provider]) {
    throw new Error(`找不到模型提供者：${navigatorModel.provider}`);
  }

  const llm = createChatModel(providers[navigatorModel.provider], navigatorModel);
  const history = (input.history ?? []).slice(-12);
  const messages: BaseMessage[] = [new SystemMessage(SYSTEM_PROMPT)];
  for (const turn of history) {
    const label = turn.role === 'user' ? '用户' : '助手';
    messages.push(new HumanMessage(`${label}：${turn.content}`));
  }
  messages.push(
    new HumanMessage(
      `请判断用户最新这句话，只输出 JSON。\n用户：${latest}`,
    ),
  );

  logger.info('deciding user turn', {
    provider: navigatorModel.provider,
    model: navigatorModel.modelName,
    historyTurns: history.length,
  });

  const response = await llm.invoke(messages);
  const raw = contentFromLlmResponse(response);
  logger.info('user turn raw', raw.slice(0, 400));
  const parsed = parseUserTurnDecision(raw);
  if (!parsed.ok) {
    logger.warning('parse failed', parsed.error, raw.slice(0, 200));
    throw new Error('模型返回无法解析，请再说一遍你想做什么。');
  }
  return enforcePageObservationInvariant(latest, parsed.decision);
}
