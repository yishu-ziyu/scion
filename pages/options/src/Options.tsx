import { useState } from 'react';
import '@src/Options.css';
import { withErrorBoundary, withSuspense } from '@extension/shared';
import { t } from '@extension/i18n';
import { FiHome, FiCpu, FiShield, FiSettings, FiTrendingUp, FiHelpCircle } from 'react-icons/fi';
import { OverviewSettings } from './components/OverviewSettings';
import { GeneralSettings } from './components/GeneralSettings';
import { ModelSettings } from './components/ModelSettings';
import { FirewallSettings } from './components/FirewallSettings';
import { AnalyticsSettings } from './components/AnalyticsSettings';

type TabTypes = 'overview' | 'models' | 'general' | 'firewall' | 'analytics' | 'help';

type TabItem = { id: TabTypes; icon: React.ComponentType<{ className?: string }>; label: string };

const TAB_GROUPS: TabItem[][] = [
  [
    { id: 'overview', icon: FiHome, label: '总览' },
    { id: 'models', icon: FiCpu, label: '模型' },
  ],
  [
    { id: 'general', icon: FiSettings, label: t('options_tabs_general') },
    { id: 'firewall', icon: FiShield, label: t('options_tabs_firewall') },
    { id: 'analytics', icon: FiTrendingUp, label: t('options_tabs_analytics') },
  ],
  [{ id: 'help', icon: FiHelpCircle, label: t('options_tabs_help') }],
];

const Options = () => {
  const [activeTab, setActiveTab] = useState<TabTypes>('overview');

  const handleTabClick = (tabId: TabTypes) => {
    if (tabId === 'help') {
      window.open('https://github.com/yishu-ziyu/scion', '_blank');
      return;
    }
    setActiveTab(tabId);
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview':
        return (
          <OverviewSettings
            onOpenModels={() => setActiveTab('models')}
            onOpenFirewall={() => setActiveTab('firewall')}
          />
        );
      case 'models':
        return <ModelSettings isDarkMode />;
      case 'general':
        return <GeneralSettings />;
      case 'firewall':
        return <FirewallSettings />;
      case 'analytics':
        return <AnalyticsSettings />;
      default:
        return null;
    }
  };

  return (
    <div className="chijie-options-layout" data-testid="options-root">
      <nav className="chijie-options-nav" aria-label={t('options_nav_header')}>
        <div className="mb-6 flex items-center gap-2">
          <img
            src={chrome.runtime.getURL('logo-header.png')}
            alt="持节"
            className="h-7 w-auto max-w-[140px] object-contain object-left"
            data-testid="options-logo"
          />
        </div>
        {TAB_GROUPS.map((group, groupIndex) => (
          <ul key={groupIndex} className={groupIndex === 0 ? undefined : 'chijie-options-nav-group'}>
            {group.map(item => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => handleTabClick(item.id)}
                  data-active={String(activeTab === item.id)}
                  className="chijie-options-nav-item">
                  <item.icon className="size-4" aria-hidden />
                  <span>{item.label}</span>
                </button>
              </li>
            ))}
          </ul>
        ))}
      </nav>

      <main className="chijie-options-main">
        <div className="chijie-options-column">{renderTabContent()}</div>
      </main>
    </div>
  );
};

export default withErrorBoundary(withSuspense(Options, <div>Loading...</div>), <div>Error Occurred</div>);
