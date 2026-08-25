import { AgentNameEnum, agentModelStore, llmProviderStore, userMemoryStore } from '@extension/storage';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ensurePersonalDefaults } from '../../personal/bootstrap';
import { createChatModel } from './helper';
import { messageContentToText } from './messages/utils';
import { mergeUserMemoryFacts, parseStructuredMemoryFacts } from './user-memory';

export const STRUCTURE_USER_MEMORY_TYPE = 'structure_user_memory';

const STRUCTURE_SYSTEM_PROMPT = `你把用户写在记忆页上的原文抽成结构化事实。只输出一个 JSON 对象，不要 markdown。

格式：
{"facts":[{"kind":"常用邮箱","value":"mail.google.com"}]}

规则：
- kind 是短标签（常用邮箱、常用搜索、飞书空间…）。
- value 是可直接使用的值。网页邮箱写成主机名：mail.google.com 或 outlook.live.com。
- 只抽取用户亲口确立的事实。不要发明。
- 不要抽取密码、API key、cookie、token。
- 没有事实就输出 {"facts":[]}。
`;

export type StructureUserMemoryResult =
  | { ok: true; factsCount: number }
  | { ok: false; error: 'empty' | 'no_model' | 'llm_failed' | 'no_facts' };

export async function structureUserMemoryFromSource(sourceText: string): Promise<StructureUserMemoryResult> {
  const text = sourceText.trim();
  if (!text) return { ok: false, error: 'empty' };

  await ensurePersonalDefaults();
  const providers = await llmProviderStore.getAllProviders();
  const agentModels = await agentModelStore.getAllAgentModels();
  const navigatorModel = agentModels[AgentNameEnum.Navigator] ?? agentModels[AgentNameEnum.Planner];
  if (!navigatorModel || !providers[navigatorModel.provider]) {
    return { ok: false, error: 'no_model' };
  }

  const llm = createChatModel(providers[navigatorModel.provider], navigatorModel);
  let raw = '';
  try {
    const response = await llm.invoke([new SystemMessage(STRUCTURE_SYSTEM_PROMPT), new HumanMessage(text)]);
    raw = messageContentToText(response.content);
  } catch {
    return { ok: false, error: 'llm_failed' };
  }

  const extracted = parseStructuredMemoryFacts(raw, Date.now(), text);
  if (extracted.length === 0) return { ok: false, error: 'no_facts' };

  const current = await userMemoryStore.getState();
  const facts = mergeUserMemoryFacts(current.facts, extracted);
  await userMemoryStore.setState({ facts, sourceText: text });
  return { ok: true, factsCount: facts.length };
}
