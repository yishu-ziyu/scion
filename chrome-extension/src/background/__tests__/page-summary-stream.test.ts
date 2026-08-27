import { AgentNameEnum } from '@extension/storage';
import { selectRuntime, type ChatTurn, type TurnStreamEvent } from '@extension/agent-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatStreamDeps } from '../chat-stream';
import {
  PAGE_CONTEXT_MAX_FRAMES,
  PAGE_CONTEXT_TOTAL_PAYLOAD_LIMIT,
  PAGE_NOT_WEB_ERROR,
  PAGE_SUMMARY_CONTEXT_LIMIT,
  collectPageContextFromTab,
  createPageSummaryStreamHandler,
  parseCollectedPageContext,
  parsePageSummaryStreamRequest,
  preparePageSummaryContext,
  type CollectedPageContext,
  type PageSummaryStreamEvent,
} from '../page-summary-stream';

function frameContext(
  title: string,
  url: string,
  text: string,
  options: { truncated?: boolean; inaccessibleIframes?: CollectedPageContext['inaccessibleIframes'] } = {},
): CollectedPageContext {
  return {
    bundle: {
      sourceType: 'webpage',
      title,
      url,
      blocks: text ? [{ type: 'paragraph', text }] : [],
      anchors: [],
      trustLevel: 'untrusted',
    },
    truncated: options.truncated ?? false,
    inaccessibleIframes: options.inaccessibleIframes ?? [],
  };
}

function makePort() {
  const sent: PageSummaryStreamEvent[] = [];
  return {
    sent,
    postMessage: vi.fn((message: PageSummaryStreamEvent) => sent.push(message)),
  };
}

let runtimeEvents: TurnStreamEvent[];
let seenTurns: ChatTurn[] | undefined;
let factoryCalls: Array<[string, string]>;
let selectedFeature: { featureId: string; requiredCapabilities: string[] } | undefined;

const runtimeDeps: ChatStreamDeps = {
  getProviders: async () => ({
    minimax: {
      name: 'MiniMax',
      type: 'custom_openai' as never,
      apiKey: '',
      apiKeyRef: 'ref-minimax',
      baseUrl: 'https://api.minimaxi.com/v1',
      modelNames: ['MiniMax-M3'],
    },
  }),
  getAgentModels: async () => ({
    [AgentNameEnum.Navigator]: { provider: 'minimax', modelName: 'MiniMax-M3' },
  }),
  getApiKey: async ref => (ref === 'ref-minimax' ? 'sk-real' : null),
  getSessionMessages: async () => null,
  runtimeFactory: (model, apiKey) => {
    factoryCalls.push([model.modelId, apiKey]);
    return {
      async *streamTurn(messages: ChatTurn[]) {
        seenTurns = messages;
        for (const event of runtimeEvents) yield event;
      },
    };
  },
  selectRuntimeImpl: async (input, getApiKey) => {
    selectedFeature = {
      featureId: input.featureId,
      requiredCapabilities: [...(input.requirements[0]?.requiredCapabilities ?? [])],
    };
    return selectRuntime(input, getApiKey);
  },
};

beforeEach(() => {
  runtimeEvents = [{ type: 'delta', text: '这一页' }, { type: 'delta', text: '介绍测试内容。' }, { type: 'done' }];
  seenTurns = undefined;
  factoryCalls = [];
  selectedFeature = undefined;
});

