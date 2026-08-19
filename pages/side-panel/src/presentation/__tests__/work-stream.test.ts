import { describe, expect, it } from 'vitest';
import type { ActionAttempt } from '@extension/storage';
import { collectStreamSources, deriveWorkStream, isSearchAttempt, searchQueryFromAttempt } from '../work-stream';

const attempt = (partial: Partial<ActionAttempt> & Pick<ActionAttempt, 'id' | 'actionName'>): ActionAttempt =>
  ({
    roundId: 'r1',
    effect: 'read',
    argsDigest: 'd',
    state: 'observed',
    proposedAt: 1,
    ...partial,
  }) as ActionAttempt;

describe('deriveWorkStream', () => {
  it('hides snapshot rows and shows the opened page', () => {
    const view = deriveWorkStream({
      status: 'running',
      currentSummary: '获取页面快照',
      attempts: [
        attempt({ id: 'a1', actionName: 'observe', displaySummary: '获取页面快照' }),
        attempt({
          id: 'a2',
          actionName: 'go_to_url',
          displaySummary: '打开 etsy.com',
          targetLabel: 'etsy.com',
          state: 'executing',
        }),
      ],
    });
    expect(view.blocks.map(block => block.type)).toEqual(['page']);
    expect(view.blocks[0]).toMatchObject({
      type: 'page',
      page: { title: 'etsy.com', host: 'etsy.com', url: 'https://etsy.com', live: true },
    });
  });

  it('renders a search board with query and result rows', () => {
    const view = deriveWorkStream({
      status: 'running',
      attempts: [
        attempt({
          id: 's1',
          actionName: 'search_google',
          displaySummary: '搜索：清程极智 深圳 黑客松 报名',
          findings: [
            { title: 'MoonStone2026 AI黑客松正式官宣', host: 'example.com', url: 'https://example.com/a' },
            { title: '清程极智 | Qingcheng.ai', host: 'qingcheng.ai', url: 'https://qingcheng.ai' },
          ],
        }),
        attempt({
          id: 's2',
          actionName: 'search_google',
          displaySummary: '搜索：清程极智 hackathon 深圳',
          state: 'executing',
        }),
      ],
    });
    expect(view.blocks).toHaveLength(1);
    expect(view.blocks[0]).toMatchObject({
      type: 'search',
      queries: [
        {
          query: '清程极智 深圳 黑客松 报名',
          results: [
            { title: 'MoonStone2026 AI黑客松正式官宣', host: 'example.com', url: 'https://example.com/a' },
            { title: '清程极智 | Qingcheng.ai', host: 'qingcheng.ai', url: 'https://qingcheng.ai' },
          ],
        },
        { query: '清程极智 hackathon 深圳', live: true, results: [] },
      ],
    });
  });

  it('writes a real why after what already happened, and invents nothing', () => {
    const deciding = deriveWorkStream({
      status: 'running',
      currentSummary: '思考中',
      attempts: [attempt({ id: 'a1', actionName: 'observe', displaySummary: '获取页面快照' })],
    });
    expect(deciding.blocks).toEqual([]);

    const afterPage = deriveWorkStream({
      status: 'running',
      currentSummary: '要比对报名入口',
      attempts: [
        attempt({
          id: 'a2',
          actionName: 'go_to_url',
          displaySummary: '打开 etsy.com',
          targetLabel: 'etsy.com',
          state: 'observed',
        }),
      ],
    });
    expect(afterPage.blocks.map(block => block.type)).toEqual(['page', 'thinking']);
    expect(afterPage.blocks[1]).toMatchObject({ type: 'thinking', text: '要比对报名入口', open: true });

    const livePage = deriveWorkStream({
      status: 'running',
      currentSummary: '打开 etsy.com',
      attempts: [
        attempt({
          id: 'a3',
          actionName: 'go_to_url',
          displaySummary: '打开 etsy.com',
          targetLabel: 'etsy.com',
          state: 'executing',
        }),
      ],
    });
    expect(livePage.blocks.map(block => block.type)).toEqual(['page']);

    const failed = deriveWorkStream({
      status: 'failed',
      currentSummary: '没做成',
      attempts: [attempt({ id: 'a1', actionName: 'observe' })],
    });
    expect(failed.blocks).toEqual([]);
  });

  it('uses the page title, not the navigate verb, and keeps it after a click', () => {
    const view = deriveWorkStream({
      status: 'running',
      attempts: [
        attempt({
          id: 's1',
          actionName: 'search_google',
          displaySummary: '搜索：报名',
          findings: [{ title: 'MoonStone2026 AI黑客松正式官宣', host: 'qingcheng.ai', url: 'https://qingcheng.ai/apply' }],
        }),
        attempt({
          id: 'p1',
          actionName: 'go_to_url',
          displaySummary: '打开 qingcheng.ai',
          targetLabel: 'qingcheng.ai',
          targetUrl: 'https://qingcheng.ai/apply',
        }),
        attempt({
          id: 'c1',
          actionName: 'click_element',
          displaySummary: '点击报名',
          targetLabel: 'qingcheng.ai',
          state: 'observed',
        }),
      ],
    });
    expect(view.blocks.map(block => block.type)).toEqual(['search', 'page']);
    expect(view.blocks[1]).toMatchObject({
      type: 'page',
      page: { title: 'MoonStone2026 AI黑客松正式官宣', host: 'qingcheng.ai' },
    });
  });

  it('surfaces a live commit before the action lands', () => {
    const view = deriveWorkStream({
      status: 'running',
      attempts: [
        attempt({
          id: 'c1',
          actionName: 'click_element',
          effect: 'external_commit',
          displaySummary: '点击提交按钮',
          state: 'executing',
        }),
      ],
    });
    expect(view.blocks).toEqual([
      {
        type: 'commit',
        id: 'c1',
        commit: { id: 'c1', text: '点击提交按钮', live: true },
      },
    ]);
  });
});

