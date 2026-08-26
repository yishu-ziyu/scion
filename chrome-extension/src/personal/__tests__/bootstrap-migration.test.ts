import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
let migratePlaintextApiKeys: (typeof import('../bootstrap'))['migratePlaintextApiKeys'];

beforeAll(async () => {
  storage = await import('@extension/storage');
  ({ migratePlaintextApiKeys } = await import('../bootstrap'));
});

beforeEach(() => {
  for (const key of Object.keys(localData)) {
    delete localData[key];
  }
});

describe('migratePlaintextApiKeys', () => {
  it('moves a plaintext apiKey into the vault and leaves only apiKeyRef', async () => {
    const key = 'sk-legacy-1234567890';
    await storage.llmProviderStore.setProvider('openai', {
      apiKey: key,
      type: storage.ProviderTypeEnum.OpenAI,
      modelNames: ['gpt-test'],
    });

    await migratePlaintextApiKeys();

    const saved = await storage.llmProviderStore.getProvider('openai');
    expect(saved?.apiKey).toBe('');
    const ref = await storage.deriveApiKeyRef(key);
    expect(saved?.apiKeyRef).toBe(ref);
    expect(await storage.getApiKey(ref)).toBe(key);

    // The stored record no longer contains the key material anywhere.
    expect(JSON.stringify(localData['llm-api-keys'])).not.toContain(key);
  });

  it('is idempotent: a second run changes nothing', async () => {
    const key = 'sk-legacy-abcdefghij';
    await storage.llmProviderStore.setProvider('openai', {
      apiKey: key,
      type: storage.ProviderTypeEnum.OpenAI,
      modelNames: ['gpt-test'],
    });

    await migratePlaintextApiKeys();
    const first = await storage.llmProviderStore.getProvider('openai');
    const refsFirst = await storage.listKeyRefs();

    await migratePlaintextApiKeys();
    const second = await storage.llmProviderStore.getProvider('openai');
    const refsSecond = await storage.listKeyRefs();

    expect(second?.apiKey).toBe('');
    expect(second?.apiKeyRef).toBe(first?.apiKeyRef);
    expect(refsSecond).toEqual(refsFirst);
  });

  it('leaves ref-only providers untouched', async () => {
    const ref = '0123456789abcdef';
    await storage.putApiKey(ref, 'sk-vault-only-key');
    await storage.llmProviderStore.setProvider('minimax', {
      apiKey: '',
      apiKeyRef: ref,
      type: storage.ProviderTypeEnum.CustomOpenAI,
      baseUrl: 'https://api.minimaxi.com/v1',
      modelNames: ['MiniMax-M3'],
    });

    await migratePlaintextApiKeys();

    const saved = await storage.llmProviderStore.getProvider('minimax');
    expect(saved?.apiKey).toBe('');
    expect(saved?.apiKeyRef).toBe(ref);
    expect(await storage.getApiKey(ref)).toBe('sk-vault-only-key');
  });
});
