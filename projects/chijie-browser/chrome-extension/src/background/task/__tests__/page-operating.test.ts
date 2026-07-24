import { describe, expect, it, vi } from 'vitest';
import { shouldShowPageOperatingBar, syncPageOperatingBar } from '../page-operating';

describe('page operating bar (design/005 P3)', () => {
  it('shows only while task status is running', () => {
    expect(shouldShowPageOperatingBar('running')).toBe(true);
    expect(shouldShowPageOperatingBar('waiting_approval')).toBe(false);
    expect(shouldShowPageOperatingBar('completed')).toBe(false);
    expect(shouldShowPageOperatingBar(undefined)).toBe(false);
  });

  it('sends active true to task tab when running', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await syncPageOperatingBar({ status: 'running', activeTabId: 42 }, send);
    expect(send).toHaveBeenCalledWith(42, {
      type: 'CHIJIE_PAGE_OPERATING',
      active: true,
      text: '正在替你操作此页',
    });
  });

  it('sends active false when completed', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await syncPageOperatingBar({ status: 'completed', activeTabId: 7 }, send);
    expect(send).toHaveBeenCalledWith(7, {
      type: 'CHIJIE_PAGE_OPERATING',
      active: false,
      text: undefined,
    });
  });

  it('skips invalid tab ids', async () => {
    const send = vi.fn();
    await syncPageOperatingBar({ status: 'running', activeTabId: -1 }, send);
    await syncPageOperatingBar(null, send);
    expect(send).not.toHaveBeenCalled();
  });

  it('swallows send failures', async () => {
    const send = vi.fn().mockRejectedValue(new Error('no receiver'));
    await expect(syncPageOperatingBar({ status: 'running', activeTabId: 1 }, send)).resolves.toBeUndefined();
  });
});
