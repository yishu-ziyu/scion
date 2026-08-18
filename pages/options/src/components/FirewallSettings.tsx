import { useState, useEffect, useCallback } from 'react';
import { firewallStore } from '@extension/storage';
import { Button } from '@extension/ui';
import { t } from '@extension/i18n';

interface FirewallSettingsProps {
 isDarkMode: boolean;
}

export const FirewallSettings = ({ isDarkMode }: FirewallSettingsProps) => {
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
 // Remove http:// or https:// prefixes
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

 return (
 <section className="space-y-6">
 <div
 className={`rounded-lg border ${isDarkMode ? 'border-[var(--chijie-border)] bg-[var(--chijie-surface)]' : 'border-[var(--chijie-border)] bg-[var(--chijie-surface)]'} p-6 text-left `}>
 <h2 className={`mb-4 text-xl font-semibold ${isDarkMode ? 'text-[var(--chijie-foreground)]' : 'text-[var(--chijie-paper)]'}`}>
 {t('options_firewall_header')}
 </h2>

 <div className="space-y-6">
 <div
 className={`my-6 rounded-lg border p-4 ${isDarkMode ? 'border-[var(--chijie-border)] bg-[var(--chijie-surface-raised)]' : 'border-[var(--chijie-border)] bg-[var(--chijie-surface-raised)]'}`}>
 <div className="flex items-center justify-between">
 <label
 htmlFor="toggle-firewall"
 className={`text-base font-medium ${isDarkMode ? 'text-[var(--chijie-foreground)]' : 'text-[var(--chijie-foreground)]'}`}>
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
 isEnabled ? 'bg-[var(--chijie-accent)]' : isDarkMode ? 'bg-[var(--chijie-border-strong)]' : 'bg-[var(--chijie-border-strong)]'
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
 className={`px-4 py-2 text-base ${
 activeList === 'allow'
 ? isDarkMode
 ? 'bg-[var(--chijie-accent)] text-[var(--chijie-foreground)]'
 : 'bg-[var(--chijie-accent)] text-[var(--chijie-foreground)]'
 : isDarkMode
 ? 'bg-[var(--chijie-surface-raised)] text-[var(--chijie-foreground)]'
 : 'bg-[var(--chijie-border-strong)] text-[var(--chijie-foreground)]'
 }`}>
 {t('options_firewall_allowList_header')}
 </Button>
 <Button
 onClick={() => setActiveList('deny')}
 className={`px-4 py-2 text-base ${
 activeList === 'deny'
 ? isDarkMode
 ? 'bg-[var(--chijie-accent)] text-[var(--chijie-foreground)]'
 : 'bg-[var(--chijie-accent)] text-[var(--chijie-foreground)]'
 : isDarkMode
 ? 'bg-[var(--chijie-surface-raised)] text-[var(--chijie-foreground)]'
 : 'bg-[var(--chijie-border-strong)] text-[var(--chijie-foreground)]'
 }`}>
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
 className={`flex-1 rounded-md border px-3 py-2 text-sm ${
 isDarkMode ? 'border-[var(--chijie-border-strong)] bg-[var(--chijie-surface-raised)] text-[var(--chijie-foreground)]' : 'border-[var(--chijie-border-strong)] bg-[var(--chijie-surface-raised)] text-[var(--chijie-foreground)]'
 }`}
 />
 <Button
 onClick={handleAddUrl}
 className={`px-4 py-2 text-sm ${
 isDarkMode ? 'bg-[var(--chijie-accent)] text-[#fff8f0] hover:bg-[var(--chijie-accent-signal)]' : 'bg-[var(--chijie-accent)] text-[#fff8f0] hover:bg-[var(--chijie-accent-signal)]'
 }`}>
 {t('options_firewall_btnAdd')}
 </Button>
 </div>

 <div className="max-h-64 overflow-y-auto">
 {activeList === 'allow' ? (
 allowList.length > 0 ? (
 <ul className="space-y-2">
 {allowList.map(url => (
 <li
 key={url}
 className={`flex items-center justify-between rounded-md p-2 pr-0 ${
 isDarkMode ? 'bg-[var(--chijie-surface-raised)]' : 'bg-[var(--chijie-surface-raised)]'
 }`}>
 <span className={`text-sm ${isDarkMode ? 'text-[var(--chijie-foreground)]' : 'text-[var(--chijie-foreground)]'}`}>{url}</span>
 <Button
 onClick={() => handleRemoveUrl(url, 'allow')}
 className={`rounded-l-none px-2 py-1 text-xs ${
 isDarkMode
 ? 'bg-[var(--chijie-accent-signal)] text-[#fff8f0] hover:bg-[var(--chijie-accent)]'
 : 'bg-[var(--chijie-accent-signal)] text-[#fff8f0] hover:bg-[var(--chijie-accent)]'
 }`}>
 {t('options_firewall_btnRemove')}
 </Button>
 </li>
 ))}
 </ul>
 ) : (
 <p className={`text-center text-sm ${isDarkMode ? 'text-[var(--chijie-muted)]' : 'text-[var(--chijie-muted)]'}`}>
 {t('options_firewall_allowList_empty')}
 </p>
 )
 ) : denyList.length > 0 ? (
 <ul className="space-y-2">
 {denyList.map(url => (
 <li
 key={url}
 className={`flex items-center justify-between rounded-md p-2 pr-0 ${
 isDarkMode ? 'bg-[var(--chijie-surface-raised)]' : 'bg-[var(--chijie-surface-raised)]'
 }`}>
 <span className={`text-sm ${isDarkMode ? 'text-[var(--chijie-foreground)]' : 'text-[var(--chijie-foreground)]'}`}>{url}</span>
 <Button
 onClick={() => handleRemoveUrl(url, 'deny')}
 className={`rounded-l-none px-2 py-1 text-xs ${
 isDarkMode ? 'bg-[var(--chijie-accent-signal)] text-[#fff8f0] hover:bg-[var(--chijie-accent)]' : 'bg-[var(--chijie-accent-signal)] text-[#fff8f0] hover:bg-[var(--chijie-accent)]'
 }`}>
 Remove
 </Button>
 </li>
 ))}
 </ul>
 ) : (
 <p className={`text-center text-sm ${isDarkMode ? 'text-[var(--chijie-muted)]' : 'text-[var(--chijie-muted)]'}`}>
 {t('options_firewall_denyList_empty')}
 </p>
 )}
 </div>
 </div>
 </div>

 <div
 className={`rounded-lg border ${isDarkMode ? 'border-[var(--chijie-border)] bg-[var(--chijie-surface)]' : 'border-[var(--chijie-border)] bg-[var(--chijie-surface)]'} p-6 text-left `}>
 <h2 className={`mb-4 text-xl font-semibold ${isDarkMode ? 'text-[var(--chijie-foreground)]' : 'text-[var(--chijie-paper)]'}`}>
 {t('options_firewall_howItWorks_header')}
 </h2>
 <ul className={`list-disc space-y-2 pl-5 text-left text-sm ${isDarkMode ? 'text-[var(--chijie-foreground)]' : 'text-[var(--chijie-muted)]'}`}>
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
