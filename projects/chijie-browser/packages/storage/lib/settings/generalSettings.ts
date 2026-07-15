import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

// Interface for general settings configuration
export interface GeneralSettingsConfig {
  maxSteps: number;
  maxActionsPerStep: number;
  maxFailures: number;
  useVision: boolean;
  useVisionForPlanner: boolean;
  planningInterval: number;
  displayHighlights: boolean;
  minWaitPageLoad: number;
  /**
   * Agent execution core (design/002).
   * nano = Planner/Navigator (default until control is stable).
   * control = P1-parity control loop under TaskManager.
   */
  agentCoreBackend?: 'nano' | 'control';
}

export type GeneralSettingsStorage = BaseStorage<GeneralSettingsConfig> & {
  updateSettings: (settings: Partial<GeneralSettingsConfig>) => Promise<void>;
  getSettings: () => Promise<GeneralSettingsConfig>;
  resetToDefaults: () => Promise<void>;
};

// Default settings
export const DEFAULT_GENERAL_SETTINGS: GeneralSettingsConfig = {
  maxSteps: 100,
  maxActionsPerStep: 5,
  maxFailures: 3,
  useVision: false,
  useVisionForPlanner: false,
  planningInterval: 3,
  // Off: numbered boxes on the live page are debug-only, not product UI.
  displayHighlights: false,
  minWaitPageLoad: 250,
  agentCoreBackend: 'control',
};

/** Flip old installs that still ship displayHighlights:true from legacy defaults. */
const HIGHLIGHTS_OFF_MIGRATION = 'general-settings-highlights-off-v1';

const storage = createStorage<GeneralSettingsConfig>('general-settings', DEFAULT_GENERAL_SETTINGS, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export const generalSettingsStore: GeneralSettingsStorage = {
  ...storage,
  async updateSettings(settings: Partial<GeneralSettingsConfig>) {
    const currentSettings = (await storage.get()) || DEFAULT_GENERAL_SETTINGS;
    const updatedSettings = {
      ...currentSettings,
      ...settings,
    };
    // useVision and displayHighlights are independent: vision screenshots must
    // not force color boxes on the user's page.

    await storage.set(updatedSettings);
  },
  async getSettings() {
    const settings = await storage.get();
    const merged = {
      ...DEFAULT_GENERAL_SETTINGS,
      ...settings,
    };

    // One-time product migration: legacy default was true; clear it once so
    // existing profiles match "clean page" without asking users to hunt a toggle.
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const flag = await chrome.storage.local.get(HIGHLIGHTS_OFF_MIGRATION);
        if (!flag[HIGHLIGHTS_OFF_MIGRATION] && merged.displayHighlights === true) {
          merged.displayHighlights = false;
          await storage.set(merged);
          await chrome.storage.local.set({ [HIGHLIGHTS_OFF_MIGRATION]: true });
        } else if (!flag[HIGHLIGHTS_OFF_MIGRATION]) {
          await chrome.storage.local.set({ [HIGHLIGHTS_OFF_MIGRATION]: true });
        }
      }
    } catch {
      // Non-extension test env: leave merged as-is
    }

    return merged;
  },
  async resetToDefaults() {
    await storage.set(DEFAULT_GENERAL_SETTINGS);
  },
};
