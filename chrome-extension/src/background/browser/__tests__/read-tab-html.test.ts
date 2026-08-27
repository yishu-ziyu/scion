import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { executeScript } = vi.hoisted(() => {
  const executeScript = vi.fn();
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      runtime: { id: 'test-extension' },
      scripting: { executeScript },
    },
  });
  return { executeScript };
});

import { readTabOuterHtml } from '../read-tab-html';
import Page from '../page';

describe('readTabOuterHtml', () => {
  beforeEach(() => {
    executeScript.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns document outerHTML from chrome.scripting without puppeteer', async () => {
    executeScript.mockResolvedValue([{ result: '<html><body><article class="product_pod">x</article></body></html>' }]);
    await expect(readTabOuterHtml(12)).resolves.toContain('product_pod');
    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 12 },
      }),
    );
  });

  it('returns empty string when scripting fails', async () => {
    executeScript.mockRejectedValue(new Error('no tab'));
    await expect(readTabOuterHtml(12)).resolves.toBe('');
  });
});

describe('Page.getContent', () => {
  beforeEach(() => {
    executeScript.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prefers tab outerHTML over puppeteer content()', async () => {
    executeScript.mockResolvedValue([{ result: '<html><body>from-script</body></html>' }]);
    const page = new Page(4, 'https://books.toscrape.com/', 'Books');
    const puppeteerContent = vi.fn(async () => '<html><body>from-puppeteer</body></html>');
    (page as unknown as { _puppeteerPage: { content: typeof puppeteerContent } })._puppeteerPage = {
      content: puppeteerContent,
    };
    await expect(page.getContent()).resolves.toBe('<html><body>from-script</body></html>');
    expect(puppeteerContent).not.toHaveBeenCalled();
  });
});