describe('page_summary_stream handler', () => {
  it('collects the bound tab, routes by chat capability, runs page_summary, and streams source plus deltas', async () => {
    const longBody = `${'正文甲'.repeat(5_000)}结尾证据`;
    const collectPageContext = vi.fn(async () =>
      frameContext('测试文章', 'https://example.test/article', longBody, { truncated: true }),
    );
    const port = makePort();
    const handler = createPageSummaryStreamHandler({ ...runtimeDeps, collectPageContext });

    await handler({ sessionId: 's1', text: '总结当前页面', tabId: 42 }, port);

    expect(collectPageContext).toHaveBeenCalledWith(42);
    expect(selectedFeature).toEqual({ featureId: 'page_summary', requiredCapabilities: ['chat'] });
    expect(factoryCalls).toEqual([['MiniMax-M3', 'sk-real']]);
    expect(port.sent).toEqual([
      {
        type: 'page_summary_stream_source',
        sessionId: 's1',
        source: { title: '测试文章', url: 'https://example.test/article', tabId: 42 },
      },
      { type: 'page_summary_stream_delta', sessionId: 's1', text: '这一页' },
      { type: 'page_summary_stream_delta', sessionId: 's1', text: '介绍测试内容。' },
      { type: 'page_summary_stream_done', sessionId: 's1' },
    ]);
    const prompt = seenTurns?.[1]?.content ?? '';
    const pageSourceMatch = prompt.match(
      /<<<BEGIN_UNTRUSTED_PAGE_SOURCE_(\d+)>>>\n([\s\S]*?)\n<<<END_UNTRUSTED_PAGE_SOURCE_\1>>>/,
    );
    const pageSource = JSON.parse(pageSourceMatch?.[2] ?? '{}') as { body?: string };
    expect(pageSource.body).toContain('正文甲正文甲');
    expect(pageSource.body?.length).toBeLessThanOrEqual(PAGE_SUMMARY_CONTEXT_LIMIT);
    expect(pageSource.body).toContain('truncated');
    expect(prompt).toContain('测试文章');
    expect(JSON.stringify(port.sent)).not.toContain('sk-real');
  });

  it('turns model-resolution failures into a stream error instead of leaving the composer stuck', async () => {
    const port = makePort();
    const handler = createPageSummaryStreamHandler({
      ...runtimeDeps,
      getProviders: async () => {
        throw new Error('storage unavailable');
      },
      collectPageContext: async () => frameContext('Article', 'https://example.test/article', 'Readable body.'),
    });

    await expect(handler({ sessionId: 's3', text: '总结当前页面', tabId: 5 }, port)).resolves.toBeUndefined();
    expect(port.sent).toEqual([
      { type: 'page_summary_stream_error', sessionId: 's3', error: '无法总结当前页面：storage unavailable' },
    ]);
  });

  it('ingests the collected page before summarizing', async () => {
    const ingestPageContext = vi.fn(async () => undefined);
    const port = makePort();
    const handler = createPageSummaryStreamHandler({
      ...runtimeDeps,
      collectPageContext: async () => frameContext('测试文章', 'https://example.test/article', 'Readable body.'),
      ingestPageContext,
    });

    await handler({ sessionId: 's1', text: '总结当前页面', tabId: 42 }, port);

    expect(ingestPageContext).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '测试文章',
        url: 'https://example.test/article',
      }),
    );
    expect(port.sent.at(-1)).toEqual({ type: 'page_summary_stream_done', sessionId: 's1' });
  });

  it('does not ingest when the page cannot be read', async () => {
    const ingestPageContext = vi.fn(async () => undefined);
    const port = makePort();
    const handler = createPageSummaryStreamHandler({
      ...runtimeDeps,
      collectPageContext: async () =>
        frameContext('Checkout', 'https://shop.test/checkout', 'Visible shell', {
          inaccessibleIframes: [{ url: 'https://pay.test', error: 'cross-origin frame' }],
        }),
      ingestPageContext,
    });

    await handler({ sessionId: 's2', text: '总结当前页面', tabId: 7 }, port);

    expect(ingestPageContext).not.toHaveBeenCalled();
  });

  it('refuses to summarize when any iframe is inaccessible and never resolves a model', async () => {
    const getProviders = vi.fn(runtimeDeps.getProviders);
    const port = makePort();
    const handler = createPageSummaryStreamHandler({
      ...runtimeDeps,
      getProviders,
      collectPageContext: async () =>
        frameContext('Checkout', 'https://shop.test/checkout', 'Visible shell', {
          inaccessibleIframes: [{ url: 'https://pay.test', error: 'cross-origin frame' }],
        }),
    });

    await handler({ sessionId: 's2', text: '总结当前页面', tabId: 7 }, port);

    expect(getProviders).not.toHaveBeenCalled();
    expect(factoryCalls).toEqual([]);
    expect(port.sent).toHaveLength(1);
    expect(port.sent[0]).toMatchObject({ type: 'page_summary_stream_error', sessionId: 's2' });
    expect((port.sent[0] as { error: string }).error).toContain('iframe');
    expect((port.sent[0] as { error: string }).error).toContain('https://pay.test');
  });

  it('refuses chrome:// with the ordinary-webpage copy', async () => {
    const port = makePort();
    const handler = createPageSummaryStreamHandler({
      ...runtimeDeps,
      collectPageContext: async () => null,
    });

    await handler({ sessionId: 's5', text: '总结当前页面', tabId: 1 }, port);

    expect(port.sent).toEqual([{ type: 'page_summary_stream_error', sessionId: 's5', error: PAGE_NOT_WEB_ERROR }]);
  });

  it('does not tell the user to open a normal webpage when https collect throws', async () => {
    const port = makePort();
    const handler = createPageSummaryStreamHandler({
      ...runtimeDeps,
      collectPageContext: async () => {
        throw new Error('Could not establish connection. Receiving end does not exist.');
      },
    });

    await handler(
      { sessionId: 's4', text: 'Write a short summary of the first three books on this page.', tabId: 8 },
      port,
    );

    expect(port.sent).toEqual([
      {
        type: 'page_summary_stream_error',
        sessionId: 's4',
        error: 'Could not establish connection. Receiving end does not exist.',
      },
    ]);
    expect((port.sent[0] as { error: string }).error).not.toContain('请打开普通网页后再试');
  });

  it('never sends query tokens from the page URL to the model or the chat source', () => {
    const prepared = preparePageSummaryContext(
      frameContext('Reset', 'https://example.test/reset?token=SECRET_TOKEN#frag', 'Reset this password.'),
    );
    const serialized = JSON.stringify(prepared);

    expect(prepared.page.url).toBe('https://example.test/reset');
    expect(prepared.bundle.url).toBe('https://example.test/reset');
    expect(serialized).not.toContain('SECRET_TOKEN');
    expect(serialized).not.toContain('#frag');
  });
});

