import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      debugger: { detach: vi.fn(async () => undefined), attach: vi.fn(async () => undefined) },
      runtime: { id: 'test-extension' },
    },
  });
});

const connectMock = vi.hoisted(() => vi.fn());
const connectTabMock = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('puppeteer-core/lib/esm/puppeteer/puppeteer-core-browser.js', () => ({
  connect: (...args: unknown[]) => connectMock(...(args as [])),
  ExtensionTransport: { connectTab: (...args: unknown[]) => connectTabMock(...(args as [])) },
}));

import Page from '../page';

function fakeBrowser() {
  const page = {
    evaluateOnNewDocument: vi.fn(async () => undefined),
    url: () => 'https://example.test/',
  };
  return { pages: async () => [page] };
}

describe('Page.attachPuppeteer recovers from a stale debugger attachment', () => {
  beforeEach(() => {
    connectMock.mockReset();
    (chrome.debugger.detach as ReturnType<typeof vi.fn>).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('detaches the stale session and retries once on "Another debugger is already attached"', async () => {
    const page = new Page(7, 'https://example.test/', 'Example');
    connectMock
      .mockRejectedValueOnce(new Error('Another debugger is already attached to the tab with id: 7.'))
      .mockResolvedValueOnce(fakeBrowser());

    await expect(page.attachPuppeteer()).resolves.toBe(true);
    expect(connectMock).toHaveBeenCalledTimes(2);
    expect(chrome.debugger.detach).toHaveBeenCalledWith({ tabId: 7 });
    expect(page.attached).toBe(true);
  });

  it('does not detach when the attach failure is unrelated', async () => {
    const page = new Page(7, 'https://example.test/', 'Example');
    connectMock.mockRejectedValueOnce(new Error('Target closed'));

    await expect(page.attachPuppeteer()).rejects.toThrow('Target closed');
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(chrome.debugger.detach).not.toHaveBeenCalled();
  });
});
