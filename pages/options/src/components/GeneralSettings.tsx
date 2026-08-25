import { useState, useEffect, type ReactNode } from 'react';
import { type GeneralSettingsConfig, generalSettingsStore, DEFAULT_GENERAL_SETTINGS } from '@extension/storage';
import { t } from '@extension/i18n';

const INPUT_CLASS =
  'w-20 rounded-md border border-[var(--chijie-border-strong)] bg-[var(--chijie-surface-raised)] px-3 py-2 text-[var(--chijie-foreground)]';
const TOGGLE_CLASS =
  "peer h-6 w-11 rounded-full bg-[var(--chijie-border-strong)] after:absolute after:left-[2px] after:top-[2px] after:size-5 after:rounded-full after:border after:border-[var(--chijie-border-strong)] after:bg-[var(--chijie-surface-raised)] after:transition-all after:content-[''] peer-checked:bg-[var(--chijie-accent)] peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-[var(--chijie-accent-subtle)]";

function SettingRow({ title, description, control }: { title: string; description: string; control: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h3 className="text-base font-medium text-[var(--chijie-foreground)]">{title}</h3>
        <p className="text-sm font-normal text-[var(--chijie-muted)]">{description}</p>
      </div>
      {control}
    </div>
  );
}

export const GeneralSettings = () => {
  const [settings, setSettings] = useState<GeneralSettingsConfig>(DEFAULT_GENERAL_SETTINGS);

  useEffect(() => {
    generalSettingsStore.getSettings().then(setSettings);
  }, []);

  const updateSetting = async <K extends keyof GeneralSettingsConfig>(key: K, value: GeneralSettingsConfig[K]) => {
    setSettings(prevSettings => ({ ...prevSettings, [key]: value }));
    await generalSettingsStore.updateSettings({ [key]: value } as Partial<GeneralSettingsConfig>);
    setSettings(await generalSettingsStore.getSettings());
  };

  return (
    <section className="space-y-6">
      <div className="rounded-lg border border-[var(--chijie-border)] bg-[var(--chijie-surface)] p-6 text-left">
        <h2 className="mb-4 text-left text-xl font-semibold text-[var(--chijie-foreground)]">
          {t('options_general_header')}
        </h2>

        <div className="space-y-4">
          <SettingRow
            title={t('options_general_maxSteps')}
            description={t('options_general_maxSteps_desc')}
            control={
              <>
                <label htmlFor="maxSteps" className="sr-only">
                  {t('options_general_maxSteps')}
                </label>
                <input
                  id="maxSteps"
                  type="number"
                  min={1}
                  max={50}
                  value={settings.maxSteps}
                  onChange={e => updateSetting('maxSteps', Number.parseInt(e.target.value, 10))}
                  className={INPUT_CLASS}
                />
              </>
            }
          />

          <SettingRow
            title={t('options_general_maxActions')}
            description={t('options_general_maxActions_desc')}
            control={
              <>
                <label htmlFor="maxActionsPerStep" className="sr-only">
                  {t('options_general_maxActions')}
                </label>
                <input
                  id="maxActionsPerStep"
                  type="number"
                  min={1}
                  max={50}
                  value={settings.maxActionsPerStep}
                  onChange={e => updateSetting('maxActionsPerStep', Number.parseInt(e.target.value, 10))}
                  className={INPUT_CLASS}
                />
              </>
            }
          />

          <SettingRow
            title={t('options_general_maxFailures')}
            description={t('options_general_maxFailures_desc')}
            control={
              <>
                <label htmlFor="maxFailures" className="sr-only">
                  {t('options_general_maxFailures')}
                </label>
                <input
                  id="maxFailures"
                  type="number"
                  min={1}
                  max={10}
                  value={settings.maxFailures}
                  onChange={e => updateSetting('maxFailures', Number.parseInt(e.target.value, 10))}
                  className={INPUT_CLASS}
                />
              </>
            }
          />

          <SettingRow
            title={t('options_general_enableVision')}
            description={t('options_general_enableVision_desc')}
            control={
              <div className="relative inline-flex cursor-pointer items-center">
                <input
                  id="useVision"
                  type="checkbox"
                  checked={settings.useVision}
                  onChange={e => updateSetting('useVision', e.target.checked)}
                  className="peer sr-only"
                />
                <label htmlFor="useVision" className={TOGGLE_CLASS}>
                  <span className="sr-only">{t('options_general_enableVision')}</span>
                </label>
              </div>
            }
          />

          <SettingRow
            title={t('options_general_displayHighlights')}
            description={t('options_general_displayHighlights_desc')}
            control={
              <div className="relative inline-flex cursor-pointer items-center">
                <input
                  id="displayHighlights"
                  type="checkbox"
                  checked={settings.displayHighlights}
                  onChange={e => updateSetting('displayHighlights', e.target.checked)}
                  className="peer sr-only"
                />
                <label htmlFor="displayHighlights" className={TOGGLE_CLASS}>
                  <span className="sr-only">{t('options_general_displayHighlights')}</span>
                </label>
              </div>
            }
          />

          <SettingRow
            title={t('options_general_planningInterval')}
            description={t('options_general_planningInterval_desc')}
            control={
              <>
                <label htmlFor="planningInterval" className="sr-only">
                  {t('options_general_planningInterval')}
                </label>
                <input
                  id="planningInterval"
                  type="number"
                  min={1}
                  max={20}
                  value={settings.planningInterval}
                  onChange={e => updateSetting('planningInterval', Number.parseInt(e.target.value, 10))}
                  className={INPUT_CLASS}
                />
              </>
            }
          />

          <SettingRow
            title={t('options_general_minWaitPageLoad')}
            description={t('options_general_minWaitPageLoad_desc')}
            control={
              <div className="flex items-center space-x-2">
                <label htmlFor="minWaitPageLoad" className="sr-only">
                  {t('options_general_minWaitPageLoad')}
                </label>
                <input
                  id="minWaitPageLoad"
                  type="number"
                  min={250}
                  max={5000}
                  step={50}
                  value={settings.minWaitPageLoad}
                  onChange={e => updateSetting('minWaitPageLoad', Number.parseInt(e.target.value, 10))}
                  className={INPUT_CLASS}
                />
              </div>
            }
          />
        </div>
      </div>
    </section>
  );
};
