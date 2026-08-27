import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { clickCdpElement } = vi.hoisted(() => {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: { runtime: { id: 'test-extension' } },
  });
  return { clickCdpElement: vi.fn(async () => undefined as void) };
});

import { DOMElementNode } from '../dom/views';

vi.mock('../cdp/click', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    clickCdpElement,
  };
});

import Page from '../page';

function nodeWithHandle(): DOMElementNode {
  return new DOMElementNode({
    tagName: 'button',
    xpath: '/html/body/button',
    attributes: {},
    children: [],
    isVisible: true,
    isInteractive: true,
    highlightIndex: 1,
    tabId: 7,
    cdpFrameId: 'main',
    backendNodeId: 22,
  });
}

function nodeWithoutHandle(): DOMElementNode {
  return new DOMElementNode({
    tagName: 'button',
    xpath: '/html/body/button',
    attributes: {},
    children: [],
    isVisible: true,
    isInteractive: true,
    highlightIndex: 1,
    tabId: 7,
  });
}

describe('Page.clickElementNode uses debugger click only', () => {
  beforeEach(() => {
    clickCdpElement.mockReset();
    clickCdpElement.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clicks through chrome.debugger and does not locate a puppeteer handle', async () => {
    const page = new Page(7, 'https://example.test/', 'Example');
    const puppeteerClick = vi.fn();
    (page as unknown as { _puppeteerPage: { url: () => string; click: typeof puppeteerClick } })._puppeteerPage = {
      url: () => 'https://example.test/',
      click: puppeteerClick,
    };
    const locate = vi.spyOn(page, 'locateElement');

    await page.clickElementNode(false, nodeWithHandle());

    expect(clickCdpElement).toHaveBeenCalledOnce();
    expect(locate).not.toHaveBeenCalled();
    expect(puppeteerClick).not.toHaveBeenCalled();
  });

  it('does not fall back to puppeteer when the debugger click fails', async () => {
    clickCdpElement.mockRejectedValue(new Error('Target closed'));
    const page = new Page(7, 'https://example.test/', 'Example');
    const puppeteerClick = vi.fn();
    (page as unknown as { _puppeteerPage: { url: () => string; click: typeof puppeteerClick } })._puppeteerPage = {
      url: () => 'https://example.test/',
      click: puppeteerClick,
    };
    const locate = vi.spyOn(page, 'locateElement');

    await expect(page.clickElementNode(false, nodeWithHandle())).rejects.toThrow(/Target closed/);
    expect(locate).not.toHaveBeenCalled();
    expect(puppeteerClick).not.toHaveBeenCalled();
  });

  it('awaits the debugger click instead of abandoning it', async () => {
    let finish: () => void = () => undefined;
    clickCdpElement.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          finish = resolve;
        }),
    );
    const page = new Page(7, 'https://example.test/', 'Example');
    (page as unknown as { _puppeteerPage: { url: () => string } })._puppeteerPage = {
      url: () => 'https://example.test/',
    };

    const pending = page.clickElementNode(false, nodeWithHandle());
    let outcome: 'pending' | 'resolved' | 'rejected' = 'pending';
    const tracked = pending.then(
      () => {
        outcome = 'resolved';
      },
      () => {
        outcome = 'rejected';
      },
    );
    await Promise.resolve();
    expect(outcome).toBe('pending');
    finish();
    await tracked;
    expect(outcome).toBe('resolved');
  });

  it('does not fall back to puppeteer when the node has no debugger id', async () => {
    const page = new Page(7, 'https://example.test/', 'Example');
    const puppeteerClick = vi.fn();
    (page as unknown as { _puppeteerPage: { url: () => string; click: typeof puppeteerClick } })._puppeteerPage = {
      url: () => 'https://example.test/',
      click: puppeteerClick,
    };
    const locate = vi.spyOn(page, 'locateElement');

    await expect(page.clickElementNode(false, nodeWithoutHandle())).rejects.toThrow(/debugger/);
    expect(clickCdpElement).not.toHaveBeenCalled();
    expect(locate).not.toHaveBeenCalled();
    expect(puppeteerClick).not.toHaveBeenCalled();
  });
});
