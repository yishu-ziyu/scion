import { useEffect, useRef, useState } from 'react';
import { FiChevronDown, FiSearch } from 'react-icons/fi';
import { t } from '@extension/i18n';
import { openFoundUrl } from '../presentation/open-found-url';
import { splitThinkingSentences, thinkingRevealStep, type WorkStreamView } from '../presentation/work-stream';

interface WorkStreamProps {
  view: WorkStreamView;
  running: boolean;
  onOpenUrl?: (url: string) => void;
}

export function WorkStream({ view, running, onOpenUrl }: WorkStreamProps) {
  if (view.blocks.length === 0 && !running) return null;

  return (
    <div className="chijie-stream" data-testid="task-work-stream">
      {view.blocks.map(block => {
        if (block.type === 'thinking') {
          return <ThinkingFold key={block.id} text={block.text} open={block.open} running={running} />;
        }

        if (block.type === 'search') {
          const live = block.queries.some(query => query.live);
          return (
            <section
              key={block.id}
              className="chijie-search-board"
              data-testid="task-search-board"
              data-live={live ? 'true' : undefined}>
              <p className="chijie-stream-caption">{live ? '正在搜索' : '已完成网页搜索'}</p>
              {block.queries.map(query => (
                <div key={query.id} className="chijie-search-stack">
                  <div className="chijie-search-query">
                    <FiSearch aria-hidden />
                    <span>{query.query}</span>
                  </div>
                  {query.results.length > 0 ? (
                    <ul className="chijie-search-hits" data-testid="task-search-hits">
                      {query.results.map(hit => {
                        const label = hit.title;
                        return (
                          <li key={`${query.id}-${hit.title}`}>
                            {hit.url ? (
                              <button
                                type="button"
                                className="chijie-search-hit"
                                data-url={hit.url}
                                onClick={() => openFoundUrl(hit.url!, onOpenUrl)}>
                                <span className="chijie-search-host">{hit.host ?? '网页'}</span>
                                <span>{label}</span>
                              </button>
                            ) : (
                              <span className="chijie-search-hit">
                                <span className="chijie-search-host">{hit.host ?? '网页'}</span>
                                <span>{label}</span>
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </div>
              ))}
            </section>
          );
        }

        if (block.type === 'commit') {
          return (
            <section
              key={block.id}
              className="chijie-commit-note"
              data-testid="task-commit-note"
              data-live={block.commit.live ? 'true' : undefined}>
              <p className="chijie-stream-caption">{block.commit.live ? '下一步要提交或确认' : '已提交或确认'}</p>
              <strong>{block.commit.text}</strong>
            </section>
          );
        }

        if (block.type === 'act') {
          return (
            <p
              key={block.id}
              className="chijie-act-line chijie-act-chip"
              data-testid="task-act-line"
              data-live={block.live ? 'true' : undefined}>
              {block.text}
            </p>
          );
        }

        const pageBody = (
          <>
            {block.page.host && block.page.host !== block.page.title ? (
              <span className="chijie-page-host">{block.page.host}</span>
            ) : null}
            <strong>{block.page.title}</strong>
            {block.page.snippet ? <p>{block.page.snippet}</p> : null}
          </>
        );

        if (block.page.url) {
          return (
            <button
              key={block.id}
              type="button"
              className="chijie-page-card"
              data-testid="task-page-card"
              data-url={block.page.url}
              data-live={block.page.live ? 'true' : undefined}
              onClick={() => openFoundUrl(block.page.url!, onOpenUrl)}>
              {pageBody}
            </button>
          );
        }

        return (
          <section
            key={block.id}
            className="chijie-page-card"
            data-testid="task-page-card"
            data-live={block.page.live ? 'true' : undefined}>
            {pageBody}
          </section>
        );
      })}
    </div>
  );
}

function ThinkingFold({ text, open, running }: { text: string; open: boolean; running: boolean }) {
  const [expanded, setExpanded] = useState(open);
  useEffect(() => {
    setExpanded(open);
  }, [open]);
  const sentences = splitThinkingSentences(text);
  const canToggle = !running;
  const [reduceMotion] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
  );
  const [revealed, setRevealed] = useState(() => sentences.length);
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const step = thinkingRevealStep(sentences.length, revealed, { running, reduceMotion });
    if (step.visible === revealed) return;
    if (step.againInMs === undefined) {
      setRevealed(step.visible);
      return;
    }
    const timer = setTimeout(() => setRevealed(step.visible), step.againInMs);
    return () => clearTimeout(timer);
  }, [sentences.length, revealed, running, reduceMotion]);

  useEffect(() => {
    if (!running) return;
    const el = viewportRef.current;
    if (!el) return;
    if (el.scrollHeight > el.clientHeight + 1) el.dataset.capped = 'true';
    else delete el.dataset.capped;
    el.scrollTop = el.scrollHeight;
  }, [revealed, running]);

  // While running, grow the viewport smoothly; CSS transitions the height.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    if (!running) {
      el.style.height = '';
      return;
    }
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [sentences.length, revealed, running]);

  const visible = sentences.slice(0, revealed);

  return (
    <div
      className="chijie-thinking t-acc"
      data-testid="task-thinking-process"
      data-running={running ? 'true' : undefined}
      data-open={expanded ? 'true' : 'false'}>
      <button
        type="button"
        className="chijie-thinking-head t-acc-head"
        aria-expanded={expanded}
        disabled={!canToggle}
        onClick={() => {
          if (canToggle) setExpanded(next => !next);
        }}>
        <span className="chijie-thinking-label">{t('chat_task_thinking_heading')}</span>
        {canToggle ? <FiChevronDown className="chijie-thinking-chevron" aria-hidden /> : null}
      </button>
      <div
        className={`chijie-thinking-collapsible t-acc-panel${expanded ? '' : ' is-collapsed'}`}
        aria-hidden={!expanded}>
        <div className="chijie-thinking-inner t-acc-panel-inner">
          <div className="chijie-thinking-viewport" ref={viewportRef}>
            <ul className="chijie-thinking-stream">
              {visible.map((sentence, index) => (
                <li key={`${index}-${sentence}`} data-testid={index === 0 ? 'task-thinking-line' : undefined}>
                  {sentence}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
