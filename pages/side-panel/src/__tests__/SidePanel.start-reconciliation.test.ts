import { describe, expect, it } from 'vitest';
import type { TaskSnapshot } from '@extension/storage';
import { acceptedStartSnapshotRequest, reconnectTaskSnapshotRequest } from '../SidePanel';
import { mergeTaskSnapshot } from '../task-snapshot';

const runningSnapshot = {
  id: 'task-started-without-event',
  goalSummary: 'Open the page',
  status: 'running',
  revision: 1,
  activeTabId: 1,
  currentRoundId: 'round-1',
  targetRefs: [],
  rounds: [],
  createdAt: 1,
  updatedAt: 1,
} as TaskSnapshot;

describe('SidePanel accepted task start reconciliation', () => {
  it('hydrates the pending start from get_task when its task_event was missed', () => {
    const request = acceptedStartSnapshotRequest(
      { taskId: runningSnapshot.id, commandId: 'start-command' },
      { taskId: runningSnapshot.id, commandId: 'start-command', type: 'start' },
      { taskId: runningSnapshot.id, commandId: 'start-command', accepted: true },
    );

    expect(request).toEqual({ type: 'get_task', taskId: runningSnapshot.id });
    // No task_event arrives. The response must still replace the empty task surface.
    expect(mergeTaskSnapshot(null, runningSnapshot, undefined, request?.taskId)).toBe(runningSnapshot);
  });

  it('does not fetch for a different command or a non-launch command', () => {
    expect(
      acceptedStartSnapshotRequest(
        { taskId: runningSnapshot.id, commandId: 'start-command' },
        { taskId: runningSnapshot.id, commandId: 'pause-command', type: 'pause' },
        { taskId: runningSnapshot.id, commandId: 'pause-command', accepted: true },
      ),
    ).toBeNull();
  });

  it('restores the pending start after reconnect before falling back to the active task', () => {
    expect(reconnectTaskSnapshotRequest(null, { taskId: runningSnapshot.id })).toEqual({
      type: 'get_task',
      taskId: runningSnapshot.id,
    });
    expect(reconnectTaskSnapshotRequest({ taskId: 'cancelling-task' }, { taskId: runningSnapshot.id })).toEqual({
      type: 'get_task',
      taskId: 'cancelling-task',
    });
    expect(reconnectTaskSnapshotRequest(null, null)).toEqual({ type: 'get_active_task' });
  });
});
