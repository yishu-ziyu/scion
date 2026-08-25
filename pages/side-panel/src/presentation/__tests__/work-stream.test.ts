import { describe, expect, it } from 'vitest';
import type { ActionAttempt } from '@extension/storage';
import {
  collectStreamSources,
  deriveWorkStream,
  isSearchAttempt,
  searchQueryFromAttempt,
  splitThinkingSentences,
} from '../work-stream';

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
  it('discloses snapshot as an action chip then shows the opened page', () => {
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
    expect(view.blocks.map(block => block.type)).toEqual(['act', 'page']);
    expect(view.blocks[0]).toMatchObject({ type: 'act', text: '获取页面快照' });
    expect(view.blocks[1]).toMatchObject({
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

    const completed = deriveWorkStream({
      status: 'completed',
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
    expect(completed.blocks[1]).toMatchObject({ type: 'thinking', text: '要比对报名入口', open: false });

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

  it('uses the page title, not the navigate verb, and keeps a click as its own line', () => {
    const view = deriveWorkStream({
      status: 'running',
      attempts: [
        attempt({
          id: 's1',
          actionName: 'search_google',
          displaySummary: '搜索：报名',
          findings: [
            { title: 'MoonStone2026 AI黑客松正式官宣', host: 'qingcheng.ai', url: 'https://qingcheng.ai/apply' },
          ],
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
    expect(view.blocks.map(block => block.type)).toEqual(['search', 'page', 'act']);
    expect(view.blocks[1]).toMatchObject({
      type: 'page',
      page: { title: 'MoonStone2026 AI黑客松正式官宣', host: 'qingcheng.ai' },
    });
    expect(view.blocks[2]).toMatchObject({ type: 'act', text: '点击报名', live: false });
  });

  it('turns an already-open Google SERP observe into a search board with the fourth title', () => {
    const view = deriveWorkStream({
      status: 'running',
      attempts: [
        attempt({
          id: 'o1',
          actionName: 'observe',
          displaySummary: '搜索：全部',
          targetUrl: 'https://www.google.com.hk/search',
          findings: [
            { title: '第一条视频', host: 'a.example', url: 'https://a.example/1' },
            { title: '第二条官网', host: 'b.example', url: 'https://b.example/2' },
            { title: '第三条百科', host: 'c.example', url: 'https://c.example/3' },
            { title: '某某教程', host: 'd.example', url: 'https://d.example/4' },
          ],
        }),
      ],
    });
    expect(view.blocks.map(block => block.type)).toEqual(['search']);
    expect(view.blocks[0]).toMatchObject({
      type: 'search',
      queries: [
        {
          query: '全部',
          results: expect.arrayContaining([{ title: '某某教程', host: 'd.example', url: 'https://d.example/4' }]),
        },
      ],
    });
  });

  it('uses the Google document title as the query when the stored URL dropped q=', () => {
    const view = deriveWorkStream({
      status: 'running',
      pageUrl: 'https://www.google.com.hk/search',
      pageTitle: '全部 - Google 搜索',
      pageLabel: 'google.com.hk',
      attempts: [attempt({ id: 'o1', actionName: 'observe', displaySummary: '获取页面快照' })],
    });
    expect(view.blocks.map(block => block.type)).toEqual(['search']);
    expect(view.blocks[0]).toMatchObject({
      type: 'search',
      queries: [{ query: '全部', results: [] }],
    });
  });

  it('does not put 获取页面快照 on the search board when observe already has result titles', () => {
    const view = deriveWorkStream({
      status: 'running',
      pageTitle: '全部 - Google 搜索',
      pageUrl: 'https://www.google.com.hk/search',
      attempts: [
        attempt({
          id: 'o1',
          actionName: 'observe',
          displaySummary: '获取页面快照',
          findings: [
            { title: '第一条视频', host: 'a.example', url: 'https://a.example/1' },
            { title: '第二条官网', host: 'b.example', url: 'https://b.example/2' },
            { title: '第三条百科', host: 'c.example', url: 'https://c.example/3' },
            { title: '某某教程', host: 'd.example', url: 'https://d.example/4' },
          ],
        }),
      ],
    });
    expect(view.blocks.map(block => block.type)).toEqual(['search']);
    expect(view.blocks[0]).toMatchObject({
      type: 'search',
      queries: [
        {
          query: '全部',
          results: [
            { title: '第一条视频', host: 'a.example', url: 'https://a.example/1' },
            { title: '第二条官网', host: 'b.example', url: 'https://b.example/2' },
            { title: '第三条百科', host: 'c.example', url: 'https://c.example/3' },
            { title: '某某教程', host: 'd.example', url: 'https://d.example/4' },
          ],
        },
      ],
    });
  });

  it('turns an already-open Google SERP observe into a search board, then reading, then the fourth-hit click', () => {
    const view = deriveWorkStream({
      status: 'running',
      currentSummary: '当前是搜索结果页，第四条是某某教程',
      attempts: [
        attempt({
          id: 'o1',
          actionName: 'observe',
          displaySummary: '搜索：全部',
          targetUrl: 'https://www.google.com.hk/search',
          findings: [
            { title: '第一条视频', host: 'a.example', url: 'https://a.example/1' },
            { title: '第二条官网', host: 'b.example', url: 'https://b.example/2' },
            { title: '第三条百科', host: 'c.example', url: 'https://c.example/3' },
            { title: '某某教程', host: 'd.example', url: 'https://d.example/4' },
          ],
        }),
        attempt({
          id: 'c1',
          actionName: 'click_element',
          displaySummary: '点击第四个：某某教程',
          state: 'executing',
        }),
      ],
    });
    expect(view.blocks.map(block => block.type)).toEqual(['search', 'thinking', 'act']);
    expect(view.blocks[0]).toMatchObject({
      type: 'search',
      queries: [
        {
          query: '全部',
          results: expect.arrayContaining([{ title: '某某教程', host: 'd.example', url: 'https://d.example/4' }]),
        },
      ],
    });
    expect(view.blocks[1]).toMatchObject({ type: 'thinking', text: '当前是搜索结果页，第四条是某某教程', open: true });
    expect(view.blocks[2]).toMatchObject({ type: 'act', text: '点击第四个：某某教程', live: true });
  });

  it('drops 获取页面快照 and 思考中 as page readings', () => {
    const snapshot = deriveWorkStream({
      status: 'running',
      currentSummary: '获取页面快照',
      attempts: [attempt({ id: 'o1', actionName: 'observe', displaySummary: '获取页面快照' })],
    });
    expect(snapshot.blocks).toEqual([expect.objectContaining({ type: 'act', id: 'o1', text: '获取页面快照' })]);
    expect(snapshot.blocks.some(block => block.type === 'thinking')).toBe(false);

    const thinking = deriveWorkStream({
      status: 'running',
      currentSummary: '思考中',
      attempts: [
        attempt({
          id: 's1',
          actionName: 'search_google',
          displaySummary: '搜索：全部',
        }),
      ],
    });
    expect(thinking.blocks.map(block => block.type)).toEqual(['search']);
  });

  it('does not draw a blocked click or select that never happened', () => {
    const view = deriveWorkStream({
      status: 'waiting_user',
      attempts: [
        attempt({
          id: 'a0',
          actionName: 'click_element',
          displaySummary: '点击第四个：某某教程',
          state: 'observed',
        }),
        attempt({
          id: 'a1',
          actionName: 'click_element',
          displaySummary: '点击 Submit',
          state: 'blocked',
        }),
        attempt({
          id: 'a2',
          actionName: 'select_dropdown_option',
          displaySummary: '选择国家',
          state: 'blocked',
        }),
        attempt({
          id: 'a3',
          actionName: 'input_text',
          displaySummary: '填写 Name',
          state: 'blocked',
        }),
      ],
    });
    expect(view.blocks.map(block => block.type)).toEqual(['act']);
    expect(view.blocks[0]).toMatchObject({ type: 'act', text: '点击第四个：某某教程', live: false });
  });

  it('still draws an executing click as a live act', () => {
    const view = deriveWorkStream({
      status: 'running',
      attempts: [
        attempt({
          id: 'a1',
          actionName: 'click_element',
          displaySummary: '点击第四个：某某教程',
          state: 'executing',
        }),
      ],
    });
    expect(view.blocks).toEqual([{ type: 'act', id: 'a1', text: '点击第四个：某某教程', live: true }]);
  });

  it('does not draw a blocked submit as a commit', () => {
    const view = deriveWorkStream({
      status: 'waiting_user',
      attempts: [
        attempt({
          id: 'c1',
          actionName: 'click_element',
          effect: 'external_commit',
          displaySummary: '点击提交按钮',
          state: 'blocked',
        }),
      ],
    });
    expect(view.blocks).toEqual([]);
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

describe('splitThinkingSentences', () => {
  it('splits a Chinese reading on sentence stops and keeps a single line whole', () => {
    expect(splitThinkingSentences('当前是搜索结果页。第四条是某某教程。')).toEqual([
      '当前是搜索结果页。',
      '第四条是某某教程。',
    ]);
    expect(splitThinkingSentences('要比对报名入口')).toEqual(['要比对报名入口']);
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

  it('does not treat 获取页面快照 as a search query', () => {
    expect(searchQueryFromAttempt({ displaySummary: '获取页面快照' })).toBe('搜索网页');
  });
});

describe('isSearchAttempt', () => {
  it('treats a go_to_url that already says 搜索： as a search board', () => {
    expect(isSearchAttempt({ actionName: 'go_to_url', displaySummary: '搜索：example.com 是什么' })).toBe(true);
    expect(isSearchAttempt({ actionName: 'go_to_url', displaySummary: '打开 google.com' })).toBe(false);
    expect(
      isSearchAttempt({
        actionName: 'observe',
        displaySummary: '获取页面快照',
        findings: [{ title: '某某教程', host: 'd.example', url: 'https://d.example/4' }],
      }),
    ).toBe(true);
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
