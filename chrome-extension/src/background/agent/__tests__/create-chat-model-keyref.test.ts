import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ModelConfig, ProviderConfig } from '@extension/storage';

// The storage base module captures `globalThis.chrome` at import time,
// so the mock must be installed before any storage module is imported.
const localData: Record<string, unknown> = {};
(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: {
    local: {
      get: async (keys: string[]) =>
        Object.fromEntries(keys.filter(key => key in localData).map(key => [key, localData[key]])),
      set: async (items: Record<string, unknown>) => {
        Object.assign(localData, items);
      },
      onChanged: { addListener: () => {} },
    },
  },
};

let storage: typeof import('@extension/storage');
let createChatModel: (typeof import('../helper'))['createChatModel'];

beforeAll(async () => {
  storage = await import('@extension/storage');
  ({ createChatModel } = await import('../helper'));
});

beforeEach(() => {
  for (const key of Object.keys(localData)) {
    delete localData[key];
  }
});

const modelConfig: ModelConfig = {
  provider: 'my-custom',
  modelName: 'test-model',
  parameters: { temperature: 0.2, topP: 0.5 },
};

describe('createChatModel with apiKeyRef', () => {
  it('resolves the key from the vault; the provider config carries no plaintext', async () => {
    const key = 'sk-vault-resolved-9876';
    const ref = await storage.deriveApiKeyRef(key);
    await storage.putApiKey(ref, key);

    const providerConfig: ProviderConfig = {
      apiKey: '',
      apiKeyRef: ref,
      type: storage.ProviderTypeEnum.CustomOpenAI,
      baseUrl: 'https://api.example.com/v1',
      modelNames: ['test-model'],
    };

    const model = await createChatModel(providerConfig, modelConfig);

    // The LangChain client received the vault key...
    expect((model as unknown as { apiKey?: string }).apiKey).toBe(key);
    // ...while the config object itself still holds no plaintext.
    expect(providerConfig.apiKey).toBe('');
    expect(JSON.stringify(providerConfig)).not.toContain(key);
  });

  it('falls back to the inline apiKey when no ref is set (legacy/local providers)', async () => {
    const providerConfig: ProviderConfig = {
      apiKey: 'sk-inline-legacy-1111',
      type: storage.ProviderTypeEnum.CustomOpenAI,
      baseUrl: 'https://api.example.com/v1',
      modelNames: ['test-model'],
    };

    const model = await createChatModel(providerConfig, modelConfig);
    expect((model as unknown as { apiKey?: string }).apiKey).toBe('sk-inline-legacy-1111');
  });

  it('falls back to the inline apiKey when the ref is missing from the vault', async () => {
    const providerConfig: ProviderConfig = {
      apiKey: 'sk-inline-fallback-2222',
      apiKeyRef: 'deadbeefdeadbeef',
      type: storage.ProviderTypeEnum.CustomOpenAI,
      baseUrl: 'https://api.example.com/v1',
      modelNames: ['test-model'],
    };

    const model = await createChatModel(providerConfig, modelConfig);
    expect((model as unknown as { apiKey?: string }).apiKey).toBe('sk-inline-fallback-2222');
  });
});
