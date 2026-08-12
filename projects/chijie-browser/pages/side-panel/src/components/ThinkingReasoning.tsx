import { useEffect, useId, useRef, useState } from 'react';
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
  const contentId = useId();
  const disclosureName = '展开或收起任务处理过程';
  const disclosureLabel = `任务处理过程，工作时长 ${elapsed}`;
  // Default collapsed: audit trail must not pretend to be live progress (design/008 S1).
  const [open, setOpen] = useState(false);
  const collapsibleRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!running) setOpen(false);
  }, [running]);

  useEffect(() => {
    const element = collapsibleRef.current;
    if (!element) return;
    if (open) element.removeAttribute('inert');
    else element.setAttribute('inert', '');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [items.length, open]);

  // Non-running with no steps: hide entirely (no fake activity chrome).
  if (items.length === 0 && !running) return null;

  return (
    <section className="chijie-thinking" data-testid="task-thinking-reasoning" data-running={running || undefined}>
      <button
        type="button"
        className="chijie-thinking-head"
        aria-expanded={open}
        aria-controls={contentId}
        aria-label={`${disclosureName}，${disclosureLabel}，当前${open ? '已展开，按下收起' : '已收起，按下展开'}`}
        onClick={() => setOpen(value => !value)}>
        {running ? (
          <span className="chijie-thinking-label">处理过程 · {elapsed}</span>
        ) : (
          <span className="chijie-thinking-label">
            <strong>工作了</strong> {elapsed}
          </span>
        )}
        <FiChevronDown className="chijie-thinking-chevron" aria-hidden />
      </button>

      <div
        id={contentId}
        ref={collapsibleRef}
        className={open ? 'chijie-thinking-collapsible' : 'chijie-thinking-collapsible is-collapsed'}
        aria-hidden={!open}>
        <div className="chijie-thinking-inner">
          <div ref={viewportRef} className="chijie-thinking-viewport">
            {items.length > 0 ? (
              <ol className="chijie-thinking-stream">
                {items.map(item => (
                  <li key={item.id}>{item.text}</li>
                ))}
              </ol>
            ) : (
              running && <p className="m-0 text-xs text-[var(--chijie-muted)]">暂无新的可展示动作</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
