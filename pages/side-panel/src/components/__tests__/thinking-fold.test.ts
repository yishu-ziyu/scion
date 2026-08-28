import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { t } from '@extension/i18n';
import type { WorkStreamView } from '../../presentation/work-stream';
import { workStreamBody } from '../ProcessDisclosure';

t.devLocale = 'zh_CN';

function html(view: WorkStreamView, running: boolean) {
  const node = workStreamBody(view, running);
  return node ? renderToStaticMarkup(createElement('div', null, node)) : '';
}

describe('thinking fold form', () => {
  it('shows expanded 思考中… above the live action line, even before any sentence exists', () => {
    const markup = html({ blocks: [] }, true);
    expect(markup).toContain('data-testid="task-thinking-process"');
    expect(markup).toContain('思考中…');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('data-testid="task-now-summary"');
    expect(markup).toContain('正在读取');
    expect(markup.indexOf('task-thinking-process')).toBeLessThan(markup.indexOf('task-now-summary'));
    expect(markup).not.toContain('data-testid="task-thinking-line"');
    expect(markup).not.toContain('SENTENCES');
    expect(markup).not.toContain('DELAYS');
  });

  it('keeps a real sentence under the live fold, not inside the action details', () => {
    const markup = html(
      {
        blocks: [
          { type: 'thinking', id: 'think-1', text: '先核报名页。', open: true },
          { type: 'act', id: 'act-1', text: '打开报名页', live: true },
        ],
      },
      true,
    );
    expect(markup).toContain('思考中…');
    expect(markup).toContain('先核报名页。');
    expect(markup).toContain('打开报名页');
    const think = markup.indexOf('先核报名页。');
    const details = markup.indexOf('task-process-disclosure');
    const act = markup.indexOf('打开报名页');
    expect(think).toBeGreaterThan(-1);
    expect(think).toBeLessThan(details);
    expect(act).toBeGreaterThan(details);
  });

  it('folds finished thinking to 思考过程 so the sentence is still there to reopen', () => {
    const markup = html({ blocks: [{ type: 'thinking', id: 'think-1', text: '先核报名页。', open: false }] }, false);
    expect(markup).toContain('思考过程');
    expect(markup).not.toContain('思考中…');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('is-collapsed');
    expect(markup).toContain('先核报名页。');
    expect(markup).not.toContain('data-testid="task-process-disclosure"');
  });

  it('does not leave an empty finished thinking fold', () => {
    const markup = html({ blocks: [] }, false);
    expect(markup).toBe('');
  });
});
