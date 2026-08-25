import { describe, expect, it, vi } from 'vitest';
import {
  PAGE_OPERATING_FOLLOW_LABEL,
  PAGE_OPERATING_TAKEOVER_LABEL,
  PAGE_OPERATING_TEXT,
  createPageOperatingBarSyncQueue,
  pageOperatingCancelCommand,
  pageOperatingFollowCommand,
  pageOperatingTakeoverCommand,
  shouldShowPageOperatingBar,
  syncPageOperatingBar,
} from '../page-operating';

describe('page operating bar (design/005 P3)', () => {
  it('shows only while task status is running', () => {
    expect(shouldShowPageOperatingBar('running')).toBe(true);
    expect(shouldShowPageOperatingBar('completed')).toBe(false);
    expect(shouldShowPageOperatingBar(undefined)).toBe(false);
  });

  it('sends active true to task tab when running', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await syncPageOperatingBar({ status: 'running', activeTabId: 42 }, send);
    expect(send).toHaveBeenCalledWith(42, {
      type: 'CHIJIE_PAGE_OPERATING',
      active: true,
      text: PAGE_OPERATING_TEXT,
      follow: false,
      followLabel: PAGE_OPERATING_FOLLOW_LABEL,
      takeoverLabel: PAGE_OPERATING_TAKEOVER_LABEL,
    });
  });

  it('sends active false when completed', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await syncPageOperatingBar({ status: 'completed', activeTabId: 7 }, send);
    expect(send).toHaveBeenCalledWith(7, {
      type: 'CHIJIE_PAGE_OPERATING',
      active: false,
      text: undefined,
      follow: false,
      followLabel: PAGE_OPERATING_FOLLOW_LABEL,
      takeoverLabel: PAGE_OPERATING_TAKEOVER_LABEL,
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

  it('delivers completed=false after a slower running=true sync', async () => {
    let releaseRunning!: () => void;
    const snapshots = [
      { status: 'running', activeTabId: 7 },
      { status: 'completed', activeTabId: 7 },
    ];
    const loadSnapshot = vi.fn(async () => snapshots.shift() ?? null);
    const send = vi.fn(async (_tabId: number, message: { active: boolean }) => {
      if (message.active) {
        await new Promise<void>(resolve => {
          releaseRunning = resolve;
        });
      }
    });
    const sync = createPageOperatingBarSyncQueue(loadSnapshot, send, vi.fn());

    const running = sync();
    const completed = sync();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]?.[1]).toMatchObject({ active: true });
    releaseRunning();
    await Promise.all([running, completed]);

    expect(send.mock.calls.map(call => call[1].active)).toEqual([true, false]);
  });

  it('clears the bar from a previous task tab before syncing the next tab', async () => {
    const snapshots = [
      { status: 'running', activeTabId: 7 },
      { status: 'running', activeTabId: 8 },
      { status: 'completed', activeTabId: 8 },
    ];
    const loadSnapshot = vi.fn(async () => snapshots.shift() ?? null);
    const send = vi.fn().mockResolvedValue(undefined);
    const sync = createPageOperatingBarSyncQueue(loadSnapshot, send, vi.fn());

    await sync();
    await sync();
    await sync();

    expect(send.mock.calls.map(([tabId, message]) => [tabId, message.active])).toEqual([
      [7, true],
      [7, false],
      [8, true],
      [8, false],
    ]);
  });

  it.each(['paused', 'failed', 'cancelled'] as const)(
    'clears every shown tab when the task becomes %s',
    async status => {
      const snapshots = [
        { status: 'running', activeTabId: 7 },
        { status: 'running', activeTabId: 8 },
        { status, activeTabId: 8 },
      ];
      const loadSnapshot = vi.fn(async () => snapshots.shift() ?? null);
      const send = vi.fn().mockResolvedValue(undefined);
      const sync = createPageOperatingBarSyncQueue(loadSnapshot, send, vi.fn());

      await sync();
      await sync();
      await sync();

      expect(send.mock.calls.map(([tabId, message]) => [tabId, message.active])).toEqual([
        [7, true],
        [7, false],
        [8, true],
        [8, false],
      ]);
    },
  );

  it('cancels only from the tab the running task is driving', () => {
    const snapshot = { id: 'task-1', revision: 4, status: 'running', activeTabId: 42 };
    expect(pageOperatingCancelCommand(snapshot, 42, 'cmd-1')).toEqual({
      type: 'cancel',
      commandId: 'cmd-1',
      taskId: 'task-1',
      expectedRevision: 4,
    });
    expect(pageOperatingCancelCommand(snapshot, 9, 'cmd-2')).toBeNull();
    expect(pageOperatingCancelCommand({ ...snapshot, status: 'paused' }, 42, 'cmd-3')).toBeNull();
    expect(PAGE_OPERATING_TEXT).toBe('持节正在操作这个页面');
  });

  it('toggles follow and takeover only from the tab the running task is driving', () => {
    const snapshot = { id: 'task-1', revision: 4, status: 'running', activeTabId: 42 };
    expect(pageOperatingFollowCommand(snapshot, 42, 'cmd-f', true)).toEqual({
      type: 'set_follow',
      commandId: 'cmd-f',
      taskId: 'task-1',
      expectedRevision: 4,
      follow: true,
    });
    expect(pageOperatingTakeoverCommand(snapshot, 42, 'cmd-t')).toEqual({
      type: 'takeover',
      commandId: 'cmd-t',
      taskId: 'task-1',
      expectedRevision: 4,
    });
    expect(pageOperatingFollowCommand(snapshot, 9, 'cmd-x', true)).toBeNull();
    expect(pageOperatingTakeoverCommand({ ...snapshot, status: 'paused' }, 42, 'cmd-y')).toBeNull();
  });
});
