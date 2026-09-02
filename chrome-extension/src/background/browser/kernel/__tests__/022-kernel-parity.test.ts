/**
 * 022-KERNEL-01: Kernel observe produces stable frame shape; act is the only side-effect path mock.
 * External behavior contract for ON path (default).
 */
import { describe, expect, it, vi } from 'vitest';
import { createBrowserKernel } from '../browser-kernel';

describe('022-KERNEL-01 BrowserKernel contract', () => {
  it('observe returns frame with pageRevision and text; does not call chrome.tabs itself', async () => {
    const selectorMap = new Map([
      [
        1,
        {
          tagName: 'button',
          attributes: { type: 'submit' },
          getAllTextTillNextClickableElement: () => 'Submit',
          hash: async () => ({
            branchPathHash: 'branch1',
            attributesHash: 'attr1',
            xpathHash: 'xp1',
          }),
        },
      ],
    ]);
    const getState = vi.fn(async () => ({
      tabId: 7,
      url: 'https://example.com/',
      title: 'Example',
      elementTree: { clickableElementsToString: () => '1 [] button Submit' },
      selectorMap,
    }));
    const evaluate = vi.fn(async (fn: () => unknown) => {
      const src = String(fn);
      if (src.includes('innerText')) return 'Example Domain\nThis domain is for use in documentation examples.';
      if (src.includes('scrollY')) {
        return { scrollY: 0, viewportHeight: 800, documentHeight: 1200 };
      }
      return undefined;
    });
    const browserContext = {
      getState,
      switchTab: vi.fn(),
      getCurrentPage: vi.fn(async () => ({
        observeMedia: async () => ({ kind: 'none' as const }),
        evaluate,
      })),
    };
    const defaults = { useVision: false, includeAttributes: [] as string[] };
    const dispatcher = {
      dispatch: vi.fn(async () => ({ ok: true, observed: true })),
    };

    const kernel = createBrowserKernel({
      browserContext: browserContext as never,
      dispatcher: dispatcher as never,
      defaults,
      resolveAction: () => undefined,
      defaultUseVision: false,
    });

    const frame = await kernel.observe();
    expect(frame.tab.url).toContain('example.com');
    expect(frame.pageRevision).toBeTruthy();
    expect(typeof frame.text).toBe('string');
    expect(frame.visibleText).toContain('This domain is for use in documentation examples.');
    expect(frame.text).toContain('This domain is for use in documentation examples.');
    expect(frame.text).toContain('Interactive elements:');
    expect(getState).toHaveBeenCalled();
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('merges a[title] names that innerText truncated', async () => {
    const getState = vi.fn(async () => ({
      tabId: 7,
      url: 'https://books.toscrape.com/',
      title: 'All products',
      elementTree: { clickableElementsToString: () => '' },
      selectorMap: new Map(),
    }));
    const evaluate = vi.fn(async (fn: () => unknown) => {
      const src = String(fn);
      if (src.includes('innerText')) {
        return { body: 'A Light in the ...\n£51.77', titles: ['A Light in the Attic'] };
      }
      if (src.includes('scrollY')) {
        return { scrollY: 0, viewportHeight: 800, documentHeight: 1200 };
      }
      return undefined;
    });
    const kernel = createBrowserKernel({
      browserContext: {
        getState,
        switchTab: vi.fn(),
        getCurrentPage: vi.fn(async () => ({
          observeMedia: async () => ({ kind: 'none' as const }),
          evaluate,
        })),
      } as never,
      dispatcher: { dispatch: vi.fn(async () => ({ ok: true, observed: true })) } as never,
      defaults: { useVision: false, includeAttributes: [] as string[] },
      resolveAction: () => undefined,
      defaultUseVision: false,
    });
    const frame = await kernel.observe();
    expect(frame.visibleText).toContain('A Light in the Attic');
    expect(frame.visibleText).toContain('£51.77');
  });

  it('can skip the page-load wait on the first look at an already-open page', async () => {
    const getState = vi.fn(async () => ({
      tabId: 7,
      url: 'https://www.bilibili.com/',
      title: '哔哩哔哩',
      elementTree: { clickableElementsToString: () => '' },
      selectorMap: new Map(),
    }));
    const kernel = createBrowserKernel({
      browserContext: {
        getState,
        getCurrentPage: vi.fn(async () => ({
          observeMedia: async () => ({ kind: 'none' as const }),
          evaluate: async () => '',
        })),
      } as never,
      dispatcher: { dispatch: vi.fn() } as never,
      resolveAction: () => undefined,
      defaultUseVision: false,
    });
    await kernel.observe({ waitForLoad: false });
    expect(getState).toHaveBeenCalledWith(false, false, { waitForLoad: false });
  });
});
