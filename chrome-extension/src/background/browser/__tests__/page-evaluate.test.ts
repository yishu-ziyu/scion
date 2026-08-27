import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: { runtime: { id: 'test-extension' } },
  });
});

import Page from '../page';

describe('Page.evaluate', () => {
  it('rejects string source before Puppeteer sees it', async () => {
    const puppeteerEvaluate = vi.fn();
    const page = new Page(7, 'https://example.test/', 'Example');
    (page as unknown as { _puppeteerPage: { evaluate: typeof puppeteerEvaluate } })._puppeteerPage = {
      evaluate: puppeteerEvaluate,
    };

    await expect(page.evaluate('document.body.remove()' as never)).rejects.toThrow('dynamic_code_not_allowed');
    expect(puppeteerEvaluate).not.toHaveBeenCalled();
  });

  it('passes a hostile-looking string only as data to a host function', async () => {
    const payload = '); document.body.remove(); ({code: plain data}';
    const hostFunction = (value: string): string => value;
    const puppeteerEvaluate = vi.fn(async (_fn: typeof hostFunction, value: string) => value);
    const page = new Page(7, 'https://example.test/', 'Example');
    (page as unknown as { _puppeteerPage: { evaluate: typeof puppeteerEvaluate } })._puppeteerPage = {
      evaluate: puppeteerEvaluate,
    };

    await expect(page.evaluate(hostFunction, payload)).resolves.toBe(payload);
    expect(puppeteerEvaluate).toHaveBeenCalledWith(hostFunction, payload);
  });
});
