import { useState, useEffect } from 'react';
import { analyticsSettingsStore } from '@extension/storage';
import type { AnalyticsSettingsConfig } from '@extension/storage';

const CARD = 'rounded-lg border border-[var(--chijie-border)] bg-[var(--chijie-surface)] p-6 text-left';
const HEADING = 'mb-4 text-xl font-semibold text-[var(--chijie-foreground)]';
const PANEL = 'rounded-md border border-[var(--chijie-border-strong)] bg-[var(--chijie-surface-raised)] p-4';
const LABEL = 'text-base font-medium text-[var(--chijie-foreground)]';
const MUTED = 'text-sm text-[var(--chijie-muted)]';
const LIST = 'list-disc space-y-2 pl-5 text-left text-sm text-[var(--chijie-foreground)]';

export const AnalyticsSettings = () => {
  const [settings, setSettings] = useState<AnalyticsSettingsConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        setSettings(await analyticsSettingsStore.getSettings());
      } catch (error) {
        console.error('Failed to load analytics settings:', error);
      } finally {
        setLoading(false);
      }
    };

    void loadSettings();
    return analyticsSettingsStore.subscribe(() => {
      void loadSettings();
    });
  }, []);

  const handleToggleAnalytics = async (enabled: boolean) => {
    if (!settings) return;
    try {
      await analyticsSettingsStore.updateSettings({ enabled });
      setSettings({ ...settings, enabled });
    } catch (error) {
      console.error('Failed to update analytics settings:', error);
    }
  };

  if (loading) {
    return (
      <section className="space-y-6">
        <div className={CARD}>
          <h2 className={HEADING}>Analytics Settings</h2>
          <div className="animate-pulse">
            <div className="mb-2 h-4 w-3/4 rounded bg-[var(--chijie-border-strong)]" />
            <div className="h-4 w-1/2 rounded bg-[var(--chijie-border-strong)]" />
          </div>
        </div>
      </section>
    );
  }

  if (!settings) {
    return (
      <section className="space-y-6">
        <div className={CARD}>
          <h2 className={HEADING}>Analytics Settings</h2>
          <p className="text-[var(--chijie-accent-signal)]">Failed to load analytics settings.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className={CARD}>
        <h2 className={HEADING}>Analytics Settings</h2>

        <div className="space-y-6">
          <div className="my-6 rounded-lg border border-[var(--chijie-border)] bg-[var(--chijie-surface-raised)] p-4">
            <div className="flex items-center justify-between">
              <label htmlFor="analytics-enabled" className={LABEL}>
                Help improve 持节
              </label>
              <div className="relative inline-block w-12 select-none">
                <input
                  type="checkbox"
                  checked={settings.enabled}
                  onChange={e => handleToggleAnalytics(e.target.checked)}
                  className="sr-only"
                  id="analytics-enabled"
                />
                <label
                  htmlFor="analytics-enabled"
                  className={`block h-6 cursor-pointer overflow-hidden rounded-full ${
                    settings.enabled ? 'bg-[var(--chijie-accent)]' : 'bg-[var(--chijie-border-strong)]'
                  }`}>
                  <span className="sr-only">Toggle analytics</span>
                  <span
                    className={`block size-6 rounded-full bg-[var(--chijie-surface-raised)] transition-transform ${
                      settings.enabled ? 'translate-x-6' : 'translate-x-0'
                    }`}
                  />
                </label>
              </div>
            </div>
            <p className={`mt-2 ${MUTED}`}>Share anonymous usage data to help us improve the extension</p>
          </div>

          <div className={PANEL}>
            <h3 className={`${LABEL} mb-4`}>What we collect:</h3>
            <ul className={LIST}>
              <li>Task execution metrics (start, completion, failure counts and duration)</li>
              <li>Domain names of websites visited (e.g., &quot;amazon.com&quot;, not full URLs)</li>
              <li>Error categories for failed tasks (no sensitive details)</li>
              <li>Anonymous usage statistics</li>
            </ul>

            <h3 className={`${LABEL} mb-4 mt-6`}>What we DON&apos;T collect:</h3>
            <ul className={LIST}>
              <li>Personal information or login credentials</li>
              <li>Full URLs or page content</li>
              <li>Task instructions or user prompts</li>
              <li>Screen recordings or screenshots</li>
              <li>Any sensitive or private data</li>
            </ul>
          </div>

          {!settings.enabled && (
            <div className={PANEL}>
              <p className={MUTED}>Analytics disabled. You can re-enable it anytime to help improve 持节.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
