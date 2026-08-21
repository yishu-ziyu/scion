import { Fragment } from 'react';
import { attachSourceHrefs, parseAnswerBlocks, type AnswerSpan } from '../presentation/answer-format';
import { openFoundUrl } from '../presentation/open-found-url';
import type { StreamSource } from '../presentation/work-stream';

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
  const blocks = attachSourceHrefs(parseAnswerBlocks(text), sources);
  return (
    <div className="chijie-answer" data-testid={testId}>
      {blocks.map((block, index) => (
        <Fragment key={index}>
          {index > 0 ? '\n' : null}
          {block.type === 'ul' ? (
            <ul>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <Spans spans={item} onOpenUrl={onOpenUrl} />
                </li>
              ))}
            </ul>
          ) : block.type === 'ol' ? (
            <ol>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <Spans spans={item} onOpenUrl={onOpenUrl} />
                </li>
              ))}
            </ol>
          ) : block.type === 'pre' ? (
            <pre className="chijie-answer-table">{block.text}</pre>
          ) : (
            <p>
              <Spans spans={block.spans} onOpenUrl={onOpenUrl} />
            </p>
          )}
        </Fragment>
      ))}
      {sources.length > 0 ? (
        <div className="chijie-answer-sources" data-testid="answer-sources">
          <p className="chijie-stream-caption">对核这些页</p>
          <ul>
            {sources.map(source => (
              <li key={source.id}>
                <button
                  type="button"
                  className="chijie-answer-source"
                  data-url={source.url}
                  onClick={() => openFoundUrl(source.url, onOpenUrl)}>
                  <span className="chijie-search-host">{source.host ?? '网页'}</span>
                  <span>{source.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
