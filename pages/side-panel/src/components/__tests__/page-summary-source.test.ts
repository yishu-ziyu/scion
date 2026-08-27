import { Actors, type Message } from '@extension/storage';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import MessageList from '../MessageList';

describe('page summary source', () => {
  it('renders the collected page title and URL with the streamed answer', () => {
    const messages: Message[] = [
      {
        actor: Actors.SYSTEM,
        content: '这是一篇测试文章。',
        timestamp: 100,
        source: { title: '测试文章', url: 'https://example.test/article', tabId: 42 },
      },
    ];

    const html = renderToStaticMarkup(createElement(MessageList, { messages }));

    expect(html).toContain('这是一篇测试文章。');
    expect(html).toContain('测试文章');
    expect(html).toContain('<span class="chijie-search-host">https://example.test/article</span>');
    expect(html).toContain('data-url="https://example.test/article"');
    expect(html).toContain('title="https://example.test/article"');
  });
});
