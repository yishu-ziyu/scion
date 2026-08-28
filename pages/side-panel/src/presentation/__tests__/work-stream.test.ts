import { describe, expect, it } from 'vitest';
import type { ActionAttempt } from '@extension/storage';
import {
  collectStreamSources,
  deriveWorkStream,
  isSearchAttempt,
  searchQueryFromAttempt,
  splitThinkingSentences,
  thinkingRevealStep,
  THINKING_REVEAL_MS,
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
  it('skips noise snapshots and host-only navigations while running', () => {
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
    expect(view.blocks).toEqual([]);
  });

  it('keeps a named page title when the navigate verb only had a host', () => {
    const view = deriveWorkStream({
      status: 'running',
      pageTitle: 'Etsy handmade goods',
      attempts: [
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
      page: { title: 'Etsy handmade goods', live: true },
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

  it('lists real attempts only, and does not paint pageReading as a thinking sentence', () => {
    const deciding = deriveWorkStream({
      status: 'running',
      currentSummary: '思考中',
      attempts: [attempt({ id: 'a1', actionName: 'observe', displaySummary: '获取页面快照' })],
    });
    expect(deciding.blocks).toEqual([]);
    expect(deciding.blocks.some(block => block.type === 'thinking')).toBe(false);

    const afterPage = deriveWorkStream({
      status: 'running',
      currentSummary: '要比对报名入口',
      pageTitle: 'Etsy handmade goods',
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
    expect(afterPage.blocks.map(block => block.type)).toEqual(['page']);
    expect(afterPage.blocks.some(block => block.type === 'thinking')).toBe(false);
    expect(JSON.stringify(afterPage.blocks)).not.toContain('要比对报名入口');

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
    expect(completed.blocks.some(block => block.type === 'thinking')).toBe(false);
    expect(JSON.stringify(completed.blocks)).not.toContain('要比对报名入口');

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
    expect(livePage.blocks).toEqual([]);

    const failed = deriveWorkStream({
      status: 'failed',
      currentSummary: '没做成',
      attempts: [attempt({ id: 'a1', actionName: 'observe' })],
    });
    expect(failed.blocks).toEqual([]);
    expect(failed.blocks.some(block => block.type === 'thinking')).toBe(false);
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

  it('skips snapshot chips and keeps a named tab, not the bare host', () => {
    const view = deriveWorkStream({
      status: 'running',
      attempts: [
        attempt({ id: 's1', actionName: 'snapshot', displaySummary: '获取页面快照' }),
        attempt({ id: 'o1', actionName: 'observe', displaySummary: '获取页面快照' }),
        attempt({
          id: 't1',
          actionName: 'switch_tab',
          displaySummary: '切换到 YouTube',
          targetLabel: 'youtube.com',
          targetUrl: 'https://youtube.com',
        }),
      ],
    });
    expect(view.blocks.map(block => block.type)).toEqual(['page']);
    expect(view.blocks[0]).toMatchObject({
      type: 'page',
      page: { title: 'YouTube', url: 'https://youtube.com' },
    });
  });

  it('does not dump 查看 youtube.com as an act, or English page extracts as thinking', () => {
    const view = deriveWorkStream({
      status: 'running',
      currentSummary:
        'GitHub is where people build software. More than 100 million people use GitHub to discover, fork, and contribute.',
      attempts: [
        attempt({
          id: 'c1',
          actionName: 'click_element',
          displaySummary: '查看 youtube.com',
          state: 'observed',
        }),
        attempt({
          id: 'g1',
          actionName: 'go_to_url',
          displaySummary: '打开 github.com',
          targetLabel: 'github.com',
          targetUrl: 'https://github.com',
        }),
      ],
    });
    expect(view.blocks).toEqual([]);
    expect(view.blocks.some(block => block.type === 'thinking')).toBe(false);
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
    expect(view.blocks.map(block => block.type)).toEqual(['search', 'act']);
    expect(view.blocks[0]).toMatchObject({
      type: 'search',
      queries: [
        {
          query: '全部',
          results: expect.arrayContaining([{ title: '某某教程', host: 'd.example', url: 'https://d.example/4' }]),
        },
      ],
    });
    expect(view.blocks[1]).toMatchObject({ type: 'act', text: '点击第四个：某某教程', live: true });
    expect(JSON.stringify(view.blocks)).not.toContain('当前是搜索结果页');
  });

  it('drops 获取页面快照 and 思考中 as page readings', () => {
    const snapshot = deriveWorkStream({
      status: 'running',
      currentSummary: '获取页面快照',
      attempts: [attempt({ id: 'o1', actionName: 'observe', displaySummary: '获取页面快照' })],
    });
    expect(snapshot.blocks).toEqual([]);
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

  it('lists both two-site sources when only the second page was an open_tab', () => {
    const view = deriveWorkStream({
      status: 'completed',
      attempts: [
        attempt({ id: 'o1', actionName: 'observe', displaySummary: '获取页面快照' }),
        attempt({
          id: 't1',
          actionName: 'open_tab',
          displaySummary: '打开 webscraper.io Allinone | Web Scraper Test Sites',
          targetLabel: 'webscraper.io',
          targetUrl: 'https://webscraper.io/test-sites/e-commerce/allinone',
        }),
      ],
      verifiedPages: [
        {
          id: 'books',
          title: 'All products | Books to Scrape',
          host: 'books.toscrape.com',
          url: 'https://books.toscrape.com/catalogue/category/books_1/index.html',
        },
        {
          id: 'allinone',
          title: 'Allinone | Web Scraper Test Sites',
          host: 'webscraper.io',
          url: 'https://webscraper.io/test-sites/e-commerce/allinone',
        },
      ],
    });
    const pages = view.blocks.filter(block => block.type === 'page');
    expect(pages).toHaveLength(2);
    expect(pages[0]).toMatchObject({
      type: 'page',
      page: { title: 'All products | Books to Scrape', host: 'books.toscrape.com' },
    });
    expect(pages[1]).toMatchObject({
      type: 'page',
      page: { title: expect.stringContaining('Allinone') },
    });
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

  it('never shows raw markdown tokens in a live reading', () => {
    const sentences = splitThinkingSentences(
      '已通读当前页面，下面给出提炼。## 关键信息提炼 **1. AI 产品经理角色定义** AI 产品经理 = 传统产品经理 + AI 技术理解。',
    );
    expect(sentences.length).toBeGreaterThan(0);
    for (const sentence of sentences) {
      expect(sentence).not.toContain('#');
      expect(sentence).not.toContain('*');
    }
    expect(sentences.some(sentence => sentence.includes('关键信息提炼'))).toBe(true);
  });
});

describe('thinkingRevealStep', () => {
  it('shows everything at once once the task is no longer running', () => {
    expect(thinkingRevealStep(5, 1, { running: false, reduceMotion: false })).toEqual({ visible: 5 });
  });

  it('shows everything at once when the user prefers reduced motion', () => {
    expect(thinkingRevealStep(5, 0, { running: true, reduceMotion: true })).toEqual({ visible: 5 });
  });

  it('reveals the first sentence almost immediately while running', () => {
    const step = thinkingRevealStep(3, 0, { running: true, reduceMotion: false });
    expect(step.visible).toBe(1);
    expect(step.againInMs).toBeLessThanOrEqual(80);
  });

  it('reveals already-arrived sentences one at a time on a single cadence', () => {
    const step = thinkingRevealStep(4, 2, { running: true, reduceMotion: false });
    expect(step.visible).toBe(3);
    expect(step.againInMs).toBe(THINKING_REVEAL_MS);
  });

  it('stops scheduling once every arrived sentence is visible', () => {
    expect(thinkingRevealStep(3, 3, { running: true, reduceMotion: false })).toEqual({ visible: 3 });
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
