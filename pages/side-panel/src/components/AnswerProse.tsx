import { attachSourceHrefs, parseAnswerBlocks, type AnswerBlock, type AnswerSpan } from '../presentation/answer-format';
import { openFoundSource, openFoundUrl } from '../presentation/open-found-url';
import type { StreamSource } from '../presentation/work-stream';
import { t } from '@extension/i18n';

function Spans({ spans, onOpenUrl }: { spans: AnswerSpan[]; onOpenUrl?: (url: string) => void }) {
  return (
    <>
      {spans.map((span, index) => {
        if (span.href) {
          return (
            <button
              key={index}
              type="button"
              className="chijie-answer-link"
              data-url={span.href}
              onClick={() => openFoundUrl(span.href!, onOpenUrl)}>
              {span.bold ? <strong>{span.text}</strong> : span.text}
            </button>
          );
        }
        return span.bold ? <strong key={index}>{span.text}</strong> : <span key={index}>{span.text}</span>;
      })}
    </>
  );
}

function AnswerBlockView({ block, onOpenUrl }: { block: AnswerBlock; onOpenUrl?: (url: string) => void }) {
  if (block.type === 'section') {
    return (
      <p className="chijie-answer-section">
        <Spans spans={block.spans} onOpenUrl={onOpenUrl} />
      </p>
    );
  }
  if (block.type === 'ul') {
    return (
      <ul>
        {block.items.map((item, itemIndex) => (
          <li key={itemIndex}>
            <Spans spans={item} onOpenUrl={onOpenUrl} />
          </li>
        ))}
      </ul>
    );
  }
  if (block.type === 'ol') {
    return (
      <ol>
        {block.items.map((item, itemIndex) => (
          <li key={itemIndex}>
            <Spans spans={item} onOpenUrl={onOpenUrl} />
          </li>
        ))}
      </ol>
    );
  }
  if (block.type === 'pre') {
    return <pre className="chijie-answer-table">{block.text}</pre>;
  }
  return (
    <p>
      <Spans spans={block.spans} onOpenUrl={onOpenUrl} />
    </p>
  );
}

export function AnswerProse({
  text,
  sources = [],
  onOpenUrl,
  testId = 'completion-result',
}: {
  text: string;
  sources?: StreamSource[];
  onOpenUrl?: (url: string) => void;
  testId?: string;
}) {
  const clickableSources = sources.filter(source => !source.unavailable);
  const blocks = attachSourceHrefs(parseAnswerBlocks(text), clickableSources);
  return (
    <div className="chijie-answer" data-testid={testId}>
      {blocks.map((block, index) => (
        <AnswerBlockView key={index} block={block} onOpenUrl={onOpenUrl} />
      ))}
      {sources.length > 0 ? (
        <div className="chijie-answer-sources" data-testid="answer-sources">
          <p className="chijie-stream-caption">对核这些页</p>
          <ul>
            {sources.map(source => (
              <li key={source.id}>
                {source.unavailable ? (
                  <div className="chijie-answer-source chijie-answer-source-unavailable">
                    <span className="chijie-search-host">{source.host ?? '网页'}</span>
                    <span>{source.title}</span>
                    <small>{t('chat_task_source_unavailable')}</small>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="chijie-answer-source"
                    data-url={source.url}
                    title={source.url}
                    onClick={() => openFoundSource(source, onOpenUrl)}>
                    <span className="chijie-search-host">{source.host ?? '网页'}</span>
                    <span>{source.title}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
