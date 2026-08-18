import { t } from '@extension/i18n';
import type { NowTraceView } from '../presentation/now-trace';
import { ThinkingReasoning, type ThinkingReasoningItem } from './ThinkingReasoning';

interface NowTraceProps {
  view: NowTraceView;
  items: ThinkingReasoningItem[];
  running: boolean;
  elapsed: string;
  onStop?: () => void;
  audit?: boolean;
}

export function NowTrace({ view, items, running, elapsed, onStop, audit = false }: NowTraceProps) {
  return (
    <div className="chijie-now-trace" data-testid="task-now-trace">
      {view.thinkingLine ? (
        <details className="chijie-now-trace-block" data-testid="task-thinking-process" open={view.thinkingOpen}>
          <summary>{t('chat_task_thinking_heading')}</summary>
          <p data-testid="task-thinking-line">{view.thinkingLine}</p>
        </details>
      ) : null}
      {(running || view.steps.length > 0) && (
        <div className="chijie-now-trace-block" data-testid="task-execution-steps">
          <ThinkingReasoning
            items={items}
            running={running}
            elapsed={elapsed}
            heading={audit ? '做过' : t('chat_task_steps_heading')}
            onStop={onStop}
          />
        </div>
      )}
    </div>
  );
}
