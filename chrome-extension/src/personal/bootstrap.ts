import {
  agentModelStore,
  deriveApiKeyRef,
  getApiKey,
  llmProviderStore,
  maskApiKey,
  putApiKey,
} from '@extension/storage';
import { createLogger } from '../background/log';
import { PERSONAL_MODEL_CONFIG, PERSONAL_PROVIDER, PERSONAL_PROVIDER_ID } from './config';
import { PERSONAL_MINIMAX_API_KEY } from './secrets.local';

const logger = createLogger('PersonalBootstrap');

let bootstrapPromise: Promise<void> | null = null;

/**
 * Move any legacy plaintext `ProviderConfig.apiKey` into the vault and leave
 * only `apiKeyRef` on the provider record. Idempotent: a record whose
 * plaintext key is empty (already migrated) is skipped, and the vault write
 * uses a deterministic ref so re-runs converge on the same entry.
 */
export async function migratePlaintextApiKeys(): Promise<void> {
  const providers = await llmProviderStore.getAllProviders();
  for (const [providerId, config] of Object.entries(providers)) {
    const plaintext = (config.apiKey || '').trim();
    if (!plaintext) continue;
    const ref = await deriveApiKeyRef(plaintext);
    await putApiKey(ref, plaintext);
    await llmProviderStore.setProvider(providerId, { ...config, apiKey: '', apiKeyRef: ref });
    logger.info(`Migrated API key into vault: provider=${providerId} ref=${ref}`);
  }
}

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

    // Move legacy plaintext keys into the vault before anything else reads them.
    await migratePlaintextApiKeys();

    // The personal key lives in the vault; provider records only hold its ref.
    const apiKeyRef = await deriveApiKeyRef(apiKey);
    await putApiKey(apiKeyRef, apiKey);

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
      apiKey: '',
      apiKeyRef,
      baseUrl: PERSONAL_PROVIDER.baseUrl,
      modelNames: [...PERSONAL_PROVIDER.modelNames],
      createdAt: Date.now(),
    });

    await agentModelStore.setModel({
      provider: PERSONAL_MODEL_CONFIG.provider,
      modelName: PERSONAL_MODEL_CONFIG.modelName,
      parameters: { ...PERSONAL_MODEL_CONFIG.parameters },
    });

    // Verify the vault round-trip (what createChatModel will actually resolve).
    const saved = await llmProviderStore.getProvider(PERSONAL_PROVIDER_ID);
    const savedKey = saved?.apiKeyRef ? await getApiKey(saved.apiKeyRef) : undefined;
    logger.info(
      `Personal defaults applied: provider=${PERSONAL_PROVIDER_ID} model=${PERSONAL_MODEL_CONFIG.modelName} base=${saved?.baseUrl || ''} keyRef=${saved?.apiKeyRef || 'none'} key=${maskApiKey(savedKey || '')}`,
    );
    if (!savedKey || savedKey !== apiKey) {
      logger.error('Vault round-trip mismatch for MiniMax API key after bootstrap');
    }
  })();

  try {
    await bootstrapPromise;
  } finally {
    bootstrapPromise = null;
  }
}
