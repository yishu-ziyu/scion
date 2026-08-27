import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTaskKeepAliveListener, syncTaskKeepAlive, TASK_KEEP_ALIVE_ALARM } from '../task-keep-alive';

describe('task keep-alive alarm', () => {
  const create = vi.fn<(name: string, info: { periodInMinutes?: number }) => Promise<void>>(async () => undefined);
  const clear = vi.fn<(name: string) => Promise<boolean>>(async () => true);
  const get = vi.fn<(name: string) => Promise<{ name: string } | undefined>>(async () => undefined);
  const addListener = vi.fn<(callback: (alarm: { name: string }) => void) => void>();

  beforeEach(() => {
    create.mockClear();
    clear.mockClear();
    get.mockReset();
    get.mockResolvedValue(undefined);
    addListener.mockClear();
    vi.stubGlobal('chrome', {
      alarms: { create, clear, get, onAlarm: { addListener } },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a 20-25s period alarm when work is running', async () => {
    await syncTaskKeepAlive(true);
    expect(create).toHaveBeenCalledWith(
      TASK_KEEP_ALIVE_ALARM,
      expect.objectContaining({ periodInMinutes: expect.any(Number) }),
    );
    const period = create.mock.calls[0]?.[1]?.periodInMinutes as number;
    expect(period).toBeGreaterThanOrEqual(20 / 60);
    expect(period).toBeLessThanOrEqual(25 / 60);
    expect(clear).not.toHaveBeenCalled();
  });

  it('does not recreate an existing keep-alive alarm', async () => {
    get.mockResolvedValue({ name: TASK_KEEP_ALIVE_ALARM });
    await syncTaskKeepAlive(true);
    expect(create).not.toHaveBeenCalled();
  });

  it('clears the alarm when no running work remains', async () => {
    await syncTaskKeepAlive(false);
    expect(clear).toHaveBeenCalledWith(TASK_KEEP_ALIVE_ALARM);
    expect(create).not.toHaveBeenCalled();
  });

  it('wakes the worker without starting a second recover', () => {
    installTaskKeepAliveListener();
    expect(addListener).toHaveBeenCalledTimes(1);
    const handler = addListener.mock.calls[0]?.[0] as (alarm: { name: string }) => void;
    handler({ name: TASK_KEEP_ALIVE_ALARM });
    handler({ name: 'other' });
    expect(create).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });
});
