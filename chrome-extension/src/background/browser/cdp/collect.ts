/**
 * Collect interactive nodes via chrome.debugger.
 * Main document uses DOM.getDocument({ pierce: true }).
 * Each cross-origin iframe target is attached separately.
 */
import { attach, getTargets, sendCommand, type DebuggerTarget } from './session';
import type { CdpDomNode, CdpInteractiveNode, CollectInteractiveResult, InaccessibleIframe } from './types';

const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary', 'option']);
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'checkbox',
  'radio',
  'tab',
  'menuitem',
  'option',
  'switch',
  'slider',
  'searchbox',
  'combobox',
]);

/** Page-world walker used with Runtime.evaluate. Open shadow only; closed shadow uses pierce. */
export const EVALUATE_FOCUSABLE_JS = `(() => {
  const out = [];
  const describe = (el, inShadow) => {
    const r = el.getBoundingClientRect();
    return {
      tag: (el.tagName || '').toLowerCase(),
      text: ((el.innerText || el.getAttribute('aria-label') || el.value || '') + '').replace(/\\s+/g, ' ').trim().slice(0, 80),
      type: el.getAttribute('type') || undefined,
      role: el.getAttribute('role') || undefined,
      name: el.getAttribute('name') || undefined,
      id: el.id || undefined,
      x: r.width || r.height ? r.left + r.width / 2 : undefined,
      y: r.width || r.height ? r.top + r.height / 2 : undefined,
      inShadow: Boolean(inShadow),
    };
  };
  const isInteractive = (el) => {
    const tag = (el.tagName || '').toLowerCase();
    if (['a', 'button', 'input', 'select', 'textarea', 'summary'].includes(tag)) return true;
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (['button', 'link', 'textbox', 'checkbox', 'radio', 'tab', 'menuitem'].includes(role)) return true;
    if (el.isContentEditable) return true;
    const tab = el.getAttribute('tabindex');
    return tab !== null && tab !== '-1';
  };
  const walk = (root, inShadow) => {
    if (!root) return;
    const nodes = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (const el of nodes) {
      if (isInteractive(el)) out.push(describe(el, inShadow));
      if (el.shadowRoot) walk(el.shadowRoot, true);
    }
  };
  walk(document, false);
  return out;
})()`;

export function attrsOf(node: CdpDomNode): Record<string, string> {
  const attrs: Record<string, string> = {};
  const list = node.attributes ?? [];
  for (let i = 0; i + 1 < list.length; i += 2) {
    attrs[(list[i] ?? '').toLowerCase()] = list[i + 1] ?? '';
  }
  return attrs;
}

export function isInteractiveCdpNode(node: CdpDomNode, attrs: Record<string, string> = attrsOf(node)): boolean {
  if ((node.nodeType ?? 1) !== 1) return false;
  const tag = (node.localName || node.nodeName || '').toLowerCase();
  if (['script', 'style', 'meta', 'link', 'head', 'noscript', '#document', '#document-fragment'].includes(tag)) {
    return false;
  }
  if (INTERACTIVE_TAGS.has(tag)) return true;
  if (INTERACTIVE_ROLES.has((attrs.role || '').toLowerCase())) return true;
  if (attrs.contenteditable === '' || attrs.contenteditable === 'true') return true;
  if (attrs.tabindex !== undefined && attrs.tabindex !== '-1') return true;
  return Boolean(attrs.onclick);
}

export function collectText(node: CdpDomNode, limit = 80): string {
  if (node.nodeType === 3) return (node.nodeValue || '').replace(/\s+/g, ' ');
  let out = '';
  for (const child of node.children ?? []) {
    out += collectText(child, limit);
    if (out.length >= limit) break;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, limit);
}

export function walkInteractiveNodes(
  node: CdpDomNode,
  ctx: { tabId: number; frameId: string; targetId?: string; inShadow?: boolean; inIframe?: boolean },
): CdpInteractiveNode[] {
  const out: CdpInteractiveNode[] = [];
  const visit = (
    current: CdpDomNode,
    state: { tabId: number; frameId: string; targetId?: string; inShadow?: boolean; inIframe?: boolean },
  ) => {
    const frameId = current.frameId || state.frameId;
    const attrs = attrsOf(current);
    const tag = (current.localName || current.nodeName || '').toLowerCase();
    if (
      isInteractiveCdpNode(current, attrs) &&
      typeof current.backendNodeId === 'number' &&
      current.backendNodeId > 0
    ) {
      const text = collectText(current) || attrs['aria-label'] || attrs.value || undefined;
      out.push({
        handle: {
          tabId: state.tabId,
          frameId,
          backendNodeId: current.backendNodeId,
          targetId: state.targetId,
        },
        tagName: tag,
        text,
        role: attrs.role,
        type: attrs.type,
        name: attrs.name,
        id: attrs.id,
        placeholder: attrs.placeholder,
        label: attrs['aria-label'] || attrs.placeholder,
        inShadow: state.inShadow,
        inIframe: state.inIframe,
      });
    }
    for (const child of current.children ?? []) visit(child, { ...state, frameId });
    for (const shadow of current.shadowRoots ?? []) {
      visit(shadow, { ...state, frameId, inShadow: true });
    }
    if (current.contentDocument) {
      visit(current.contentDocument, {
        tabId: state.tabId,
        frameId: current.contentDocument.frameId || current.frameId || frameId,
        targetId: state.targetId,
        inIframe: true,
      });
    }
  };
  visit(node, ctx);
  return out;
}

