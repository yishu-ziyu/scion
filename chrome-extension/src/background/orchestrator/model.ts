import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';

export const DEFAULT_COMPAT_BASE_URL = 'https://api.minimaxi.com/v1';

const COMPAT_ADAPTERS = new Set(['openai_compatible', 'native_openai']);

/** MiniMax and any OpenAI-compatible provider. Returns null for adapters this slice does not wire. */
export function createCompatibleLanguageModel(input: {
  modelId: string;
  apiKey: string;
  baseUrl?: string;
  providerId?: string;
  adapterType?: string;
}): LanguageModel | null {
  if (input.adapterType && !COMPAT_ADAPTERS.has(input.adapterType)) return null;
  const provider = createOpenAICompatible({
    name: input.providerId || 'openai-compatible',
    apiKey: input.apiKey,
    baseURL: input.baseUrl || DEFAULT_COMPAT_BASE_URL,
  });
  return provider.chatModel(input.modelId);
}