describe('collectPageContextFromTab', () => {
  it('merges every responding frame so cross-origin frame text is not silently lost', async () => {
    const collected = await collectPageContextFromTab(9, {
      getFrames: async () => [
        { frameId: 0, url: 'https://example.test/article' },
        { frameId: 3, url: 'https://embed.test/details' },
      ],
      sendToFrame: async (_tabId, frameId) =>
        frameId === 0
          ? frameContext('Top article', 'https://example.test/article', 'Top frame fact.')
          : frameContext('Embedded details', 'https://embed.test/details', 'Embedded frame fact.'),
    });

    expect(collected?.inaccessibleIframes).toEqual([]);
    const prepared = preparePageSummaryContext(collected!);
    expect(prepared.page.text).toContain('Top frame fact.');
    expect(prepared.page.text).toContain('Embedded frame fact.');
  });

  it('reports a frame that has no content-script response', async () => {
    const collected = await collectPageContextFromTab(9, {
      getFrames: async () => [
        { frameId: 0, url: 'https://example.test/article' },
        { frameId: 4, url: 'https://blocked.test/frame' },
      ],
      sendToFrame: async (_tabId, frameId) => {
        if (frameId === 4) throw new Error('Receiving end does not exist');
        return frameContext('Top article', 'https://example.test/article', 'Top frame fact.');
      },
    });

    expect(collected?.inaccessibleIframes).toEqual([
      { url: 'https://blocked.test/frame', error: 'Receiving end does not exist' },
    ]);
  });

  it('bounds the total wire payload across a page with more frames than the budget can admit', async () => {
    const requestedBudgets: number[] = [];
    let wirePayloadChars = 0;
    const collected = await collectPageContextFromTab(11, {
      getFrames: async () =>
        Array.from({ length: PAGE_CONTEXT_MAX_FRAMES + 7 }, (_, frameId) => ({
          frameId,
          url: `https://frame-${frameId}.example.test/`,
        })),
      sendToFrame: async (_tabId, frameId, maxPayloadChars) => {
        requestedBudgets.push(maxPayloadChars);
        const response = frameContext(
          `Frame ${frameId}`,
          `https://frame-${frameId}.example.test/`,
          `UNIQUE_FRAME_${frameId} ${'large frame body '.repeat(Math.max(1, Math.floor((maxPayloadChars - 512) / 17)))}${
            frameId === 0 ? ' TOP_FRAME_TAIL_EVIDENCE' : ''
          }`,
          { truncated: true },
        );
        const responseChars = JSON.stringify(response).length;
        expect(responseChars).toBeLessThanOrEqual(maxPayloadChars);
        wirePayloadChars += responseChars;
        return response;
      },
    });

    expect(requestedBudgets).toHaveLength(PAGE_CONTEXT_MAX_FRAMES);
    expect(requestedBudgets[0]).toBeGreaterThanOrEqual(PAGE_CONTEXT_TOTAL_PAYLOAD_LIMIT / 2);
    expect(requestedBudgets.reduce((sum, budget) => sum + budget, 0)).toBeLessThanOrEqual(
      PAGE_CONTEXT_TOTAL_PAYLOAD_LIMIT,
    );
    expect(wirePayloadChars).toBeLessThanOrEqual(PAGE_CONTEXT_TOTAL_PAYLOAD_LIMIT);
    expect(JSON.stringify(collected).length).toBeLessThanOrEqual(PAGE_CONTEXT_TOTAL_PAYLOAD_LIMIT);
    const pageText = preparePageSummaryContext(collected!).page.text;
    expect(pageText).toContain('TOP_FRAME_TAIL_EVIDENCE');
    expect(pageText).toContain('7 additional iframe(s) omitted');
    expect(collected?.omittedFrameCount).toBe(7);
    expect(collected?.truncated).toBe(true);
  });

  it('rejects a legacy frame response that sends raw HTML to the background', async () => {
    await expect(
      collectPageContextFromTab(12, {
        getTab: async () => ({ url: 'https://example.test/' }),
        getFrames: async () => [{ frameId: 0, url: 'https://example.test/' }],
        sendToFrame: async () => ({
          title: 'Legacy response',
          url: 'https://example.test/',
          html: `<main>${'raw html '.repeat(10_000)}</main>`,
          truncated: false,
          inaccessibleIframes: [],
        }),
      }),
    ).rejects.toThrow(/invalid or oversized page context response/);
  });

  it('collects books-like https HTML when the content-script listener is missing', async () => {
    const collected = await collectPageContextFromTab(8, {
      getTab: async () => ({ url: 'https://books.toscrape.com/', title: 'All products | Books to Scrape - Sandbox' }),
      getFrames: async () => [{ frameId: 0, url: 'https://books.toscrape.com/' }],
      sendToFrame: async () => {
        throw new Error('Could not establish connection. Receiving end does not exist.');
      },
      readFrameHtml: async () => ({
        title: 'All products | Books to Scrape - Sandbox',
        url: 'https://books.toscrape.com/',
        html: `<html><body><main>
          <h1>Books to Scrape</h1>
          <article><h3><a href="catalogue/a-light-in-the-attic_1000/index.html">A Light in the Attic</a></h3><p>£51.77</p></article>
          <article><h3><a href="catalogue/tipping-the-velvet_999/index.html">Tipping the Velvet</a></h3><p>£53.74</p></article>
          <article><h3><a href="catalogue/soumission_998/index.html">Soumission</a></h3><p>£50.10</p></article>
        </main></body></html>`,
      }),
    });

    expect(collected).not.toBeNull();
    expect(collected?.inaccessibleIframes).toEqual([]);
    const text = preparePageSummaryContext(collected!).page.text;
    expect(text).toContain('A Light in the Attic');
    expect(text).toContain('Tipping the Velvet');
    expect(text).toContain('Soumission');
  });

  it('returns null for chrome:// without reading HTML', async () => {
    const readFrameHtml = vi.fn();
    const collected = await collectPageContextFromTab(1, {
      getTab: async () => ({ url: 'chrome://extensions' }),
      getFrames: async () => [{ frameId: 0, url: 'chrome://extensions' }],
      sendToFrame: async () => {
        throw new Error('Receiving end does not exist');
      },
      readFrameHtml,
    });

    expect(collected).toBeNull();
    expect(readFrameHtml).not.toHaveBeenCalled();
  });
});

