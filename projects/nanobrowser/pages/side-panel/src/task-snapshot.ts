import type { TaskEvent, TaskSnapshot } from '@extension/storage';

type SnapshotEventMeta = Pick<TaskEvent, 'taskId' | 'roundId' | 'revision'>;

export function mergeTaskSnapshot(
  current: TaskSnapshot | null,
  incoming: TaskSnapshot,
  event?: SnapshotEventMeta,
  replacementTaskId?: string | null,
): TaskSnapshot | null {
  if (
    event &&
    (event.taskId !== incoming.id || event.roundId !== incoming.currentRoundId || event.revision !== incoming.revision)
  ) {
    return current;
  }
  if (!current) return !replacementTaskId || incoming.id === replacementTaskId ? incoming : null;
  if (current.id === incoming.id) return incoming.revision > current.revision ? incoming : current;
  return incoming.id === replacementTaskId ? incoming : current;
}
