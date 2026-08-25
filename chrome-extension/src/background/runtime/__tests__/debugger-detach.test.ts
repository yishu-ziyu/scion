import { describe, expect, it, vi } from 'vitest';
import { createDebuggerDetachHandler } from '../debugger-detach';

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
}

describe('debugger detach handler', () => {
  it('contains task interruption failures', async () => {
    const interruptActive = vi.fn(async () => {
      throw new Error('interruption failed');
    });
    const onError = vi.fn();
    const handler = createDebuggerDetachHandler({
      interruptActive,
      isCurrentTaskTab: tabId => tabId === 7,
      onError,
    });

    expect(() => handler({ tabId: 7 }, 'canceled_by_user')).not.toThrow();
    await flushMicrotasks();

    expect(interruptActive).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith('Failed to interrupt task after debugger cancellation', expect.any(Error));
  });

  it('runs one interruption while a cancellation interruption is still in flight', async () => {
    let releaseInterrupt: (() => void) | undefined;
    const interruptActive = vi.fn(
      () =>
        new Promise<void>(resolve => {
          releaseInterrupt = resolve;
        }),
    );
    const handler = createDebuggerDetachHandler({
      interruptActive,
      isCurrentTaskTab: tabId => tabId === 7,
      onError: vi.fn(),
    });

    handler({ tabId: 7 }, 'canceled_by_user');
    handler({ tabId: 7 }, 'canceled_by_user');
    await flushMicrotasks();

    expect(interruptActive).toHaveBeenCalledOnce();
    releaseInterrupt?.();
    await flushMicrotasks();
  });

  it('ignores ordinary detach reasons and non-tab targets', async () => {
    const interruptActive = vi.fn(async () => undefined);
    const handler = createDebuggerDetachHandler({
      interruptActive,
      isCurrentTaskTab: tabId => tabId === 7,
      onError: vi.fn(),
    });

    handler({ tabId: 7 }, 'target_closed');
    handler({}, 'canceled_by_user');
    handler({ tabId: 8 }, 'canceled_by_user');
    await flushMicrotasks();

    expect(interruptActive).not.toHaveBeenCalled();
  });

  it('does not leak when error reporting itself fails', async () => {
    const handler = createDebuggerDetachHandler({
      interruptActive: vi.fn(async () => {
        throw new Error('interruption failed');
      }),
      isCurrentTaskTab: tabId => tabId === 7,
      onError: vi.fn(() => {
        throw new Error('logger failed');
      }),
    });

    handler({ tabId: 7 }, 'canceled_by_user');
    await flushMicrotasks();
  });
});
