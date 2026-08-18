import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CdpElementHandle } from '../types';
import * as sessionApi from '../session';
import { attach, detach, getTargets, sendCommand } from '../session';

type DebuggerMock = {
  attach: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
  sendCommand: ReturnType<typeof vi.fn>;
  getTargets: ReturnType<typeof vi.fn>;
};

function mockDebugger(): DebuggerMock {
  return {
    attach: vi.fn(async () => undefined),
    detach: vi.fn(async () => undefined),
    sendCommand: vi.fn(async () => ({})),
    getTargets: vi.fn(async () => []),
  };
}

function installChrome(): DebuggerMock {
  const api = mockDebugger();
  vi.stubGlobal('chrome', { debugger: api });
  return api;
}

describe('cdp session', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exports attach, sendCommand, detach, getTargets, and normalizeTarget', () => {
    expect(Object.keys(sessionApi).sort()).toEqual([
      'attach',
      'detach',
      'getTargets',
      'normalizeTarget',
      'sendCommand',
    ]);
  });

  it('attaches with protocolVersion 1.3', async () => {
    const api = installChrome();
    await attach(7);
    expect(api.attach).toHaveBeenCalledOnce();
    expect(api.attach).toHaveBeenCalledWith({ tabId: 7 }, '1.3');
  });

  it('does not throw when the same tab is attached twice', async () => {
    const api = installChrome();
    api.attach
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Another debugger is already attached to the tab with id: 7.'));
    await attach(7);
    await expect(attach(7)).resolves.toBeUndefined();
    expect(api.attach).toHaveBeenCalledTimes(2);
  });

  it('does not throw when Chrome resolves both attach calls', async () => {
    const api = installChrome();
    await attach(7);
    await expect(attach(7)).resolves.toBeUndefined();
    expect(api.attach).toHaveBeenCalledTimes(2);
  });

  it('treats Chrome already-attached string rejections as success', async () => {
    const api = installChrome();
    api.attach.mockRejectedValue('Cannot attach to the target with given id already attached.');
    await expect(attach(3)).resolves.toBeUndefined();
  });

  it('treats an already-attached lastError-shaped object as success', async () => {
    const api = installChrome();
    api.attach.mockRejectedValue({ message: 'already attached' });
    await expect(attach(3)).resolves.toBeUndefined();
  });

  it('still throws when attach fails for another reason', async () => {
    const api = installChrome();
    api.attach.mockRejectedValue(new Error('No tab with given id 99.'));
    await expect(attach(99)).rejects.toThrow(/No tab with given id 99/);
  });

  it('sends a command to the attached tab and returns the result', async () => {
    const api = installChrome();
    api.sendCommand.mockResolvedValue({ root: { nodeId: 1 } });
    const result = await sendCommand(7, 'DOM.getDocument', { depth: 0 });
    expect(api.sendCommand).toHaveBeenCalledWith({ tabId: 7 }, 'DOM.getDocument', { depth: 0 });
    expect(result).toEqual({ root: { nodeId: 1 } });
  });

  it('sends a command without params', async () => {
    const api = installChrome();
    await sendCommand(7, 'Runtime.enable');
    expect(api.sendCommand).toHaveBeenCalledWith({ tabId: 7 }, 'Runtime.enable');
  });

  it('propagates sendCommand failures', async () => {
    const api = installChrome();
    api.sendCommand.mockRejectedValue(new Error('Debugger is not attached to the tab with id: 7.'));
    await expect(sendCommand(7, 'Page.enable')).rejects.toThrow(/Debugger is not attached/);
  });

  it('detaches the tab', async () => {
    const api = installChrome();
    await detach(7);
    expect(api.detach).toHaveBeenCalledOnce();
    expect(api.detach).toHaveBeenCalledWith({ tabId: 7 });
  });

  it('does not throw when detach reports the debugger is not attached', async () => {
    const api = installChrome();
    api.detach.mockRejectedValue(new Error('Debugger is not attached to the tab with id: 7.'));
    await expect(detach(7)).resolves.toBeUndefined();
  });

  it('still throws when detach fails for another reason', async () => {
    const api = installChrome();
    api.detach.mockRejectedValue(new Error('No tab with given id 99.'));
    await expect(detach(99)).rejects.toThrow(/No tab with given id 99/);
  });

  it('attaches, sends, then detaches on one tab', async () => {
    const api = installChrome();
    api.sendCommand.mockResolvedValue({ ok: true });
    await attach(11);
    await expect(sendCommand(11, 'Page.enable')).resolves.toEqual({ ok: true });
    await detach(11);
    expect(api.attach).toHaveBeenCalledWith({ tabId: 11 }, '1.3');
    expect(api.sendCommand).toHaveBeenCalledWith({ tabId: 11 }, 'Page.enable');
    expect(api.detach).toHaveBeenCalledWith({ tabId: 11 });
  });

  it('returns a clear error when chrome.debugger is missing', async () => {
    vi.stubGlobal('chrome', undefined);
    await expect(attach(1)).rejects.toThrow(/chrome\.debugger is not available/);
    await expect(sendCommand(1, 'Page.enable')).rejects.toThrow(/chrome\.debugger is not available/);
    await expect(detach(1)).rejects.toThrow(/chrome\.debugger is not available/);
  });

  it('returns a clear error when chrome exists but debugger methods are missing', async () => {
    vi.stubGlobal('chrome', {});
    await expect(attach(1)).rejects.toThrow(/chrome\.debugger is not available/);

    vi.stubGlobal('chrome', { debugger: {} });
    await expect(sendCommand(1, 'Page.enable')).rejects.toThrow(/chrome\.debugger is not available/);
    await expect(detach(1)).rejects.toThrow(/chrome\.debugger is not available/);
  });

  it('does not crash when reading chrome.debugger on a bare global', async () => {
    vi.stubGlobal('chrome', null);
    await expect(attach(1)).rejects.toBeInstanceOf(Error);
  });

  it('does not import page.ts or puppeteer-core', () => {
    const src = readFileSync(resolve(__dirname, '../session.ts'), 'utf8');
    expect(src).not.toMatch(/puppeteer|from ['"]\.\.\/page['"]/);
  });

  it('attaches and sends to an iframe targetId', async () => {
    const api = installChrome();
    api.sendCommand.mockResolvedValue({ root: { nodeId: 2 } });
    await attach({ targetId: 'iframe-1' });
    const result = await sendCommand({ targetId: 'iframe-1' }, 'DOM.getDocument', { pierce: true });
    expect(api.attach).toHaveBeenCalledWith({ targetId: 'iframe-1' }, '1.3');
    expect(api.sendCommand).toHaveBeenCalledWith({ targetId: 'iframe-1' }, 'DOM.getDocument', { pierce: true });
    expect(result).toEqual({ root: { nodeId: 2 } });
  });

  it('lists debugger targets including iframe entries', async () => {
    const api = installChrome();
    api.getTargets.mockResolvedValue([
      { id: 'page-1', type: 'page', title: 'main', url: 'https://example.test', attached: true, tabId: 7 },
      { id: 'iframe-1', type: 'iframe', title: 'pay', url: 'https://pay.example.test', attached: false, tabId: 7 },
    ]);
    const targets = await getTargets();
    expect(targets).toHaveLength(2);
    expect(targets.find(item => item.type === 'iframe')).toMatchObject({ id: 'iframe-1', tabId: 7 });
  });

  it('returns a clear error when getTargets is missing', async () => {
    vi.stubGlobal('chrome', {
      debugger: {
        attach: vi.fn(async () => undefined),
        detach: vi.fn(async () => undefined),
        sendCommand: vi.fn(async () => ({})),
      },
    });
    await expect(getTargets()).rejects.toThrow(/getTargets is not available/);
  });
});

describe('CdpElementHandle', () => {
  it('holds tabId, frameId, backendNodeId, and optional coordinates', () => {
    const handle: CdpElementHandle = {
      tabId: 4,
      frameId: 'frame-abc',
      backendNodeId: 88,
      targetId: 'iframe-1',
      x: 10,
      y: 20,
    };
    expect(handle).toEqual({
      tabId: 4,
      frameId: 'frame-abc',
      backendNodeId: 88,
      targetId: 'iframe-1',
      x: 10,
      y: 20,
    });
    const withoutPoint: CdpElementHandle = { tabId: 4, frameId: 'frame-abc', backendNodeId: 88 };
    expect(withoutPoint.x).toBeUndefined();
    expect(withoutPoint.y).toBeUndefined();
  });
});
