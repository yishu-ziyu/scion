/**
 * Personal fork defaults for this machine only.
 * Keys are injected into secrets.local.ts at build time (gitignored).
 */
import { AgentNameEnum, ProviderTypeEnum } from '@extension/storage';
import type { AgentCoreBackend } from '../background/agent/backends/types';

export const PERSONAL_PROVIDER_ID = 'minimax';

export const PERSONAL_PROVIDER = {
  name: 'MiniMax',
  type: ProviderTypeEnum.CustomOpenAI,
  baseUrl: 'https://api.minimaxi.com/v1',
  modelNames: ['MiniMax-M3'] as string[],
};

export const PERSONAL_MODEL = 'MiniMax-M3';

/**
 * Agent core backend override (design/002).
 * `control` = production default for this machine (G6).
 * Set null to follow generalSettings; set `nano` to force legacy Planner/Navigator.
 */
export const PERSONAL_AGENT_CORE_BACKEND: AgentCoreBackend | null = 'control';

/** Planner + Navigator both use M3 for self-use simplicity. */
export const PERSONAL_AGENT_MODELS = {
  [AgentNameEnum.Planner]: {
    provider: PERSONAL_PROVIDER_ID,
    modelName: PERSONAL_MODEL,
    parameters: { temperature: 0.3, topP: 0.6 },
  },
  [AgentNameEnum.Navigator]: {
    provider: PERSONAL_PROVIDER_ID,
    modelName: PERSONAL_MODEL,
    parameters: { temperature: 0.2, topP: 0.5 },
  },
} as const;
