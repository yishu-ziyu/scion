import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';
import { llmProviderParameters } from './types';

export interface ModelConfig {
  // providerId, the key of the provider in the llmProviderStore, not the provider name
  provider: string;
  modelName: string;
  parameters?: Record<string, unknown>;
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'; // For o-series models (OpenAI and Azure)
}

/**
 * chrome.storage `agent-models`.
 * `model` is the one config the product uses.
 * `agents` is the old planner/navigator/validator map; read as fallback, dropped on write.
 */
export interface AgentModelRecord {
  model?: ModelConfig;
  agents?: Record<string, ModelConfig>;
}

const LEGACY_SLOTS = ['navigator', 'planner', 'validator'] as const;

function isUsable(config: ModelConfig | undefined): config is ModelConfig {
  return Boolean(config?.provider && config?.modelName);
}

export function pickStoredModel(record: AgentModelRecord | null | undefined): ModelConfig | undefined {
  if (!record) return undefined;
  if (isUsable(record.model)) return record.model;
  for (const slot of LEGACY_SLOTS) {
    const cfg = record.agents?.[slot];
    if (isUsable(cfg)) return cfg;
  }
  return undefined;
}

export type AgentModelStorage = BaseStorage<AgentModelRecord> & {
  getModel: () => Promise<ModelConfig | undefined>;
  setModel: (config: ModelConfig) => Promise<void>;
  resetModel: () => Promise<void>;
  hasModel: () => Promise<boolean>;
};

const storage = createStorage<AgentModelRecord>(
  'agent-models',
  {},
  {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  },
);

function validateModelConfig(config: ModelConfig) {
  if (!config.provider || !config.modelName) {
    throw new Error('Provider and model name must be specified');
  }
}

function defaultParameters(provider: string): Record<string, unknown> {
  return llmProviderParameters[provider as keyof typeof llmProviderParameters] ?? { temperature: 0.1, topP: 0.1 };
}

function withDefaults(config: ModelConfig): ModelConfig {
  return {
    ...config,
    parameters: {
      ...defaultParameters(config.provider),
      ...config.parameters,
    },
  };
}

export const agentModelStore: AgentModelStorage = {
  ...storage,
  getModel: async () => {
    const data = await storage.get();
    const picked = pickStoredModel(data);
    if (!picked) return undefined;
    if (!isUsable(data.model)) {
      await storage.set({ model: withDefaults(picked) });
    }
    return withDefaults(picked);
  },
  setModel: async config => {
    validateModelConfig(config);
    await storage.set({ model: withDefaults(config) });
  },
  resetModel: async () => {
    await storage.set({});
  },
  hasModel: async () => Boolean(pickStoredModel(await storage.get())),
};
