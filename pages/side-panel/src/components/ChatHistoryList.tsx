/* eslint-disable react/prop-types */
import { FaTrash } from 'react-icons/fa';
import { BsBookmark } from 'react-icons/bs';
import { t } from '@extension/i18n';

interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
}

interface ChatHistoryListProps {
  sessions: ChatSession[];
  onSessionSelect: (sessionId: string) => void;
  onSessionDelete: (sessionId: string) => void;
  onSessionBookmark: (sessionId: string) => void;
  visible: boolean;
  protectedSessionId?: string | null;
  isDarkMode?: boolean;
}

const ChatHistoryList: React.FC<ChatHistoryListProps> = ({
  sessions,
  onSessionSelect,
  onSessionDelete,
  onSessionBookmark,
  visible,
  protectedSessionId = null,
  isDarkMode = false,
}) => {
  void isDarkMode;
  if (!visible) return null;

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="h-full overflow-y-auto bg-[var(--chijie-background)] p-4 text-[var(--chijie-foreground)]">
      <h2 className="mb-4 text-lg font-semibold text-[var(--chijie-foreground)]">{t('chat_history_title')}</h2>
      {sessions.length === 0 ? (
        <div className="rounded-lg border border-[var(--chijie-border)] bg-[var(--chijie-surface-raised)] p-4 text-center text-[var(--chijie-paper-muted)]">
          {t('chat_history_empty')}
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map(session => {
            const protectedLiveSession = session.id === protectedSessionId;
            return (
              <div
                key={session.id}
                className="group relative rounded-lg border border-[var(--chijie-border)] bg-[var(--chijie-surface-raised)] p-3 transition-colors hover:border-[var(--chijie-border-strong)] hover:bg-[var(--chijie-accent-subtle)]">
                <button
                  onClick={() => onSessionSelect(session.id)}
                  className="min-h-12 w-full rounded pr-20 text-left"
                  type="button">
                  <h3 className="break-words text-sm font-medium text-[var(--chijie-foreground)]">{session.title}</h3>
                  <p className="mt-1 text-xs text-[var(--chijie-paper-muted)]">{formatDate(session.createdAt)}</p>
                </button>

                <div className="absolute right-1 top-1 flex gap-1">
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      onSessionBookmark(session.id);
                    }}
                    className="flex size-10 items-center justify-center rounded bg-[var(--chijie-surface)] text-[var(--chijie-accent)] opacity-100 transition-colors hover:bg-[var(--chijie-accent-subtle)] focus-visible:opacity-100"
                    aria-label={t('chat_history_bookmark')}
                    type="button">
                    <BsBookmark size={16} aria-hidden />
                  </button>

                  <button
                    onClick={e => {
                      e.stopPropagation();
                      if (protectedLiveSession) return;
                      onSessionDelete(session.id);
                    }}
                    disabled={protectedLiveSession}
                    className="flex size-10 items-center justify-center rounded bg-[var(--chijie-surface)] text-[var(--chijie-danger)] opacity-100 transition-colors hover:bg-[var(--chijie-danger-subtle)] focus-visible:opacity-100 disabled:cursor-not-allowed disabled:text-[var(--chijie-paper-muted)]"
                    aria-label={protectedLiveSession ? '正在运行的任务不可删除' : t('chat_history_delete')}
                    title={protectedLiveSession ? '正在运行的任务不可删除' : undefined}
                    type="button">
                    <FaTrash size={16} aria-hidden />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ChatHistoryList;
