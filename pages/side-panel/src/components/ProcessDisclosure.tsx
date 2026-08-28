import { t } from '@extension/i18n';
import { FiChevronDown } from 'react-icons/fi';
import { liveProcessFold, type ProgressCurrentActivity } from '../presentation/task-progress-view';
import type { WorkStreamView } from '../presentation/work-stream';
import { ThinkingFold, WorkStream } from './WorkStream';

function thinkingCopy(view: WorkStreamView): string {
  for (const block of view.blocks) {
    if (block.type === 'thinking') return block.text;
  }
  return '';
}

function actionStream(view: WorkStreamView): WorkStreamView {
  return { blocks: view.blocks.filter(block => block.type !== 'thinking') };
}

export function workStreamBody(
  view: WorkStreamView,
  running: boolean,
  onStop?: () => void,
  fold?: { summary: string; site?: string },
) {
  const thinkingText = thinkingCopy(view);
  const rest = actionStream(view);
  const showThinking = running || Boolean(thinkingText.trim());
  const thinking = showThinking ? <ThinkingFold text={thinkingText} open={running} running={running} /> : null;
  const stream = rest.blocks.length > 0 ? <WorkStream view={rest} running={running} /> : null;

  if (running) {
    return (
      <div data-testid="live-tool-log" className="chijie-live-process">
        {thinking}
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
          {stream ? (
            <div data-testid="task-activity-panel" className="chijie-activity-panel">
              {stream}
            </div>
          ) : null}
        </details>
      </div>
    );
  }
  if (view.blocks.length === 0) return null;
  return (
    <>
      {thinking}
      {stream ? (
        <details className="chijie-process-disclosure" data-testid="task-process-disclosure">
          <summary>
            <span>{t('chat_task_process_disclosure')}</span>
            <span className="chijie-process-disclosure-meta">
              <small>{t('chat_task_process_count', [String(rest.blocks.length)])}</small>
              <FiChevronDown aria-hidden />
            </span>
          </summary>
          <div data-testid="task-activity-panel" className="chijie-activity-panel">
            {stream}
          </div>
        </details>
      ) : null}
    </>
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
