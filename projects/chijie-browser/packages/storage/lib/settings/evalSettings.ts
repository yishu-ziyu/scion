import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

export interface EvalFeatureFlags {
  enableAgentStatusBar: boolean;
  enableDeterministicFormFill: boolean;
  enableDeterministicBilibili: boolean;
  enableDeterministicYouTube: boolean;
  enableRetryRecovery: boolean;
  /** Book ch2-style trajectory compression in control-llm userPrompt. */
  enableContextCompression: boolean;
}

export interface EvalSettingsConfig {
  traceEnabled: boolean;
  featureFlags: EvalFeatureFlags;
}

export type EvalSettingsStorage = BaseStorage<EvalSettingsConfig> & {
  updateSettings: (settings: Partial<EvalSettingsConfig>) => Promise<void>;
  getSettings: () => Promise<EvalSettingsConfig>;
  resetToDefaults: () => Promise<void>;
};

export const DEFAULT_EVAL_SETTINGS: EvalSettingsConfig = {
  traceEnabled: true,
  featureFlags: {
    enableAgentStatusBar: true,
    enableDeterministicFormFill: true,
    enableDeterministicBilibili: true,
    enableDeterministicYouTube: true,
    enableRetryRecovery: true,
    enableContextCompression: true,
  },
};

const storage = createStorage<EvalSettingsConfig>('eval-settings', DEFAULT_EVAL_SETTINGS, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export const evalSettingsStore: EvalSettingsStorage = {
  ...storage,
  async updateSettings(settings: Partial<EvalSettingsConfig>) {
    const current = (await storage.get()) || DEFAULT_EVAL_SETTINGS;
    const updated = {
      ...current,
      ...settings,
      featureFlags: {
        ...current.featureFlags,
        ...(settings.featureFlags ?? {}),
      },
    };
    await storage.set(updated);
  },
  async getSettings() {
    const settings = await storage.get();
    return {
      ...DEFAULT_EVAL_SETTINGS,
      ...settings,
      featureFlags: {
        ...DEFAULT_EVAL_SETTINGS.featureFlags,
        ...(settings?.featureFlags ?? {}),
      },
    };
  },
  async resetToDefaults() {
    await storage.set(DEFAULT_EVAL_SETTINGS);
  },
};
