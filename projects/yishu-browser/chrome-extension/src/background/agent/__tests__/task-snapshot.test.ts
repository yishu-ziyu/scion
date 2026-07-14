import { describe, expect, it } from 'vitest';
import type { TaskSnapshot } from '@extension/storage';
import { mergeTaskSnapshot } from '../../../../../pages/side-panel/src/task-snapshot';

function snapshot(
  id: string,
  revision: number,
  status: TaskSnapshot['status'] = 'running',
  roundId = `${id}-round`,
): TaskSnapshot {
  return {
    id,
    goalSummary: 'Task',
    status,
    revision,
    activeTabId: 7,
    currentRoundId: roundId,
    targetRefs: [],
    rounds: [
      {
        id: roundId,
        instructionSummary: 'Instruction',
        status,
        commandAcks: {},
        criteria: [],
        attempts: [],
        approvals: [],
        evidence: [],
      },
    ],
    createdAt: 1,
    updatedAt: revision,
  };
}

describe('SidePanel task snapshot ordering', () => {
  it('ignores same-task snapshots that do not increase the revision', () => {
    const current = snapshot('task-1', 4);

    expect(mergeTaskSnapshot(current, snapshot('task-1', 3))).toBe(current);
    expect(mergeTaskSnapshot(current, snapshot('task-1', 4))).toBe(current);
    expect(mergeTaskSnapshot(current, snapshot('task-1', 5))).toMatchObject({ revision: 5 });
  });

  it('rejects events whose top-level identity does not match their snapshot', () => {
    const current = snapshot('task-1', 4);
    const incoming = snapshot('task-1', 5);

    expect(
      mergeTaskSnapshot(current, incoming, { taskId: 'task-2', roundId: incoming.currentRoundId, revision: 5 }),
    ).toBe(current);
    expect(mergeTaskSnapshot(current, incoming, { taskId: 'task-1', roundId: 'wrong-round', revision: 5 })).toBe(
      current,
    );
    expect(
      mergeTaskSnapshot(current, incoming, { taskId: 'task-1', roundId: incoming.currentRoundId, revision: 6 }),
    ).toBe(current);
  });

  it('does not replace the selected task until its snapshot is explicitly cleared', () => {
    const incoming = snapshot('task-2', 1);

    expect(mergeTaskSnapshot(snapshot('task-1', 4), incoming)).toMatchObject({ id: 'task-1' });
    expect(mergeTaskSnapshot(snapshot('task-1', 5, 'completed'), incoming)).toMatchObject({ id: 'task-1' });
    expect(mergeTaskSnapshot(snapshot('task-1', 5, 'completed'), incoming, undefined, 'task-2')).toBe(incoming);
    expect(mergeTaskSnapshot(null, incoming)).toBe(incoming);
    expect(mergeTaskSnapshot(null, snapshot('task-1', 5), undefined, 'task-2')).toBeNull();
  });
});
