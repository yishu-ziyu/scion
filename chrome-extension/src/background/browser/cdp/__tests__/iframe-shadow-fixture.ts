import type { CdpDomNode } from '../types';

function textNode(value: string): CdpDomNode {
  return { nodeType: 3, nodeName: '#text', nodeValue: value, backendNodeId: 0 };
}

function el(
  name: string,
  attrs: string[],
  children: CdpDomNode[],
  extra: Partial<CdpDomNode> = {},
): CdpDomNode {
  return {
    nodeType: 1,
    nodeName: name.toUpperCase(),
    localName: name,
    attributes: attrs,
    children,
    backendNodeId: extra.backendNodeId ?? 1,
    ...extra,
  };
}

/** CDP tree for test/fixtures/iframe-shadow.html (main document + open shadow). */
export function iframeShadowMainDocument(): CdpDomNode {
  return el(
    'html',
    [],
    [
      el(
        'body',
        [],
        [
          el('button', ['id', 'main-cancel'], [textNode('取消')], { backendNodeId: 10 }),
          el('div', ['id', 'shadow-host'], [], {
            backendNodeId: 11,
            shadowRoots: [
              {
                nodeType: 11,
                nodeName: '#document-fragment',
                backendNodeId: 12,
                children: [
                  el('button', ['type', 'button', 'id', 'shadow-pay'], [textNode('结算')], {
                    backendNodeId: 13,
                  }),
                ],
              },
            ],
          }),
          el('iframe', ['id', 'pay-frame', 'title', 'pay'], [], { backendNodeId: 14, frameId: 'main' }),
        ],
        { backendNodeId: 2 },
      ),
    ],
    { backendNodeId: 1, frameId: 'main' },
  );
}

/** CDP tree for test/fixtures/iframe-shadow-frame.html (cross-origin iframe target). */
export function iframeShadowFrameDocument(): CdpDomNode {
  return el(
    'html',
    [],
    [
      el(
        'body',
        [],
        [
          el(
            'form',
            [],
            [
              el('input', ['name', 'card'], [], { backendNodeId: 21 }),
              el('button', ['type', 'submit'], [textNode('提交')], { backendNodeId: 22 }),
            ],
            { backendNodeId: 20 },
          ),
        ],
        { backendNodeId: 19 },
      ),
    ],
    { backendNodeId: 18, frameId: 'iframe-pay' },
  );
}
