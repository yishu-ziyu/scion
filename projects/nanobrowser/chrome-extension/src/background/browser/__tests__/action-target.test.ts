import { describe, expect, it, vi } from 'vitest';

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
  it('returns only a digest for a semantic submit target', async () => {
    const form = element('form', {});
    const button = element('button', { type: 'submit', 'aria-label': 'Submit invoice' }, form);
    const observation = await pageWithElement(button).observeActionTarget('click_element', { index: 4 }, 'before');

    expect(observation).toMatchObject({
      tag: 'button',
      type: 'submit',
      inForm: true,
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
});
