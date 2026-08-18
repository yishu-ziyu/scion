/**
 * Attach CDP handles onto the existing highlight-index map.
 * Unmatched iframe / shadow nodes are appended so query can resolve them.
 */
import { DOMElementNode, DOMTextNode } from '../dom/views';
import type { CdpInteractiveNode } from './types';

function visibleText(node: DOMElementNode): string {
  return (node.getAllTextTillNextClickableElement?.() || '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function applyHandle(node: DOMElementNode, collected: CdpInteractiveNode): void {
  node.tabId = collected.handle.tabId;
  node.cdpFrameId = collected.handle.frameId;
  node.backendNodeId = collected.handle.backendNodeId;
  node.cdpTargetId = collected.handle.targetId;
}

function matchCdpNode(element: DOMElementNode, nodes: CdpInteractiveNode[]): CdpInteractiveNode | undefined {
  const tag = (element.tagName || '').toLowerCase();
  const text = visibleText(element);
  const id = element.attributes.id;
  const name = element.attributes.name;
  const type = element.attributes.type;
  const candidates = nodes.filter(node => node.tagName === tag);
  const scored = candidates.filter(node => {
    if (id && node.id === id) return true;
    if (name && node.name === name && (type || '') === (node.type || '')) return true;
    if (text && node.text === text) return true;
    return false;
  });
  if (scored.length === 1) return scored[0];
  if (scored.length > 1) {
    const withTarget = scored.filter(node => node.handle.targetId);
    if (withTarget.length === 1) return withTarget[0];
  }
  return undefined;
}

function handleKey(node: CdpInteractiveNode): string {
  return `${node.handle.targetId ?? 'tab'}:${node.handle.frameId}:${node.handle.backendNodeId}`;
}

export function applyCdpHandles(
  elementTree: DOMElementNode,
  selectorMap: Map<number, DOMElementNode>,
  collected: CdpInteractiveNode[],
): void {
  const used = new Set<string>();
  for (const node of selectorMap.values()) {
    const match = matchCdpNode(node, collected);
    if (!match) continue;
    used.add(handleKey(match));
    applyHandle(node, match);
  }

  let nextIndex = selectorMap.size ? Math.max(...selectorMap.keys()) + 1 : 0;
  const appendedSemantic = new Set<string>();
  for (const extra of collected) {
    const key = handleKey(extra);
    if (used.has(key)) continue;
    if (!extra.inIframe && !extra.inShadow) continue;
    const already = [...selectorMap.values()].filter(
      node =>
        (node.tagName || '').toLowerCase() === extra.tagName &&
        (node.attributes.type || '') === (extra.type || '') &&
        visibleText(node) === (extra.text || ''),
    );
    if (already.length === 1) {
      applyHandle(already[0]!, extra);
      used.add(key);
      continue;
    }
    const semantic = `${extra.tagName}|${extra.type || ''}|${extra.text || ''}|${extra.inIframe ? 'i' : ''}|${extra.inShadow ? 's' : ''}`;
    if (appendedSemantic.has(semantic)) continue;
    appendedSemantic.add(semantic);

    const attributes: Record<string, string> = {};
    if (extra.type) attributes.type = extra.type;
    if (extra.name) attributes.name = extra.name;
    if (extra.id) attributes.id = extra.id;
    if (extra.role) attributes.role = extra.role;
    if (extra.placeholder) attributes.placeholder = extra.placeholder;
    if (extra.label) attributes['aria-label'] = extra.label;

    const node = new DOMElementNode({
      tagName: extra.tagName,
      xpath: extra.inShadow ? 'shadow' : extra.inIframe ? 'iframe' : '',
      attributes,
      children: [],
      isVisible: true,
      isInteractive: true,
      isTopElement: true,
      isInViewport: true,
      highlightIndex: nextIndex,
      shadowRoot: Boolean(extra.inShadow),
      parent: elementTree,
    });
    applyHandle(node, extra);
    if (extra.text) {
      node.children.push(new DOMTextNode(extra.text, true, node));
    }
    elementTree.children.push(node);
    selectorMap.set(nextIndex, node);
    used.add(key);
    nextIndex += 1;
  }
}
