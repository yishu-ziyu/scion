import { useState } from 'react';
import '@src/Options.css';
import { withErrorBoundary, withSuspense } from '@extension/shared';
import { t } from '@extension/i18n';
import {
  FiHome,
  FiCpu,
  FiShield,
  FiCheckSquare,
  FiFileText,
  FiGlobe,
  FiLock,
  FiSettings,
  FiTrendingUp,
  FiHelpCircle,
} from 'react-icons/fi';
import { OverviewSettings } from './components/OverviewSettings';
import { GeneralSettings } from './components/GeneralSettings';
import { ModelSettings } from './components/ModelSettings';
import { FirewallSettings } from './components/FirewallSettings';
import { AnalyticsSettings } from './components/AnalyticsSettings';

/** design/003 nav + legacy advanced tabs */
type TabTypes =
  | 'overview'
  | 'models'
  | 'approval'
  | 'skill'
  | 'receipt'
  | 'sites'
  | 'privacy'
  | 'general'
  | 'firewall'
  | 'analytics'
  | 'help';

const TABS: { id: TabTypes; icon: React.ComponentType<{ className?: string }>; label: string }[] = [
  { id: 'overview', icon: FiHome, label: '总览' },
  { id: 'models', icon: FiCpu, label: '模型' },
  { id: 'approval', icon: FiCheckSquare, label: '审批' },
  { id: 'skill', icon: FiFileText, label: 'Skill' },
  { id: 'receipt', icon: FiFileText, label: '回执' },
  { id: 'sites', icon: FiGlobe, label: '站点权限' },
  { id: 'privacy', icon: FiLock, label: '隐私' },
  { id: 'general', icon: FiSettings, label: t('options_tabs_general') },
  { id: 'firewall', icon: FiShield, label: t('options_tabs_firewall') },
  { id: 'analytics', icon: FiTrendingUp, label: t('options_tabs_analytics') },
  { id: 'help', icon: FiHelpCircle, label: t('options_tabs_help') },
];

const Options = () => {
  const [activeTab, setActiveTab] = useState<TabTypes>('overview');
  const isDarkMode = true;

  const handleTabClick = (tabId: TabTypes) => {
    if (tabId === 'help') {
      window.open('https://github.com/yishu-ziyu/scion/blob/main/projects/chijie-browser/PRODUCT.md', '_blank');
      return;
    }
    setActiveTab(tabId);
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview':
      case 'approval':
      case 'skill':
      case 'receipt':
      case 'sites':
      case 'privacy':
        // Single overview implements design/003 cards 1–7; nav anchors scroll intent for now
        return <OverviewSettings />;
      case 'models':
        return <ModelSettings isDarkMode={isDarkMode} />;
      case 'general':
        return <GeneralSettings isDarkMode={isDarkMode} />;
      case 'firewall':
        return <FirewallSettings isDarkMode={isDarkMode} />;
      case 'analytics':
        return <AnalyticsSettings isDarkMode={isDarkMode} />;
      default:
        return null;
    }
  };

  return (
    <div className="chijie-options-layout" data-testid="options-root">
      <nav className="chijie-options-nav" aria-label={t('options_nav_header')}>
        <div className="mb-3 flex items-center gap-2">
          <img
            src={chrome.runtime.getURL('logo-header.png')}
            alt="scion"
            className="h-7 w-auto max-w-[140px] object-contain object-left"
            data-testid="options-logo"
          />
        </div>
        <p className="mb-4 text-xs text-[var(--chijie-muted)]">持节 · 浏览器行动 Agent 设置</p>
        <ul className="space-y-2">
          {TABS.map(item => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => handleTabClick(item.id)}
                data-active={activeTab === item.id ? 'true' : 'false'}
                className="chijie-options-nav-item">
                <item.icon className="h-4 w-4" />
                <span>{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <main className="chijie-options-main">
        <div className="mx-auto min-w-[512px] max-w-screen-lg">{renderTabContent()}</div>
      </main>
    </div>
  );
};

export default withErrorBoundary(withSuspense(Options, <div>Loading...</div>), <div>Error Occurred</div>);
