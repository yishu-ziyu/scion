import type { FeatureBinding, FeatureRequirement, ModelDescriptor, ProviderProfile } from '@extension/contracts';
import { describe, expect, it } from 'vitest';
import { selectRuntime } from './router';
import type { AgentRuntime, ChatTurn, TurnStreamEvent } from './types';

const provider: ProviderProfile = {
  id: 'local',
  adapterType: 'openai_compatible',
  baseUrl: 'http://localhost:11434/v1',
  apiKeyRef: 'secret/local',
  enabled: true,
  declaredCapabilities: ['chat'],
};

const model: ModelDescriptor = {
  providerId: 'local',
  modelId: 'qwen3',
  capabilities: ['chat'],
  supportsStreaming: true,
};

const bindings: FeatureBinding[] = [{ featureId: 'sidepanel_chat', primaryModel: 'qwen3', fallbackModels: [] }];
const requirements: FeatureRequirement[] = [{ featureId: 'sidepanel_chat', requiredCapabilities: ['chat'] }];

const stubRuntime: AgentRuntime = {
  async *streamTurn(_messages: ChatTurn[]): AsyncGenerator<TurnStreamEvent> {
    yield { type: 'done' };
  },
};

const input = { featureId: 'sidepanel_chat', bindings, requirements, providers: [provider], models: [model] };

describe('selectRuntime', () => {
  it('builds a runtime from the resolved model and the vault key', async () => {
    const factoryCalls: Array<[string, string, string]> = [];
    const result = await selectRuntime(
      {
        ...input,
        factory: (m, apiKey, p) => {
          factoryCalls.push([m.modelId, apiKey, p.id]);
          return stubRuntime;
        },
      },
      async apiKeyRef => (apiKeyRef === 'secret/local' ? 'sk-test' : null),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.model).toBe(model);
      expect(result.provider).toBe(provider);
      expect(result.runtime).toBe(stubRuntime);
    }
    expect(factoryCalls).toEqual([['qwen3', 'sk-test', 'local']]);
  });

  it('fails without touching the vault when no model can be resolved', async () => {
    let vaultTouched = false;
    const result = await selectRuntime({ ...input, featureId: 'unknown_feature', factory: () => stubRuntime }, () => {
      vaultTouched = true;
      return 'sk-test';
    });

    expect(result).toMatchObject({ ok: false, reason: 'unresolved' });
    expect(vaultTouched).toBe(false);
  });

  it('fails with missing_api_key when the vault has no key for the provider', async () => {
    const result = await selectRuntime({ ...input, factory: () => stubRuntime }, async () => null);

    expect(result).toMatchObject({ ok: false, reason: 'missing_api_key', apiKeyRef: 'secret/local' });
  });
});
