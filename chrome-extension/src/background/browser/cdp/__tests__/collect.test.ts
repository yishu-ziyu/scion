import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectInteractive, walkInteractiveNodes } from '../collect';
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
    expect(api.sendCommand).toHaveBeenCalledWith(
      { tabId: 7 },
      'Runtime.evaluate',
      expect.objectContaining({ returnByValue: true }),
    );

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
});
