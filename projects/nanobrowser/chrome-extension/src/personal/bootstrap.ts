import { agentModelStore, AgentNameEnum, llmProviderStore } from '@extension/storage';
import { createLogger } from '../background/log';
import { PERSONAL_AGENT_MODELS, PERSONAL_PROVIDER, PERSONAL_PROVIDER_ID } from './config';
import { PERSONAL_MINIMAX_API_KEY } from './secrets.local';

const logger = createLogger('PersonalBootstrap');

let bootstrapPromise: Promise<void> | null = null;

/**
 * Force-seed personal MiniMax-M3 config into chrome.storage.
 * Self-use fork: overwrites GUI settings so a refresh always restores working defaults.
 * Safe to call repeatedly; concurrent callers share one in-flight promise then re-run write.
 */
export async function ensurePersonalDefaults(): Promise<void> {
  // Serialize so setupExecutor never races an incomplete write.
  if (bootstrapPromise) {
    await bootstrapPromise;
  }

  bootstrapPromise = (async () => {
    const apiKey = (PERSONAL_MINIMAX_API_KEY || '').trim();
    if (!apiKey) {
      logger.error(
        'PERSONAL_MINIMAX_API_KEY is empty. Run: node chrome-extension/scripts/inject-personal-secrets.mjs && pnpm build',
      );
      return;
    }

    // Drop other providers so GUI leftovers cannot steal agent routing.
    const existing = await llmProviderStore.getAllProviders();
    for (const id of Object.keys(existing)) {
      if (id !== PERSONAL_PROVIDER_ID) {
        await llmProviderStore.removeProvider(id);
      }
    }

    await llmProviderStore.setProvider(PERSONAL_PROVIDER_ID, {
      name: PERSONAL_PROVIDER.name,
      type: PERSONAL_PROVIDER.type,
      apiKey,
      baseUrl: PERSONAL_PROVIDER.baseUrl,
      modelNames: [...PERSONAL_PROVIDER.modelNames],
      createdAt: Date.now(),
    });

    for (const agent of [AgentNameEnum.Planner, AgentNameEnum.Navigator] as const) {
      const cfg = PERSONAL_AGENT_MODELS[agent];
      await agentModelStore.setAgentModel(agent, {
        provider: cfg.provider,
        modelName: cfg.modelName,
        parameters: { ...cfg.parameters },
      });
    }

    // Verify round-trip from storage (what createChatModel will actually read).
    const saved = await llmProviderStore.getProvider(PERSONAL_PROVIDER_ID);
    const prefix = (saved?.apiKey || '').slice(0, 10);
    const base = saved?.baseUrl || '';
    logger.info(
      `Personal defaults applied: provider=${PERSONAL_PROVIDER_ID} model=${PERSONAL_AGENT_MODELS[AgentNameEnum.Navigator].modelName} base=${base} keyPrefix=${prefix}… keyLen=${(saved?.apiKey || '').length}`,
    );
    if (!saved?.apiKey || saved.apiKey !== apiKey) {
      logger.error('Storage round-trip mismatch for MiniMax API key after bootstrap');
    }
  })();

  try {
    await bootstrapPromise;
  } finally {
    bootstrapPromise = null;
  }
}
