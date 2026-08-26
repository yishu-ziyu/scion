import { FiBookOpen, FiSettings } from 'react-icons/fi';
import { PiPlusBold } from 'react-icons/pi';
import { GrHistory } from 'react-icons/gr';
import { t } from '@extension/i18n';
import { PictureInPictureButton } from './PictureInPictureButton';
import { HeaderTip, MotionTextSwap } from './MotionPrimitives';

type SidePanelHeaderProps = {
  showHistory: boolean;
  statusLabel: string;
  newChatPending: boolean;
  onBack: () => void;
  onNewChat: () => void;
  onLoadHistory: () => void;
};

export function SidePanelHeader({
  showHistory,
  statusLabel,
  newChatPending,
  onBack,
  onNewChat,
  onLoadHistory,
}: SidePanelHeaderProps) {
  return (
    <header className="header relative border-b border-[var(--chijie-border)] bg-[var(--chijie-surface)] p-3">
      <div className="header-logo">
        {showHistory ? (
          <button
            type="button"
            onClick={onBack}
            className="min-h-10 cursor-pointer px-2 text-[var(--chijie-foreground)] hover:text-[var(--chijie-accent)]"
            aria-label={t('nav_back_a11y')}>
            {t('nav_back')}
          </button>
        ) : (
          <div className="chijie-header-brand">
            <img
              src={chrome.runtime.getURL('logo-header.png')}
              alt="scion"
              className="chijie-header-logo"
              data-testid="header-logo"
            />
            <span
              className="chijie-header-brand-sub"
              data-testid="header-task-status"
              aria-live="polite"
              aria-atomic="true">
              <MotionTextSwap text={statusLabel} />
            </span>
          </div>
        )}
      </div>
      <div className="header-icons">
        <PictureInPictureButton />
        <HeaderTip label={t('nav_newChat_a11y')}>
          <button
            type="button"
            onClick={onNewChat}
            className="header-icon t-tt-trigger cursor-pointer text-[var(--chijie-foreground)] hover:text-[var(--chijie-accent)]"
            aria-label={t('nav_newChat_a11y')}
            aria-busy={newChatPending}
            disabled={newChatPending}>
            <PiPlusBold size={20} />
          </button>
        </HeaderTip>
        <HeaderTip label={t('nav_loadHistory_a11y')}>
          <button
            type="button"
            onClick={onLoadHistory}
            className="header-icon t-tt-trigger cursor-pointer text-[var(--chijie-foreground)] hover:text-[var(--chijie-accent)]"
            data-active={showHistory ? 'true' : undefined}
            aria-label={t('nav_loadHistory_a11y')}>
            <GrHistory size={20} />
          </button>
        </HeaderTip>
        <HeaderTip label={t('nav_memory_a11y')}>
          <button
            type="button"
            onClick={() => {
              void chrome.tabs.create({ url: chrome.runtime.getURL('memory/index.html') });
            }}
            className="header-icon t-tt-trigger cursor-pointer text-[var(--chijie-foreground)] hover:text-[var(--chijie-accent)]"
            aria-label={t('nav_memory_a11y')}>
            <FiBookOpen size={20} />
          </button>
        </HeaderTip>
        <HeaderTip label={t('nav_settings_a11y')}>
          <button
            type="button"
            onClick={() => chrome.runtime.openOptionsPage()}
            className="header-icon t-tt-trigger cursor-pointer text-[var(--chijie-foreground)] hover:text-[var(--chijie-accent)]"
            aria-label={t('nav_settings_a11y')}>
            <FiSettings size={20} />
          </button>
        </HeaderTip>
      </div>
    </header>
  );
}