describe('collectStreamSources', () => {
  it('keeps search hits and opened pages as clickable sources', () => {
    const view = deriveWorkStream({
      status: 'completed',
      attempts: [
        attempt({
          id: 's1',
          actionName: 'search_google',
          displaySummary: '搜索：报名',
          findings: [{ title: '报名页', host: 'qingcheng.ai', url: 'https://qingcheng.ai/apply' }],
        }),
        attempt({
          id: 'p1',
          actionName: 'go_to_url',
          displaySummary: '打开 qingcheng.ai',
          targetLabel: 'qingcheng.ai',
          targetUrl: 'https://qingcheng.ai/apply',
        }),
      ],
    });
    expect(collectStreamSources(view)).toEqual([
      {
        id: 's1-https://qingcheng.ai/apply',
        title: '报名页',
        host: 'qingcheng.ai',
        url: 'https://qingcheng.ai/apply',
      },
    ]);
  });
});

describe('searchQueryFromAttempt', () => {
  it('reads the query after 搜索：', () => {
    expect(searchQueryFromAttempt({ displaySummary: '搜索：清程极智 黑客松' })).toBe('清程极智 黑客松');
  });
});

describe('isSearchAttempt', () => {
  it('treats a go_to_url that already says 搜索： as a search board', () => {
    expect(isSearchAttempt({ actionName: 'go_to_url', displaySummary: '搜索：example.com 是什么' })).toBe(true);
    expect(isSearchAttempt({ actionName: 'go_to_url', displaySummary: '打开 google.com' })).toBe(false);
  });
});

describe('deriveWorkStream serp navigation', () => {
  it('renders a search-engine go_to_url as a search board with hits', () => {
    const view = deriveWorkStream({
      status: 'completed',
      attempts: [
        attempt({
          id: 's1',
          actionName: 'go_to_url',
          displaySummary: '搜索：example.com 是什么',
          targetUrl: 'https://www.google.com/search',
          findings: [{ title: 'Example Domain', host: 'example.com', url: 'https://example.com/' }],
        }),
      ],
    });
    expect(view.blocks.map(block => block.type)).toEqual(['search']);
    expect(view.blocks[0]).toMatchObject({
      type: 'search',
      queries: [
        {
          query: 'example.com 是什么',
          results: [{ title: 'Example Domain', host: 'example.com', url: 'https://example.com/' }],
        },
      ],
    });
  });
});
