import { useState, useEffect, useCallback } from 'react';
import { firewallStore } from '@extension/storage';
import { Button } from '@extension/ui';
import { t } from '@extension/i18n';

const LIST_CHIP_ON = 'bg-[var(--chijie-accent)] text-white shadow-none hover:scale-100';
const LIST_CHIP_OFF = 'bg-[var(--chijie-found)] text-[var(--chijie-foreground)] shadow-none hover:scale-100';
const REMOVE_BTN =
  'rounded-l-none bg-[var(--chijie-danger-subtle)] px-2 py-1 text-xs text-[var(--chijie-danger)] shadow-none hover:scale-100';
const SECTION_TITLE = 'mb-4 text-xl font-semibold text-[var(--chijie-foreground)]';

export const FirewallSettings = () => {
  const [isEnabled, setIsEnabled] = useState(true);
  const [allowList, setAllowList] = useState<string[]>([]);
  const [denyList, setDenyList] = useState<string[]>([]);
  const [newUrl, setNewUrl] = useState('');
  const [activeList, setActiveList] = useState<'allow' | 'deny'>('allow');

  const loadFirewallSettings = useCallback(async () => {
    const settings = await firewallStore.getFirewall();
    setIsEnabled(settings.enabled);
    setAllowList(settings.allowList);
    setDenyList(settings.denyList);
  }, []);

  useEffect(() => {
    loadFirewallSettings();
  }, [loadFirewallSettings]);

  const handleToggleFirewall = async () => {
    await firewallStore.updateFirewall({ enabled: !isEnabled });
    await loadFirewallSettings();
  };

  const handleAddUrl = async () => {
    const cleanUrl = newUrl.trim().replace(/^https?:\/\//, '');
    if (!cleanUrl) return;

    if (activeList === 'allow') {
      await firewallStore.addToAllowList(cleanUrl);
    } else {
      await firewallStore.addToDenyList(cleanUrl);
    }
    await loadFirewallSettings();
    setNewUrl('');
  };

  const handleRemoveUrl = async (url: string, listType: 'allow' | 'deny') => {
    if (listType === 'allow') {
      await firewallStore.removeFromAllowList(url);
    } else {
      await firewallStore.removeFromDenyList(url);
    }
    await loadFirewallSettings();
  };

  const urls = activeList === 'allow' ? allowList : denyList;
  const emptyText =
    activeList === 'allow' ? t('options_firewall_allowList_empty') : t('options_firewall_denyList_empty');
  const removeLabel = activeList === 'allow' ? t('options_firewall_btnRemove') : 'Remove';

  return (
    <section className="space-y-6">
      <div className="rounded-lg border border-[var(--chijie-border)] bg-[var(--chijie-surface)] p-6 text-left">
        <h2 className={SECTION_TITLE}>{t('options_firewall_header')}</h2>

        <div className="space-y-6">
          <div className="my-6 rounded-lg border border-[var(--chijie-border)] bg-[var(--chijie-surface-raised)] p-4">
            <div className="flex items-center justify-between">
              <label htmlFor="toggle-firewall" className="text-base font-medium text-[var(--chijie-foreground)]">
                {t('options_firewall_enableToggle')}
              </label>
              <div className="relative inline-block w-12 select-none">
                <input
                  type="checkbox"
                  checked={isEnabled}
                  onChange={handleToggleFirewall}
                  className="sr-only"
                  id="toggle-firewall"
                />
                <label
                  htmlFor="toggle-firewall"
                  className={`block h-6 cursor-pointer overflow-hidden rounded-full ${
                    isEnabled ? 'bg-[var(--chijie-accent)]' : 'bg-[var(--chijie-border-strong)]'
                  }`}>
                  <span className="sr-only">{t('options_firewall_toggleFirewall_a11y')}</span>
                  <span
                    className={`block size-6 rounded-full bg-[var(--chijie-surface-raised)] transition-transform ${
                      isEnabled ? 'translate-x-6' : 'translate-x-0'
                    }`}
                  />
                </label>
              </div>
            </div>
          </div>

          <div className="mb-6 mt-10 flex items-center justify-between">
            <div className="flex space-x-2">
              <Button
                onClick={() => setActiveList('allow')}
                className={`px-4 py-2 text-base ${activeList === 'allow' ? LIST_CHIP_ON : LIST_CHIP_OFF}`}>
                {t('options_firewall_allowList_header')}
              </Button>
              <Button
                onClick={() => setActiveList('deny')}
                className={`px-4 py-2 text-base ${activeList === 'deny' ? LIST_CHIP_ON : LIST_CHIP_OFF}`}>
                {t('options_firewall_denyList_header')}
              </Button>
            </div>
          </div>

          <div className="mb-4 flex space-x-2">
            <input
              id="url-input"
              type="text"
              value={newUrl}
              onChange={e => setNewUrl(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  handleAddUrl();
                }
              }}
              placeholder={t('options_firewall_placeholders_domainUrl')}
              className="flex-1 rounded-md border border-[var(--chijie-border-strong)] bg-[var(--chijie-surface-raised)] px-3 py-2 text-sm text-[var(--chijie-foreground)]"
            />
            <Button
              onClick={handleAddUrl}
              className="bg-[var(--chijie-accent)] px-4 py-2 text-sm text-white shadow-none hover:scale-100 hover:bg-[#2e2c29]">
              {t('options_firewall_btnAdd')}
            </Button>
          </div>

          <div className="max-h-64 overflow-y-auto">
            {urls.length > 0 ? (
              <ul className="space-y-2">
                {urls.map(url => (
                  <li
                    key={url}
                    className="flex items-center justify-between rounded-md bg-[var(--chijie-surface-raised)] p-2 pr-0">
                    <span className="text-sm text-[var(--chijie-foreground)]">{url}</span>
                    <Button onClick={() => handleRemoveUrl(url, activeList)} className={REMOVE_BTN}>
                      {removeLabel}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-center text-sm text-[var(--chijie-muted)]">{emptyText}</p>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--chijie-border)] bg-[var(--chijie-surface)] p-6 text-left">
        <h2 className={SECTION_TITLE}>{t('options_firewall_howItWorks_header')}</h2>
        <ul className="list-disc space-y-2 pl-5 text-left text-sm text-[var(--chijie-foreground)]">
          {t('options_firewall_howItWorks')
            .split('\n')
            .map((rule, index) => (
              <li key={index}>{rule}</li>
            ))}
        </ul>
      </div>
    </section>
  );
};
