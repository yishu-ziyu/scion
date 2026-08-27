import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cdpHandleFromDomNode, clickCdpElement, debuggerTargetForHandle } from '../click';
import type { CdpElementHandle } from '../types';

function mockDebugger() {
  return {
    attach: vi.fn(async () => undefined),
    detach: vi.fn(async () => undefined),
    sendCommand: vi.fn(async (...args: unknown[]) => {
      void args;
      return {};
    }),
    getTargets: vi.fn(async () => []),
  };
}

describe('clickCdpElement', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('clicks an iframe handle with element.click on that target', async () => {
    const api = mockDebugger();
    api.sendCommand.mockImplementation(async (...args: unknown[]) => {
      const method = args[1];
      if (method === 'DOM.resolveNode') {
        return { object: { objectId: 'obj-22' } };
      }
      return {};
    });
    vi.stubGlobal('chrome', { debugger: api });

    const handle: CdpElementHandle = {
      tabId: 7,
      frameId: 'iframe-pay',
      backendNodeId: 22,
      targetId: 'tgt-iframe',
    };
    await clickCdpElement(handle);

    expect(api.attach).toHaveBeenCalledWith({ targetId: 'tgt-iframe' }, '1.3');
    expect(api.sendCommand).toHaveBeenCalledWith({ targetId: 'tgt-iframe' }, 'DOM.resolveNode', { backendNodeId: 22 });
    expect(api.sendCommand).toHaveBeenCalledWith({ targetId: 'tgt-iframe' }, 'Runtime.callFunctionOn', {
      objectId: 'obj-22',
      functionDeclaration: 'function() { if (this && this.click) { this.click(); return true; } return false; }',
    });
    const methods = api.sendCommand.mock.calls.map(call => String(call[1]));
    expect(methods).not.toContain('Input.dispatchMouseEvent');
    expect(api.detach).not.toHaveBeenCalled();
  });

  it('falls back to Input.dispatchMouseEvent with buttons: 1', async () => {
    const api = mockDebugger();
    api.sendCommand.mockImplementation(async (...args: unknown[]) => {
      const method = args[1];
      if (method === 'DOM.resolveNode') return {};
      if (method === 'DOM.getBoxModel') {
        return { model: { content: [10, 20, 30, 20, 30, 40, 10, 40] } };
      }
      return {};
    });
    vi.stubGlobal('chrome', { debugger: api });
    await clickCdpElement({
      tabId: 7,
      frameId: 'iframe-pay',
      backendNodeId: 22,
      targetId: 'tgt-iframe',
    });
    expect(api.sendCommand).toHaveBeenCalledWith(
      { targetId: 'tgt-iframe' },
      'Input.dispatchMouseEvent',
      expect.objectContaining({ type: 'mousePressed', x: 20, y: 30, button: 'left', buttons: 1, clickCount: 1 }),
    );
  });

  it('uses coordinates on the handle and skips getBoxModel', async () => {
    const api = mockDebugger();
    vi.stubGlobal('chrome', { debugger: api });
    api.sendCommand.mockImplementation(async (...args: unknown[]) => {
      if (args[1] === 'DOM.resolveNode') return {};
      return {};
    });
    await clickCdpElement({
      tabId: 7,
      frameId: 'main',
      backendNodeId: 13,
      x: 8,
      y: 9,
    });
    const methods = api.sendCommand.mock.calls.map(call => String(call[1]));
    expect(methods).not.toContain('DOM.getBoxModel');
    expect(methods.filter(method => method === 'Input.dispatchMouseEvent')).toHaveLength(2);
  });
});

describe('cdpHandleFromDomNode', () => {
  it('requires tabId, cdpFrameId, and backendNodeId', () => {
    expect(cdpHandleFromDomNode({ tabId: 1, cdpFrameId: 'main', backendNodeId: 13 })).toEqual({
      tabId: 1,
      frameId: 'main',
      backendNodeId: 13,
      targetId: undefined,
      x: undefined,
      y: undefined,
    });
    expect(cdpHandleFromDomNode({ tabId: 1, backendNodeId: 13 })).toBeNull();
    expect(debuggerTargetForHandle({ tabId: 1, frameId: 'f', backendNodeId: 1, targetId: 'x' })).toEqual({
      targetId: 'x',
    });
  });
});
