import { t } from '@extension/i18n';
import { FiChevronDown } from 'react-icons/fi';
import { liveProcessFold, type ProgressCurrentActivity } from '../presentation/task-progress-view';
import type { WorkStreamView } from '../presentation/work-stream';
import { WorkStream } from './WorkStream';

export function workStreamBody(
  view: WorkStreamView,
  running: boolean,
  onStop?: () => void,
  fold?: { summary: string; site?: string },
) {
  if (running) {
    return (
      <div data-testid="live-tool-log">
        <details className="chijie-process-disclosure" data-testid="task-process-disclosure" data-live="true">
          <summary data-testid="task-now-line">
            <FiChevronDown className="chijie-process-chevron" aria-hidden />
            <span className="chijie-process-fold">
              <span data-testid="task-now-summary">{fold?.summary ?? '正在读取'}</span>
              {fold?.site ? <span data-testid="task-now-site"> · {fold.site}</span> : null}
            </span>
            {onStop ? (
              <button
                type="button"
                className="chijie-process-takeover"
                data-testid="live-stop-generating"
                onClick={event => {
                  event.preventDefault();
                  event.stopPropagation();
                  onStop();
                }}>
                {t('chat_task_takeover')}
              </button>
            ) : null}
          </summary>
          {view.blocks.length > 0 ? (
            <div data-testid="task-activity-panel" className="chijie-activity-panel">
              <WorkStream view={view} running />
            </div>
          ) : null}
        </details>
      </div>
    );
  }
  if (view.blocks.length === 0) return null;
  return (
    <details className="chijie-process-disclosure" data-testid="task-process-disclosure">
      <summary>
        <span>{t('chat_task_process_disclosure')}</span>
        <span className="chijie-process-disclosure-meta">
          <small>{t('chat_task_process_count', [String(view.blocks.length)])}</small>
          <FiChevronDown aria-hidden />
        </span>
      </summary>
      <div data-testid="task-activity-panel" className="chijie-activity-panel">
        <WorkStream view={view} running={false} />
      </div>
    </details>
  );
}

export function processNowBody(
  view: WorkStreamView,
  running: boolean,
  onStop: (() => void) | undefined,
  activity: ProgressCurrentActivity | undefined,
  readOnly: boolean,
) {
  return workStreamBody(
    view,
    running,
    running && !readOnly ? onStop : undefined,
    running ? liveProcessFold(activity ?? { summary: '', purpose: '', startedAt: 0 }) : undefined,
  );
}
