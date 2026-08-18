import { useEffect, useId, useRef, useState, type ComponentType } from 'react';
import {
  FiArrowLeft,
  FiCamera,
  FiCheck,
  FiChevronDown,
  FiClock,
  FiEye,
  FiFolder,
  FiGlobe,
  FiList,
  FiMoreHorizontal,
  FiMousePointer,
  FiPlay,
  FiSearch,
  FiSquare,
  FiType,
  FiX,
} from 'react-icons/fi';
import type { ActivityIconKey, ActivityLogItem } from '../presentation/activity-stream';

export interface ThinkingReasoningItem extends Pick<ActivityLogItem, 'id' | 'text'> {
  icon?: ActivityIconKey;
  chip?: string;
  live?: boolean;
}

interface ThinkingReasoningProps {
  items: ThinkingReasoningItem[];
  running: boolean;
  elapsed: string;
  heading?: string;
  onStop?: () => void;
}

const ICON_MAP: Record<ActivityIconKey, ComponentType<{ className?: string }>> = {
  search: FiSearch,
  eye: FiEye,
  globe: FiGlobe,
  click: FiMousePointer,
  type: FiType,
  play: FiPlay,
  scroll: FiMoreHorizontal,
  wait: FiClock,
  tab: FiFolder,
  close: FiX,
  camera: FiCamera,
  check: FiCheck,
  back: FiArrowLeft,
  list: FiList,
  generic: FiMoreHorizontal,
};

/**
 * Public execution trace only. `items` must be privacy-safe action summaries
 * from the task snapshot, never model chain-of-thought, selectors, or raw input.
 */
export function ThinkingReasoning({ items, running, elapsed, heading, onStop }: ThinkingReasoningProps) {
  const contentId = useId();
  const title = heading?.trim() || '执行步骤';
  const disclosureName = `展开或收起${title}`;
  const disclosureLabel = `${title}，工作时长 ${elapsed}`;
  const [open, setOpen] = useState(running);
  const collapsibleRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(running);
  }, [running]);

  useEffect(() => {
    const element = collapsibleRef.current;
    if (!element) return;
    if (running || open) element.removeAttribute('inert');
    else element.setAttribute('inert', '');
  }, [open, running]);

  useEffect(() => {
    if (!running && !open) return;
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [items.length, open, running]);

  if (!running && items.length === 0) return null;

  const stream = (
    <div ref={viewportRef} className="chijie-thinking-viewport">
      <ol className="chijie-thinking-stream" data-testid="live-tool-log">
        {items.map(item => {
          const Icon = ICON_MAP[item.icon ?? 'generic'];
          return (
            <li key={item.id} data-live={item.live ? 'true' : undefined}>
              <span className="chijie-tool-icon" aria-hidden>
                <Icon />
              </span>
              <span className="chijie-tool-verb">{item.text}</span>
              {item.chip ? <span className="chijie-tool-chip">{item.chip}</span> : null}
            </li>
          );
        })}
        {running ? (
          <li className="chijie-live-cursor" data-testid="live-cursor" aria-hidden>
            <span className="chijie-live-dot" />
          </li>
        ) : null}
      </ol>
      {running && onStop ? (
        <div className="chijie-live-stop-wrap">
          <button type="button" className="chijie-stop-pill" data-testid="live-stop-generating" onClick={onStop}>
            <FiSquare aria-hidden />
            接管
          </button>
        </div>
      ) : null}
    </div>
  );

  if (running) {
    return (
      <section className="chijie-thinking" data-testid="task-thinking-reasoning" data-running="true">
        <p className="chijie-thinking-label" data-testid="live-elapsed">
          {title} · {elapsed}
        </p>
        {stream}
      </section>
    );
  }

  return (
    <section className="chijie-thinking" data-testid="task-thinking-reasoning">
      <button
        type="button"
        className="chijie-thinking-head"
        aria-expanded={open}
        aria-controls={contentId}
        aria-label={`${disclosureName}，${disclosureLabel}，当前${open ? '已展开，按下收起' : '已收起，按下展开'}`}
        onClick={() => setOpen(value => !value)}>
        <span className="chijie-thinking-label">
          <strong>{title}</strong> · {elapsed}
        </span>
        <FiChevronDown className="chijie-thinking-chevron" aria-hidden />
      </button>

      <div
        id={contentId}
        ref={collapsibleRef}
        className={open ? 'chijie-thinking-collapsible' : 'chijie-thinking-collapsible is-collapsed'}
        aria-hidden={!open}>
        <div className="chijie-thinking-inner">{stream}</div>
      </div>
    </section>
  );
}
