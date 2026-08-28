import { beforeEach, describe, expect, it, vi } from 'vitest';

const collectPageContextFromTab = vi.hoisted(() => vi.fn());
const preparePageSummaryContext = vi.hoisted(() => vi.fn());
const tabsApi = vi.hoisted(() => ({ query: vi.fn() }));
const debuggerApi = vi.hoisted(() => ({
  attach: vi.fn(async () => undefined),
  detach: vi.fn(async () => undefined),
  getTargets: vi.fn(async () => []),
}));

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      tabs: tabsApi,
      debugger: debuggerApi,
    },
  });
});

vi.mock('../../page-summary-stream', () => ({
  collectPageContextFromTab: (...args: unknown[]) => collectPageContextFromTab(...args),
  preparePageSummaryContext: (...args: unknown[]) => preparePageSummaryContext(...args),
}));

import { createLiveOrchestratorHost } from '../live-host';

function fakeTaskManager() {
  return {
    activeSnapshot: vi.fn(async () => null),
    snapshot: vi.fn(async () => null),
    dispatch: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
  };
}

describe('live orchestrator host page read', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads the active http tab via the content script and does not debugger.attach', async () => {
    tabsApi.query.mockResolvedValue([{ id: 9, url: 'https://example.test/article' }]);
    collectPageContextFromTab.mockResolvedValue({
      bundle: { title: '夹具文章', url: 'https://example.test/article', blocks: [] },
    });
    preparePageSummaryContext.mockReturnValue({
      page: { title: '夹具文章', url: 'https://example.test/article', text: '候鸟迁徙' },
    });
    const host = createLiveOrchestratorHost(fakeTaskManager() as never);

    await expect(host.readCurrentPage?.()).resolves.toEqual({
      ok: true,
      title: '夹具文章',
      url: 'https://example.test/article',
      text: '候鸟迁徙',
    });

    expect(collectPageContextFromTab).toHaveBeenCalledWith(9);
    expect(debuggerApi.attach).not.toHaveBeenCalled();
  });

  it('does not attach when the side panel is the active tab and no http tab exists', async () => {
    tabsApi.query.mockResolvedValue([{ id: 1, url: 'chrome-extension://test-extension/side-panel/index.html' }]);
    const host = createLiveOrchestratorHost(fakeTaskManager() as never);

    await expect(host.readCurrentPage?.()).resolves.toEqual({ ok: false, error: 'No web page is active.' });

    expect(collectPageContextFromTab).not.toHaveBeenCalled();
    expect(debuggerApi.attach).not.toHaveBeenCalled();
  });

  it('reads a sibling http tab via the content script when the side panel is the active tab', async () => {
    const extensionTab = { id: 1, url: 'chrome-extension://test-extension/side-panel/index.html' };
    const article = { id: 9, url: 'https://example.test/article', lastAccessed: 20 };
    tabsApi.query.mockImplementation(async (query: { active?: boolean }) =>
      query.active ? [extensionTab] : [extensionTab, article],
    );
    collectPageContextFromTab.mockResolvedValue({
      bundle: { title: '夹具文章', url: 'https://example.test/article', blocks: [] },
    });
    preparePageSummaryContext.mockReturnValue({
      page: { title: '夹具文章', url: 'https://example.test/article', text: '候鸟迁徙' },
    });
    const host = createLiveOrchestratorHost(fakeTaskManager() as never);

    await expect(host.readCurrentPage?.()).resolves.toEqual({
      ok: true,
      title: '夹具文章',
      url: 'https://example.test/article',
      text: '候鸟迁徙',
    });

    expect(collectPageContextFromTab).toHaveBeenCalledWith(9);
    expect(debuggerApi.attach).not.toHaveBeenCalled();
  });
});
