import { describe, expect, it } from 'vitest';
import { DOMElementNode, DOMTextNode } from '../../browser/dom/views';
import type { PageState } from '../../browser/views';
import { bindIndexedActionToFrame, captureActionFrame } from '../action-frame';

function state(
  xpath = '/html/body/button[1]',
  attributes: Record<string, string> = { 'aria-label': 'Save' },
  text = 'Save',
): PageState {
  const node = new DOMElementNode({
    tagName: 'button',
    xpath,
    attributes,
    children: [],
    isVisible: true,
    parent: null,
  });
  node.children.push(new DOMTextNode(text, true, node));
  return {
    tabId: 7,
    url: 'https://example.test/form',
    title: 'Fixture',
    elementTree: node,
    selectorMap: new Map([[4, node]]),
    screenshot: null,
    scrollY: 0,
    scrollHeight: 0,
    visualViewportHeight: 0,
  };
}

describe('action frame', () => {
  it('keeps the same revision for the same captured interactive state', async () => {
    const snapshot = state();

    const first = await captureActionFrame(snapshot);
    const second = await captureActionFrame(snapshot);

    expect(second).toEqual(first);
    expect(first.pageRevision).toMatch(/^7\|https:\/\/example\.test\|[a-f0-9]{64}$/);
    expect(first.targetCount).toBe(1);
  });

  it('changes revision when the page URL or indexed target identity changes', async () => {
    const baseline = await captureActionFrame(state());
    const navigated = await captureActionFrame(state(), 'https://example.test/next');
    const moved = await captureActionFrame(state('/html/body/button[2]'));
    const relabeled = await captureActionFrame(state('/html/body/button[1]', { 'aria-label': 'Save' }, 'Delete'));

    expect(navigated.pageRevision).not.toBe(baseline.pageRevision);
    expect(moved.pageRevision).not.toBe(baseline.pageRevision);
    expect(relabeled.pageRevision).not.toBe(baseline.pageRevision);
  });

  it('changes revision when a live input value changes without putting that value in the revision', async () => {
    const before = await captureActionFrame(
      state('/html/body/input[1]', { type: 'text', name: 'Name', value: '' }, ''),
    );
    const rawValue = 'eval(1); document.body.remove()';
    const after = await captureActionFrame(
      state('/html/body/input[1]', { type: 'text', name: 'Name', value: rawValue }, ''),
    );

    expect(after.pageRevision).not.toBe(before.pageRevision);
    expect(after.pageRevision).not.toContain(rawValue);
  });

  it('automatically binds only index-based actions to the current frame', () => {
    expect(bindIndexedActionToFrame({ index: 4, intent: 'save' }, 'frame-current')).toEqual({
      index: 4,
      intent: 'save',
      page_revision: 'frame-current',
    });
    expect(bindIndexedActionToFrame({ url: 'https://example.test' }, 'frame-current')).toEqual({
      url: 'https://example.test',
    });
  });
});
