import { useEffect, useRef, useState } from 'react';
import { FiChevronDown } from 'react-icons/fi';

export interface ThinkingReasoningItem {
  id: string;
  text: string;
}

interface ThinkingReasoningProps {
  items: ThinkingReasoningItem[];
  running: boolean;
  elapsed: string;
}

/**
 * Public execution trace only. `items` must be privacy-safe action summaries
 * from the task snapshot, never model chain-of-thought, selectors, or raw input.
 */
export function ThinkingReasoning({ items, running, elapsed }: ThinkingReasoningProps) {
  const [open, setOpen] = useState(running);
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(running);
  }, [running]);

  useEffect(() => {
    if (!running || !open) return;
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [items.length, open, running]);

  if (items.length === 0 && !running) return null;

  const expanded = running || open;

  return (
    <section className="chijie-thinking" data-testid="task-thinking-reasoning" data-running={running || undefined}>
      <button
        type="button"
        className="chijie-thinking-head"
        aria-expanded={expanded}
        aria-label={running ? '任务处理过程' : '展开或收起任务处理过程'}
        disabled={running}
        onClick={running ? undefined : () => setOpen(value => !value)}>
        {running ? (
          <span className="chijie-thinking-label is-shimmer" role="status" aria-live="polite">
            思考中…
          </span>
        ) : (
          <span className="chijie-thinking-label">
            <strong>工作了</strong> {elapsed}
          </span>
        )}
        {!running && <FiChevronDown className="chijie-thinking-chevron" aria-hidden />}
      </button>

      <div className={expanded ? 'chijie-thinking-collapsible' : 'chijie-thinking-collapsible is-collapsed'}>
        <div className="chijie-thinking-inner">
          <div ref={viewportRef} className="chijie-thinking-viewport">
            {items.length > 0 && (
              <ol className="chijie-thinking-stream">
                {items.map(item => (
                  <li key={item.id}>{item.text}</li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
