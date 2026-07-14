import { describe, expect, it, vi } from 'vitest';
import { PortRegistry } from '../port-registry';

describe('PortRegistry', () => {
  it('interrupts only after the last side panel disconnects', () => {
    const registry = new PortRegistry<{ postMessage(message: string): void }>();
    const oldPort = { postMessage: vi.fn() };
    const newPort = { postMessage: vi.fn() };
    registry.add(oldPort);
    registry.add(newPort);

    oldPort.postMessage.mockImplementation(() => {
      throw new Error('stale port');
    });
    registry.broadcast(port => port.postMessage('before-disconnect'));
    expect(newPort.postMessage).toHaveBeenCalledWith('before-disconnect');
    oldPort.postMessage.mockClear();
    newPort.postMessage.mockClear();

    expect(registry.release(oldPort)).toBe(false);
    registry.broadcast(port => port.postMessage('snapshot'));
    expect(oldPort.postMessage).not.toHaveBeenCalled();
    expect(newPort.postMessage).toHaveBeenCalledWith('snapshot');
    expect(registry.release(newPort)).toBe(true);
  });
});
