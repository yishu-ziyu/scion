import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EVALUATE_FOCUSABLE_JS,
  collectInteractive,
  collectInteractiveDetailed,
  walkInteractiveNodes,
} from '../collect';
import { iframeShadowFrameDocument, iframeShadowMainDocument } from './iframe-shadow-fixture';

function mockDebugger() {
  return {
    attach: vi.fn(async () => undefined),
    detach: vi.fn(async () => undefined),
    sendCommand: vi.fn(async () => ({})),
    getTargets: vi.fn(async () => []),
  };
}

describe('walkInteractiveNodes', () => {
  it('finds the shadow 结算 button by piercing shadowRoots', () => {
    const nodes = walkInteractiveNodes(iframeShadowMainDocument(), { tabId: 7, frameId: 'main' });
    const pay = nodes.find(node => node.text === '结算');
    expect(pay).toMatchObject({
      tagName: 'button',
      inShadow: true,
      handle: { tabId: 7, backendNodeId: 13 },
    });
    expect(nodes.some(node => node.text === '取消')).toBe(true);
    expect(nodes.some(node => node.text === '提交')).toBe(false);
  });

  it('never turns an input value into CDP fallback text', () => {
    const secret = 'PASSWORD_SENTINEL_9471';
    const nodes = walkInteractiveNodes(
      {
        nodeId: 1,
        backendNodeId: 11,
        nodeType: 1,
        nodeName: 'INPUT',
        localName: 'input',
        attributes: ['type', 'password', 'value', secret],
        children: [],
      },
      { tabId: 7, frameId: 'main' },
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.text).toBeUndefined();
    expect(JSON.stringify(nodes)).not.toContain(secret);
    expect(EVALUATE_FOCUSABLE_JS).not.toContain('el.value');
  });

  it('finds the iframe 提交 button on the iframe document', () => {
    const nodes = walkInteractiveNodes(iframeShadowFrameDocument(), {
      tabId: 7,
      frameId: 'iframe-pay',
      targetId: 'tgt-iframe',
      inIframe: true,
    });
    const submit = nodes.find(node => node.type === 'submit');
    expect(submit).toMatchObject({
      tagName: 'button',
      text: '提交',
      inIframe: true,
      handle: { tabId: 7, frameId: 'iframe-pay', backendNodeId: 22, targetId: 'tgt-iframe' },
    });
  });
});

describe('collectInteractive', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('attaches the tab and each iframe target, and returns both buttons', async () => {
    const api = mockDebugger();
    api.getTargets.mockResolvedValue([
      { id: 'page-1', type: 'page', title: 'main', url: 'https://shop.test', attached: true, tabId: 7 },
      { id: 'tgt-iframe', type: 'iframe', title: 'pay', url: 'https://pay.test', attached: false, tabId: 7 },
    ] as never);
    api.sendCommand.mockImplementation(async (...args: unknown[]) => {
      const target = args[0] as { tabId?: number; targetId?: string };
      const method = args[1] as string;
      if (method === 'DOM.getDocument' && target.tabId === 7) {
        return { root: iframeShadowMainDocument() };
      }
      if (method === 'DOM.getDocument' && target.targetId === 'tgt-iframe') {
        return { root: iframeShadowFrameDocument() };
      }
      if (method === 'Runtime.evaluate') {
        return { result: { value: [] } };
      }
      return {};
    });
    vi.stubGlobal('chrome', { debugger: api });

    const nodes = await collectInteractive(7);
    expect(api.attach).toHaveBeenCalledWith({ tabId: 7 }, '1.3');
    expect(api.attach).toHaveBeenCalledWith({ targetId: 'tgt-iframe' }, '1.3');
    expect(api.sendCommand).toHaveBeenCalledWith(
      { tabId: 7 },
      'DOM.getDocument',
      expect.objectContaining({ pierce: true }),
    );
    expect(api.sendCommand).toHaveBeenCalledWith(
      { targetId: 'tgt-iframe' },
      'DOM.getDocument',
      expect.objectContaining({ pierce: true }),
    );
    const evaluateCalls = (api.sendCommand.mock.calls as unknown[][]).filter(call => call[1] === 'Runtime.evaluate');
    expect(evaluateCalls).toHaveLength(2);
    for (const call of evaluateCalls) {
      expect(call[2]).toEqual({ expression: EVALUATE_FOCUSABLE_JS, returnByValue: true });
    }

    expect(nodes.find(node => node.text === '结算')?.handle.backendNodeId).toBe(13);
    expect(nodes.find(node => node.text === '提交')?.handle).toMatchObject({
      backendNodeId: 22,
      targetId: 'tgt-iframe',
    });
  });

  it('keeps one 提交 when the main document also embeds the iframe tree', async () => {
    const api = mockDebugger();
    const main = iframeShadowMainDocument();
    const iframe = iframeShadowFrameDocument();
    const iframeEl = main.children?.[0]?.children?.find(node => node.localName === 'iframe');
    if (iframeEl) iframeEl.contentDocument = iframe;
    api.getTargets.mockResolvedValue([
      { id: 'tgt-iframe', type: 'iframe', title: 'pay', url: 'https://pay.test', attached: false, tabId: 7 },
    ] as never);
    api.sendCommand.mockImplementation(async (...args: unknown[]) => {
      const target = args[0] as { tabId?: number; targetId?: string };
      const method = args[1] as string;
      if (method === 'DOM.getDocument' && target.tabId === 7) return { root: main };
      if (method === 'DOM.getDocument' && target.targetId === 'tgt-iframe') return { root: iframe };
      if (method === 'Runtime.evaluate') return { result: { value: [] } };
      return {};
    });
    vi.stubGlobal('chrome', { debugger: api });
    const nodes = await collectInteractive(7);
    expect(nodes.filter(node => node.text === '提交')).toHaveLength(1);
    expect(nodes.find(node => node.text === '提交')?.handle.targetId).toBe('tgt-iframe');
  });

  it('records inaccessible iframe targets instead of pretending the pay form is absent', async () => {
    const api = mockDebugger();
    api.getTargets.mockResolvedValue([
      { id: 'tgt-iframe', type: 'iframe', title: 'pay', url: 'https://pay.test', attached: false, tabId: 7 },
    ] as never);
    api.attach.mockImplementation(async (...args: unknown[]) => {
      const target = args[0] as { tabId?: number; targetId?: string };
      if (target?.targetId === 'tgt-iframe') throw new Error('Target closed');
    });
    api.sendCommand.mockImplementation(async (...args: unknown[]) => {
      const target = args[0] as { tabId?: number; targetId?: string };
      const method = args[1] as string;
      if (method === 'DOM.getDocument' && target.tabId === 7) {
        return { root: iframeShadowMainDocument() };
      }
      if (method === 'Runtime.evaluate') return { result: { value: [] } };
      return {};
    });
    vi.stubGlobal('chrome', { debugger: api });

    const result = await collectInteractiveDetailed(7);
    expect(result.nodes.some(node => node.text === '提交')).toBe(false);
    expect(result.inaccessibleIframes).toEqual([
      { targetId: 'tgt-iframe', url: 'https://pay.test', error: 'Target closed' },
    ]);
  });
});
