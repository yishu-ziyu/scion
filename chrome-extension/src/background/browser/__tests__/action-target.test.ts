import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: { runtime: { id: 'test-extension' } },
  });
});

import Page, { build_initial_state } from '../page';
import { DOMElementNode, DOMTextNode } from '../dom/views';
import { decideEffect } from '../../task/action-dispatcher';
import { sha256 } from '../../task/digest';
import { checkCompletion, durableHttpCompletionUrl } from '../../task/completion';

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
  vi.spyOn(page, 'getState').mockResolvedValue(state);
  return page;
}

describe('Page action target observation', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

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
      pageRevision: expect.stringMatching(/^7\|https:\/\/example\.test\|[a-f0-9]{64}$/),
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

  it('refreshes the snapshot frame before resolving an index action', async () => {
    const original = element('button', { 'aria-label': 'Save' });
    original.children.push(new DOMTextNode('Save', true, original));
    const page = pageWithElement(original);
    const first = await page.observeActionTarget('click_element', { index: 4 }, 'before');

    const changed = element('button', { 'aria-label': 'Delete' });
    changed.children.push(new DOMTextNode('Delete', true, changed));
    const changedState = build_initial_state(7, 'https://example.test/form', 'Fixture');
    changedState.selectorMap.set(4, changed);
    vi.mocked(page.getState).mockImplementation(async () => {
      (page as unknown as { _cachedState: typeof changedState })._cachedState = changedState;
      return changedState;
    });

    const second = await page.observeActionTarget('click_element', { index: 4 }, 'before');

    expect(second.pageRevision).not.toBe(first.pageRevision);
    expect(page.getState).toHaveBeenCalledTimes(2);
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

  it('captures case-sensitive page URL and body sentence digests after observation', async () => {
    const page = new Page(7, 'https://EXAMPLE.test/CasePath?secret=redacted#fragment', 'Fixture');
    const bodyText = 'First visible sentence. 第二条可见正文细节。';
    const evaluate = vi.fn(async () => bodyText);
    (page as unknown as { _puppeteerPage: { evaluate: typeof evaluate; url: () => string } })._puppeteerPage = {
      evaluate,
      url: () => 'https://EXAMPLE.test/CasePath?secret=redacted#fragment',
    };

    const observation = await page.observeActionTarget('read_page_text', {}, 'after');

    expect(observation.target).toMatchObject({
      kind: 'page',
      normalizedUrl: 'https://example.test/CasePath',
      queryIdentityDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      bodyDigest: await sha256(bodyText),
      textDigests: expect.arrayContaining([
        await sha256('First visible sentence.'),
        await sha256('第二条可见正文细节。'),
      ]),
      pageRevision: expect.any(String),
      observedAt: expect.any(Number),
    });
    expect(JSON.stringify(observation)).not.toContain('First visible sentence');
    expect(JSON.stringify(observation)).not.toContain('secret=redacted');
  });

  it('fails a fresh body capture closed without reusing revision or digest', async () => {
    const page = new Page(7, 'https://example.test/report?id=1', 'Fixture');
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce('Fresh visible body sentence.')
      .mockRejectedValueOnce(new Error('execution context destroyed'));
    (page as unknown as { _puppeteerPage: { evaluate: typeof evaluate; url: () => string } })._puppeteerPage = {
      evaluate,
      url: () => 'https://example.test/report?id=1',
    };

    const captured = await page.observeActionTarget('read_page_text', {}, 'after');
    const failed = await page.observeActionTarget('read_page_text', {}, 'after');

    expect(captured.target).toMatchObject({
      bodyDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      textDigests: expect.any(Array),
      pageRevision: expect.any(String),
      queryIdentityDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(failed.target.digest).not.toBe(captured.target.digest);
    expect(failed.target).not.toHaveProperty('bodyDigest');
    expect(failed.target).not.toHaveProperty('textDigests');
    expect(failed.target).not.toHaveProperty('pageRevision');
    expect(JSON.stringify(failed.target)).not.toContain('?id=1');
  });

  it('does not ground or persist provenance for malformed query encoding', async () => {
    const page = new Page(7, 'https://example.test/report?id=%ZZ', 'Fixture');
    const evaluate = vi.fn(async () => 'This body must not become evidence.');
    (page as unknown as { _puppeteerPage: { evaluate: typeof evaluate; url: () => string } })._puppeteerPage = {
      evaluate,
      url: () => 'https://example.test/report?id=%ZZ',
    };

    const observation = await page.observeActionTarget('read_page_text', {}, 'after');
    expect(evaluate).not.toHaveBeenCalled();
    expect(observation.target).not.toHaveProperty('normalizedUrl');
    expect(observation.target).not.toHaveProperty('queryIdentityDigest');
    expect(observation.target).not.toHaveProperty('bodyDigest');
    expect(observation.target).not.toHaveProperty('pageRevision');
    expect(JSON.stringify(observation.target)).not.toContain('%ZZ');
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

  it('waits for a started button click instead of abandoning its outcome', async () => {
    vi.useFakeTimers();
    const button = element('button', { type: 'submit' });
    const page = pageWithElement(button);
    const click = vi.fn(() => new Promise<void>(resolve => setTimeout(resolve, 3000)));
    const handle = { click, evaluate: vi.fn(async () => true) };
    (page as unknown as { _puppeteerPage: { url: () => string } })._puppeteerPage = {
      url: () => 'https://example.test/form',
    };
    vi.spyOn(page, 'locateElement').mockResolvedValue(handle as never);

    const pending = page.clickElementNode(false, button);
    let outcome: 'pending' | 'resolved' | 'rejected' = 'pending';
    const tracked = pending.then(
      () => (outcome = 'resolved'),
      () => (outcome = 'rejected'),
    );
    await vi.advanceTimersByTimeAsync(2001);
    expect(outcome).toBe('pending');

    await vi.advanceTimersByTimeAsync(1000);
    await tracked;
    expect(outcome).toBe('resolved');
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('activates a plain navigation link once without starting an orphaned pointer click', async () => {
    vi.useFakeTimers();
    const link = element('a', { href: '/watch?v=first' });
    const page = pageWithElement(link);
    let navigationCount = 0;
    const click = vi.fn(
      () =>
        new Promise<void>(resolve => {
          setTimeout(() => {
            navigationCount += 1;
            resolve();
          }, 3000);
        }),
    );
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockImplementationOnce(async () => {
        navigationCount += 1;
        return true;
      });
    const handle = { click, evaluate };
    (page as unknown as { _puppeteerPage: { url: () => string } })._puppeteerPage = {
      url: () => 'https://example.test/watch',
    };
    vi.spyOn(page, 'locateElement').mockResolvedValue(handle as never);

    const pending = expect(page.clickElementNode(false, link)).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(3001);

    await pending;
    expect(navigationCount).toBe(1);
    expect(click).not.toHaveBeenCalled();
  });

  it('recovers the same Bilibili video card when its DOM position changed', async () => {
    const link = new DOMElementNode({
      tagName: 'a',
      attributes: {
        href: '//www.bilibili.com/video/BV1xx411c7mD?spm_id_from=333.1007.0.0',
      },
      parent: null,
      xpath: '/html/body/main/div[2]/a[1]',
      children: [],
      isVisible: true,
    });
    const candidate = {
      evaluate: vi.fn().mockResolvedValue('https://www.bilibili.com/video/BV1xx411c7mD?spm_id_from=333.1007.0.0'),
      isHidden: vi.fn().mockResolvedValue(true),
    };
    const query = vi.fn().mockResolvedValue(null);
    const queryAll = vi.fn().mockResolvedValue([candidate]);
    const page = new Page(7, 'https://www.bilibili.com/', 'Bilibili');
    (
      page as unknown as { _puppeteerPage: { $: typeof query; $$: typeof queryAll; url: () => string } }
    )._puppeteerPage = {
      $: query,
      $$: queryAll,
      url: () => 'https://www.bilibili.com/',
    };

    await expect(page.locateElement(link)).resolves.toBe(candidate);
    expect(queryAll).toHaveBeenCalledWith('a[href*="/video/BV1xx411c7mD"]');
  });

  it('never accepts a different Bilibili video from the card fallback', async () => {
    const link = new DOMElementNode({
      tagName: 'a',
      attributes: { href: 'https://www.bilibili.com/video/BV1xx411c7mD' },
      parent: null,
      xpath: '/html/body/main/div[2]/a[1]',
      children: [],
      isVisible: true,
    });
    const candidate = {
      evaluate: vi.fn().mockResolvedValue('https://www.bilibili.com/video/BV1yy411c7mE'),
      dispose: vi.fn().mockResolvedValue(undefined),
      isHidden: vi.fn().mockResolvedValue(true),
    };
    const page = new Page(7, 'https://www.bilibili.com/', 'Bilibili');
    (
      page as unknown as { _puppeteerPage: { $: () => Promise<null>; $$: () => Promise<unknown[]>; url: () => string } }
    )._puppeteerPage = {
      $: vi.fn().mockResolvedValue(null),
      $$: vi.fn().mockResolvedValue([candidate]),
      url: () => 'https://www.bilibili.com/',
    };

    await expect(page.locateElement(link)).resolves.toBeNull();
    expect(candidate.dispose).toHaveBeenCalledOnce();
  });

  it('returns only bounded completion values and strips URL query data', async () => {
    const page = new Page(7, 'https://example.test/success?token=SECRET#done', 'Fixture');
    const expectedDigest = await sha256('Saved successfully');
    const state = build_initial_state(7, 'https://example.test/success?token=SECRET#done', 'Fixture');
    state.elementTree.children.push(new DOMTextNode('Saved successfully', true, state.elementTree));
    vi.spyOn(page, 'getState').mockResolvedValue(state);
    const evaluate = vi.fn(async () => 'Saved successfully');
    (page as unknown as { _puppeteerPage: { evaluate: typeof evaluate; url: () => string } })._puppeteerPage = {
      evaluate,
      url: () => 'https://example.test/success?token=SECRET#done',
    };
    const durableUrl = await durableHttpCompletionUrl('https://example.test/success?token=SECRET#done');

    const observations = await page.observeCompletionCriteria([
      {
        id: 'url-1',
        kind: 'url',
        operator: 'equals',
        expected: durableUrl!,
        required: true,
        roundId: 'round-1',
        targetRefId: 'tab-7',
        baseline: false,
        frozenAt: 100,
        notBefore: 100,
        timeoutMs: 5000,
      },
      {
        id: 'text-1',
        kind: 'page_text',
        operator: 'present',
        expectedDigest,
        required: true,
        roundId: 'round-1',
        targetRefId: 'tab-7',
        baseline: false,
        frozenAt: 100,
        notBefore: 100,
        timeoutMs: 5000,
      },
    ]);

    expect(observations).toEqual([
      expect.objectContaining({ criterionId: 'url-1', value: durableUrl }),
      expect.objectContaining({ criterionId: 'text-1', value: true }),
    ]);
    expect(JSON.stringify(observations)).not.toContain('SECRET');
    expect(JSON.stringify(observations)).not.toContain('Saved successfully');
  });

  it('matches completion text on its own body line when the DOM tree omits plain text', async () => {
    const page = new Page(7, 'https://example.test/success', 'Fixture');
    const state = build_initial_state(7, 'https://example.test/success', 'Fixture');
    vi.spyOn(page, 'getState').mockResolvedValue(state);
    vi.stubGlobal('document', { body: { innerText: 'Bake-off form\nSaved successfully' } });
    (
      page as unknown as { _puppeteerPage: { url: () => string; evaluate: (fn: () => string) => Promise<string> } }
    )._puppeteerPage = {
      url: () => 'https://example.test/success',
      evaluate: async fn => fn(),
    };

    const observations = await page.observeCompletionCriteria([
      {
        id: 'text-1',
        kind: 'page_text',
        operator: 'present',
        expectedDigest: await sha256('Saved successfully'),
        required: true,
        roundId: 'round-1',
        targetRefId: 'tab-7',
        baseline: false,
        frozenAt: 100,
        notBefore: 100,
        timeoutMs: 5000,
      },
    ]);

    expect(observations).toEqual([expect.objectContaining({ criterionId: 'text-1', value: true })]);
  });

  it('matches page_text present against a case-folded title or heading', async () => {
    const page = new Page(7, 'https://en.wikipedia.org/wiki/Web_browser', 'Web browser - Wikipedia');
    const state = build_initial_state(7, 'https://en.wikipedia.org/wiki/Web_browser', 'Web browser - Wikipedia');
    vi.spyOn(page, 'getState').mockResolvedValue(state);
    (
      page as unknown as {
        _puppeteerPage: { url: () => string; evaluate: (fn: () => unknown) => Promise<unknown> };
      }
    )._puppeteerPage = {
      url: () => 'https://en.wikipedia.org/wiki/Web_browser',
      evaluate: async () => ({
        title: 'Web browser - Wikipedia',
        bodyText: 'A web browser is an application for accessing websites.',
        leafText: ['Web browser', 'A web browser is an application for accessing websites.'],
      }),
    };

    const observations = await page.observeCompletionCriteria([
      {
        id: 'text-1',
        kind: 'page_text',
        operator: 'present',
        expectedDigest: await sha256('web browser'),
        required: true,
        roundId: 'round-1',
        targetRefId: 'tab-7',
        baseline: false,
        frozenAt: 100,
        notBefore: 100,
        timeoutMs: 5000,
      },
    ]);

    expect(observations).toEqual([expect.objectContaining({ criterionId: 'text-1', value: true })]);
  });

  it('bounds the number of body lines scanned for completion text', async () => {
    const page = new Page(7, 'https://example.test/success', 'Fixture');
    const state = build_initial_state(7, 'https://example.test/success', 'Fixture');
    vi.spyOn(page, 'getState').mockResolvedValue(state);
    const bodyText = [...Array.from({ length: 2000 }, (_, index) => `Filler ${index}`), 'Saved beyond limit'].join(
      '\n',
    );
    vi.stubGlobal('document', { body: { innerText: bodyText } });
    (
      page as unknown as { _puppeteerPage: { url: () => string; evaluate: (fn: () => string) => Promise<string> } }
    )._puppeteerPage = {
      url: () => 'https://example.test/success',
      evaluate: async fn => fn(),
    };

    const observations = await page.observeCompletionCriteria([
      {
        id: 'text-1',
        kind: 'page_text',
        operator: 'present',
        expectedDigest: await sha256('Saved beyond limit'),
        required: true,
        roundId: 'round-1',
        targetRefId: 'tab-7',
        baseline: false,
        frozenAt: 100,
        notBefore: 100,
        timeoutMs: 5000,
      },
    ]);

    expect(observations).toEqual([expect.objectContaining({ criterionId: 'text-1', value: false })]);
  });

  it('reports the actual tab instead of echoing a stale completion target', async () => {
    const page = new Page(8, 'https://example.test/success', 'Fixture');
    const criterion = {
      id: 'url-1',
      kind: 'url' as const,
      operator: 'equals' as const,
      expected: 'https://example.test/success',
      required: true,
      roundId: 'round-1',
      targetRefId: 'tab-7',
      baseline: false,
      frozenAt: 100,
      notBefore: 100,
      timeoutMs: Number.MAX_SAFE_INTEGER,
    };
    const observations = await page.observeCompletionCriteria([criterion]);

    expect(observations[0]).toMatchObject({ targetRefId: 'tab-8', value: 'https://example.test/success' });
    // URL criteria follow the current page. A frozen tab id must not block a matching URL.
    expect(
      checkCompletion({ now: Date.now(), currentRoundId: 'round-1', criteria: [criterion], observations }),
    ).toMatchObject({ passed: true });
  });
});
