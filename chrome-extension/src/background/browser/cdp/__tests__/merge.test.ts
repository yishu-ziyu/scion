import { describe, expect, it } from 'vitest';
import { DOMElementNode } from '../../dom/views';
import { applyCdpHandles } from '../merge';
import { walkInteractiveNodes } from '../collect';
import { iframeShadowFrameDocument, iframeShadowMainDocument } from './iframe-shadow-fixture';

function emptyTree(): DOMElementNode {
  return new DOMElementNode({
    tagName: 'body',
    xpath: '/body',
    attributes: {},
    children: [],
    isVisible: true,
  });
}

describe('applyCdpHandles', () => {
  it('appends unmatched iframe and shadow buttons onto the selector map', () => {
    const tree = emptyTree();
    const selectorMap = new Map<number, DOMElementNode>();
    const collected = [
      ...walkInteractiveNodes(iframeShadowMainDocument(), { tabId: 7, frameId: 'main' }),
      ...walkInteractiveNodes(iframeShadowFrameDocument(), {
        tabId: 7,
        frameId: 'iframe-pay',
        targetId: 'tgt-iframe',
        inIframe: true,
      }),
    ];
    applyCdpHandles(tree, selectorMap, collected);

    const shadow = [...selectorMap.values()].find(node => node.getAllTextTillNextClickableElement() === '结算');
    const submit = [...selectorMap.values()].find(node => node.attributes.type === 'submit');
    expect(shadow?.backendNodeId).toBe(13);
    expect(shadow?.cdpFrameId).toBe('main');
    expect(submit?.backendNodeId).toBe(22);
    expect(submit?.cdpTargetId).toBe('tgt-iframe');
    expect(tree.children.length).toBeGreaterThanOrEqual(2);
  });
});
