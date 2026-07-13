import { describe, expect, it, vi } from 'vitest';
import { PortLease } from '../port-lease';

describe('PortLease', () => {
  it('does not let an old disconnect release the replacement port', () => {
    const lease = new PortLease<{ disconnect(): void }>();
    const oldPort = { disconnect: vi.fn() };
    const newPort = { disconnect: vi.fn() };

    lease.replace(oldPort);
    lease.replace(newPort);

    expect(oldPort.disconnect).toHaveBeenCalledTimes(1);
    expect(lease.release(oldPort)).toBe(false);
    expect(lease.current).toBe(newPort);
    expect(lease.release(newPort)).toBe(true);
    expect(lease.current).toBeNull();
  });
});
