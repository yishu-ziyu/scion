import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { IdleHome } from '../../components/IdleHome';
import { IDLE_EXAMPLES } from '../idle-examples';

describe('idle home examples', () => {
  it('offers three concrete tasks that fill the composer', () => {
    expect(IDLE_EXAMPLES).toHaveLength(3);
    expect(IDLE_EXAMPLES.map(item => item.id)).toEqual(['open', 'extract', 'finish']);
    expect(IDLE_EXAMPLES.every(item => item.prompt.length >= 8)).toBe(true);
    expect(IDLE_EXAMPLES.some(item => /etsy|购物|订阅/.test(item.title + item.prompt))).toBe(false);
  });

  it('renders a hero, example rows, and no mode rail', () => {
    const onPick = vi.fn();
    const html = renderToStaticMarkup(
      createElement(IdleHome, {
        hint: '打开页面、抽出表格、读完再回。做完能核对。',
        onPick,
        savedCount: 2,
      }),
    );

    expect(html).toContain('data-testid="empty-composer-spacer"');
    expect(html).toContain('data-testid="idle-delegate-hint"');
    expect(html).toContain('把要做的事交出去');
    expect(html).toContain('data-testid="idle-examples"');
    expect(html).toContain('打开页面');
    expect(html).toContain('抽出表格');
    expect(html).toContain('读完再回');
    expect(html).toContain('已保存 2 条');
    expect(html).not.toContain('Chat');
    expect(html).not.toContain('Claw');
  });
});
