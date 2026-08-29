import {
  createOpenAICompatibleRuntime,
  selectRuntime,
  type ChatTurn,
  type RuntimeFactory,
  type SelectRuntimeResult,
} from '@extension/agent-core';
import type { AdapterType, ModelDescriptor, ProviderProfile } from '@extension/contracts';
import {
  Actors,
  ProviderTypeEnum,
  agentModelStore,
  chatHistoryStore,
  deriveApiKeyRef,
  getApiKey,
  llmProviderStore,
  type ModelConfig,
  type ProviderConfig,
} from '@extension/storage';
import type { LanguageModel, ModelMessage } from 'ai';
import { createLogger } from './log';
import { createCompatibleLanguageModel } from './orchestrator/model';
import { runOrchestratorTurn } from './orchestrator/run';
import { tryCheapStop } from './orchestrator/stop';
import type { OrchestratorHost } from './orchestrator/types';
import {
  attachRecalledSources,
  recallSavedSources as recallSavedSourcesFromLibrary,
  type RecalledSource,
} from './wisebase-runtime';

const logger = createLogger('ChatStream');

/** Feature id the side panel chat stream resolves its model through. */
export const CHAT_FEATURE_ID = 'chat';

export const CHAT_STREAM_UNBOUND_ERROR = '未绑定 chat 模型';

export interface ChatStreamRequest {
  sessionId: string;
  text: string;
}

export type ChatStreamEvent =
  | { type: 'chat_stream_source'; sessionId: string; source: { title: string; url: string } }
  | { type: 'chat_stream_delta'; sessionId: string; text: string }
  | { type: 'chat_stream_worker_started'; sessionId: string }
  | { type: 'chat_stream_done'; sessionId: string }
  | { type: 'chat_stream_error'; sessionId: string; error: string };

export interface ChatStreamPort {
  postMessage: (message: ChatStreamEvent) => void;
}