describe('parseCollectedPageContext', () => {
  it.each([Number.POSITIVE_INFINITY, Number.NaN, PAGE_CONTEXT_TOTAL_PAYLOAD_LIMIT * 2])(
    'never lets a non-production cap bypass the global payload limit: %s',
    maxPayloadChars => {
      const oversized = frameContext('Oversized', 'https://example.test/', 'x'.repeat(30_000));

      expect(parseCollectedPageContext(oversized, maxPayloadChars)).toBeNull();
    },
  );
});

describe('parsePageSummaryStreamRequest', () => {
  it('accepts only a bound non-empty page summary request', () => {
    expect(
      parsePageSummaryStreamRequest({ type: 'page_summary_stream', sessionId: 's1', text: '总结当前页面', tabId: 8 }),
    ).toEqual({ sessionId: 's1', text: '总结当前页面', tabId: 8 });
    expect(
      parsePageSummaryStreamRequest({ type: 'page_summary_stream', sessionId: 's1', text: '总结当前页面' }),
    ).toBeNull();
    for (const tabId of [-1, 1.5, Number.NaN, '8']) {
      expect(
        parsePageSummaryStreamRequest({ type: 'page_summary_stream', sessionId: 's1', text: '总结当前页面', tabId }),
      ).toBeNull();
    }
    expect(
      parsePageSummaryStreamRequest({ type: 'page_summary_stream', sessionId: 's1', text: ' ', tabId: 8 }),
    ).toBeNull();
    expect(parsePageSummaryStreamRequest({ type: 'chat_stream', sessionId: 's1', text: '你好', tabId: 8 })).toBeNull();
  });
});
