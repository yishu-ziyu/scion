import {
  createOpenAICompatibleRuntime,
  runRecipe,
  selectRuntime,
  webChatRecipe,
  type ChatTurn,
  type RuntimeFactory,
  type SelectRuntimeResult,
} from '@extension/agent-core';
import type { AdapterType, ModelDescriptor, ProviderProfile } from '@extension/contracts';
import {
  Actors,
  AgentNameEnum,
  ProviderTypeEnum,
  agentModelStore,
  chatHistoryStore,
  deriveApiKeyRef,
  getApiKey,
  llmProviderStore,
  type ModelConfig,
  type ProviderConfig,
} from '@extension/storage';
import { createLogger } from './log';

const logger = createLogger('ChatStream');

/** Feature id the side panel chat stream resolves its model through. */
export const CHAT_FEATURE_ID = 'chat';

export const CHAT_STREAM_UNBOUND_ERROR = '未绑定 chat 模型';

export interface ChatStreamRequest {
  sessionId: string;
  text: string;
}

export type ChatStreamEvent =
  | { type: 'chat_stream_delta'; sessionId: string; text: string }
  | { type: 'chat_stream_done'; sessionId: string }
  | { type: 'chat_stream_error'; sessionId: string; error: string };

export interface ChatStreamPort {
  postMessage: (message: ChatStreamEvent) => void;
}

/** Everything the handler reads from the outside world; tests inject fakes. */
export interface ChatStreamDeps {
  getProviders: () => Promise<Record<string, ProviderConfig>>;
  getAgentModels: () => Promise<Partial<Record<AgentNameEnum, ModelConfig>>>;
  getApiKey: (ref: string) => Promise<string | null>;
  getSessionMessages: (sessionId: string) => Promise<Array<{ actor: Actors; content: string }> | null>;
  runtimeFactory: RuntimeFactory;
  selectRuntimeImpl?: (
    input: Parameters<typeof selectRuntime>[0],
    getApiKey: Parameters<typeof selectRuntime>[1],
  ) => Promise<SelectRuntimeResult>;
}

const NATIVE_ADAPTER_BY_PROVIDER_TYPE: Partial<Record<ProviderTypeEnum, AdapterType>> = {
  [ProviderTypeEnum.OpenAI]: 'native_openai',
  [ProviderTypeEnum.Anthropic]: 'native_anthropic',
  [ProviderTypeEnum.Gemini]: 'native_google',
};

function toAdapterType(type: ProviderTypeEnum | undefined): AdapterType {
  return (type && NATIVE_ADAPTER_BY_PROVIDER_TYPE[type]) || 'openai_compatible';
}

async function toProviderProfile(id: string, config: ProviderConfig): Promise<ProviderProfile> {
  const apiKeyRef = config.apiKeyRef || (config.apiKey?.trim() ? await deriveApiKeyRef(config.apiKey.trim()) : '');
  return {
    id,
    adapterType: toAdapterType(config.type),
    baseUrl: config.baseUrl || undefined,
    apiKeyRef: apiKeyRef || 'none',
    enabled: true,
    declaredCapabilities: ['chat'],
  };
}

function toModelDescriptors(providerId: string, config: ProviderConfig): ModelDescriptor[] {
  const names = config.modelNames ?? config.azureDeploymentNames ?? [];
  return names.map(modelId => ({
    providerId,
    modelId,
    capabilities: ['chat'],
    supportsStreaming: true,
  }));
}

/**
 * The chat feature binds to the navigator model (planner as fallback), the
 * same pair the legacy agent loop already resolves from `agent-models`.
 */
export function chatFeatureBinding(
  agentModels: Partial<Record<AgentNameEnum, ModelConfig>>,
): { primaryModel: string; fallbackModels: string[] } | null {
  const navigator = agentModels[AgentNameEnum.Navigator];
  const planner = agentModels[AgentNameEnum.Planner];
  const primary = navigator?.modelName?.trim() || planner?.modelName?.trim() || '';
  if (!primary) return null;
  const fallback = planner?.modelName?.trim();
  return { primaryModel: primary, fallbackModels: fallback && fallback !== primary ? [fallback] : [] };
}

function unsupportedAdapterRuntime(provider: ProviderProfile): ReturnType<RuntimeFactory> {
  return {
    async *streamTurn() {
      yield { type: 'error', error: new Error(`adapter "${provider.adapterType}" 还没接入 chat 直连`) };
    },
  };
}

/** Default factory: only OpenAI-compatible wire formats stream directly today. */
const defaultRuntimeFactory: RuntimeFactory = (model, apiKey, provider) =>
  provider.adapterType === 'openai_compatible' || provider.adapterType === 'native_openai'
    ? createOpenAICompatibleRuntime(model, apiKey, provider)
    : unsupportedAdapterRuntime(provider);