/** Everything the handler reads from the outside world; tests inject fakes. */
export interface ChatStreamDeps extends OrchestratorHost {
  getProviders: () => Promise<Record<string, ProviderConfig>>;
  getModel: () => Promise<ModelConfig | undefined>;
  getApiKey: (ref: string) => Promise<string | null>;
  getSessionMessages: (sessionId: string) => Promise<Array<{ actor: Actors; content: string }> | null>;
  runtimeFactory: RuntimeFactory;
  selectRuntimeImpl?: (
    input: Parameters<typeof selectRuntime>[0],
    getApiKey: Parameters<typeof selectRuntime>[1],
  ) => Promise<SelectRuntimeResult>;
  recallSavedSources?: (query: string) => Promise<RecalledSource[]>;
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

/** Bind chat to the one configured model. */
export function chatFeatureBinding(
  model: ModelConfig | undefined,
): { primaryModel: string; fallbackModels: string[] } | null {
  const primary = model?.modelName?.trim() || '';
  if (!primary) return null;
  return { primaryModel: primary, fallbackModels: [] };
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

/** Resolve any chat-capable recipe through the same configured chat model. */
export async function resolveChatRuntime(
  deps: ChatStreamDeps,
  featureId = CHAT_FEATURE_ID,
): Promise<SelectRuntimeResult | null> {
  const [providers, model] = await Promise.all([deps.getProviders(), deps.getModel()]);
  const binding = chatFeatureBinding(model);
  if (!binding) return null;

  const profiles: ProviderProfile[] = [];
  const models: ModelDescriptor[] = [];
  for (const [id, config] of Object.entries(providers)) {
    profiles.push(await toProviderProfile(id, config));
    models.push(...toModelDescriptors(id, config));
  }

  return (deps.selectRuntimeImpl ?? selectRuntime)(
    {
      featureId,
      bindings: [{ featureId, ...binding }],
      requirements: [{ featureId, requiredCapabilities: ['chat'] }],
      providers: profiles,
      models,
      factory: deps.runtimeFactory,
    },
    deps.getApiKey,
  );
}

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

function toModelMessages(turns: ChatTurn[]): ModelMessage[] {
  return turns
    .filter(
      (turn): turn is ChatTurn & { role: 'system' | 'user' | 'assistant' } =>
        turn.role === 'system' || turn.role === 'user' || turn.role === 'assistant',
    )
    .map(turn => ({ role: turn.role, content: turn.content }));
}

function postPort(port: ChatStreamPort, message: ChatStreamEvent): boolean {
  try {
    port.postMessage(message);
    return true;
  } catch {
    return false;
  }
}

async function resolveLanguageModel(
  deps: ChatStreamDeps,
): Promise<{ ok: true; model: LanguageModel } | { ok: false; error: string }> {
  const result = await resolveChatRuntime(deps);
  if (!result?.ok) {
    const error =
      result?.reason === 'missing_api_key'
        ? `chat 模型缺少 API key（${result.provider.id}）`
        : CHAT_STREAM_UNBOUND_ERROR;
    return { ok: false, error };
  }
  const apiKey = await deps.getApiKey(result.provider.apiKeyRef);
  if (!apiKey) return { ok: false, error: `chat 模型缺少 API key（${result.provider.id}）` };
  const model = (deps.createLanguageModel ?? createCompatibleLanguageModel)({
    modelId: result.model.modelId,
    apiKey,
    baseUrl: result.provider.baseUrl,
    providerId: result.provider.id,
    adapterType: result.provider.adapterType,
  });
  if (!model) return { ok: false, error: `adapter "${result.provider.adapterType}" 还没接入 chat 直连` };
  return { ok: true, model };
}

function emitOrchestratorEvent(
  post: (message: ChatStreamEvent) => boolean,
  sessionId: string,
  event:
    | { type: 'delta'; text: string }
    | { type: 'worker_started' }
    | { type: 'done' }
    | { type: 'error'; error: string },
): boolean {
  if (event.type === 'delta') return post({ type: 'chat_stream_delta', sessionId, text: event.text });
  if (event.type === 'worker_started') return post({ type: 'chat_stream_worker_started', sessionId });
  if (event.type === 'error') {
    post({ type: 'chat_stream_error', sessionId, error: event.error });
    return false;
  }
  return post({ type: 'chat_stream_done', sessionId });
}

/**
 * Handle one `chat_stream` request from the side panel: resolve the chat
 * model, then run the orchestrator (which may delegate to a worker).
 * Key material stays inside this handler (service worker).
 */
export function createChatStreamHandler(deps: ChatStreamDeps) {
  return async function handleChatStream(request: ChatStreamRequest, port: ChatStreamPort): Promise<void> {
    const { sessionId, text } = request;
    const post = (message: ChatStreamEvent): boolean => postPort(port, message);

    const stopped = await tryCheapStop({ text, sessionId, host: deps });
    if (stopped) {
      if (post({ type: 'chat_stream_delta', sessionId, text: stopped })) {
        post({ type: 'chat_stream_done', sessionId });
      }
      return;
    }

    const resolved = await resolveLanguageModel(deps);
    if (!resolved.ok) {
      post({ type: 'chat_stream_error', sessionId, error: resolved.error });
      return;
    }

    const recalled = await recallForChat(deps, text);
    const messages = toModelMessages(
      attachRecalledSources(await loadHistoryTurns(deps.getSessionMessages, sessionId, text), recalled),
    );
    if (!emitRecalledSource(post, sessionId, recalled[0])) return;

    try {
      await runOrchestratorTurn({
        model: resolved.model,
        messages,
        host: { ...deps, workerModel: deps.workerModel ?? resolved.model },
        sessionId,
        onEvent: event => emitOrchestratorEvent(post, sessionId, event),
      });
    } catch (error) {
      post({
        type: 'chat_stream_error',
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

/** Production dependencies stay in the service worker, including key lookup. */
export const productionChatStreamDeps: ChatStreamDeps = {
  getProviders: () => llmProviderStore.getAllProviders(),
  getModel: () => agentModelStore.getModel(),
  getApiKey: async ref => (await getApiKey(ref)) ?? null,
  getSessionMessages: async sessionId => (await chatHistoryStore.getSession(sessionId))?.messages ?? null,
  runtimeFactory: defaultRuntimeFactory,
  recallSavedSources: query => recallSavedSourcesFromLibrary(query),
};

let productionHandler = createChatStreamHandler(productionChatStreamDeps);

/** Attach TaskManager / page-read host after the service worker constructs them. */
export function attachChatStreamHost(host: OrchestratorHost): void {
  productionHandler = createChatStreamHandler({ ...productionChatStreamDeps, ...host });
}

export const handleChatStream = (request: ChatStreamRequest, port: ChatStreamPort) => productionHandler(request, port);

/** Validate an incoming port message; returns the request or null. */
export function parseChatStreamRequest(message: unknown): ChatStreamRequest | null {
  if (!message || typeof message !== 'object') return null;
  const record = message as Record<string, unknown>;
  if (record.type !== 'chat_stream') return null;
  if (typeof record.sessionId !== 'string' || !record.sessionId) return null;
  if (typeof record.text !== 'string' || !record.text.trim()) return null;
  return { sessionId: record.sessionId, text: record.text };
}

async function recallForChat(deps: ChatStreamDeps, text: string): Promise<RecalledSource[]> {
  if (!deps.recallSavedSources) return [];
  try {
    return await deps.recallSavedSources(text);
  } catch {
    return [];
  }
}

function emitRecalledSource(
  post: (message: ChatStreamEvent) => boolean,
  sessionId: string,
  top: RecalledSource | undefined,
): boolean {
  if (!top || !(top.title || top.url)) return true;
  return post({ type: 'chat_stream_source', sessionId, source: { title: top.title, url: top.url } });
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
