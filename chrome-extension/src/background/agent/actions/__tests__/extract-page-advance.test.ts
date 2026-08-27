import { describe, expect, it, vi } from 'vitest';
import { advanceExtractPage, findNextPageControlIndex } from '../extract-page-advance';

function node(tagName: string, attributes: Record<string, string>, text: string) {
  return {
    tagName,
    attributes,
    getAllTextTillNextClickableElement: (): string => text,
  };
}

describe('extract page advance', () => {
  it('finds rel=next and 下一页 among clickable nodes', () => {
    const withRel = new Map([
      [1, node('a', {}, 'Home')],
      [2, node('a', { rel: 'next', href: '/p2' }, '2')],
    ]);
    expect(findNextPageControlIndex(withRel)).toBe(2);

    const withCn = new Map([
      [3, node('button', { type: 'button' }, '筛选')],
      [4, node('a', { href: '?page=2' }, '下一页')],
    ]);
    expect(findNextPageControlIndex(withCn)).toBe(4);
  });

  it('clicks the next control and reports that the page advanced', async () => {
    const nextNode = node('a', { rel: 'next' }, 'Next');
    const selectorMap = new Map([[8, nextNode]]);
    const clickElementNode = vi.fn(async () => undefined);
    const waitForPageAndFramesLoad = vi.fn(async () => undefined);
    const advanced = await advanceExtractPage(
      {
        getState: async () => ({ selectorMap }),
        getDomElementByIndex: index => selectorMap.get(index),
        clickElementNode,
        waitForPageAndFramesLoad,
        isFileUploader: () => false,
      },
      false,
    );
    expect(advanced).toBe(true);
    expect(clickElementNode).toHaveBeenCalledTimes(1);
    expect(clickElementNode).toHaveBeenCalledWith(false, nextNode);
    expect(waitForPageAndFramesLoad).toHaveBeenCalledTimes(1);
  });

  it('returns false without clicking when no next control exists', async () => {
    const clickElementNode = vi.fn(async () => undefined);
    const advanced = await advanceExtractPage({
      getState: async () => ({ selectorMap: new Map([[1, node('a', {}, 'Home')]]) }),
      getDomElementByIndex: () => node('a', {}, 'Home'),
      clickElementNode,
      waitForPageAndFramesLoad: async () => undefined,
    });
    expect(advanced).toBe(false);
    expect(clickElementNode).not.toHaveBeenCalled();
  });
});
