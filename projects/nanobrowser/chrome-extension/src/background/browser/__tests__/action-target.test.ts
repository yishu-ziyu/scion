import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: { runtime: { id: 'test-extension' } },
  });
});

import Page, { build_initial_state } from '../page';
import { DOMElementNode } from '../dom/views';
import { decideEffect } from '../../task/action-dispatcher';

function element(tagName: string, attributes: Record<string, string>, parent: DOMElementNode | null = null) {
  return new DOMElementNode({
    tagName,
    attributes,
    parent,
    xpath: '',
    children: [],
    isVisible: true,
  });
}

function pageWithElement(node: DOMElementNode): Page {
  const page = new Page(7, 'https://example.test/form', 'Fixture');
  const state = build_initial_state(7, 'https://example.test/form', 'Fixture');
  state.selectorMap.set(4, node);
  (page as unknown as { _cachedState: typeof state })._cachedState = state;
  return page;
}

describe('Page action target observation', () => {
  afterEach(() => vi.useRealTimers());

  it('returns only a digest for a semantic submit target', async () => {
    const form = element('form', {});
    const button = element('button', { type: 'submit', 'aria-label': 'Submit invoice' }, form);
    const observation = await pageWithElement(button).observeActionTarget('click_element', { index: 4 }, 'before');

    expect(observation).toMatchObject({
      tag: 'button',
      type: 'submit',
      inForm: true,
      hasSemanticName: true,
      semanticCommit: true,
      nameDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      target: {
        kind: 'element',
        tabId: 7,
        frameId: 0,
        urlOrigin: 'https://example.test',
        digest: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(JSON.stringify(observation)).not.toContain('Submit invoice');
  });

  it('normalizes current-password targets to the blocked password policy', async () => {
    const input = element('input', { type: 'text', autocomplete: 'current-password' });
    const observation = await pageWithElement(input).observeActionTarget('input_text', { index: 4 }, 'before');

    expect(observation.type).toBe('password');
    expect(decideEffect({ actionName: 'input_text', target: observation, skillPolicy: 'default' }).kind).toBe('block');
  });

  it('fails closed when a cached indexed target cannot be read live', async () => {
    const button = element('button', { type: 'submit' });
    const page = pageWithElement(button);
    (page as unknown as { _puppeteerPage: object })._puppeteerPage = {};
    vi.spyOn(page, 'getElementByIndex').mockResolvedValue(null);

    await expect(page.observeActionTarget('click_element', { index: 4 }, 'before')).rejects.toThrow(
      'no longer available',
    );
  });

  it('observes the resulting page after a commit without replaying the old index', async () => {
    const button = element('button', { type: 'submit' });
    const page = pageWithElement(button);
    (page as unknown as { _puppeteerPage: { url: () => string } })._puppeteerPage = {
      url: () => 'https://example.test/success',
    };

    const observation = await page.observeActionTarget('click_element', { index: 4 }, 'after');

    expect(observation.target).toMatchObject({ kind: 'page', urlOrigin: 'https://example.test' });
    expect(observation.target.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('binds Enter approval to the active element structure', async () => {
    const page = new Page(7, 'https://example.test/form', 'Fixture');
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce({
        tag: 'textarea',
        type: undefined,
        role: undefined,
        autocomplete: undefined,
        inForm: true,
        name: undefined,
        hasSemanticName: false,
        structure: 'html:0/body:1/form:0/textarea:0',
      })
      .mockResolvedValueOnce({
        tag: 'textarea',
        type: undefined,
        role: undefined,
        autocomplete: undefined,
        inForm: true,
        name: undefined,
        hasSemanticName: false,
        structure: 'html:0/body:1/form:0/textarea:1',
      });
    (page as unknown as { _puppeteerPage: { evaluate: typeof evaluate; url: () => string } })._puppeteerPage = {
      evaluate,
      url: () => 'https://example.test/form',
    };

    const first = await page.observeActionTarget('send_keys', { keys: 'Control+Enter' }, 'before');
    const second = await page.observeActionTarget('send_keys', { keys: 'Control+Enter' }, 'before');

    expect(first.target.digest).not.toBe(second.target.digest);
  });

  it('invalidates approval when live semantic text changes at the same structure', async () => {
    const button = element('button', { type: 'button' });
    const page = pageWithElement(button);
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce({
        tag: 'button',
        type: 'button',
        role: undefined,
        autocomplete: undefined,
        inForm: false,
        name: undefined,
        hasSemanticName: true,
        semanticCommit: true,
        semanticNavigation: false,
        semanticSource: 'Pay $10',
        structure: 'html:0/body:1/button:0',
      })
      .mockResolvedValueOnce({
        tag: 'button',
        type: 'button',
        role: undefined,
        autocomplete: undefined,
        inForm: false,
        name: undefined,
        hasSemanticName: true,
        semanticCommit: true,
        semanticNavigation: false,
        semanticSource: 'Pay $1000',
        structure: 'html:0/body:1/button:0',
      });
    const handle = { evaluate };
    (page as unknown as { _puppeteerPage: { url: () => string } })._puppeteerPage = {
      url: () => 'https://example.test/form',
    };
    vi.spyOn(page, 'getElementByIndex').mockResolvedValue(handle as never);

    const first = await page.observeActionTarget('click_element', { index: 4 }, 'before');
    const second = await page.observeActionTarget('click_element', { index: 4 }, 'before');

    expect(first.target.digest).not.toBe(second.target.digest);
    expect(JSON.stringify([first, second])).not.toContain('Pay $');
  });

  it('never retries a click after its outcome becomes unknown', async () => {
    vi.useFakeTimers();
    const button = element('button', { type: 'submit' });
    const page = pageWithElement(button);
    const click = vi.fn(() => new Promise<void>(() => {}));
    const handle = { click, evaluate: vi.fn(async () => true) };
    (page as unknown as { _puppeteerPage: object })._puppeteerPage = {};
    vi.spyOn(page, 'locateElement').mockResolvedValue(handle as never);

    const pending = page.clickElementNode(false, button);
    const rejected = expect(pending).rejects.toThrow('Click timeout');
    await vi.advanceTimersByTimeAsync(2001);

    await rejected;
    expect(click).toHaveBeenCalledTimes(1);
  });
});