type EvaluatedControl = {
  tag?: string;
  text?: string;
  type?: string;
  role?: string;
  x?: number;
  y?: number;
};

export function mergeEvaluatedCoords(nodes: CdpInteractiveNode[], evaluated: EvaluatedControl[]): void {
  for (const node of nodes) {
    if (node.handle.x !== undefined && node.handle.y !== undefined) continue;
    const matches = evaluated.filter(
      ev =>
        (ev.tag || '') === node.tagName &&
        (ev.text || '').trim() === (node.text || '').trim() &&
        (ev.type || '') === (node.type || ''),
    );
    if (matches.length === 1 && typeof matches[0]?.x === 'number' && typeof matches[0]?.y === 'number') {
      node.handle.x = matches[0].x;
      node.handle.y = matches[0].y;
    }
  }
}

function nodeKey(node: CdpInteractiveNode): string {
  return `${node.handle.targetId ?? 'tab'}:${node.handle.frameId}:${node.handle.backendNodeId}`;
}

export function semanticNodeKey(node: CdpInteractiveNode): string {
  return [
    node.tagName,
    node.type || '',
    node.id || '',
    (node.text || '').trim(),
    node.inIframe ? 'iframe' : '',
    node.inShadow ? 'shadow' : '',
  ].join('|');
}

function pushUnique(into: CdpInteractiveNode[], extras: CdpInteractiveNode[]): void {
  const seenHandle = new Set(into.map(nodeKey));
  const bySemantic = new Map(into.map(node => [semanticNodeKey(node), node]));
  for (const node of extras) {
    const handle = nodeKey(node);
    if (seenHandle.has(handle)) continue;
    const semantic = semanticNodeKey(node);
    const existing = bySemantic.get(semantic);
    if (existing) {
      if (!existing.handle.targetId && node.handle.targetId) {
        existing.handle = node.handle;
      }
      continue;
    }
    into.push(node);
    seenHandle.add(handle);
    bySemantic.set(semantic, node);
  }
}

async function collectFromTarget(
  target: number | DebuggerTarget,
  ctx: { tabId: number; frameId: string; targetId?: string; inIframe?: boolean },
): Promise<CdpInteractiveNode[]> {
  await attach(target);
  const doc = (await sendCommand(target, 'DOM.getDocument', { depth: -1, pierce: true })) as
    | { root?: CdpDomNode }
    | undefined;
  if (!doc?.root) return [];
  const nodes = walkInteractiveNodes(doc.root, {
    ...ctx,
    frameId: doc.root.frameId || ctx.frameId,
  });
  try {
    const evaluated = (await sendCommand(target, 'Runtime.evaluate', {
      expression: EVALUATE_FOCUSABLE_JS,
      returnByValue: true,
    })) as { result?: { value?: EvaluatedControl[] } } | undefined;
    const values = evaluated?.result?.value;
    if (Array.isArray(values)) mergeEvaluatedCoords(nodes, values);
  } catch {
    // pierce walk is enough when Runtime.evaluate is blocked
  }
  return nodes;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

export async function collectInteractiveDetailed(tabId: number): Promise<CollectInteractiveResult> {
  const collected = await collectFromTarget(tabId, { tabId, frameId: 'main' });
  const inaccessibleIframes: InaccessibleIframe[] = [];

  let targets: Awaited<ReturnType<typeof getTargets>> = [];
  try {
    targets = await getTargets();
  } catch (error) {
    return {
      nodes: collected,
      inaccessibleIframes: [{ targetId: 'getTargets', error: errorMessage(error) }],
    };
  }

  for (const iframe of targets) {
    if (iframe.tabId !== tabId || iframe.type !== 'iframe' || !iframe.id) continue;
    try {
      const extra = await collectFromTarget(
        { targetId: iframe.id },
        { tabId, frameId: iframe.id, targetId: iframe.id, inIframe: true },
      );
      pushUnique(collected, extra);
    } catch (error) {
      inaccessibleIframes.push({
        targetId: iframe.id,
        url: iframe.url || undefined,
        error: errorMessage(error),
      });
    }
  }
  return { nodes: collected, inaccessibleIframes };
}

export async function collectInteractive(tabId: number): Promise<CdpInteractiveNode[]> {
  return (await collectInteractiveDetailed(tabId)).nodes;
}