async function loadHistoryTurns(
  getSessionMessages: ChatStreamDeps['getSessionMessages'],
  sessionId: string,
  text: string,
): Promise<ChatTurn[]> {
  try {
    const stored = await getSessionMessages(sessionId);
    const turns: ChatTurn[] = (stored ?? [])
      .filter(message => message.actor === Actors.USER || message.actor === Actors.SYSTEM)
      .slice(-20)
      .map(message => ({
        role: message.actor === Actors.USER ? 'user' : 'assistant',
        content: message.content,
      }));
    const last = turns[turns.length - 1];
    if (!last || last.role !== 'user' || last.content !== text) {
      turns.push({ role: 'user', content: text });
    }
    return turns;
  } catch (error) {
    logger.error('Failed to load chat session history', error);
    return [{ role: 'user', content: text }];
  }
}

/**
 * Handle one `chat_stream` request from the side panel: resolve the chat
 * feature model through contracts + agent-core, then push every token back
 * over the port. Key material stays inside this handler (service worker).
 */
export function createChatStreamHandler(deps: ChatStreamDeps) {
  const selectRuntimeImpl = deps.selectRuntimeImpl ?? selectRuntime;
  return async function handleChatStream(request: ChatStreamRequest, port: ChatStreamPort): Promise<void> {
    const { sessionId, text } = request;
    const post = (message: ChatStreamEvent): boolean => {
      try {
        port.postMessage(message);
        return true;
      } catch {
        return false; // panel closed mid-stream; drop the rest
      }
    };

    const [providers, agentModels] = await Promise.all([deps.getProviders(), deps.getAgentModels()]);
    const binding = chatFeatureBinding(agentModels);
    if (!binding) {
      post({ type: 'chat_stream_error', sessionId, error: CHAT_STREAM_UNBOUND_ERROR });
      return;
    }

    const providerEntries = Object.entries(providers);
    const profiles: ProviderProfile[] = [];
    const models: ModelDescriptor[] = [];
    for (const [id, config] of providerEntries) {
      profiles.push(await toProviderProfile(id, config));
      models.push(...toModelDescriptors(id, config));
    }

    const result = await selectRuntimeImpl(
      {
        featureId: CHAT_FEATURE_ID,
        bindings: [{ featureId: CHAT_FEATURE_ID, ...binding }],
        requirements: [{ featureId: CHAT_FEATURE_ID, requiredCapabilities: ['chat'] }],
        providers: profiles,
        models,
        factory: deps.runtimeFactory,
      },
      deps.getApiKey,
    );

    if (!result.ok) {
      const detail =
        result.reason === 'missing_api_key'
          ? `chat 模型缺少 API key（${result.provider.id}）`
          : CHAT_STREAM_UNBOUND_ERROR;
      post({ type: 'chat_stream_error', sessionId, error: detail });
      return;
    }

    const messages = await loadHistoryTurns(deps.getSessionMessages, sessionId, text);

    let finished = false;
    for await (const event of runRecipe(webChatRecipe, { runtime: result.runtime, model: result.model, messages })) {
      if (event.type === 'token') {
        if (!post({ type: 'chat_stream_delta', sessionId, text: event.text })) return;
      } else if (event.type === 'done') {
        post({ type: 'chat_stream_done', sessionId });
        finished = true;
      } else {
        post({ type: 'chat_stream_error', sessionId, error: event.text });
        finished = true;
      }
    }
    if (!finished) post({ type: 'chat_stream_done', sessionId });
  };
}

/** Production handler bound to chrome.storage-backed deps. */
export const handleChatStream = createChatStreamHandler({
  getProviders: () => llmProviderStore.getAllProviders(),
  getAgentModels: () => agentModelStore.getAllAgentModels(),
  getApiKey: async ref => (await getApiKey(ref)) ?? null,
  getSessionMessages: async sessionId => (await chatHistoryStore.getSession(sessionId))?.messages ?? null,
  runtimeFactory: defaultRuntimeFactory,
});

/** Validate an incoming port message; returns the request or null. */
export function parseChatStreamRequest(message: unknown): ChatStreamRequest | null {
  if (!message || typeof message !== 'object') return null;
  const record = message as Record<string, unknown>;
  if (record.type !== 'chat_stream') return null;
  if (typeof record.sessionId !== 'string' || !record.sessionId) return null;
  if (typeof record.text !== 'string' || !record.text.trim()) return null;
  return { sessionId: record.sessionId, text: record.text };
}

/** Entry for the side-panel port switch: parse, then stream over the port. */
export async function handleChatStreamRequest(message: unknown, port: ChatStreamPort): Promise<void> {
  const request = parseChatStreamRequest(message);
  if (!request) {
    port.postMessage({ type: 'chat_stream_error', sessionId: '', error: 'invalid chat_stream message' });
    return;
  }
  await handleChatStream(request, port);
}
