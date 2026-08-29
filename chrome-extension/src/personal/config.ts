/**
 * Personal fork defaults for this machine only.
 * Keys are injected into secrets.local.ts at build time (gitignored).
 */
import { ProviderTypeEnum } from '@extension/storage';

export const PERSONAL_PROVIDER_ID = 'minimax';

export const PERSONAL_PROVIDER = {
  name: 'MiniMax',
  type: ProviderTypeEnum.CustomOpenAI,
  baseUrl: 'https://api.minimaxi.com/v1',
  modelNames: ['MiniMax-M3'] as string[],
};

export const PERSONAL_MODEL = 'MiniMax-M3';

export const PERSONAL_MODEL_CONFIG = {
  provider: PERSONAL_PROVIDER_ID,
  modelName: PERSONAL_MODEL,
  parameters: { temperature: 0.2, topP: 0.5 },
} as const;
