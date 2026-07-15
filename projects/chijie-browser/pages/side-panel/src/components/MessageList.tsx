import type { Message } from '@extension/storage';
import { memo } from 'react';
import { humanizeStoredMessage, type DisplayMessage } from '../presentation/humanize-message';

interface MessageListProps {
  messages: Message[];
  isDarkMode?: boolean;
  onRetry?: () => void;
  onRephrase?: () => void;
}

export default memo(function MessageList({ messages, isDarkMode = false, onRetry, onRephrase }: MessageListProps) {
  void isDarkMode;
  return (
    <div className="max-w-full space-y-4">
      {messages.map((message, index) => {
        const display = humanizeStoredMessage(message);
        const prevDisplay = index > 0 ? humanizeStoredMessage(messages[index - 1]) : null;
        const isSameGroup =
          prevDisplay != null &&
          prevDisplay.title === display.title &&
          prevDisplay.kind === display.kind &&
          display.kind !== 'progress';

        return (
          <MessageBlock
            key={`${message.actor}-${message.timestamp}-${index}`}
            display={display}
            isSameGroup={isSameGroup}
            onRetry={onRetry}
            onRephrase={onRephrase}
            showActions={display.kind === 'failure' && index === messages.length - 1 && Boolean(onRetry || onRephrase)}
          />
        );
      })}
    </div>
  );
});

interface MessageBlockProps {
  display: DisplayMessage;
  isSameGroup: boolean;
  showActions?: boolean;
  onRetry?: () => void;
  onRephrase?: () => void;
}

function MessageBlock({ display, isSameGroup, showActions, onRetry, onRephrase }: MessageBlockProps) {
  const isProgress = display.kind === 'progress';
  const isFailure = display.kind === 'failure';

  return (
    <div
      className={`flex max-w-full gap-3 ${
        !isSameGroup ? 'mt-4 border-t border-[var(--chijie-border)] pt-4 first:mt-0 first:border-t-0 first:pt-0' : ''
      }`}>
      {!isSameGroup && (
        <div
          className={`flex size-8 shrink-0 items-center justify-center rounded-full border border-[var(--chijie-border-strong)] text-xs font-medium ${
            display.kind === 'user'
              ? 'border-[var(--chijie-accent)] bg-[var(--chijie-accent)] text-white'
              : 'border-[var(--chijie-accent-subtle)] bg-[var(--chijie-accent-subtle)] text-[var(--chijie-accent-signal)]'
          }`}>
          {display.kind === 'user' ? '你' : '助'}
        </div>
      )}
      {isSameGroup && <div className="w-8" />}

      <div className="min-w-0 flex-1">
        {!isSameGroup && <div className="chijie-mono-label mb-1 text-[var(--chijie-foreground)]">{display.title}</div>}

        <div className="space-y-0.5">
          <div className="whitespace-pre-wrap break-words text-sm text-[var(--chijie-foreground)]">
            {isProgress ? (
              <div className="chijie-current-activity" role="status" aria-live="polite">
                <span className="chijie-activity-dot" aria-hidden />
                <div className="text-[var(--chijie-accent-signal)]">{display.body}</div>
              </div>
            ) : (
              display.body
            )}
          </div>

          {isFailure && display.detail ? (
            <details className="mt-1 text-xs text-[var(--chijie-muted)]">
              <summary className="cursor-pointer select-none text-[var(--chijie-paper-muted)]">详情</summary>
              <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded border border-[var(--chijie-border)] bg-[var(--chijie-surface-raised)] p-2 font-mono text-[10px] text-[var(--chijie-muted)]">
                {display.detail}
              </pre>
            </details>
          ) : null}

          {showActions && isFailure ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {onRetry ? (
                <button type="button" className="chijie-btn-primary !w-auto !px-3 !py-1.5 text-xs" onClick={onRetry}>
                  再试一次
                </button>
              ) : null}
              {onRephrase ? (
                <button
                  type="button"
                  className="chijie-btn-secondary !w-auto !px-3 !py-1.5 text-xs"
                  onClick={onRephrase}>
                  换个说法
                </button>
              ) : null}
            </div>
          ) : null}

          {!isProgress && (
            <div className="chijie-mono-label text-right text-[10px] text-[var(--chijie-muted)]">
              {formatTimestamp(display.timestamp)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  const isThisYear = date.getFullYear() === now.getFullYear();
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (isToday) return timeStr;
  if (isYesterday) return `昨天 ${timeStr}`;
  if (isThisYear) {
    return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${timeStr}`;
  }
  return `${date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })} ${timeStr}`;
}
