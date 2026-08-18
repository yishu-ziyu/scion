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
    const agentContext = {
      browserContext,
      options: { useVision: false, includeAttributes: [] as string[] },
    };
    const hooks = {
      dispatchAction: vi.fn(async () => ({ ok: true, observed: true })),
    };

    const kernel = createBrowserKernel({
      browserContext: browserContext as never,
      agentContext: agentContext as never,
      hooks: hooks as never,
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
    expect(hooks.dispatchAction).not.toHaveBeenCalled();
  });
});
