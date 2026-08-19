import { FiSearch, FiSquare } from 'react-icons/fi';
import { t } from '@extension/i18n';
import { openFoundUrl } from '../presentation/open-found-url';
import type { WorkStreamView } from '../presentation/work-stream';

interface WorkStreamProps {
  view: WorkStreamView;
  running: boolean;
  onStop?: () => void;
  onOpenUrl?: (url: string) => void;
}

export function WorkStream({ view, running, onStop, onOpenUrl }: WorkStreamProps) {
  if (view.blocks.length === 0 && !running) return null;

  return (
    <div className="chijie-stream" data-testid="task-work-stream">
      {view.blocks.map(block => {
        if (block.type === 'thinking') {
          return (
            <details
              key={block.id}
              className="chijie-thinking-fold"
              data-testid="task-thinking-process"
              open={block.open}>
              <summary>{t('chat_task_thinking_heading')}</summary>
              <p data-testid="task-thinking-line">{block.text}</p>
            </details>
          );
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
              <p className="chijie-stream-caption">
                {block.commit.live ? '下一步要提交或确认' : '已提交或确认'}
              </p>
              <strong>{block.commit.text}</strong>
            </section>
          );
        }

        const pageBody = (
          <>
            {block.page.host ? <span className="chijie-page-host">{block.page.host}</span> : null}
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

      {running ? (
        <div className="chijie-stream-live" data-testid="live-tool-log">
          <span className="chijie-live-cursor" data-testid="live-cursor" aria-hidden>
            <span className="chijie-live-dot" />
          </span>
          {onStop ? (
            <button type="button" className="chijie-stop-pill" data-testid="live-stop-generating" onClick={onStop}>
              <FiSquare aria-hidden />
              {t('chat_task_takeover')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
